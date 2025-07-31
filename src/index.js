/**
 * Main Application Entry Point
 * 
 * This is the primary server file that orchestrates the initialization and startup
 * of the Storacha delegation management system. It handles:
 * 
 * - Express server setup with CORS and JSON parsing
 * - Database initialization and data loading
 * - Storacha client initialization
 * - Route mounting for authentication, spaces, delegations, and uploads
 * - Error handling and graceful shutdown procedures
 * 
 * The application follows a multi-step startup process to ensure all dependencies
 * are properly initialized before accepting requests.
 */

import express from 'express';
import cors from 'cors';
import { initializeW3UpClient, clearClientState } from './lib/w3upClient.js';
import { clearStores, loadDelegationsFromDatabase, loadPrincipalsFromDatabase, loadSessionsFromDatabase } from './lib/store.js';
import { setupDatabase, closeDatabase } from './lib/db.js';
import * as AuthService from './services/authService.js';
import authRoutes from './routes/authRoutes.js';
import spaceRoutes from './routes/spaceRoutes.js';
import delegationRoutes from './routes/delegationRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import bridgeRoutes from './routes/bridgeRoutes.js';
import { logger } from './lib/logger.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for cross-origin requests from web clients
app.use(cors());

// Configure JSON parser with increased limit for CAR file uploads
// CAR files can be large, so we allow up to 50MB payloads
app.use(express.json({ limit: '50mb' }));

// Request logging middleware - captures incoming request metadata for debugging and monitoring
app.use((req, res, next) => {
    logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        query: req.query,
        headers: {
            'content-type': req.headers['content-type'],
            'x-session-id': req.headers['x-session-id'],
            'x-user-did': req.headers['x-user-did']
        }
    });
    next();
});

// Global error handling middleware - catches unhandled errors and provides consistent error responses
app.use((err, req, res, next) => {
    logger.error('Unhandled error', { 
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

/**
 * Main initialization function
 * 
 * Performs the complete application startup sequence:
 * 1. Clears any stale state in development mode
 * 2. Initializes database and runs migrations
 * 3. Loads persistent data into memory stores
 * 4. Initializes Storacha client
 * 5. Mounts all route handlers
 * 6. Starts the HTTP server
 * 7. Sets up graceful shutdown handlers
 */
async function main() {
    try {
        // Development mode cleanup - ensures clean state for development/testing
        const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
        if (isDev) {
            clearClientState();
            clearStores();
        }
        
        // Database initialization - creates tables and runs any pending migrations
        await setupDatabase();
        logger.info('Database setup complete');

        // Load persistent data from database into memory stores for fast access
        // This hybrid approach provides both persistence and performance
        await loadPrincipalsFromDatabase();
        logger.info('Principals loaded from database');
        await loadDelegationsFromDatabase();
        logger.info('Delegations loaded from database');
        await loadSessionsFromDatabase();
        logger.info('Sessions loaded from database');
        
        // Initialize Storacha client with any existing proofs/credentials
        await initializeW3UpClient(); 
        logger.info('Server initialization complete');

        // Mount route handlers - each handles a specific domain of functionality
        app.use('/auth', authRoutes);
        logger.info('Auth routes mounted');

        app.use('/spaces', spaceRoutes);
        logger.info('Space routes mounted');

        app.use('/delegations', delegationRoutes);
        logger.info('Delegation routes mounted');

        app.use('/', bridgeRoutes);
        logger.info('Bridge routes mounted');

        // Upload routes are mounted at root level for simpler client integration
        app.use('/', uploadRoutes);
        logger.info('Upload routes mounted');

        // Start HTTP server and listen for incoming connections
        if (process.env.NODE_ENV !== 'test') {
            const server = app.listen(PORT, () => {
                logger.info('Server started', { port: PORT });
            });

            // Graceful shutdown handlers - ensures proper cleanup when server is terminated
            // SIGTERM is typically sent by process managers like PM2 or Docker
            process.on('SIGTERM', () => {
                logger.info('SIGTERM received, shutting down gracefully');
                server.close(() => {
                    closeDatabase();
                    process.exit(0);
                });
            });

            // SIGINT is sent when user presses Ctrl+C
            process.on('SIGINT', () => {
                logger.info('SIGINT received, shutting down gracefully');
                server.close(() => {
                    closeDatabase();
                    process.exit(0);
                });
            });
        }

    } catch (error) {
        logger.error('Server initialization failed', { error: error.message });
        process.exit(1); // Exit with error code if initialization fails
    }
}

// Global error handlers for uncaught exceptions and promise rejections
// These prevent the application from crashing silently and ensure proper logging

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', { 
        reason: reason?.message || reason,
        promise: promise.toString()
    });
});

// Start the application
main();

export { app }; 