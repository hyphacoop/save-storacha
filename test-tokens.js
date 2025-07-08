#!/usr/bin/env node

// Quick test script for bridge tokens
import { generateAuthHeaders } from './src/lib/token-generation.js';

const headers = await generateAuthHeaders(
    'did:key:z6MkexampleUserDIDforDocumentation123456789abcdef',
    'did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba'
);

console.log('Bridge Token Headers:');
console.log(JSON.stringify(headers, null, 2));

console.log('\nCurl command:');
console.log(`curl -X POST \\
  -H "X-Auth-Secret: ${headers.headers['X-Auth-Secret']}" \\
  -H "Authorization: ${headers.headers['Authorization']}" \\
  -F "file=@test.txt" \\
  https://up.storacha.network/bridge`);
