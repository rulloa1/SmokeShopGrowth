import "dotenv/config";
import axios from "axios";

const VAPI_API_KEY = process.env.VAPI_API_KEY;

const vapi = axios.create({
    baseURL: "https://api.vapi.ai",
    headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
    },
});

async function listPhoneNumbers() {
    try {
        const res = await vapi.get("/phone-number");
        console.log("\n=== Available Phone Numbers in Vapi ===\n");
        res.data.forEach((phone, idx) => {
            console.log(`[${idx + 1}]`);
            console.log(`  ID: ${phone.id}`);
            console.log(`  Number: ${phone.number}`);
            console.log(`  Provider: ${phone.provider}`);
            console.log(`  Status: ${phone.status || "active"}\n`);
        });
    } catch (err) {
        console.error("Error listing phone numbers:", err.response?.data || err.message);
    }
}

listPhoneNumbers();
