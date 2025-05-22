import express from 'express';
import * as SpaceService from '../services/spaceService.js';
import { ensureAuthenticated } from './authRoutes.js'; // Import shared middleware
import { logger } from '../lib/logger.js';

const router = express.Router();

// GET /spaces - lists spaces for the authenticated admin
router.get('/', ensureAuthenticated, async (req, res) => {
    const adminEmail = req.userEmail; // From ensureAuthenticated middleware
    try {
        logger.info('Space list request received', { adminEmail });
        const spaces = await SpaceService.getSpaces(adminEmail);
        res.json(spaces);
    } catch (error) {
        logger.error('Space list request failed', { adminEmail, error: error.message });
        // More specific error handling based on SpaceService errors
        if (error.message.includes('Missing') || error.message.includes('Failed to parse stored')) {
            return res.status(409).json({ message: `Configuration incomplete: ${error.message}` }); // 409 Conflict if setup incomplete
        }
        res.status(500).json({ message: error.message || 'Failed to retrieve spaces.' });
    }
});

export default router; 