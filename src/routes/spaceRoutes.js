import express from 'express';
import * as SpaceService from '../services/spaceService.js';
import { ensureAuthenticated } from './authRoutes.js'; // Import shared middleware
import { logger } from '../lib/logger.js';
import { getClient } from '../lib/w3upClient.js';

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

// GET /spaces/usage - Get space usage information
router.get('/usage', ensureAuthenticated, async (req, res) => {
    const { spaceDid } = req.query;
    const adminEmail = req.userEmail;

    if (!spaceDid) {
        return res.status(400).json({ 
            message: 'spaceDid query parameter is required' 
        });
    }

    try {
        logger.info('Space usage request received', { adminEmail, spaceDid });
        const client = getClient();
        
        // Try to get the space from loaded spaces
        let spaces = client.spaces();
        let space = spaces.find(s => s.did() === spaceDid);
        
        // If not found, try to add/load the space
        if (!space) {
            try {
                space = await client.addSpace(spaceDid);
                logger.info('Loaded space using addSpace', { spaceDid });
            } catch (err) {
                logger.error('Failed to load space with addSpace', { spaceDid, error: err.message });
                return res.status(404).json({ 
                    message: 'Space not found and could not be loaded',
                    spaceDid 
                });
            }
        }

        // Get usage report for all time
        const period = { from: new Date(0), to: new Date() };
        const usage = await client.capability.usage.report(spaceDid, period);
        // Extract the 'final' value from the usage report (handle possible nesting)
        let finalBytes = 0;
        if (usage && usage[Object.keys(usage)[0]] && usage[Object.keys(usage)[0]].size && typeof usage[Object.keys(usage)[0]].size.final === 'number') {
            finalBytes = usage[Object.keys(usage)[0]].size.final;
        }
        const finalMB = +(finalBytes / 1048576).toFixed(4);
        const human = `${finalMB} MB`;
        res.json({
            spaceDid,
            usage: {
                bytes: finalBytes,
                mb: finalMB,
                human
            }
        });

    } catch (error) {
        logger.error('Failed to get space usage', { 
            adminEmail, 
            spaceDid, 
            error: error.message 
        });
        res.status(500).json({ 
            message: error.message || 'Failed to get space usage'
        });
    }
});

export default router; 