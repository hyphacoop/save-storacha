#!/usr/bin/env node

/**
 * Migration script to add spaceName column to existing delegations table
 * This script should be run once to update existing databases
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Database file location
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'delegations.db');

async function migrateDelegationsTable() {
    console.log('Starting migration: Adding spaceName column to delegations table...');

    // Check if database exists
    if (!fs.existsSync(DB_PATH)) {
        console.log('Database file not found. No migration needed.');
        return;
    }

    const db = new Database(DB_PATH);

    try {
        // Check if spaceName column already exists
        const tableInfo = db.prepare("PRAGMA table_info(delegations)").all();
        const spaceNameColumnExists = tableInfo.some(col => col.name === 'spaceName');

        if (spaceNameColumnExists) {
            console.log('spaceName column already exists. Migration not needed.');
            return;
        }

        console.log('Adding spaceName column to delegations table...');

        // Add the spaceName column
        db.prepare('ALTER TABLE delegations ADD COLUMN spaceName TEXT').run();

        console.log('Migration completed successfully!');
        console.log('Note: Existing delegations will show space DIDs until new delegations are created with space names.');

    } catch (error) {
        console.error('Migration failed:', error.message);
        throw error;
    } finally {
        db.close();
    }
}

// Run migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    migrateDelegationsTable()
        .then(() => {
            console.log('Migration script completed.');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Migration script failed:', error);
            process.exit(1);
        });
}

export { migrateDelegationsTable };