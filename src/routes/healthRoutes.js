import express from 'express';

const router = express.Router();

export function getHealthPayload() {
    return {
        ok: true,
        service: 'save-storacha',
        timestamp: new Date().toISOString()
    };
}

router.get('/health', (req, res) => {
    res.status(200).json(getHealthPayload());
});

export default router;
