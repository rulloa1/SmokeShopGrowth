/**
 * Social Content Generator
 * ========================
 * Generates a 30-day social media content calendar using OpenAI GPT-4o.
 */

const { OpenAI } = require('openai');

async function generateCalendar({ business_name, city, instagram, specialty }) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is missing");
    }

    const openai = new OpenAI();
    
    const prompt = `You are an expert social media manager. Generate a 30-day Instagram/Facebook content calendar for a business named "${business_name}" located in "${city || 'Unknown'}". 
Specialty: ${specialty || 'General'}.
They want highly engaging posts to attract local customers.

Return pure JSON containing an array of 30 items under the key "posts". Each item should have:
- "day": a number from 1 to 30
- "platform": "Instagram" or "Facebook"
- "post_type": "Image", "Reel", "Carousel", or "Story"
- "caption": highly engaging caption with emojis and relevant hashtags
- "best_time": string representing optimal time (e.g., "12:00 PM")

Return ONLY JSON, no markdown formatting.`;

    const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
    });
    
    return JSON.parse(completion.choices[0].message.content);
}

module.exports = { generateCalendar };
