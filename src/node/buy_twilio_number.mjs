/**
 * buy_twilio_number.mjs
 * Purchase a new Twilio number and import it to Vapi
 *
 * Usage:
 *   node buy_twilio_number.mjs --area-code 281
 */

import "dotenv/config";
import axios from "axios";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const VAPI_API_KEY = process.env.VAPI_API_KEY;

// Parse args for area code preference
const args = process.argv.slice(2);
const areaCodeArg = args.find(arg => arg.startsWith("--area-code="));
const AREA_CODE = areaCodeArg ? areaCodeArg.split("=")[1] : "281"; // Texas (Houston area code)

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !VAPI_API_KEY) {
    console.error("Missing required environment variables:");
    console.error("  TWILIO_ACCOUNT_SID:", TWILIO_ACCOUNT_SID ? "✓" : "✗");
    console.error("  TWILIO_AUTH_TOKEN:", TWILIO_AUTH_TOKEN ? "✓" : "✗");
    console.error("  VAPI_API_KEY:", VAPI_API_KEY ? "✓" : "✗");
    process.exit(1);
}

const twilio = axios.create({
    baseURL: `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}`,
    auth: {
        username: TWILIO_ACCOUNT_SID,
        password: TWILIO_AUTH_TOKEN,
    },
});

const vapi = axios.create({
    baseURL: "https://api.vapi.ai",
    headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
    },
});

async function buyTwilioNumber() {
    try {
        console.log(`\n🔵 Searching for available Twilio numbers in area code ${AREA_CODE}...\n`);

        // Find available numbers
        const availRes = await twilio.get("/AvailablePhoneNumbers/US/Local.json", {
            params: {
                AreaCode: AREA_CODE,
                Limit: 1,
            },
        });

        if (!availRes.data.available_phone_numbers || availRes.data.available_phone_numbers.length === 0) {
            console.error("✗ No available numbers found in that area code");
            process.exit(1);
        }

        const newNumber = availRes.data.available_phone_numbers[0].phone_number;
        console.log(`✓ Found: ${newNumber}`);

        // Buy the number
        console.log(`\n🛒 Purchasing ${newNumber}...\n`);
        const buyRes = await twilio.post("/IncomingPhoneNumbers.json", null, {
            params: {
                PhoneNumber: newNumber,
                FriendlyName: `Smoke Shop Outreach - ${newNumber}`,
            },
        });

        const purchasedNumber = buyRes.data.phone_number;
        console.log(`✓ Successfully purchased: ${purchasedNumber}`);

        // Import to Vapi
        console.log(`\n📱 Importing to Vapi...\n`);
        const vapiRes = await vapi.post("/phone-number", {
            number: purchasedNumber,
            provider: "twilio",
            twilioAccountSid: TWILIO_ACCOUNT_SID,
            twilioAuthToken: TWILIO_AUTH_TOKEN,
        });

        const phoneNumberId = vapiRes.data.id;
        console.log(`✓ Imported to Vapi successfully!`);
        console.log(`\n════════════════════════════════════════`);
        console.log(`✓ NEW TWILIO NUMBER: ${purchasedNumber}`);
        console.log(`✓ VAPI PHONE NUMBER ID: ${phoneNumberId}`);
        console.log(`════════════════════════════════════════\n`);

        console.log("📝 Update your .env.local:\n");
        console.log(`TWILIO_PHONE_NUMBER=${purchasedNumber}`);
        console.log(`VAPI_PHONE_NUMBER_ID=${phoneNumberId}\n`);

        console.log("Then test with:");
        console.log(`  node src/node/vapi_call.js --phone "+13462985038" --name "Test Shop" --city "Houston"\n`);

    } catch (err) {
        console.error("✗ Error:", err.response?.data || err.message);
        process.exit(1);
    }
}

buyTwilioNumber();
