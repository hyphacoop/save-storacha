#!/usr/bin/env node
import Database from 'better-sqlite3';
import path from 'path';
import { encryptForStorage, isEncryptedValue, decryptFromStorage, getActiveKeyId, getCipherKeyId } from '../src/lib/dbEncryption.js';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'delegations.db');

if (!process.env.DB_ENCRYPTION_KEY && !process.env.DB_ENCRYPTION_KEYS_JSON) {
    console.error('DB_ENCRYPTION_KEY or DB_ENCRYPTION_KEYS_JSON is required for migration.');
    process.exit(1);
}

const probe = encryptForStorage('probe');
if (!isEncryptedValue(probe)) {
    console.error('DB_ENCRYPTION_KEY is invalid; encryption is not active.');
    process.exit(1);
}

const db = new Database(DB_PATH);
const rows = db.prepare('SELECT rowid AS rowId, agentData FROM admin_agents').all();
const activeKeyId = getActiveKeyId();
if (!activeKeyId) {
    console.error('No active encryption key configured.');
    process.exit(1);
}

const rowsToMigrate = rows.filter((row) => {
    if (!isEncryptedValue(row.agentData)) {
        return true;
    }
    return getCipherKeyId(row.agentData) !== activeKeyId;
});

if (rowsToMigrate.length === 0) {
    console.log(`No admin_agents.agentData rows require migration to active key "${activeKeyId}".`);
    process.exit(0);
}

const update = db.prepare('UPDATE admin_agents SET agentData = ?, updatedAt = ? WHERE rowid = ?');
const now = Date.now();

const tx = db.transaction(() => {
    for (const row of rowsToMigrate) {
        const plaintext = isEncryptedValue(row.agentData) ? decryptFromStorage(row.agentData) : row.agentData;
        const encrypted = encryptForStorage(plaintext);
        if (!isEncryptedValue(encrypted)) {
            throw new Error(`Failed to encrypt row rowid=${row.rowId}`);
        }
        update.run(encrypted, now, row.rowId);
    }
});

try {
    tx();
    console.log(`Migrated ${rowsToMigrate.length} admin_agents row(s) to active key "${activeKeyId}".`);
} catch (error) {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
}
