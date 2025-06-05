import { Signer } from '@ucanto/principal/ed25519'

/**
 * Generate a new principal for a user
 * @returns {Promise<import('@ucanto/principal').Signer>} The generated principal
 */
export async function generatePrincipal() {
  return Signer.generate()
}

/**
 * Export a principal to a serializable format
 * @param {import('@ucanto/principal').Signer} principal The principal to export
 * @returns {Promise<string>} The exported key in JSON format
 */
export async function exportPrincipal(principal) {
  const archive = principal.toArchive()
  const serializableArchive = {
    id: archive.id,
    keys: {}
  }
  for (const [key, value] of Object.entries(archive.keys)) {
    serializableArchive.keys[key] = Buffer.from(value).toString('base64')
  }
  return JSON.stringify(serializableArchive)
}

/**
 * Import a principal from its exported key
 * @param {string} key The exported key
 * @returns {Promise<import('@ucanto/principal').Signer>} The imported principal
 */
export async function importPrincipal(key) {
  const archive = JSON.parse(key)
  const restoredArchive = {
    id: archive.id,
    keys: Object.fromEntries(
      Object.entries(archive.keys).map(([k, v]) => [k, Buffer.from(v, 'base64')])
    )
  }
  // Use Signer.from for importing
  return Signer.from(restoredArchive)
} 