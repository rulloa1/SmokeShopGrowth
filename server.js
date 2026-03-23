/**
 * Dashboard Server
 * ================
 * Express web server that powers the lead generation dashboard.
 */
'use strict';
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://api.stripe.com"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// ── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : [];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (server-to-server, curl, same-origin)
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.length === 0) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
    credentials: true,
}));

// Fix: Stripe webhook needs raw body
app.use((req, res, next) => {
    if (req.originalUrl === '/webhook/stripe') return next();
    express.json()(req, res, next);
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/demos', express.static(path.join(__dirname, 'public/demos')));

const deployPath = path.join(__dirname, 'deployments');
if (!fs.existsSync(deployPath)) fs.mkdirSync(deployPath);
app.use('/deployments', express.static(deployPath));

// Serve assets for the premium template
app.use(express.static(path.join(__dirname, 'template')));

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Railway health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'dashboard', ts: Date.now() });
});

// Mount route modules
app.use(require('./routes/api'));
app.use(require('./routes/demos'));
app.use(require('./routes/social'));
app.use(require('./routes/webhooks'));

// ── Global error handler ────────────────────────────────────────────────────
// Must be defined AFTER all routes
app.use((err, req, res, _next) => {
    console.error('[ERROR]', err.stack || err.message || err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message || 'Internal server error',
    });
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Dashboard running at http://localhost:${PORT}\n`);
    });
}

module.exports = app;
