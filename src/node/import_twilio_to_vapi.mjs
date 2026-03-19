/**
 * import_twilio_to_vapi.mjs
 * Import your Twilio phone number into Vapi to bypass daily call limits
 *
 * Usage:
 *   node import_twilio_to_vapi.mjs
 */

import "dotenv/config";
import axios from "axios";

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

if (!VAPI_API_KEY || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.error("Missing required environment variables:");
    console.error("  VAPI_API_KEY:", VAPI_API_KEY ? "✓" : "✗");
    console.error("  TWILIO_ACCOUNT_SID:", TWILIO_ACCOUNT_SID ? "✓" : "✗");
    console.error("  TWILIO_AUTH_TOKEN:", TWILIO_AUTH_TOKEN ? "✓" : "✗");
    console.error("  TWILIO_PHONE_NUMBER:", TWILIO_PHONE_NUMBER ? "✓" : "✗");
    process.exit(1);
}

const vapi = axios.create({
    baseURL: "https://api.vapi.ai",
    headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
    },
});

async function importTwilioNumber() {
    console.log(`\nImporting Twilio number ${TWILIO_PHONE_NUMBER} to Vapi...\n`);

    const payload = {
        number: TWILIO_PHONE_NUMBER,
        provider: "twilio",
        twilioAccountSid: TWILIO_ACCOUNT_SID,
        twilioAuthToken: TWILIO_AUTH_TOKEN,
    };

    try {
        const res = await vapi.post("/phone-number", payload);
        const phoneNumberId = res.data.id;

        console.log("✓ Twilio number imported successfully!");
        console.log(`\nPhone Number ID: ${phoneNumberId}`);
        console.log(`Phone Number: ${TWILIO_PHONE_NUMBER}`);

        console.log("\n─────────────────────────────────────────");
        console.log("✓ Next Step: Update .env.local with:");
        console.log(`\n  VAPI_PHONE_NUMBER_ID=${phoneNumberId}`);
        console.log("\nThen run:");
        console.log(`  node src/node/vapi_call.js --phone "+1234567890" --name "Shop" --city "City"\n`);

        return phoneNumberId;
    } catch (err) {
        console.error("✗ Error importing Twilio number:");
        console.error(err.response?.data || err.message);
        process.exit(1);
    }
}

importTwilioNumber();
