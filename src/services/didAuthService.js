/**
 * DID-Based Authentication Service
 * 
 * This handles cryptographic signature-based authentication using
 * Decentralized Identifiers (DIDs) and Ed25519 signatures. It provides
 * secure challenge-response authentication where:
 * 
 * 1. Server generates unique challenges for each login attempt
 * 2. Client signs the challenge with their Ed25519 private key
 * 3. Server verifies the signature against the DID's public key
 * 4. Server grants access upon successful verification
 * 
 */

import crypto from 'crypto'
import { base64 } from 'multiformats/bases/base64'
import { logger } from '../lib/logger.js'
import { getDatabase } from '../lib/db.js'
import { createSession } from '../lib/store.js'

/**
 * Generates a unique cryptographic challenge for DID authentication
 * 
 * Creates a time-bound challenge that must be signed by the client's
 * private key. The challenge includes timestamp and random data to
 * prevent replay attacks.
 * 
 * @param {string} did - The client's decentralized identifier
 * @returns {Promise<{challenge: string, challengeId: string}>} Challenge data
 */
export async function generateChallenge(did) {
    const db = getDatabase()
    
    // Generate a unique challenge with timestamp and random data
    const timestamp = Date.now()
    const randomBytes = crypto.randomBytes(32).toString('hex')
    const challenge = `${did}:${timestamp}:${randomBytes}`
    const challengeId = crypto.randomUUID()
    
    // Store challenge in database with 5-minute expiration
    const expiresAt = timestamp + (5 * 60 * 1000) // 5 minutes
    
    db.prepare(`
        INSERT INTO auth_challenges (challengeId, did, challenge, createdAt, expiresAt, used)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(challengeId, did, challenge, timestamp, expiresAt, 0)
    
    logger.info('Generated authentication challenge', { 
        did, 
        challengeId, 
        expiresAt: new Date(expiresAt).toISOString() 
    })
    
    return { challenge, challengeId }
}

/**
 * Verifies a signed challenge against a DID's public key
 * 
 * Validates that:
 * 1. Challenge exists and hasn't expired
 * 2. Challenge hasn't been used before
 * 3. Signature is valid for the challenge using the DID's public key
 * 4. DID format is valid
 * 
 * @param {string} did - The client's decentralized identifier  
 * @param {string} challengeId - The challenge identifier
 * @param {string} signature - Base64-encoded signature of the challenge
 * @returns {Promise<boolean>} True if verification succeeds
 */
export async function verifySignedChallenge(did, challengeId, signature) {
    const db = getDatabase()
    
    try {
        // Retrieve and validate challenge
        const challengeRecord = db.prepare(`
            SELECT challenge, expiresAt, used 
            FROM auth_challenges 
            WHERE challengeId = ? AND did = ?
        `).get(challengeId, did)
        
        if (!challengeRecord) {
            logger.warn('Challenge not found', { did, challengeId })
            return false
        }
        
        // Debug timing info
        const now = Date.now()
        const timeRemaining = challengeRecord.expiresAt - now
        logger.info('Challenge timing debug', { 
            did, 
            challengeId, 
            used: challengeRecord.used,
            expiresAt: new Date(challengeRecord.expiresAt).toISOString(),
            timeRemainingMs: timeRemaining,
            isExpired: now > challengeRecord.expiresAt
        })
        
        if (challengeRecord.used) {
            logger.warn('Challenge already used', { did, challengeId })
            return false
        }
        
        if (now > challengeRecord.expiresAt) {
            logger.warn('Challenge expired', { did, challengeId, timeRemaining })
            return false
        }
        
        // Verify signature using pure Ed25519
        const challengeBytes = new TextEncoder().encode(challengeRecord.challenge)
        const signatureBytes = base64.baseDecode(signature)
        
        logger.info('Signature verification debug', {
            did,
            challengeId,
            challengeLength: challengeRecord.challenge.length,
            challengeBytesLength: challengeBytes.length,
            signatureLength: signature.length,
            signatureBytesLength: signatureBytes.length,
            challenge: challengeRecord.challenge,
            signatureBase64: signature.substring(0, 32) + '...'
        })
        
        try {
            // Extract public key from DID
            const publicKey = extractPublicKeyFromDid(did)
            if (!publicKey) {
                logger.error('Failed to extract public key from DID', { did })
                return false
            }
            
            logger.info('Public key extracted', {
                did,
                publicKeyLength: publicKey.length,
                publicKeyHex: Array.from(publicKey).map(b => b.toString(16).padStart(2, '0')).join('')
            })
            
            // Use Node.js crypto for Ed25519 verification
            const isValid = crypto.verify(
                null, // Ed25519 doesn't use a hash algorithm
                challengeBytes,
                {
                    key: publicKey,
                    format: 'der',
                    type: 'spki'
                },
                signatureBytes
            )
            
            logger.info('Signature verification attempt', { 
                did, 
                challengeId, 
                isValid
            })
            
            if (isValid) {
                // Mark challenge as used to prevent replay
                db.prepare(`
                    UPDATE auth_challenges 
                    SET used = 1 
                    WHERE challengeId = ?
                `).run(challengeId)
                
                logger.info('Challenge verification successful', { did, challengeId })
                return true
            } else {
                logger.warn('Invalid signature for challenge', { did, challengeId })
                return false
            }
            
        } catch (error) {
            logger.error('Signature verification error', { 
                did, 
                challengeId, 
                error: error.message,
                signatureLength: signatureBytes.length
            })
            return false
        }
        
    } catch (error) {
        logger.error('Challenge verification failed', { 
            did, 
            challengeId, 
            error: error.message 
        })
        return false
    }
}

/**
 * Extracts the Ed25519 public key from a did:key identifier
 * 
 * @param {string} did - The decentralized identifier (did:key format)
 * @returns {Buffer|null} The Ed25519 public key in DER format
 */
function extractPublicKeyFromDid(did) {
    try {
        if (!did.startsWith('did:key:z6Mk')) {
            logger.error('Unsupported DID format, only did:key with Ed25519 supported', { did })
            return null
        }
        
        // Extract the multibase-encoded key part
        const keyPart = did.replace('did:key:', '')
        
        // Decode from base58btc (z prefix)
        const keyBytes = base58btcDecode(keyPart)
        
        // Remove the multicodec prefix (0xed01 for Ed25519)
        if (keyBytes.length < 34 || keyBytes[0] !== 0xed || keyBytes[1] !== 0x01) {
            logger.error('Invalid Ed25519 multicodec prefix in DID', { did })
            return null
        }
        
        const rawPublicKey = keyBytes.slice(2) // Remove 2-byte multicodec prefix
        
        // Convert to DER format for Node.js crypto
        const derPublicKey = createEd25519DerPublicKey(rawPublicKey)
        
        return derPublicKey
        
    } catch (error) {
        logger.error('Failed to extract public key from DID', { did, error: error.message })
        return null
    }
}

/**
 * Simple base58btc decoder for DID keys
 */
function base58btcDecode(encoded) {
    if (!encoded.startsWith('z')) {
        throw new Error('Invalid base58btc encoding - must start with z')
    }
    
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    const input = encoded.slice(1) // Remove 'z' prefix
    
    let result = []
    for (let i = 0; i < input.length; i++) {
        let carry = alphabet.indexOf(input[i])
        if (carry < 0) throw new Error('Invalid base58 character')
        
        for (let j = 0; j < result.length; j++) {
            carry += result[j] * 58
            result[j] = carry & 0xff
            carry >>= 8
        }
        
        while (carry > 0) {
            result.push(carry & 0xff)
            carry >>= 8
        }
    }
    
    return new Uint8Array(result.reverse())
}

/**
 * Creates a DER-encoded Ed25519 public key
 */
function createEd25519DerPublicKey(rawPublicKey) {
    // Ed25519 OID: 1.3.101.112
    const oid = new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00])
    const derKey = new Uint8Array(oid.length + rawPublicKey.length)
    derKey.set(oid)
    derKey.set(rawPublicKey, oid.length)
    return Buffer.from(derKey)
}


/**
 * Creates an authenticated session after successful signature verification
 * 
 * @param {string} did - The verified DID
 * @param {string} email - The associated email address (optional)
 * @returns {Promise<{sessionId: string, did: string}>} Session information
 */
export async function createAuthenticatedSession(did, email = null) {
    try {
        // If email is provided, verify the DID-email mapping exists
        if (email) {
            const db = getDatabase()
            const mapping = db.prepare(`
                SELECT did FROM did_email_mapping WHERE email = ? AND did = ?
            `).get(email, did)
            
            if (!mapping) {
                logger.warn('DID-email mapping not found', { did, email })
                throw new Error('DID does not match registered email')
            }
        }
        
        // Create session using the verified DID
        const { sessionId } = createSession(email || did, did, {}, true)
        
        logger.info('Created authenticated session via DID signature', { 
            did, 
            email, 
            sessionId 
        })
        
        return { sessionId, did }
        
    } catch (error) {
        logger.error('Failed to create authenticated session', { 
            did, 
            email, 
            error: error.message 
        })
        throw error
    }
}

/**
 * Cleanup expired challenges from the database
 * Should be called periodically to maintain database hygiene
 */
export async function cleanupExpiredChallenges() {
    const db = getDatabase()
    
    try {
        const result = db.prepare(`
            DELETE FROM auth_challenges 
            WHERE expiresAt < ?
        `).run(Date.now())
        
        if (result.changes > 0) {
            logger.info('Cleaned up expired challenges', { count: result.changes })
        }
        
    } catch (error) {
        logger.error('Failed to cleanup expired challenges', { error: error.message })
    }
}