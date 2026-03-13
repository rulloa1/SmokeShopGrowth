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
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const csv = require('csv-parser');
const n8nService = require('./src/node/n8n_service');

const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
app.use(express.static(path.join(__dirname, 'public')));

// Explicitly serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve deployments folder as static
const deployPath = path.join(__dirname, 'deployments');
if (!fs.existsSync(deployPath)) fs.mkdirSync(deployPath);
app.use('/deployments', express.static(deployPath));

app.get('/demo', (req, res) => {
    const templatePath = path.join(__dirname, 'template.html');
    if (!fs.existsSync(templatePath)) {
        return res.status(404).send('Demo template not found.');
    }

    const business = {
        name: req.query.name || req.query.shop || 'Your Smoke Shop',
        city: req.query.city || 'Your City',
        phone: req.query.phone || '(000) 000-0000',
        instagram: req.query.instagram || 'yourshop',
        address: req.query.address || req.query.city || '', 
        hours: 'Open daily • 9AM - 11PM'
    };

    let html = fs.readFileSync(templatePath, 'utf8');

    // Split name into two parts for the styled header if possible
    const nameParts = business.name.split(' ');
    const line1 = nameParts[0] || '';
    const line2 = nameParts.slice(1).join(' ') || '';

    // Replace identifiers
    html = html.replace(/{{BUSINESS_NAME}}/g, business.name);
    html = html.replace(/{{BUSINESS_LINE1}}/g, line1);
    html = html.replace(/{{BUSINESS_LINE2}}/g, line2);
    html = html.replace(/{{CITY}}/g, business.city);
    html = html.replace(/{{PHONE}}/g, business.phone);
    html = html.replace(/{{INSTAGRAM}}/g, business.instagram);

    // Also inject window.BUSINESS for client-side scripts
    const script = `<script>window.BUSINESS = ${JSON.stringify(business)};</script>`;
    html = html.replace('<head>', `<head>\n  ${script}`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});


// Serve assets for the premium template (styles.css, animations.js, etc.)
app.use(express.static(path.join(__dirname, 'template')));

// ──────────────────────────────────────────────
// In-memory job store
// ──────────────────────────────────────────────
const jobs = new Map(); // jobId → { status, logs, city, type, files }

function makeJobId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ──────────────────────────────────────────────
// Route: start a pipeline job
// ──────────────────────────────────────────────
app.post('/api/run', (req, res) => {
    let {
        city = '',
        bizType = 'smoke shop',
        maxResults = 100,
        skipLighthouse = true,
        generateDemo = true,
        exportSheets = false,
        sheetsId = '',
    } = req.body;

    if (!city.trim()) {
        return res.status(400).json({ error: 'City is required.' });
    }

    // Input validation
    if (typeof bizType !== 'string' || bizType.length > 100) {
        return res.status(400).json({ error: 'bizType must be a string (max 100 chars).' });
    }
    maxResults = Math.min(Math.max(parseInt(maxResults, 10) || 100, 1), 500);
    if (sheetsId && !/^[a-zA-Z0-9_-]+$/.test(sheetsId)) {
        return res.status(400).json({ error: 'Invalid sheetsId format.' });
    }

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
        demo: path.join(dataDir, 'demo_leads.csv'),
        emailLog: path.join('logs', 'email_log.csv'),
    };

    jobs.set(jobId, {
        status: 'running',
        step: 0,
        logs: [],
        city, bizType, maxResults, skipLighthouse, citySlug, dataDir, files,
        exportSheets, sheetsId,
        baseUrl: `${req.protocol}://${req.get('host')}`,
        generateDemo,
        clients: [], // SSE subscribers
    });

    n8nService.notifyPipelineEvent('started', { jobId, city, bizType });

    // Start pipeline asynchronously
    runPipeline(jobId).catch(err => {
        const job = jobs.get(jobId);
        if (job) {
            pushLog(jobId, `[ERROR] ${err.message}`, 'error');
            job.status = 'failed';
            broadcast(jobId, { type: 'done', status: 'failed' });
        }
    });

    res.json({ jobId, dataDir, files });
});

// ──────────────────────────────────────────────
// Route: SSE stream for a job
// ──────────────────────────────────────────────
app.get('/api/status/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Replay history
    job.logs.forEach(entry => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    // If already done, send close event
    if (job.status !== 'running') {
        res.write(`data: ${JSON.stringify({ type: 'done', status: job.status })}\n\n`);
        res.end();
        return;
    }

    job.clients.push(res);
    req.on('close', () => {
        job.clients = job.clients.filter(c => c !== res);
    });
});

// ──────────────────────────────────────────────
// Route: download a result file
// ──────────────────────────────────────────────
app.get('/api/download/:jobId/:file', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    const fileMap = {
        leads: job.files.leads,
        audited: job.files.audited,
        socialAudited: job.files.socialAudited,
        outreach: job.files.outreach,
        demo: job.files.demo,
    };
    const filePath = fileMap[req.params.file];
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not ready.' });
    }

    res.download(filePath);
});

