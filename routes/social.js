'use strict';

const router = require('express').Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');

// POST /api/social/generate-calendar
// Body: { business_name, city, instagram?, specialty? }
// Returns: { posts: [...] } — 30 days of post objects
router.post('/api/social/generate-calendar', async (req, res) => {
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
router.get('/api/social/buffer-profiles', async (req, res) => {
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
router.post('/api/social/schedule', async (req, res) => {
    const { posts, profileId, businessName } = req.body || {};
    if (!posts || !profileId) return res.status(400).json({ error: 'posts and profileId are required' });

    const token = process.env.BUFFER_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'BUFFER_ACCESS_TOKEN not set in .env' });

    let success = 0;
    let failed = 0;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);

    for (const post of posts) {
        try {
            const scheduledAt = new Date(startDate);
            scheduledAt.setDate(startDate.getDate() + (post.day - 1));
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
// Returns preview of DMs that would be sent (dry run)
router.post('/api/social/outreach-preview', async (req, res) => {
    const { inputFile = 'social_audited.csv', limit = 20 } = req.body || {};

    const csvPath = path.join(__dirname, '..', 'data', inputFile);
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
router.post('/api/social/outreach-run', async (req, res) => {
    const { inputFile = 'social_audited.csv', limit = 20 } = req.body || {};

    const csvPath = path.join(__dirname, '..', 'data', inputFile);
    if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ error: `File not found: data/${inputFile}` });
    }

    const scriptPath = path.join(__dirname, '..', 'src', 'node', 'social_outreach.js');
    if (!fs.existsSync(scriptPath)) {
        return res.status(500).json({ error: 'social_outreach.js script not found in src/node/' });
    }

    const ig_user = process.env.IG_USERNAME;
    const ig_pass = process.env.IG_PASSWORD;
    if (!ig_user || !ig_pass) {
        return res.status(500).json({ error: 'IG_USERNAME and IG_PASSWORD not set in .env' });
    }

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

module.exports = router;
