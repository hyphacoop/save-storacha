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
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'delegations.db');
const SCHEMA_DIR = path.join(process.cwd(), 'db');

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
 * Initializes the database connection 
 */
export async function initializeDatabase() {
    await ensureDataDir();
    
    // Create database connection with verbose logging in debug mode
    const db = new Database(DB_PATH, { verbose: logger.debug });
    logger.info('Database initialized', { path: DB_PATH });

    try {
        await fs.chmod(DB_PATH, 0o664); // Set read/write permissions
        logger.info('Set database file permissions', { path: DB_PATH });
    } catch (error) {
        logger.warn('Could not set database file permissions', { error: error.message });
    }

    // Enable foreign key constraints for referential integrity
    // This ensures proper data relationships and prevents orphaned records
    db.pragma('foreign_keys = ON');

    // Apply the consolidated schema
    await applySchema(db);

    return db;
}

/**
 * Applies the consolidated database schema from a single file.
 * This replaces the old migration system, simplifying schema management.
 */
async function applySchema(db) {
    const schemaPath = path.join(SCHEMA_DIR, 'schema.sql');
    try {
        const sql = await fs.readFile(schemaPath, 'utf8');
        db.exec(sql);
        logger.info('Applied consolidated database schema', { file: 'schema.sql' });
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.warn('schema.sql not found, skipping database setup. This might be an issue.');
            return;
        }
        logger.error('Failed to apply database schema', { error: error.message });
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