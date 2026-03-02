#!/usr/bin/env node
import Database from 'better-sqlite3';
import path from 'path';
import { encryptForStorage, isEncryptedValue } from '../src/lib/dbEncryption.js';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'delegations.db');

if (!process.env.DB_ENCRYPTION_KEY) {
    console.error('DB_ENCRYPTION_KEY is required for migration.');
    process.exit(1);
}

const probe = encryptForStorage('probe');
if (!isEncryptedValue(probe)) {
    console.error('DB_ENCRYPTION_KEY is invalid; encryption is not active.');
    process.exit(1);
}

const db = new Database(DB_PATH);
const rows = db.prepare('SELECT id, agentData FROM admin_agents').all();
const plaintextRows = rows.filter((row) => !isEncryptedValue(row.agentData));

if (plaintextRows.length === 0) {
    console.log('No plaintext admin_agents.agentData rows found. Nothing to migrate.');
    process.exit(0);
}

const update = db.prepare('UPDATE admin_agents SET agentData = ?, updatedAt = ? WHERE id = ?');
const now = Date.now();

const tx = db.transaction(() => {
    for (const row of plaintextRows) {
        const encrypted = encryptForStorage(row.agentData);
        if (!isEncryptedValue(encrypted)) {
            throw new Error(`Failed to encrypt row id=${row.id}`);
        }
        update.run(encrypted, now, row.id);
    }
});

try {
    tx();
    console.log(`Migrated ${plaintextRows.length} admin_agents row(s) to encrypted format.`);
} catch (error) {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
}
