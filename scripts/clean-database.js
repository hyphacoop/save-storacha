import { setupDatabase, closeDatabase } from '../src/lib/db.js';
import { logger } from '../src/lib/logger.js';

async function cleanDatabase() {
    try {
        logger.info('Starting database cleanup...');
        
        const db = await setupDatabase();
        
        // Get all table names
        const tables = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'migrations'
        `).all();
        
        // Clear all tables except migrations
        for (const table of tables) {
            const tableName = table.name;
            logger.info(`Clearing table: ${tableName}`);
            db.prepare(`DELETE FROM ${tableName}`).run();
        }
        
        // Reset auto-increment sequences
        db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${tables.map(() => '?').join(', ')})`).run(...tables.map(t => t.name));
        
        logger.info('Database cleanup completed successfully');
        
        closeDatabase();
        
    } catch (error) {
        logger.error('Database cleanup failed', { error: error.message });
        throw error;
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