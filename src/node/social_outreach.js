#!/usr/bin/env node
/**
 * Social Outreach
 * ===============
 * Uses Playwright to automatically send DMs to Instagram handles found in social_audited.csv.
 * 
 * NOTE: Instagram automation requires logging in. This script runs headed (visible browser)
 * so the user can log in manually the first time and save the session.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const INPUT_FILE = getArg('--input', 'data/social_audited.csv');
const LIMIT = parseInt(getArg('--limit', '20'), 10);
const SESSION_FILE = 'ig_session.json';

function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`Input file not found: ${filePath}`));
        }
        const rows = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', r => rows.push(r))
            .on('end', () => resolve(rows))
            .on('error', reject);
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log(`Starting social outreach...`);
    const leads = await readCsv(INPUT_FILE);
    
    // Filter to leads with Instagram handles
    const igLeads = leads.filter(l => l.instagram && l.instagram.trim() !== '');
    
    if (igLeads.length === 0) {
        console.log('No Instagram handles found in the target list.');
        return;
    }
    
    const targetLeads = igLeads.slice(0, LIMIT);
    console.log(`Found ${igLeads.length} Instagram handles. Targeting top ${targetLeads.length}...`);

    let browserContextOpts = {};
    if (fs.existsSync(SESSION_FILE)) {
        console.log('Using existing Instagram session...');
        browserContextOpts.storageState = SESSION_FILE;
    }

    const browser = await chromium.launch({ headless: false }); // Headless=false so we can log in if needed
    const context = await browser.newContext(browserContextOpts);
    const page = await context.newPage();

    // Go to Instagram
    await page.goto('https://www.instagram.com/');
    await delay(3000);

    // Check if we need to log in
    const isLoggedIn = await page.$('svg[aria-label="Direct"]');
    if (!isLoggedIn) {
        console.log('Not logged into Instagram. Please log in within the next 45 seconds...');
        // Wait for user to log in manually
        try {
            await page.waitForSelector('svg[aria-label="Direct"]', { timeout: 45000 });
            console.log('Login detected. Saving session...');
            await context.storageState({ path: SESSION_FILE });
        } catch (err) {
            console.error('Login timed out. Exiting.');
            await browser.close();
            process.exit(1);
        }
    }

    // Process DMs
    let successCount = 0;
    for (const lead of targetLeads) {
        const handle = lead.instagram.replace('@', '').trim();
        const businessName = lead.business || lead.business_name || 'there';
        
        // Generate a random-ish message to avoid spam filters
        const messages = [
            `Hey ${businessName}! Love your vibe. We built a custom demo website for you. Check it out when you have a sec!`,
            `Hi ${businessName}, noticed you could use a better booking system on your IG. We made a demo for you.`,
            `Hey! If you're looking to upgrade your digital storefront, we put together a free demo for ${businessName}.`
        ];
        const msg = messages[Math.floor(Math.random() * messages.length)];

        console.log(`Attempting message to @${handle}...`);

        try {
            // Navigate directly to user profile message endpoint does not exist easily, 
            // Better to go to profile and click message
            await page.goto(`https://www.instagram.com/${handle}/`);
            await delay(3000);
            
            // Look for "Message" button
            const messageBtn = await page.$('div[role="button"]:has-text("Message")');
            if (messageBtn) {
                await messageBtn.click();
                await delay(3000);
                
                // Deal with potential modals like "Turn on Notifications"
                const notNow = await page.$('button:has-text("Not Now")');
                if (notNow) await notNow.click();
                
                // Type message
                const msgBox = await page.$('div[role="textbox"]');
                if (msgBox) {
                    await msgBox.fill(msg);
                    await delay(1000);
                    // Press Enter to send
                    await page.keyboard.press('Enter');
                    console.log(`✅ Sent message to @${handle}.`);
                    successCount++;
                } else {
                    console.log(`❌ Message box not found for @${handle}.`);
                }
            } else {
                console.log(`❌ Message button not found for @${handle} (might be private or not follow back).`);
            }
        } catch (e) {
            console.log(`❌ Failed to send to @${handle}: ${e.message}`);
        }
        
        // Anti-spam delay between messages (20-40 seconds)
        const spamDelay = Math.floor(Math.random() * 20000) + 20000;
        console.log(`Waiting ${Math.round(spamDelay/1000)}s...`);
        await delay(spamDelay);
    }

    console.log(`Outreach complete. Sent ${successCount} messages.`);
    await browser.close();
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
