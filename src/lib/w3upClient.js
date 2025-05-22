import { create, Client } from '@web3-storage/w3up-client'
import { importDAG } from '@ucanto/core/delegation'
import { CarReader } from '@ipld/car/reader'
import fs from 'fs/promises'
import path from 'path'
import { logger } from './logger.js'

/** @type {Client | null} */
let client = null
/** @type {string | null} */
let serverDid = null

const storePath = path.join(process.cwd(), 'w3up-client-data')

async function loadStore() {
  try {
    await fs.mkdir(storePath, { recursive: true })
    const proofPath = path.join(storePath, 'proof.car')
    const proofBytes = await fs.readFile(proofPath)
    const proof = await CarReader.fromBytes(proofBytes)
    const delegation = await importDAG(proof.blocks)
    logger.debug('Loaded proof from disk')
    return { proof: delegation }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('Error loading proof', { error: error.message })
    }
    logger.debug('No proof found on disk')
    return undefined
  }
}

async function saveStore(proof) {
  try {
    await fs.mkdir(storePath, { recursive: true })
    const proofPath = path.join(storePath, 'proof.car')
    await fs.writeFile(proofPath, proof)
    logger.debug('Saved proof to disk')
  } catch (error) {
    logger.error('Failed to save proof', { error: error.message })
  }
}

export function clearClientState() {
  client = null
  serverDid = null
  logger.debug('Cleared client state')
}

export async function initializeW3UpClient() {
  clearClientState()
  
  try {
    const principal = await loadStore()
    logger.info('Initializing client')
    
    client = await create(principal ? { principal } : undefined)
    serverDid = client.did()
    logger.info('Client initialized', { serverDid })
    
    if (client.accounts) {
      const accounts = client.accounts()
      logger.debug('Current accounts', { count: accounts.length })
    }
    
    if (client.spaces) {
      const spaces = client.spaces()
      logger.debug('Current spaces', { count: spaces.length })
    }
    
    return { client, serverDid }
  } catch (error) {
    logger.error('Failed to initialize client', { error: error.message })
    throw error
  }
}

export function getClient() {
  if (!client) {
    throw new Error('w3up client not initialized. Call initializeW3UpClient first.')
  }
  return client
}

export function getServerDid() {
  if (!serverDid) {
    throw new Error('w3up client not initialized or DID not available. Call initializeW3UpClient first.')
  }
  return serverDid
} 