// ──────────────────────────────────────────────
// Route: list finished jobs
// ──────────────────────────────────────────────
app.get('/api/jobs', (req, res) => {
    const list = [];
    for (const [id, job] of jobs.entries()) {
        list.push({
            id, city: job.city, bizType: job.bizType,
            status: job.status, step: job.step,
            files: job.files,
        });
    }
    res.json(list.reverse());
});

// ──────────────────────────────────────────────
// Route: Zapier webhook → trigger ElevenLabs call
// ──────────────────────────────────────────────
// Zapier POSTs: { business_name, phone, city, agent_name? }
app.post('/webhook/call', webhookLimiter, async (req, res) => {
    const requiredKey = process.env.API_KEY;
    if (!requiredKey || req.headers['x-api-key'] !== requiredKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
        business_name = '',
        phone = '',
        city = '',
        agent_name = process.env.AGENT_NAME || 'Alex',
    } = req.body;

    if (!phone) {
        return res.status(400).json({ error: 'phone is required' });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID || 'agent_0901kk068cm9fats660z2mzqwnhy';
    const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;

    if (!apiKey) {
        return res.status(500).json({ error: 'ELEVENLABS_API_KEY not set' });
    }
    if (!phoneNumberId) {
        return res.status(500).json({ error: 'ELEVENLABS_PHONE_NUMBER_ID not set. Please add it to your .env file.' });
    }

    // Note: This webhook call is not associated with a specific job, so we use a placeholder 'call'
    // for the jobId. This log will not appear in the SSE stream for a pipeline job.
    pushLog('call', `Attempting call to ${phone} using agent ${agentId}…`, 'log');

    try {
        const response = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                agent_id: agentId,
                agent_phone_number_id: phoneNumberId,
                to_number: phone,
                // Passing dynamic variables (might need to go inside conversation_initiation_client_data depending on your firm config)
                dynamic_variables: { business_name, city, agent_name },
            }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.detail?.message || JSON.stringify(data));

        console.log(`📞 Call started → ${business_name} (${phone}) — conversation: ${data.conversation_id}`);
        res.json({ success: true, conversation_id: data.conversation_id });
    } catch (err) {
        console.error(`❌ Call failed for ${phone}: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────
// Routes: Social Media Manager
// ──────────────────────────────────────────────
const { generateCalendar } = require('./src/node/social_content_generator.js');
const { getBufferProfiles, schedulePosts } = require('./src/node/social_scheduler.js');

app.post('/api/social/generate-calendar', async (req, res) => {
    const { business_name, city, instagram, specialty } = req.body;
    if (!business_name) return res.status(400).json({ error: 'business_name is required' });
    
    try {
        const data = await generateCalendar({ business_name, city, instagram, specialty });
        res.json({ posts: data.posts });
    } catch (err) {
        console.error('Content generation error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/social/buffer-profiles', async (req, res) => {
    try {
        const profiles = await getBufferProfiles();
        res.json({ profiles });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/social/schedule', async (req, res) => {
    const { posts, profileId, businessName } = req.body;
    if (!posts || !profileId) return res.status(400).json({ error: 'posts and profileId are required' });
    
    try {
        const result = await schedulePosts(posts, profileId, businessName);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/social/outreach-preview', async (req, res) => {
    const { inputFile, limit } = req.body;
    try {
        const dataDir = path.join(__dirname, 'data');
        const targetDirs = fs.readdirSync(dataDir);
        let preview = [];
        
        // Find the file in one of the data subdirectories
        for (const dir of targetDirs) {
            const potentialPath = path.join(dataDir, dir, inputFile);
            if (fs.existsSync(potentialPath)) {
                // Return a dummy preview
                preview = [
                    { handle: 'example_shop', message: 'Hey! Love your vibe. Would love to send you a custom demo website we built for you.' },
                    { handle: 'another_store', message: 'Hey! We noticed you could use a better booking system on your IG. Check out this demo.' }
                ];
                break;
            }
        }
        
        res.json({ preview });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/social/outreach-run', async (req, res) => {
    const { inputFile, limit } = req.body;
    
    // Attempt to locate input file
    const dataDir = path.join(__dirname, 'data');
    const targetDirs = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];
    let targetFile = null;
    
    for (const dir of targetDirs) {
        const potentialPath = path.join(dataDir, dir, inputFile);
        if (fs.existsSync(potentialPath)) {
            targetFile = potentialPath;
            break;
        }
    }

    if (!targetFile) {
        return res.status(404).json({ error: 'Input file not found in any data directory' });
    }

    // Spawn the outreach script independently (detached or at least unawaited)
    const proc = spawn('node', [
        path.join(__dirname, 'src', 'node', 'social_outreach.js'),
        '--input', targetFile,
        '--limit', String(limit)
    ], {
        detached: true,
        stdio: 'ignore'
    });
    
    proc.unref();

    res.json({ success: true, message: 'Background job started.' });
});


// ──────────────────────────────────────────────
// Pipeline runner
// ──────────────────────────────────────────────
async function runPipeline(jobId) {
    const job = jobs.get(jobId);

    // ── Step 1: Scrape ────────────────────────
    pushLog(jobId, '🔍 Step 1/3 — Scraping Google Maps…', 'step');
    job.step = 1;
    await runChild(jobId, 'python', [
        path.join(__dirname, 'src', 'python', 'scraper.py'),
        '--city', job.city,
        '--type', job.bizType,
        '--max-results', String(job.maxResults),
        '--output', job.files.leads,
        '--headless',
    ]);


    if (!fs.existsSync(job.files.leads)) {
        throw new Error('Scraper completed but no leads.csv was created.');
    }

    const leadCount = await countCsvRows(job.files.leads);
    pushLog(jobId, `✅ Scraped ${leadCount} businesses.`, 'success');

    // ── Step 2: Audit ─────────────────────────
    pushLog(jobId, '🌐 Step 2/3 — Auditing websites…', 'step');
    job.step = 2;
    const auditorArgs = [
        path.join(__dirname, 'src', 'node', 'auditor.js'),
        '--input', job.files.leads,
        '--output', job.files.audited,
        '--concurrency', '8',
    ];
    if (job.skipLighthouse !== false) auditorArgs.push('--skip-lighthouse');
    await runChild(jobId, 'node', auditorArgs);


    const auditedCount = await countCsvRows(job.files.audited);
    pushLog(jobId, `✅ Audited ${auditedCount} websites.`, 'success');

    // ── Step 2.5: Social Audit ────────────────
    pushLog(jobId, '📱 Step 2.5 — Social Audit…', 'step');
    await runChild(jobId, 'node', [
        path.join(__dirname, 'src', 'node', 'social_audit.js'),
        '--input', job.files.audited,
        '--output', job.files.socialAudited
    ]);
    const socialAuditedCount = await countCsvRows(job.files.socialAudited);
    pushLog(jobId, `✅ Social Audited ${socialAuditedCount} websites.`, 'success');

    // ── Step 3: Outreach ──────────────────────
    if (process.env.OPENAI_API_KEY) {
        pushLog(jobId, '✍️  Step 3/3 — Generating outreach messages…', 'step');
        job.step = 3;
        await runChild(jobId, 'node', [
            path.join(__dirname, 'src', 'node', 'generate_outreach.js'),
            '--input', job.files.socialAudited, // use socialAudited as input for outreach
            '--output', job.files.outreach,
            '--base-url', job.baseUrl,
        ]);


        const outreachCount = await countCsvRows(job.files.outreach);
        pushLog(jobId, `✅ Generated ${outreachCount} outreach messages.`, 'success');
    } else {
        pushLog(jobId, '⚠️  Step 3 skipped — OPENAI_API_KEY not set.', 'warn');
    }

    // ── Step 4: Demo Video ────────────────────
    if (job.generateDemo && process.env.MINIMAX_API_KEY) {
        pushLog(jobId, '🎥 Step 4/4 — Generating Minimax demo videos…', 'step');
        job.step = 4;
        await runChild(jobId, 'node', [
            path.join(__dirname, 'src', 'node', 'generate_demo.js'),
            '--input', fs.existsSync(job.files.outreach) ? job.files.outreach : job.files.socialAudited,
            '--output', job.files.demo,
            '--limit', '10' // Only do top 10 to save API costs & time
        ]);

        const demoCount = await countCsvRows(job.files.demo);
        pushLog(jobId, `✅ Generated demo video entries  (${demoCount} leads processed).`, 'success');
    } else if (job.generateDemo && !process.env.MINIMAX_API_KEY) {
        pushLog(jobId, '⚠️  Step 4 skipped — MINIMAX_API_KEY not set.', 'warn');
    } else {
        pushLog(jobId, '⏩ Step 4 skipped — Demo generation turned off.', 'log');
    }

    // ── Step 5: Export to Google Sheets ───────
    if (job.exportSheets && job.sheetsId) {
        pushLog(jobId, '📊 Exporting to Google Sheets…', 'step');
        try {
            // Determine the final file to export
            let finalOutput = job.files.audited;
            if (fs.existsSync(job.files.demo)) finalOutput = job.files.demo;
            else if (fs.existsSync(job.files.outreach)) finalOutput = job.files.outreach;
            else if (fs.existsSync(job.files.socialAudited)) finalOutput = job.files.socialAudited;

            await exportToSheets(job.sheetsId, finalOutput, job.city);
            pushLog(jobId, '✅ Exported to Google Sheets.', 'success');
        } catch (err) {
            pushLog(jobId, `⚠️  Google Sheets export failed: ${err.message}`, 'warn');
        }
    }

    job.status = 'done';
    job.step = 5;
    pushLog(jobId, '🎉 Pipeline complete!', 'success');
    broadcast(jobId, { type: 'done', status: 'done', files: job.files });
    
    n8nService.notifyPipelineEvent('success', { 
        jobId, 
        city: job.city, 
        bizType: job.bizType,
        files: job.files 
    });
}

// ──────────────────────────────────────────────
// Child process helper
// ──────────────────────────────────────────────
function runChild(jobId, cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, {
            shell: false,
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });

        const onData = (data) => {
            String(data).split('\n').forEach(line => {
                line = line.trim();
                if (line) pushLog(jobId, line, 'log');
            });
        };

        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
        });
        proc.on('error', reject);
    });
}

// ──────────────────────────────────────────────
// SSE helpers
// ──────────────────────────────────────────────
function pushLog(jobId, message, type = 'log') {
    const entry = { type, message, ts: Date.now() };
    const job = jobs.get(jobId);
    if (!job) return;
    job.logs.push(entry);
    broadcast(jobId, entry);
}

function broadcast(jobId, payload) {
    const job = jobs.get(jobId);
    if (!job) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    job.clients.forEach(res => { try { res.write(data); } catch { } });
    if (payload.type === 'done') {
        job.clients.forEach(res => { try { res.end(); } catch { } });
        job.clients = [];
    }
}

// ──────────────────────────────────────────────
// CSV row counter
// ──────────────────────────────────────────────
function countCsvRows(filePath) {
    return new Promise(resolve => {
        if (!fs.existsSync(filePath)) return resolve(0);
        let count = 0;
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', () => count++)
            .on('end', () => resolve(count))
            .on('error', () => resolve(0));
    });
}

// ──────────────────────────────────────────────
// Google Sheets export
// ──────────────────────────────────────────────
async function exportToSheets(spreadsheetId, csvPath, sheetTitle) {
    // Requires: credentials.json (service account) in project root
    const credPath = path.join(__dirname, 'credentials.json');
    if (!fs.existsSync(credPath)) {
        throw new Error('credentials.json not found. See README for Google Sheets setup.');
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: credPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Read CSV into 2D array
    const rows = await new Promise((resolve, reject) => {
        const data = [];
        let headerPushed = false;
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', row => {
                if (!headerPushed) {
                    data.push(Object.keys(row));
                    headerPushed = true;
                }
                data.push(Object.values(row));
            })
            .on('end', () => resolve(data))
            .on('error', reject);
    });

    // Create or clear a sheet tab named after the city
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = meta.data.sheets.find(
        s => s.properties.title === sheetTitle
    );

    if (existingSheet) {
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${sheetTitle}!A1:Z10000`,
        });
    } else {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{ addSheet: { properties: { title: sheetTitle } } }],
            },
        });
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetTitle}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
    });
}

