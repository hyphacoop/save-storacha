import express from 'express';
import cors from 'cors';
import { initializeW3UpClient, clearClientState } from './lib/w3upClient.js';
import { clearStores } from './lib/store.js';
import * as AuthService from './services/authService.js';
import authRoutes from './routes/authRoutes.js';
import spaceRoutes from './routes/spaceRoutes.js';
import { logger } from './lib/logger.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
        // Clear all stores before initializing
        clearClientState();
        clearStores();
        
        // Initialize w3up client (no longer pass authService.handleAdminW3UpAuthorization as callback)
        await initializeW3UpClient(); 
        logger.info('Server initialization complete');

        // Mount authentication routes
        app.use('/auth', authRoutes);
        logger.info('Auth routes mounted');

        // Mount space routes
        app.use('/spaces', spaceRoutes);
        logger.info('Space routes mounted');

        app.listen(port, () => {
            logger.info('Server started', { port });
        });
    } catch (error) {
        logger.error('Server initialization failed', { error: error.message });
        process.exit(1); // Exit if client initialization fails
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