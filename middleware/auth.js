'use strict';

/**
 * API Key authentication middleware.
 * Checks for API_KEY in env; if set, requires x-api-key header on protected routes.
 * In development with no API_KEY set, all requests pass through.
 */
function apiKeyAuth(req, res, next) {
    const requiredKey = process.env.API_KEY;

    // If no API_KEY is configured, skip auth (dev mode)
    if (!requiredKey) return next();

    const provided = req.headers['x-api-key'];
    if (provided === requiredKey) return next();

    return res.status(401).json({ error: 'Unauthorized. Provide x-api-key header.' });
}

module.exports = { apiKeyAuth };