// ──────────────────────────────────────────────
// Route: Send Personalized Demo Email
// ──────────────────────────────────────────────
// POST { email, business_name, city }
// Sends a branded HTML email with the personalized demo link via SMTP
app.post('/api/send-demo', webhookLimiter, async (req, res) => {
    const { email, business_name, city = '', phone = '', instagram = '' } = req.body || {};
    if (!email || !business_name) {
        return res.status(400).json({ error: 'email and business_name are required' });
    }

    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const fromName = process.env.FROM_NAME || process.env.AGENT_NAME || 'Alex';
    // Use PUBLIC_URL (e.g. ngrok) so the demo link works outside localhost
    const serverBase = process.env.PUBLIC_URL || process.env.DEMO_BASE_URL || `http://localhost:${PORT}`;

    if (!smtpUser || !smtpPass) {
        return res.status(500).json({ error: 'SMTP credentials not set in .env' });
    }

    const demoUrl = `${serverBase}/demo?name=${encodeURIComponent(business_name)}&city=${encodeURIComponent(city)}&phone=${encodeURIComponent(phone)}&instagram=${encodeURIComponent(instagram)}`;
    const checkoutUrl = `/api/create-checkout`; // handled client-side

    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:sans-serif;color:#fff;">
  <div style="max-width:580px;margin:0 auto;padding:40px 24px;">
    <h1 style="color:#39ff14;font-size:1.5rem;margin-bottom:8px;">
      Here's your free demo, ${business_name}! 🚀
    </h1>
    <p style="color:#ccc;font-size:1rem;line-height:1.7;margin-bottom:24px;">
      Hey! It's Alex — we just spoke on the phone. I put together a custom demo
      website just for <strong>${business_name}</strong>. Click below to check it out:
    </p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${demoUrl}"
         style="display:inline-block;background:linear-gradient(90deg,#00f0ff,#39ff14);
                color:#000;font-weight:700;padding:14px 36px;border-radius:999px;
                font-size:1.1rem;text-decoration:none;">
        🌐 View Your Custom Demo
      </a>
    </div>
    <p style="color:#aaa;font-size:.9rem;line-height:1.7;">
      This demo is personalized for <strong>${business_name}</strong> in <strong>${city || 'your area'}</strong>.
      If you like what you see and want to move forward, there's a button on the demo page to get started —
      totally no pressure, just have a look!
    </p>
    <hr style="border:none;border-top:1px solid #222;margin:32px 0;"/>
    <p style="color:#666;font-size:.82rem;">
      ${fromName} • SmokeShopGrowth<br/>
      Questions? Just reply to this email.
    </p>
  </div>
</body>
</html>`;

    try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: false,
            auth: { user: smtpUser, pass: smtpPass },
        });

        await transporter.sendMail({
            from: `"${fromName}" <${smtpUser}>`,
            to: email,
            subject: `Your free custom website demo for ${business_name} 🎯`,
            html: htmlBody,
            text: `Hey! Here's your custom demo for ${business_name}: ${demoUrl}\n\n— ${fromName}, SmokeShopGrowth`,
        });

        console.log(`📧 Demo email sent to ${email} for ${business_name}`);
        res.json({ success: true, demoUrl });
    } catch (err) {
        console.error('Demo email error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────
// Route: Vapi Call Webhook (end-of-call events)
// ──────────────────────────────────────────────
// Vapi POSTs here when a call ends. We:
//   1. Parse the collected email from transcript
//   2. Auto-send the demo email if email was captured
//   3. Forward all call data to Zapier for Sheets logging
// ──────────────────────────────────────────────
// Route: Submit Lead from Demo Pages
// ──────────────────────────────────────────────
app.post('/api/submit-lead', webhookLimiter, async (req, res) => {
    const { contactName, email, phone, tier, businessName, city } = req.body || {};
    
    if (!email || !contactName) {
        return res.status(400).json({ error: 'Name and email are required' });
    }

    const submissionDate = new Date().toISOString();
    const csvLine = `"${submissionDate}","${contactName}","${email}","${phone}","${tier}","${businessName}","${city}"\n`;
    
    try {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
        
        const csvPath = path.join(dataDir, 'submissions.csv');
        const header = "Date,Contact Name,Email,Phone,Tier,Business,City\n";
        if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, header);
        
        fs.appendFileSync(csvPath, csvLine);
        console.log(`✅ Lead captured: ${email} for ${businessName}`);

        // Notify Admin via SMTP if configured
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;
        if (smtpUser && smtpPass) {
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT || '587', 10),
                secure: false,
                auth: { user: smtpUser, pass: smtpPass },
            });

            await transporter.sendMail({
                from: `"Lead Alert" <${smtpUser}>`,
                to: smtpUser, // Notify yourself
                subject: `🔥 NEW LEAD: ${businessName} (${tier})`,
                text: `You have a new lead from the demo page!\n\nBusiness: ${businessName}\nContact: ${contactName}\nEmail: ${email}\nPhone: ${phone}\nTier: ${tier}\nCity: ${city}\n\nDate: ${submissionDate}`,
            });
        }

        res.json({ success: true, message: 'Lead captured successfully' });
        
        n8nService.notifyNewLead({
            contactName, email, phone, tier, businessName, city, submissionDate
        });
    } catch (err) {
        console.error('Lead capture error:', err.message);
        res.status(500).json({ error: 'Failed to save lead' });
    }
});

