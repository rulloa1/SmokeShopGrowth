'use strict';

const rateLimit = require('express-rate-limit');

const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

const pipelineRunLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many pipeline runs. Maximum 10 per hour. Try again later.' },
    keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
});

module.exports = { webhookLimiter, pipelineRunLimiter };
