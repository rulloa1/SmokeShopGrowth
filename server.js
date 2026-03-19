/**
 * Dashboard Server
 * ================
 * Express web server that powers the lead generation dashboard.
 * Provides a form UI, runs the pipeline steps as child processes,
 * streams real-time progress via SSE, and exports to Google Sheets.
 *
 * Start:  node server.js
 * Open:   http://localhost:3000
 */

'use strict';
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Fix #4: Stripe webhook needs raw body for signature verification.
// Apply express.json() to all routes EXCEPT /webhook/stripe.
app.use((req, res, next) => {
    if (req.originalUrl === '/webhook/stripe') return next();
    express.json()(req, res, next);
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

const deployPath = path.join(__dirname, 'deployments');
if (!fs.existsSync(deployPath)) fs.mkdirSync(deployPath);
app.use('/deployments', express.static(deployPath));

// Serve assets for the premium template (styles.css, animations.js, etc.)
app.use(express.static(path.join(__dirname, 'template')));

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount route modules
app.use(require('./routes/api'));
app.use(require('./routes/demos'));
app.use(require('./routes/social'));
app.use(require('./routes/webhooks'));

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Dashboard running at http://localhost:${PORT}\n`);
    });
}

module.exports = app;
