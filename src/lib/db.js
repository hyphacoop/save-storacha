/**
 * Database Management Module
 * 
 * This module handles all database operations for the Storacha delegation system.
 * It uses SQLite with better-sqlite3 for high-performance synchronous operations.
 * 
 * Key Features:
 * - Automatic database initialization with proper directory structure
 * - Migration system for schema evolution
 * - Singleton pattern for connection management
 * - Foreign key constraint enforcement
 * - Graceful connection lifecycle management
 * 
 * The database stores:
 * - User principals and DIDs
 * - Space delegations and access grants
 * - Admin account sessions and authentication data
 * - DID-to-email mappings for user identification
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { logger } from './logger.js';

// Database file location - stored in a dedicated data directory
const DB_PATH = path.join(process.cwd(), 'data', 'delegations.db');
const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

/**
 * Ensures the data directory exists before attempting database operations
 * Creates the directory structure if it doesn't exist, which is common
 * on first startup or in containerized environments
 */
async function ensureDataDir() {
    const dataDir = path.dirname(DB_PATH);
    try {
        await fs.access(dataDir);
    } catch {
        await fs.mkdir(dataDir, { recursive: true });
        logger.info('Created data directory', { path: dataDir });
    }
}

/**
 * Initializes the database connection and applies any pending migrations
 * This function sets up the database with proper configuration including
 * foreign key constraints and creates the migration tracking table
 */
export async function initializeDatabase() {
    await ensureDataDir();
    
    // Create database connection with verbose logging in debug mode
    const db = new Database(DB_PATH, { verbose: logger.debug });
    logger.info('Database initialized', { path: DB_PATH });

    // Enable foreign key constraints for referential integrity
    // This ensures proper data relationships and prevents orphaned records
    db.pragma('foreign_keys = ON');

    // Create migrations tracking table to manage schema evolution
    // This table keeps track of which migrations have been applied
    db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at INTEGER NOT NULL
        )
    `);

    // Apply any pending migrations to bring schema up to date
    await runMigrations(db);

    return db;
}

/**
 * Migration system for managing database schema changes
 * Reads SQL migration files from the migrations directory and applies them
 * in alphabetical order, tracking which migrations have been applied
 * to prevent duplicate execution
 */
async function runMigrations(db) {
    try {
        // Get list of already applied migrations from the database
        const applied = db.prepare('SELECT name FROM migrations').all().map(m => m.name);
        
        // Get list of migration files from the filesystem
        const files = await fs.readdir(MIGRATIONS_DIR);
        const pending = files
            .filter(f => f.endsWith('.sql'))  // Only process SQL files
            .sort()                           // Apply in alphabetical order
            .filter(f => !applied.includes(f)); // Skip already applied migrations

        // Apply each pending migration in a transaction
        for (const file of pending) {
            const migrationPath = path.join(MIGRATIONS_DIR, file);
            const sql = await fs.readFile(migrationPath, 'utf8');
            
            // Use transaction to ensure atomic migration application
            db.transaction(() => {
                db.exec(sql);
                db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)')
                    .run(file, Date.now());
            })();
            
            logger.info('Applied migration', { file });
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            // No migrations directory is acceptable for simple deployments
            logger.info('No migrations directory found, skipping migrations');
            return;
        }
        throw error;
    }
}

// Singleton database instance to ensure single connection throughout application lifecycle
let dbInstance = null;

/**
 * Gets the singleton database instance
 * Throws an error if the database hasn't been initialized yet,
 * which helps catch initialization order issues during development
 */
export function getDatabase() {
    if (!dbInstance) {
        throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    return dbInstance;
}

/**
 * Sets up the database singleton instance
 * This should be called once during application startup
 * Returns the same instance if already initialized
 */
export async function setupDatabase() {
    if (dbInstance) {
        return dbInstance;
    }
    dbInstance = await initializeDatabase();
    return dbInstance;
}

/**
 * Safely closes the database connection
 * This should be called during application shutdown to ensure
 * proper cleanup of resources and completion of any pending operations
 */
export function closeDatabase() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
        logger.info('Database connection closed');
    }
} 