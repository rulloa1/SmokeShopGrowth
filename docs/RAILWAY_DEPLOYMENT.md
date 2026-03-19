# Railway.app Deployment Guide

## Quick Start

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Production ready"
   git push origin main
   ```

2. **Deploy on Railway**
   - Go to https://railway.app/dashboard
   - Create new project
   - Choose "Deploy from GitHub repo"
   - Select your repo
   - Railway auto-reads `Dockerfile` and `railway.toml`

3. **Add Environment Variables**
   - Dashboard → Project → Variables
   - Add all from `.env`:
     ```
     OPENAI_API_KEY=sk-...
     ELEVENLABS_API_KEY=sk-...
     SMTP_USER=your@gmail.com
     SMTP_PASS=app_password_here
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=587
     FROM_EMAIL=your@gmail.com
     FROM_NAME=Your Name
     VAPI_API_KEY=...
     WEBHOOK_URL=https://your-railway-app.railway.app/vapi/webhook
     ```

4. **Verify Deployment**
   ```bash
   curl https://your-app.railway.app/api/ping
   # Returns: {"status":"ok","timestamp":"2026-03-18T..."}
   ```

## Architecture

### Production Stack
- **Frontend**: React SPA (public/index.html)
- **Backend**: Express.js (server.js) on Node.js 20
- **Scraper**: Playwright (async Chrome automation) + Python
- **Database**: CSV files (can upgrade to PostgreSQL)
- **Email**: SMTP via Gmail or SendGrid

### Docker Deployment
- Base: `node:20-bookworm` (includes Python 3)
- Playwright installed globally + Python packages
- npm dependencies installed with `npm ci`
- Health checks every 30s
- Auto-restart on failure

### Environment

Railway provides:
- **PORT**: Auto-set by Railway (we use for Express)
- **NODE_ENV**: Set to `production`
- **Memory**: 512MB (free tier) → increase for concurrent scrapes
- **CPU**: Shared → scale up if needed

## Continuous Deployment (Optional)

Add GitHub Actions to auto-deploy on push:

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to Railway
        uses: xano-io/github-action-railway@master
        with:
          railway_token: ${{ secrets.RAILWAY_TOKEN }}
          environment: production
```

Get `RAILWAY_TOKEN` from Railway Dashboard → Account → Token.

## Monitoring & Scaling

### Logs
```bash
# Stream live logs
railway logs --follow

# Search for errors
railway logs | grep -i error
```

### Scale Resources
- Free tier: 0.5 CPU, 512MB RAM
- Paid: Add more replicas or upgrade instance size
- For heavy scraping: Increase memory to 2GB+

### Environment Presets
- **Development**: 512MB, 1 replica
- **Staging**: 1GB, 1 replica
- **Production**: 2GB, 2 replicas (auto-scaling)

## Troubleshooting

### App crashes on startup
- Check logs: `railway logs`
- Verify all env vars are set
- Ensure Python dependencies in `requirements.txt`

### SMTP authentication fails
- Regenerate Gmail app password: https://myaccount.google.com/apppasswords
- Update both `SMTP_USER` and `SMTP_PASS`

### Out of memory
- Scraper running too many parallel jobs
- Reduce `--max-results` in pipeline calls
- Check `logs/calls.jsonl` for stuck processes

### Cold start slow
- Railway has ~5s cold start on free tier
- Use paid tier for <1s startup
- Can set `startCommand` to pre-warm cache

## Production Checklist

Before deploying to production:

- [ ] `.env` has real SMTP credentials
- [ ] OPENAI_API_KEY configured
- [ ] ELEVENLABS_API_KEY configured
- [ ] WEBHOOK_URL points to production domain
- [ ] `DEMO_BASE_URL` uses production domain
- [ ] `.gitignore` includes `.env` and `.env.local`
- [ ] All tests passing: `npm test`
- [ ] Lint clean: `npm run lint`
- [ ] Docker builds locally: `docker build -t app:latest .`
- [ ] Health check works: `curl /api/ping`

## Cost Estimates (Monthly)

| Component | Free Tier | Paid |
|-----------|-----------|------|
| Railway Hosting | $5 (0.5 CPU/512MB) | $7-50+ |
| Email (SMTP) | $0 (Gmail) | $0 (SendGrid free) |
| OpenAI Outreach Gen | ~$0.50-5 | Scales with usage |
| ElevenLabs Voice | Pay-per-call | $0.30/min |
| **Total** | **~$5/mo** | **~$10-15/mo** |

## Backup & Data

CSV files are stored in `/data` directory. On Railway:
- Files persist in container filesystem
- **NOT backed up on restart**
- Recommendation: Sync to PostgreSQL or S3 bucket

To add PostgreSQL on Railway:
1. Dashboard → Project → Add Service → PostgreSQL
2. Environment var `DATABASE_URL` auto-populated
3. Update `scripts/run_pipeline.mjs` to sync CSVs to DB  
4. Or keep CSVs, configure nightly backups to GitHub

