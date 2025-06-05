import { getClient } from '../lib/w3upClient.js';
import {
    createSession,
    storeAdminServiceDidData,
    storeCachedSpaces
} from '../lib/store.js';
import * as Signer from '@ucanto/principal/ed25519';
import { CarWriter } from '@ipld/car';
import { base64 } from "multiformats/bases/base64";
import { logger } from '../lib/logger.js';
import { getDatabase } from '../lib/db.js';

// This function will be called after successful w3up email confirmation
export async function handleAdminW3UpAuthorization(adminEmail, adminDid, client, providedDid = null) {
    logger.info('Setting up authorization', { adminEmail });
    if (!client) {
        throw new Error('Client must be provided to handleAdminW3UpAuthorization');
    }

    try {
        // Generate Admin Service DID
        const adminServiceDidPrincipal = await Signer.generate(); 
        const adminServiceDidString = adminServiceDidPrincipal.did();
        logger.debug('Generated Admin Service DID');

        // Create delegation
        const issuerPrincipal = client.agent;
        const abilities = ['space/*','store/*','upload/*']; 
        const delegationToAdminServiceDid = await client.createDelegation(
            adminServiceDidPrincipal,
            abilities,
            {
                expiration: Infinity,
                resource: issuerPrincipal.did()
            }
        );

        // Extract and log spaces (truncated)
        const spaces = [];
        for (const proof of delegationToAdminServiceDid.prf || []) {
            if (proof.fct?.[0]?.space?.name) {
                spaces.push({
                    name: proof.fct[0].space.name,
                    did: proof.iss
                });
            }
        }
        
        // Cache the spaces
        if (spaces.length > 0) {
            storeCachedSpaces(adminEmail, spaces);
            logger.info('Found spaces', { 
                count: spaces.length,
                spaceNames: spaces.slice(0, 3).map(s => s.name)
            });
        }

        // Encode delegation to CAR format
        const { writer, out } = await CarWriter.create([delegationToAdminServiceDid.cid]);
        const carChunks = [];
        const carPromise = (async () => {
            for await (const chunk of out) {
                carChunks.push(chunk);
            }
        })();

        for await (const block of delegationToAdminServiceDid.export()) {
            await writer.put(block);
        }
        await writer.close();
        await carPromise;
        
        const delegationCar = Buffer.concat(carChunks);
        const delegationCarString = base64.encode(delegationCar);

        // Store data
        storeAdminServiceDidData(adminEmail, adminDid, adminServiceDidPrincipal, delegationCarString);
        
        // Create session with the provided DID if available, otherwise use adminDid
        const { sessionId } = createSession(adminEmail, providedDid || adminDid);
        logger.info('Authorization complete', { sessionId });

        return { sessionId };

    } catch (error) {
        logger.error('Authorization failed', { error: error.message });
        return { error: error.message };
    }
}

export async function requestAdminLoginViaW3Up(email, did = null) {
    logger.info('Requesting login', { email, did });
    const client = getClient();
    
    try {
        // Step 1: Login with email
        const account = await client.login(email);
        logger.info('Login successful', { accountDid: account.did() });
        
        // Step 2: Wait for payment plan if needed
        try {
            await account.plan.wait();
            logger.info('Payment plan confirmed');
            
            // Create DID-email mapping right after payment plan is confirmed
            if (did) {wdq
                const db = getDatabase();
                db.prepare(`
                    INSERT OR REPLACE INTO did_email_mapping (did, email, createdAt)
                    VALUES (?, ?, ?)
                `).run(did, email, Date.now());
                logger.info('Created DID-email mapping', { did, email });
            }
        } catch (e) {
            logger.debug('No payment plan required or already set');
        }

        // Step 3: Check if we have spaces
        const spaces = client.spaces();
        let space;
        let spacesList = [];
        
        if (spaces.length === 0) {
            // Create a new space if none exist
            logger.info('No spaces found, creating new space');
            const spaceName = 'admin-space';
            space = await client.createSpace(spaceName, { account });
            logger.info('Created new space', { spaceName });
            spacesList.push({
                did: space.did(),
                name: spaceName
            });
        } else {
            // Use existing spaces and try to get their names
            logger.info('Found existing spaces', { count: spaces.length });
            spacesList = spaces.map(s => ({
                did: s.did(),
                name: s.name || s.did()
            }));
            space = spaces[0];
            logger.debug('Using existing space', { spaceDid: space.did() });
        }

        // Cache the spaces immediately
        storeCachedSpaces(email, spacesList);
        logger.info('Cached spaces', { 
            count: spacesList.length,
            spaceNames: spacesList.map(s => s.name)
        });

        // Step 4: Set current space
        await client.setCurrentSpace(space.did());
        logger.debug('Set current space', { spaceDid: space.did() });
        
        // Step 5: Store admin data and create session
        const adminDid = client.agent.did();
        const authResult = await handleAdminW3UpAuthorization(email, adminDid, client, did);
        
        if (authResult.error) {
            throw new Error(authResult.error);
        }
        
        return { 
            message: 'Login successful',
            sessionId: authResult.sessionId,
            did: did || null
        };
    } catch (error) {
        logger.error('Login failed', { error: error.message });
        throw error;
    }
}

export async function logoutFromW3Up() {
    logger.info('Attempting to logout from w3up service');
    try {
        const client = getClient();
        const accounts = client.accounts();
        
        for (const account of accounts) {
            const email = account.email;
            logger.debug('Attempting to remove account', { email });
            
            if (typeof account.remove === 'function') {
                await account.remove();
                logger.info('Successfully removed account', { email });
            } else {
                logger.warn('Account has no remove method', { email });
            }
        }
        
        return { message: 'Logout successful' };
    } catch (error) {
        logger.error('Error during w3up logout', { error: error.message });
        throw error;
    }
}

// Modify handleDidLogin to only handle subsequent logins
export async function handleDidLogin(did) {
    logger.info('Handling DID login', { did });
    const client = getClient();

    try {
        // Verify the DID exists in our system
        const db = getDatabase();
        const mapping = db.prepare(`
            SELECT email FROM did_email_mapping 
            WHERE did = ?
        `).get(did);

        if (!mapping) {
            throw new Error('No account found for this DID. Please login with email first.');
        }

        // Check if there's an active session for this email
        const activeSession = db.prepare(`
            SELECT sessionId FROM active_account_sessions 
            WHERE email = ? 
            ORDER BY createdAt DESC LIMIT 1
        `).get(mapping.email);

        if (activeSession) {
            // Reuse existing session
            logger.info('Reusing existing session for DID login', { did, email: mapping.email });
            return {
                message: 'DID login successful',
                sessionId: activeSession.sessionId
            };
        }

        // Create a new session for this DID
        const { sessionId } = createSession(mapping.email, did);
        logger.info('Created new session for DID login', { did, email: mapping.email });
        
        return {
            message: 'DID login successful',
            sessionId
        };

    } catch (error) {
        logger.error('DID login failed', { did, error: error.message });
        throw error;
    }
} 