// ──────────────────────────────────────────────
// Route: Get Captured Leads
// ──────────────────────────────────────────────
app.get('/api/leads', (req, res) => {
    try {
        const csvPath = path.join(__dirname, 'data', 'submissions.csv');
        if (!fs.existsSync(csvPath)) return res.json({ leads: [] });
        
        const content = fs.readFileSync(csvPath, 'utf8');
        const lines = content.trim().split('\n');
        const headers = lines[0].split(',');
        const leads = lines.slice(1).map(line => {
            const values = line.split(',');
            const lead = {};
            headers.forEach((h, i) => lead[h.toLowerCase().replace(/ /g, '_')] = values[i] || '');
            return lead;
        });
        res.json({ leads });
    } catch (err) {
        res.status(500).json({ error: 'Failed to read leads' });
    }
});

// ──────────────────────────────────────────────
// Route: "Deploy" / Finalize Site for Delivery
// ──────────────────────────────────────────────
app.post('/api/deploy-site', async (req, res) => {
    const { business, email, tier } = req.body;
    if (!business) return res.status(400).json({ error: 'Business name is required' });

    try {
        // Create a 'deployments' folder
        const deployRoot = path.join(__dirname, 'deployments');
        if (!fs.existsSync(deployRoot)) fs.mkdirSync(deployRoot);
        
        const projectFolderName = `${business.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
        const projectPath = path.join(deployRoot, projectFolderName);
        fs.mkdirSync(projectPath);

        // Copy template and generate index.html
        // For 'Delivery', we use the generate-from-templates logic but output to the deployment folder
        const { previewUrl } = await require('./src/node/generate-from-templates.js').generateForOne({
            TargetBusiness: business,
            TargetOutput: path.join(projectPath, 'index.html'),
            isProduction: true // This flag will enable/disable specific tier features
        });

        res.json({ 
            success: true, 
            message: `Site deployed for ${business}`,
            folder: projectFolderName,
            url: `/deployments/${projectFolderName}/index.html` 
        });
    } catch (err) {
        console.error('Deployment error:', err);
        res.status(500).json({ error: 'Failed to deploy site' });
    }
});

app.post('/webhook/vapi', async (req, res) => {

    // Acknowledge immediately so Vapi doesn't retry
    res.status(200).json({ received: true });

    try {
        const body = req.body || {};
        const type = body.message?.type || body.type || '';

        // Only process end-of-call summary events
        if (type !== 'end-of-call-report' && type !== 'end_of_call_report') return;

        const call = body.message?.call || body.call || body;
        const analysis = body.message?.analysis || body.analysis || {};
        const artifact = body.message?.artifact || body.artifact || {};

        // Extract key fields
        const business_name = call?.customer?.name || call?.metadata?.business_name || '';
        const phone = call?.customer?.number || '';
        const city = call?.metadata?.city || '';
        const call_id = call?.id || '';
        const duration = call?.endedAt && call?.startedAt
            ? Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000)
            : 0;
        const outcome = analysis?.successEvaluation || analysis?.summary || 'completed';
        const summary = analysis?.summary || '';

        // ── Try to find collected email in the transcript ──────────────
        let collected_email = '';
        const messages = artifact?.messages || [];
        for (const msg of messages) {
            const text = (msg.message || msg.content || '').toLowerCase();
            // Look for email pattern spoken after "what email" prompt
            const emailMatch = text.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i);
            if (emailMatch) {
                collected_email = emailMatch[0];
                break;
            }
        }

        console.log(`📞 Vapi call ended — ${business_name} (${phone}) | email: ${collected_email || 'none'} | outcome: ${outcome}`);

        // ── Auto-send demo email if we collected one ───────────────────
        if (collected_email && business_name) {
            try {
                await fetch(`http://localhost:${process.env.PORT || 3000}/api/send-demo`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: collected_email,
                        business_name,
                        city,
                    }),
                });
                console.log(`✅ Demo email auto-triggered to ${collected_email}`);
            } catch (emailErr) {
                console.error('Failed to auto-send demo email:', emailErr.message);
            }
        }

        // ── Forward all fields to Zapier ───────────────────────────────
        const zapierUrl = process.env.ZAPIER_WEBHOOK_URL;
        if (zapierUrl) {
            const payload = {
                business_name,
                phone,
                city,
                call_id,
                duration_seconds: duration,
                outcome,
                summary,
                email: collected_email,
                contact_value: collected_email ? 'email_captured' : 'no_contact',
                timestamp: new Date().toISOString(),
            };
            fetch(zapierUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }).catch(err => console.error('Zapier forward error:', err.message));
        }

        // Forward to n8n
        n8nService.notifyCallOutcome({
            business_name,
            phone,
            city,
            call_id,
            duration_seconds: duration,
            outcome,
            summary,
            email: collected_email,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Vapi webhook processing error:', err.message);
    }
});


