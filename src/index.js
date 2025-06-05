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
import { logger } from './lib/logger.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for CAR file uploads

// Request logging middleware
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

// Error handling middleware
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

async function main() {
    try {
        // Only clear stores in development mode
        const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
        if (isDev) {
            clearClientState();
            clearStores();
        }
        
        // Initialize database
        await setupDatabase();
        logger.info('Database setup complete');

        // Load data from database into memory
        await loadPrincipalsFromDatabase();
        logger.info('Principals loaded from database');
        await loadDelegationsFromDatabase();
        logger.info('Delegations loaded from database');
        await loadSessionsFromDatabase();
        logger.info('Sessions loaded from database');
        
        // Initialize w3up client
        await initializeW3UpClient(); 
        logger.info('Server initialization complete');

        // Mount authentication routes
        app.use('/auth', authRoutes);
        logger.info('Auth routes mounted');

        // Mount space routes
        app.use('/spaces', spaceRoutes);
        logger.info('Space routes mounted');

        // Mount delegation routes
        app.use('/delegations', delegationRoutes);
        logger.info('Delegation routes mounted');

        // Mount upload routes at root level
        app.use('/', uploadRoutes);
        logger.info('Upload routes mounted');

        const server = app.listen(port, () => {
            logger.info('Server started', { port });
        });

        // Handle graceful shutdown
        process.on('SIGTERM', () => {
            logger.info('SIGTERM received, shutting down gracefully');
            server.close(() => {
                closeDatabase();
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            logger.info('SIGINT received, shutting down gracefully');
            server.close(() => {
                closeDatabase();
                process.exit(0);
            });
        });

    } catch (error) {
        logger.error('Server initialization failed', { error: error.message });
        process.exit(1); // Exit if initialization fails
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message });
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', { 
        reason: reason?.message || reason,
        promise: promise.toString()
    });
});

main(); 