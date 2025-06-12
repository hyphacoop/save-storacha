import { generate } from '@ucanto/principal/ed25519';
import fs from 'fs';

async function main() {
  const principal = await generate();
  const did = principal.did();
  
  // Export the principal as an archive
  const archive = principal.toArchive();
  const serializableArchive = {
    id: archive.id,
    keys: {}
  };
  for (const [key, value] of Object.entries(archive.keys)) {
    serializableArchive.keys[key] = Buffer.from(value).toString('base64');
  }

  // Get today's date for the filename
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  const filename = `did-${today}.json`;
  
  fs.writeFileSync(filename, JSON.stringify({ did, archive: serializableArchive }, null, 2));
  console.log('DID and archive object saved to', filename);
  console.log('DID:', did);
}

main(); 