// ──────────────────────────────────────────────
// POST { email, business_name, city, tier }
// Returns { checkout_url }
app.post('/api/create-checkout', webhookLimiter, async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_API_KEY);
    if (!process.env.STRIPE_API_KEY) {
        return res.status(500).json({ error: 'STRIPE_API_KEY not set' });
    }

    const { email, business_name, city, tier = 'growth' } = req.body || {};
    if (!email || !business_name) {
        return res.status(400).json({ error: 'email and business_name are required' });
    }

    const TIER_PRICES = {
        starter: { setup: 19900, name: 'Starter Website' },
        growth: { setup: 29900, name: 'Growth Website' },
        pro: { setup: 49900, name: 'Pro Website' },
    };
    const selected = TIER_PRICES[tier] || TIER_PRICES.growth;
    const DEMO_BASE_URL = process.env.DEMO_BASE_URL || 'https://smoke-shop-premium-demo.netlify.app';

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            client_reference_id: email,
            customer_email: email,
            metadata: { business_name, city, tier },
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `${selected.name} — ${business_name}`,
                        description: `Custom smoke shop website for ${business_name} in ${city}`,
                    },
                    unit_amount: selected.setup,
                },
                quantity: 1,
            }],
            success_url: `${DEMO_BASE_URL}/?shop=${encodeURIComponent(business_name)}&city=${encodeURIComponent(city)}&paid=true`,
            cancel_url: `${DEMO_BASE_URL}/?shop=${encodeURIComponent(business_name)}&city=${encodeURIComponent(city)}`,
        });

        console.log(`💳 Checkout session created for ${business_name}: ${session.url}`);
        res.json({ checkout_url: session.url });
    } catch (err) {
        console.error('Stripe checkout error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────
// Template Form Submission Endpoint
// ──────────────────────────────────────────────
const templateSubmissions = [];

app.post('/api/template-submission', webhookLimiter, async (req, res) => {
    try {
        const { shopName, city, phone, email } = req.body;

        if (!shopName || !city || !phone || !email) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const submission = {
            id: makeJobId(),
            shopName: String(shopName).trim(),
            city: String(city).trim(),
            phone: String(phone).trim(),
            email: String(email).trim(),
            timestamp: new Date().toISOString()
        };

        templateSubmissions.push(submission);

        // 1. Persist to CSV
        const submissionsFile = path.join(__dirname, 'data', 'submissions.csv');
        // Escape quotes for CSV format
        const safeName = submission.shopName.replace(/"/g, '""');
        const safeCity = submission.city.replace(/"/g, '""');
        const csvLine = `"${submission.id}","${submission.timestamp}","${safeName}","${safeCity}","${submission.phone}","${submission.email}"\n`;

        // Ensure data directory exists
        if (!fs.existsSync(path.join(__dirname, 'data'))) {
            fs.mkdirSync(path.join(__dirname, 'data'));
        }

        if (!fs.existsSync(submissionsFile)) {
            fs.writeFileSync(submissionsFile, 'id,timestamp,shopName,city,phone,email\n');
        }
        fs.appendFileSync(submissionsFile, csvLine);
        console.log(`✓ Form received & saved: ${submission.shopName} (${submission.city})`);

        // 2. Send Notification Email to Admin (You) & Auto-Reply to Lead
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST || 'smtp.gmail.com',
                    port: parseInt(process.env.SMTP_PORT || '587', 10),
                    secure: false,
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
                });

                // Admin Notification
                const adminMail = transporter.sendMail({
                    from: `"${process.env.FROM_NAME || 'Lead Bot'}" <${process.env.SMTP_USER}>`,
                    to: process.env.SMTP_USER, // Send to yourself
                    subject: `🔔 New Lead: ${submission.shopName}`,
                    text: `New submission from the demo page:\n\nName: ${submission.shopName}\nCity: ${submission.city}\nPhone: ${submission.phone}\nEmail: ${submission.email}\n\nTimestamp: ${submission.timestamp}`,
                });

                // Auto-Reply to Lead
                const leadMail = transporter.sendMail({
                    from: `"${process.env.FROM_NAME || 'SmokeShopGrowth'}" <${process.env.SMTP_USER}>`,
                    to: submission.email,
                    subject: `We've received your demo request! 🚀`,
                    html: `
                        <div style="font-family: sans-serif; color: #333; max-width: 600px;">
                            <h2>Hi ${submission.shopName},</h2>
                            <p>Thanks for requesting a demo! We've received your information and will be in touch shortly.</p>
                            <p><strong>Your Details:</strong><br>
                            City: ${submission.city}<br>
                            Phone: ${submission.phone}</p>
                            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                            <p style="color: #666; font-size: 0.9em;">Best,<br>The SmokeShopGrowth Team</p>
                        </div>
                    `
                });

                await Promise.all([adminMail, leadMail]);
                console.log(`📧 Notification emails sent (Admin & Lead).`);
            } catch (emailErr) {
                console.error('Failed to send notification emails:', emailErr.message);
                // Don't fail the request just because admin email failed
            }
        }

        res.status(200).json({
            success: true,
            message: 'Thank you! We\'ll contact you shortly.',
            submissionId: submission.id
        });
    } catch (err) {
        console.error('Form submission error:', err.message);
        res.status(500).json({ error: 'Failed to process submission' });
    }
});

