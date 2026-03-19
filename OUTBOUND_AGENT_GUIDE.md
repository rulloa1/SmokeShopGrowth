# Outbound Agent Workflow

## What Just Happened ✅
1. **Improved Agent Script**: Natural, conversational tone with personality
2. **Better Voice**: OpenAI TTS (warm, human-sounding)
3. **Test Call Sent**: Agent called 346-298-5038 successfully
4. **Batch Ready**: 106 Houston leads queued for calling

---

## How to Run Full Campaign

### Option 1: Launch Single City
```bash
# Houston (106 leads)
node src/node/vapi_call.js --batch --file data/houston/audited_leads.csv

# Dallas (3 leads)
node src/node/vapi_call.js --batch --file data/dallas/audited_leads.csv

# Austin (3 leads)
node src/node/vapi_call.js --batch --file data/austin/audited_leads.csv
```

### Option 2: Launch All Cities Simultaneously
```bash
# Start all in background
nohup node src/node/vapi_call.js --batch --file data/houston/audited_leads.csv > logs/calls_houston.log 2>&1 &
nohup node src/node/vapi_call.js --batch --file data/dallas/audited_leads.csv > logs/calls_dallas.log 2>&1 &
nohup node src/node/vapi_call.js --batch --file data/austin/audited_leads.csv > logs/calls_austin.log 2>&1 &
```

---

## Monitor Call Performance

### Real-Time Metrics
```bash
# Show call outcome summary
Get-Content logs/calls.jsonl | ConvertFrom-Json | Group-Object -Property outcome | Select-Object Name, Count

# Show last 10 calls
Get-Content logs/calls.jsonl | Select-Object -Last 10 | ConvertFrom-Json | Select-Object phoneNumber, outcome, duration_seconds
```

### Expected Results per 100 Calls
- **20-25% Interested** → Phone contact made, genuinely interested
- **15-20% Voicemail** → Left message, may call back
- **30-40% No Answer** → Try again in 2-3 hours or next day
- **20-30% Not Interested** → "Already has site" or "Not now"

---

## Follow-Up for Interested Prospects

### Manual Follow-Up (API)
After call marked "interested", get their email from call summary:

```bash
# View interested prospects
Get-Content logs/calls.jsonl | ConvertFrom-Json | Where-Object { $_.outcome -eq "interested" } | Select-Object phoneNumber, contact_value
```

### Auto Follow-Up (Webhook)
The agent extracts:
- `contact_value` — their email address
- `outcome` — interested/not_interested/voicemail

Webhook sends to your CRM → Auto email demo link

---

## Agent Behavior

**What Rory Does on Each Call:**
1. Opens with "Hey, is this the owner?"
2. Quick intro: "I'm Rory, build websites for smoke shops"
3. Observation: "You've got great reviews but no website"
4. Solution: "Simple site for $99, just need a testimonial"
5. Ask: "Interested in a demo?"

**If They Say YES:**
- Asks for email
- Sends demo link immediately
- Call ends successfully

**If They Say NO:**
- Thanks them politely
- Ends call (no pressure)

**If VOICEMAIL:**
- Leaves professional message with callback number

---

## Call Limits & Concurrency

- **Free tier**: 10 concurrent calls max
- **Paid tier**: Up to 100+ concurrent calls
- **Delay between calls**: 10 seconds (prevents rate limiting)
- **Max call duration**: 90 seconds

### To Scale Faster (Costs money):
```bash
# Upgrade to Vapi paid tier → get more concurrent capacity
# Then run batch with higher concurrency:
node src/node/vapi_call.js --batch --file data/houston/audited_leads.csv --concurrency 5
```

---

## Cost Breakdown (per call)

| Component | Cost |
|-----------|------|
| Vapi call (inbound/outbound) | $0.12-0.25 |
| OpenAI TTS | $0.015 |
| Transcription (Deepgram) | $0.0043 |
| **Total per call** | **~$0.15** |
| **Per 100 calls** | **~$15** |
| **Per 1000 calls** | **~$150** |

---

## Troubleshooting

### "No Answer" Is Too High
- Try calling 6-9 AM or 4-6 PM (peak business hours)
- Some areas don't have good coverage — whitelist by timezone

### Agent Sounds Robotic
- Ensure `voice.provider` is "openai" with model "tts-1-hd"
- Lower `temperature` in agent config for more consistent delivery

### Calls Not Being Logged
- Check `logs/calls.jsonl` exists and is writable
- Ensure webhook endpoint is reachable (for call summaries)

### Rate Limiting
- Increase delay between calls: `--delay 15000` (15 seconds)
- Reduce concurrency or spread across multiple workers

---

## Next Steps

1. **Start batch calls**: `node src/node/vapi_call.js --batch --file data/houston/audited_leads.csv`
2. **Monitor results**: Watch outcome distribution in real-time
3. **Extract interested prospects**: Pull emails from call summaries
4. **Send demo emails**: Automated follow-up to interested leads
5. **Retry no-answers**: Re-queue after 2 hours
6. **Scale up**: Add more cities once Houston pipeline is warm

---

## Production Deployment

### On Railway/Cloud Server
```bash
# Run in production with nohup
nohup node src/node/vapi_call.js --batch --file data/houston/audited_leads.csv &

# Monitor with logs
tail -f logs/calls_houston.log

# Check daily results
Get-Content logs/calls.jsonl | ConvertFrom-Json | Where-Object { $_.timestamp -gt (Get-Date).AddDays(-1) } | Group-Object outcome
```

---

## Questions?

Script improvements:
- Better greeting tone? Update `SYSTEM_PROMPT` in `vapi_agent_setup.mjs`
- Different voice? Change `voice.voiceId` to different OpenAI voice (alloy, echo, fable, onyx, nova, shimmer)
- Change offer price? Edit step 6 in prompt

Ready to scale! 🚀

