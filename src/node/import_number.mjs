import "dotenv/config";
import axios from "axios";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const VAPI_API_KEY = process.env.VAPI_API_KEY;

const phoneNumber = "+1" + process.argv[2];

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !VAPI_API_KEY) {
    console.error("Missing env vars");
    process.exit(1);
}

const vapi = axios.create({
    baseURL: "https://api.vapi.ai",
    headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
    },
});

async function importNumber() {
    try {
        console.log(`\n📱 Importing ${phoneNumber} to Vapi...\n`);
        
        const res = await vapi.post("/phone-number", {
            number: phoneNumber,
            provider: "twilio",
            twilioAccountSid: TWILIO_ACCOUNT_SID,
            twilioAuthToken: TWILIO_AUTH_TOKEN,
        });

        const phoneNumberId = res.data.id;
        console.log(`✓ Successfully imported!\n`);
        console.log(`════════════════════════════════════════`);
        console.log(`✓ PHONE NUMBER: ${phoneNumber}`);
        console.log(`✓ VAPI PHONE ID: ${phoneNumberId}`);
        console.log(`════════════════════════════════════════\n`);

        console.log("📝 Update .env.local:\n");
        console.log(`VAPI_PHONE_NUMBER_ID=${phoneNumberId}\n`);

    } catch (err) {
        console.error("✗ Error:", err.response?.data || err.message);
        process.exit(1);
    }
}

importNumber();
