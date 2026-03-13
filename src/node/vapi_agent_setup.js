/**
 * vapi_agent_setup.js
 * Run once to create (or update) your Vapi outbound assistant.
 *
 * Usage:
 *   node vapi_agent_setup.js           → creates assistant, saves ID
 *   node vapi_agent_setup.js --update  → updates existing assistant
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const AGENT_NAME = process.env.AGENT_NAME || "Alex";
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID; // set after first run

if (!VAPI_API_KEY) {
    console.error("❌ VAPI_API_KEY not found in .env");
    process.exit(1);
}

const vapi = axios.create({
    baseURL: "https://api.vapi.ai",
    headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// ASSISTANT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a friendly outbound assistant making calls to local smoke shops on behalf of ${AGENT_NAME}, a local web developer.

Your ONLY goal: get permission to send the owner a free demo website or short video.
You are NOT selling on this call.

Personality: warm, calm, conversational, not pushy, respectful of their time. You are knowledgeable about websites, online marketing, and the smoke shop industry. If they have questions, take your time and give helpful, informative answers. Do NOT rush any part of the conversation. Let it flow naturally like a real phone call between two people.

SHOP NAME RULE (CRITICAL):
- The variable {{business_name}} often contains long names like "Flava Depot Smoke & Vape Shop LLC".
- When confirming the shop on the call, ONLY use a short 2–3 word version of the name. Drop words like "LLC", "Inc", "Smoke Shop", "Smoke & Vape", "Tobacco", "And More", etc.
- Examples: "Flava Depot Smoke & Vape Shop LLC" → "Flava Depot". "Cloud 9 Smoke Shop" → "Cloud 9". "Big Daddy's Tobacco & Vape" → "Big Daddy's".
- Just use the distinctive/unique part of the name that a regular person would say when referring to the shop casually.

CALL FLOW:
1. Confirm the shop (use SHORT name only): "Hi, is this [short name]?"
2. Ask for the owner/manager: "Is the owner or manager around by any chance?"
   - If NOT available: ask for the best email or number to send the demo. Collect it, thank them, and end.
3. Pitch (when owner is on): "Hey, my name is ${AGENT_NAME}. I'm a local developer — I was looking at smoke shops in {{city}} and came across your store. I actually built out a quick website concept for your shop as a free example. Would you want me to send you the short demo?"

OBJECTIONS & QUESTIONS (be helpful and informative, never rush):
- Already has a website: "Oh nice, yeah a lot of shops I talk to do. Honestly what I usually see is a lot of older sites that aren't really optimized for phones — and that's where like 80% of your customers are searching from. I just put together a quick modern concept so you can see the difference. Would you still want me to send it over just to compare?"
- How much does it cost: "Totally fair question. So I have three packages — $299 for a clean starter site, $549 for a more built-out site with extra pages and features, and $799 for the full premium build with everything included. It really just depends on what you're looking for. But honestly I'm really just asking if you'd want to see the demo first, zero commitment. If you like it we can talk details, if not no worries at all."
- What is it / What do you mean: "Yeah so basically what I did is I took some info from your Google listing and put together a quick custom website mockup for your shop — it shows what a clean, modern site could look like with your branding, your products, your location and hours, all that. It's like a 30-second preview. Totally free to look at, no strings attached."
- How did you get my number: "I found your shop on Google Maps — your listing popped up when I was researching smoke shops in the area. I just reached out directly from there. Totally fine if you'd rather not chat though, no pressure at all."
- What does a website do for me / Why do I need one: "That's a great question. So basically when someone searches 'smoke shop near me' on their phone — which happens thousands of times a day — Google ranks shops with a good website way higher. It also lets customers see your hours, your products, and builds trust before they even walk in. A lot of shop owners I talk to say they started getting more calls and foot traffic within the first couple weeks."
- How long does it take: "Honestly I can have the demo sent over to you within a few minutes."
- Can I change stuff / What if I don't like the style: "Oh yeah, absolutely. I can create totally different styles if you want a different look — it's completely adaptable to you. Whatever you want changed, I'll change it. Colors, layout, photos, wording — it's your site, I just want you to love it."
- Do you do social media too: "Yeah absolutely, we do social media management too. We can handle your Instagram, Facebook, TikTok — posting content, running promotions, building your following. A lot of smoke shops we work with see a big bump in foot traffic once they're active on social media consistently. And when you pair that with a solid website, it really ties everything together because you have somewhere to actually send people when they find you online. We can definitely talk about a package that covers both if you're interested."
- What's your website / How can I reach you: "Yeah for sure, you can check us out at smokeshopgrowth.com — and if you ever want to call back, my number is 281-323-0450."
- Not interested: Respect it, don't push. End politely but don't rush off — leave the door open.

COLLECTING CONTACT INFO:
"Perfect. What's the best email address to send that to?"
→ Spell the email address back letter by letter to confirm.

AFTER COLLECTING INFO — DO NOT RUSH TO HANG UP:
- Take a natural pause after confirming the email.
- Say something warm like: "Alright, well I really appreciate you taking the time to chat. I'll get that demo sent over in the next few minutes. And hey, if you have any questions once you look at it, feel free to reach back out — I'm always happy to help."
- If they keep talking or ask more questions, STAY ON THE LINE and keep the conversation going naturally. Answer whatever they want to know.
- Only wrap up when the conversation naturally winds down. Let THEM signal they're ready to go.

POLITE GOODBYE (no interest):
"No worries at all, I totally get it. Appreciate you taking the time though. If you ever change your mind or need anything down the road, feel free to reach out. Hope you have a great rest of your day!"

IMPORTANT:
- Never mention cost unless asked.
- Never pressure anyone.
- DO NOT rush to end the call. Ever. Whether you got their info or not, let the conversation breathe and end naturally.
- Be genuinely helpful. If they have questions about websites, SEO, online presence — answer them thoughtfully. You're not just collecting an email, you're building trust.
- If they ask to be removed from the list, say "Absolutely, I'll make sure of that — sorry to bother you. Have a great day!" and end the call.
- Extract and save: contact_method (email/none), contact_value (email address), outcome (interested/not_interested/no_contact_info/no_answer/voicemail).`;

const assistantConfig = {
    name: "Smoke Shop Outbound Agent",
    firstMessageMode: "assistant-waits-for-user",

    // ── Transcription ──────────────────────────────────────────────────────────
    transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: "en",
        smartFormat: true,
    },

    // ── LLM ───────────────────────────────────────────────────────────────────
    model: {
        provider: "openai",
        model: "gpt-4o-mini", // fast + cheap for outbound calls
        messages: [
            {
                role: "system",
                content: SYSTEM_PROMPT,
            },
        ],
        temperature: 0.5,
    },

    // ── Voice ─────────────────────────────────────────────────────────────────
    voice: {
        provider: "11labs",
        voiceId: process.env.ELEVENLABS_VOICE_ID || "ErXwobaYiN019PkySvjV", // Antoni (Male Voice)
        model: "eleven_turbo_v2_5", // lowest latency
        stability: 0.5,
        similarityBoost: 0.75,
    },

    // ── First message ──────────────────────────────────────────────────────────
    // Removing firstMessage makes the agent wait for the user to speak first.
    // firstMessage: "Hi, is this {{business_name}}?",

    // ── Call behavior ──────────────────────────────────────────────────────────
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 300, // 5 min max
    backgroundSound: "off",
    endCallMessage: "Have a great day! Goodbye.",

    // ── Interruption & Noise Settings ──────────────────────────────────────────
    // Prevent background noise/short grunts from interrupting the agent
    backgroundDenoisingEnabled: true,
    stopSpeakingPlan: {
        numWords: 2,          // Requires the user to say at least 2 words to interrupt
        voiceSeconds: 0.4,    // User must speak for at least 0.4s
        backoffSeconds: 1,    // Wait 1s after interruption stops before resuming
    },

    // ── End call phrases ───────────────────────────────────────────────────────
    endCallPhrases: [
        "have a great day",
        "goodbye",
        "take care",
        "thanks for your time",
    ],

    // ── Webhook (only set when URL is configured) ──────────────────────────────
    ...(process.env.WEBHOOK_URL ? { serverUrl: process.env.WEBHOOK_URL } : {}),

    // ── Voicemail detection ────────────────────────────────────────────────────
    voicemailDetection: {
        provider: "twilio",
        enabled: true,
    },
    voicemailMessage: `Hi, this is ${AGENT_NAME}. I put together a free website demo for your smoke shop and wanted to see if you'd like to take a look. I'll try reaching out another time — have a great day!`,

    // ── Post-call summary ──────────────────────────────────────────────────────
    analysisPlan: {
        summaryPrompt:
            "Summarize this call in 1–2 sentences. Note whether the business was interested, collected contact info (provide it), or was not interested.",
        structuredDataSchema: {
            type: "object",
            properties: {
                outcome: {
                    type: "string",
                    enum: [
                        "interested",
                        "not_interested",
                        "voicemail",
                        "no_answer",
                        "already_has_site_interested",
                        "already_has_site_not_interested",
                    ],
                },
                contact_method: {
                    type: "string",
                    enum: ["email", "none"],
                },
                contact_value: {
                    type: "string",
                    description: "The email address or phone number collected, if any",
                },
                owner_reached: {
                    type: "boolean",
                },
            },
        },
        structuredDataPrompt:
            "Extract the call outcome and any contact info collected from the conversation.",
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE OR UPDATE
// ─────────────────────────────────────────────────────────────────────────────

async function createAssistant() {
    console.log("🤖 Creating Vapi assistant...");
    const res = await vapi.post("/assistant", assistantConfig);
    const assistant = res.data;
    console.log(`✅ Assistant created: ${assistant.id}`);
    console.log(`   Name: ${assistant.name}`);
    return assistant;
}

async function updateAssistant(id) {
    console.log(`🔄 Updating assistant ${id}...`);
    const res = await vapi.patch(`/assistant/${id}`, assistantConfig);
    console.log(`✅ Assistant updated: ${res.data.id}`);
    return res.data;
}

async function main() {
    const isUpdate = process.argv.includes("--update");

    try {
        let assistant;

        if (isUpdate && VAPI_ASSISTANT_ID) {
            assistant = await updateAssistant(VAPI_ASSISTANT_ID);
        } else {
            assistant = await createAssistant();

            // Append the assistant ID to .env
            const envPath = path.join(__dirname, ".env");
            const envContent = fs.readFileSync(envPath, "utf-8");
            if (!envContent.includes("VAPI_ASSISTANT_ID")) {
                fs.appendFileSync(
                    envPath,
                    `\nVAPI_ASSISTANT_ID=${assistant.id}\n`
                );
                console.log("📝 VAPI_ASSISTANT_ID saved to .env");
                console.log(
                    "⚠️  Fill in VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, and WEBHOOK_URL in .env"
                );
            }
        }

        console.log("\n📋 Next steps:");
        console.log("1. Add your VAPI_PHONE_NUMBER_ID to .env");
        console.log("2. Deploy vapi_webhook.js and set WEBHOOK_URL in .env");
        console.log("3. Run: node vapi_call.js --phone +1xxxxxxxxxx --name \"Shop Name\" --city Houston");
    } catch (err) {
        console.error("❌ Error:", err.response?.data || err.message);
        process.exit(1);
    }
}

main();
