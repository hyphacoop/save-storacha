import fs from 'fs/promises';
import path from 'path';
import { logger } from '../src/lib/logger.js';

// The path to the database file, consistent with src/lib/db.js
const DB_PATH = path.join(process.cwd(), 'data', 'delegations.db');

async function cleanDatabase() {
    try {
        logger.info(`Attempting to delete database file at: ${DB_PATH}`);
        
        await fs.unlink(DB_PATH);
        
        logger.info('Database file deleted successfully.');
        
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.info('Database file not found, nothing to delete. This is normal if running for the first time.');
        } else {
            logger.error('Database cleanup failed', { error: error.message });
            throw error;
        }
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    cleanDatabase().catch(error => {
        console.error('Script failed:', error);
        process.exit(1);
    });
}

export { cleanDatabase }; 