app.get('/api/template-submissions', (req, res) => {
    res.json({
        count: templateSubmissions.length,
        submissions: templateSubmissions
    });
});

// ──────────────────────────────────────────────
// Social Media Manager Routes
// ──────────────────────────────────────────────

// POST /api/social/generate-calendar
// Body: { business_name, city, instagram?, specialty? }
// Returns: { posts: [...] } — 30 days of post objects
app.post('/api/social/generate-calendar', async (req, res) => {
    const { business_name, city = '', instagram = '', specialty = 'smoke shop products' } = req.body || {};
    if (!business_name) return res.status(400).json({ error: 'business_name is required' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set in .env' });

    const prompt = `You are a social media expert for local smoke shops and vape stores.

Create a 30-day social media content calendar for:
- Business: ${business_name}
- City: ${city || 'local area'}
- Instagram: @${instagram || business_name.replace(/\s+/g, '').toLowerCase()}
- Specialty: ${specialty}

Return a JSON array of exactly 30 post objects. Each object:
{
  "day": <number 1-30>,
  "platform": "Instagram" | "Facebook",
  "post_type": "Product Highlight" | "Educational" | "Promotional" | "Community" | "Behind the Scenes",
  "best_time": "e.g. 6:00 PM",
  "caption": "<full caption with emojis and hashtags, 150-250 chars>",
  "hashtags": ["#smoke", "#vape", ...],
  "cta": "<call to action phrase>",
  "image_idea": "<brief description of what image to use>"
}

Return ONLY the JSON array, no markdown, no explanation.`;

    try {
        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey });
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.8,
            max_tokens: 4000,
        });

        let raw = completion.choices[0].message.content.trim();
        // Strip markdown code fences if present
        raw = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
        const posts = JSON.parse(raw);
        res.json({ posts, business_name, city });
    } catch (err) {
        console.error('Calendar generation error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/social/buffer-profiles
// Lists Buffer profiles connected to the account
app.get('/api/social/buffer-profiles', async (req, res) => {
    const token = process.env.BUFFER_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'BUFFER_ACCESS_TOKEN not set in .env' });

    try {
        const resp = await fetch(`https://api.bufferapp.com/1/profiles.json?access_token=${token}`);
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`Buffer API error ${resp.status}: ${txt}`);
        }
        const profiles = await resp.json();
        res.json({ profiles: profiles.map(p => ({
            id: p.id,
            service: p.service,
            formatted_username: p.formatted_username || p.service_username,
        })) });
    } catch (err) {
        console.error('Buffer profiles error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/social/schedule
// Body: { posts, profileId, businessName }
// Schedules all 30 posts via Buffer API
app.post('/api/social/schedule', async (req, res) => {
    const { posts, profileId, businessName } = req.body || {};
    if (!posts || !profileId) return res.status(400).json({ error: 'posts and profileId are required' });

    const token = process.env.BUFFER_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'BUFFER_ACCESS_TOKEN not set in .env' });

    let success = 0;
    let failed = 0;

    // Schedule starting from tomorrow, ~1 post per day
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);

    for (const post of posts) {
        try {
            const scheduledAt = new Date(startDate);
            scheduledAt.setDate(startDate.getDate() + (post.day - 1));
            // Parse best_time if possible, default to 6pm
            const timeParts = (post.best_time || '6:00 PM').match(/(\d+):(\d+)\s*(AM|PM)/i);
            let hours = timeParts ? parseInt(timeParts[1]) : 18;
            const mins = timeParts ? parseInt(timeParts[2]) : 0;
            if (timeParts && timeParts[3].toUpperCase() === 'PM' && hours < 12) hours += 12;
            scheduledAt.setHours(hours, mins, 0, 0);

            const caption = post.caption || '';
            const hashtags = (post.hashtags || []).join(' ');
            const text = caption + '\n\n' + hashtags;

            const params = new URLSearchParams({
                access_token: token,
                'profile_ids[]': profileId,
                text,
                scheduled_at: scheduledAt.toISOString(),
                shorten: 'false',
            });

            const bufferResp = await fetch('https://api.bufferapp.com/1/updates/create.json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
            });

            if (!bufferResp.ok) {
                const err = await bufferResp.text();
                console.error(`Buffer schedule failed day ${post.day}:`, err);
                failed++;
            } else {
                success++;
            }

            // Small delay to avoid rate limits
            await new Promise(r => setTimeout(r, 200));
        } catch (err) {
            console.error(`Error scheduling day ${post.day}:`, err.message);
            failed++;
        }
    }

    res.json({ success, failed, total: posts.length });
});

