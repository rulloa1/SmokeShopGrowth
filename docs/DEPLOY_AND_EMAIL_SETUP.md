# Deployment & Email Setup Guide

## 1. Email Setup (Gmail SMTP)

The pipeline uses Gmail SMTP for sending personalized emails. You need a **Gmail App Password** (NOT your main password).

### Steps:

1. **Enable 2-Factor Authentication** (required for app passwords):
   - Go to https://myaccount.google.com/security
   - Click "2-Step Verification" and follow prompts
   - Confirm your phone number

2. **Generate App Password**:
   - Go back to Security settings → https://myaccount.google.com/apppasswords
   - Select "Mail" and "Windows Computer"
   - Google will generate a 16-character password like: `abcd efgh ijkl mnop`
   - Copy this password (without spaces)

3. **Update .env**:
   ```
   SMTP_USER=your.email@gmail.com
   SMTP_PASS=abcdefghijklmnop
   FROM_EMAIL=your.email@gmail.com
   FROM_NAME=Your Name
   ```

4. **Test locally**:
   ```bash
   npm run pipeline -- --city "Houston" --max-results 2
   ```
   The pipeline will reach Step 6 (Email) and send 2 test emails.

5. **Important**: Never commit real credentials to Git. Use `.env.local` for local development:
   ```bash
   cp .env .env.local
   # Edit .env.local with real credentials
   // Add to .gitignore if not already there
   ```

---

## 2. Local Development with Docker

Run the full stack locally before deploying:

```bash
docker-compose up
```

This starts the app at `http://localhost:3000` with all services.

---

## 3. Deploy to Railway

### Prerequisites:
- Railway account (free at https://railway.app)
- GitHub repo connected to Railway

### Deploy Steps:

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Ready for production"
   git push origin main
   ```

2. **Deploy from Railway Dashboard**:
   - Log in to https://railway.app
   - Create new project → "Deploy from GitHub repo"
   - Select this repository
   - Railway auto-detects the `Dockerfile` and `railway.toml`

3. **Add Environment Variables in Railway**:
   - Go to project → Variables
   - Add all `.env` variables:
     - `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL`, `FROM_NAME`
     - `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, etc.
   - These will override `.env` at runtime

4. **Check Deployment**:
   ```bash
   # Railway automatically builds and deploys
   # View logs in Dashboard → Logs tab
   # Your app runs at: https://<project-name>.railway.app
   ```

5. **Test Health Endpoint**:
   ```bash
   curl https://<project-name>.railway.app/health
   # Should return: {"status":"OK"}
   ```

---

## 4. Test Pipeline with Multiple Cities

Once email is working, test the full pipeline across different locations:

```bash
# Test 1: Houston (5 results)
npm run pipeline -- --city "Houston" --max-results 5

# Test 2: Dallas (10 results)
npm run pipeline -- --city "Dallas" --max-results 10

# Test 3: Austin (20 results)
npm run pipeline -- --city "Austin" --max-results 20

# Test 4: San Antonio (15 results)
npm run pipeline -- --city "San Antonio" --max-results 15

# Resume from specific step (useful if one fails)
npm run pipeline -- --city "Houston" --from-step 3  # Skip scrape/audit, start at social-audit
```

### Expected Flow:
1. **Step 1**: Scrape Google Maps
2. **Step 2**: Audit business data
3. **Step 3**: Look up social media
4. **Step 4**: Generate outreach messages
5. **Step 5**: Generate demo sites
6. **Step 6**: Send emails (skipped if no email configured)

### Monitor Progress:
- CSV files update in `data/{city}/`
- Logs in `logs/`
- Check `logs/email_log.csv` for email delivery status

---

## 5. Troubleshooting

### Email fails: "Username and Password not accepted"
- App password may be expired
- Regenerate at: https://myaccount.google.com/apppasswords
- Ensure `SMTP_USER` matches your Gmail address

### Pipeline hangs on Step 3 (social media lookup)
- API rate limit reached
- Wait a few minutes, then resume:
  ```bash
  npm run pipeline -- --city "Houston" --from-step 3
  ```

### Railway deployment fails
- Check Railway logs for build errors
- Ensure all required Python dependencies in `requirements.txt`
- Verify `Dockerfile` is in repo root

### Out of memory during scraping
- Reduce `--max-results`
- Playwright closes browser after completion
- Restart pipeline

---

## 6. Production Tips

- **Email throttling**: Add `--delay-ms 3000` to space out emails
  ```bash
  npm run pipeline -- --city "Houston" -- delay-ms 3000
  ```
- **Monitor costs**: Check OpenAI usage (outreach generation) & Elevenlabs (voice agents)
- **Scale scraper**: Run pipeline in background with nohup:
  ```bash
  nohup npm run pipeline -- --city "Houston" > pipeline.log 2>&1 &
  ```
- **Database**: Consider adding PostgreSQL for storing leads (currently uses CSV)

