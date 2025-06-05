import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { logger } from './logger.js';

const DB_PATH = path.join(process.cwd(), 'data', 'delegations.db');
const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

// Ensure data directory exists
async function ensureDataDir() {
    const dataDir = path.dirname(DB_PATH);
    try {
        await fs.access(dataDir);
    } catch {
        await fs.mkdir(dataDir, { recursive: true });
        logger.info('Created data directory', { path: dataDir });
    }
}

// Initialize database and run migrations
export async function initializeDatabase() {
    await ensureDataDir();
    
    const db = new Database(DB_PATH, { verbose: logger.debug });
    logger.info('Database initialized', { path: DB_PATH });

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Create migrations table if it doesn't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at INTEGER NOT NULL
        )
    `);

    // Run migrations
    await runMigrations(db);

    return db;
}

// Run any pending migrations
async function runMigrations(db) {
    try {
        // Get list of applied migrations
        const applied = db.prepare('SELECT name FROM migrations').all().map(m => m.name);
        
        // Get list of migration files
        const files = await fs.readdir(MIGRATIONS_DIR);
        const pending = files
            .filter(f => f.endsWith('.sql'))
            .sort()
            .filter(f => !applied.includes(f));

        // Run pending migrations
        for (const file of pending) {
            const migrationPath = path.join(MIGRATIONS_DIR, file);
            const sql = await fs.readFile(migrationPath, 'utf8');
            
            db.transaction(() => {
                db.exec(sql);
                db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)')
                    .run(file, Date.now());
            })();
            
            logger.info('Applied migration', { file });
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.info('No migrations directory found, skipping migrations');
            return;
        }
        throw error;
    }
}

// Create a singleton database instance
let dbInstance = null;

export function getDatabase() {
    if (!dbInstance) {
        throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    return dbInstance;
}

export async function setupDatabase() {
    if (dbInstance) {
        return dbInstance;
    }
    dbInstance = await initializeDatabase();
    return dbInstance;
}

// Helper function to safely close the database
export function closeDatabase() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
        logger.info('Database connection closed');
    }
} 