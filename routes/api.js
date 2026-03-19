'use strict';

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const n8nService = require('../src/node/n8n_service');
const { jobs, makeJobId, pushLog, broadcast } = require('../services/sse');
const { runPipeline } = require('../services/pipeline');
const { webhookLimiter, pipelineRunLimiter } = require('../middleware/rate-limit');
const { apiKeyAuth } = require('../middleware/auth');
const db = require('../src/node/db');
const { createLogger } = require('../utils/logger');
const { asyncHandler, NotFoundError, ValidationError } = require('../utils/errors');
const { validate, schemas } = require('../utils/validation');

const logger = createLogger('API');

// POST /api/run — start a pipeline job (requires auth)
router.post('/api/run', pipelineRunLimiter, apiKeyAuth, asyncHandler(async (req, res) => {
    // Validate input
    const validated = validate(req.body, schemas.pipelineRun);
    const {
        city,
        bizType,
        maxResults,
        skipLighthouse,
        generateDemo,
        exportSheets,
        sheetsId,
    } = validated;

    logger.info('Starting pipeline', { city, bizType, maxResults });

    const jobId = makeJobId();
    const citySlug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const dataDir = path.join('data', citySlug);
    
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync('logs', { recursive: true });

    const files = {
        leads: path.join(dataDir, 'leads.csv'),
        audited: path.join(dataDir, 'audited_leads.csv'),
        socialAudited: path.join(dataDir, 'social_audited.csv'),
        outreach: path.join(dataDir, 'outreach_messages.csv'),
        demos: path.join('public', 'demos', citySlug),
        demo: path.join(dataDir, 'demo_leads.csv'),
        emailLog: path.join('logs', 'email_log.csv'),
    };

    // Persist job to DB
    try {
        db.insertJob.run({
            id: jobId, city, biz_type: bizType, status: 'running', step: 0,
            config: JSON.stringify({ maxResults, skipLighthouse, generateDemo, exportSheets, sheetsId }),
            files: JSON.stringify(files),
        });
    } catch (e) {
        logger.warn('Failed to persist job to DB', { error: e.message });
    }

    jobs.set(jobId, {
        status: 'running',
        step: 0,
        logs: [],
        city, bizType, maxResults, skipLighthouse, citySlug, dataDir, files,
        exportSheets, sheetsId,
        baseUrl: `${req.protocol}://${req.get('host')}`,
        generateDemo,
        clients: [],
    });

    n8nService.notifyPipelineEvent('started', { jobId, city, bizType });

    runPipeline(jobId).catch(err => {
        const job = jobs.get(jobId);
        if (job) {
            const errorDetails = `${err.message}\n${err.stack || ''}`;
            logger.error('Pipeline failed', { jobId, error: err.message });
            pushLog(jobId, `[ERROR] ${errorDetails}`, 'error');
            job.status = 'failed';
            job.error = err.message;
            broadcast(jobId, { type: 'done', status: 'failed', error: err.message });
        }
    });

    res.json({ jobId, dataDir, files });
}));

// GET /api/status/:jobId — SSE stream for a job
router.get('/api/status/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send existing logs
    job.logs.forEach(entry => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    // If job is already done, close immediately
    if (job.status !== 'running') {
        res.write(`data: ${JSON.stringify({ type: 'done', status: job.status })}\n\n`);
        res.end();
        return;
    }

    // Add client to listeners
    job.clients.push(res);
    
    // Cleanup on close
    req.on('close', () => {
        job.clients = job.clients.filter(c => c !== res);
    });
});

// GET /api/download/:jobId/:file — download a result file
router.get('/api/download/:jobId/:file', asyncHandler(async (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
        throw new NotFoundError('Job');
    }

    const fileMap = {
        leads: job.files.leads,
        audited: job.files.audited,
        socialAudited: job.files.socialAudited,
        outreach: job.files.outreach,
        demo: job.files.demo,
    };

    const filePath = fileMap[req.params.file];
    if (!filePath || !fs.existsSync(filePath)) {
        throw new NotFoundError('File');
    }

    res.download(filePath);
}));

// GET /api/jobs — list finished jobs
router.get('/api/jobs', (req, res) => {
    const list = [];
    for (const [id, job] of jobs.entries()) {
        list.push({
            id,
            city: job.city,
            bizType: job.bizType,
            status: job.status,
            step: job.step,
            files: job.files,
        });
    }
    res.json(list.reverse());
});

// POST /api/lead — CRM lead capture webhook
router.post('/api/lead', webhookLimiter, asyncHandler(async (req, res) => {
    const validated = validate(req.body, schemas.leadCapture);
    const { name, email, phone, city } = validated;
    const outcome = req.body.outcome || 'interested';

    const lead = {
        name,
        email,
        phone,
        city,
        outcome,
        captured_at: new Date().toISOString(),
    };

    const leadsLogPath = path.join('logs', 'captured_leads.jsonl');
    fs.mkdirSync('logs', { recursive: true });
    fs.appendFileSync(leadsLogPath, JSON.stringify(lead) + '\n');

    logger.info('New lead captured', { name, email });
    n8nService.notifyLeadCapture(lead);

    res.json({ ok: true, lead });
}));

// GET /api/leads — list captured leads
router.get('/api/leads', asyncHandler(async (req, res) => {
    const csvPath = path.join(__dirname, '..', 'data', 'submissions.csv');
    
    if (!fs.existsSync(csvPath)) {
        return res.json({ leads: [] });
    }

    const leads = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (row) => leads.push(row))
            .on('end', resolve)
            .on('error', reject);
    });

    res.json({ leads });
}));

// GET /api/stats — get dashboard statistics
router.get('/api/stats', asyncHandler(async (req, res) => {
    const csvPath = path.join(__dirname, '..', 'data', 'submissions.csv');
    
    let leads = [];
    if (fs.existsSync(csvPath)) {
        await new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(csv())
                .on('data', (row) => leads.push(row))
                .on('end', resolve)
                .on('error', reject);
        });
    }

    // Calculate statistics
    const totalLeads = leads.length;
    const conversions = leads.filter(l => l.status === 'converted').length;
    const conversionRate = totalLeads > 0 ? (conversions / totalLeads * 100).toFixed(1) : 0;
    
    // Calculate revenue
    const tierPrices = { starter: 99, growth: 299, pro: 499 };
    const revenue = leads
        .filter(l => l.tier && l.status === 'converted')
        .reduce((sum, l) => sum + (tierPrices[l.tier?.toLowerCase()] || 0), 0);

    // Calculate lead scores
    const scores = leads.filter(l => l.score).map(l => parseInt(l.score) || 0);
    const avgScore = scores.length > 0 
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) 
        : 0;

    // Weekly breakdown
    const now = new Date();
    const weeklyData = [0, 0, 0, 0];
    leads.forEach(l => {
        const date = new Date(l.date || l.captured_at || now);
        const week = Math.min(3, Math.floor((now - date) / (7 * 24 * 60 * 60 * 1000)));
        weeklyData[3 - week]++;
    });

    // Source breakdown
    const sources = { 'Google Maps': 0, 'Website Form': 0, 'Referral': 0, 'Social': 0 };
    leads.forEach(l => {
        const source = l.source || 'Website Form';
        if (sources[source] !== undefined) sources[source]++;
        else sources['Website Form']++;
    });

    res.json({
        totalLeads,
        conversions,
        conversionRate,
        revenue,
        avgScore,
        weeklyData,
        sources,
    });
}));

module.exports = router;