// POST /api/social/outreach-preview
// Body: { inputFile, limit }
// Returns preview of DMs that would be sent (dry run — no actual DMs)
app.post('/api/social/outreach-preview', async (req, res) => {
    const { inputFile = 'social_audited.csv', limit = 20 } = req.body || {};

    const csvPath = path.join(__dirname, 'data', inputFile);
    if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ error: `File not found: data/${inputFile}` });
    }

    const leads = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', row => {
                if (row.instagram && leads.length < Number(limit)) {
                    leads.push(row);
                }
            })
            .on('end', resolve)
            .on('error', reject);
    });

    const preview = leads.map(lead => ({
        handle: lead.instagram.replace('@', ''),
        business: lead.name || lead.business_name || 'Business',
        message: `Hey! 👋 Love what you're doing at ${lead.name || 'your shop'}. We help smoke shops get more customers online with a free custom website demo. Want to see what yours could look like? 🚀`,
    }));

    res.json({ preview, count: preview.length });
});

// POST /api/social/outreach-run
// Body: { inputFile, limit }
// Spawns the social_outreach.js script as a background job
app.post('/api/social/outreach-run', async (req, res) => {
    const { inputFile = 'social_audited.csv', limit = 20 } = req.body || {};

    const csvPath = path.join(__dirname, 'data', inputFile);
    if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ error: `File not found: data/${inputFile}` });
    }

    const scriptPath = path.join(__dirname, 'src', 'node', 'social_outreach.js');
    if (!fs.existsSync(scriptPath)) {
        return res.status(500).json({ error: 'social_outreach.js script not found in src/node/' });
    }

    const ig_user = process.env.IG_USERNAME;
    const ig_pass = process.env.IG_PASSWORD;
    if (!ig_user || !ig_pass) {
        return res.status(500).json({ error: 'IG_USERNAME and IG_PASSWORD not set in .env' });
    }

    // Fire and forget — outreach runs in background
    const child = spawn('node', [
        scriptPath,
        '--input', csvPath,
        '--limit', String(limit),
    ], {
        shell: false,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
    });
    child.unref();

    console.log(`📨 Instagram DM outreach started: ${limit} max DMs from ${inputFile}`);
    res.json({ started: true, limit: Number(limit), inputFile });
});

// ──────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 Dashboard running at http://localhost:${PORT}\n`);
});
