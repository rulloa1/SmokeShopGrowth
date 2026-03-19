'use strict';
/**
 * social_finder.js
 * ================
 * Fallback social media handle finder.
 * For businesses that don't have a website, searches Google to find their
 * Instagram and Facebook presence.
 *
 * Usage:
 *   const { findSocialHandles } = require('./social_finder');
 *   const { instagram, facebook } = await findSocialHandles('Clouds Smoke Shop', 'Houston TX');
 */

const { chromium } = require('playwright');

/**
 * Search Google for a business's social media handles.
 * @param {string} businessName
 * @param {string} city
 * @returns {Promise<{ instagram: string, facebook: string }>}
 */
async function findSocialHandles(businessName, city = '') {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
    });
    const page = await context.newPage();

    let instagram = '';
    let facebook = '';

    try {
        // Search for Instagram
        const igQuery = encodeURIComponent(`"${businessName}" ${city} site:instagram.com`);
        await page.goto(`https://www.google.com/search?q=${igQuery}`, {
            waitUntil: 'domcontentloaded',
            timeout: 10000,
        });
        await page.waitForTimeout(1000 + Math.random() * 1000);

        const igLinks = await page.$$eval('a[href*="instagram.com"]', (links) =>
            links.map((l) => l.href).filter((h) => h.includes('instagram.com/'))
        );
        for (const link of igLinks) {
            const match = link.match(/instagram\.com\/([A-Za-z0-9_.]+)\/?/);
            if (match) {
                const handle = match[1];
                const skip = ['p', 'reel', 'explore', 'stories', 'accounts', 'share', 'tv'];
                if (!skip.includes(handle.toLowerCase())) {
                    instagram = handle;
                    break;
                }
            }
        }

        // Search for Facebook
        const fbQuery = encodeURIComponent(`"${businessName}" ${city} site:facebook.com`);
        await page.goto(`https://www.google.com/search?q=${fbQuery}`, {
            waitUntil: 'domcontentloaded',
            timeout: 10000,
        });
        await page.waitForTimeout(1000 + Math.random() * 1000);

        const fbLinks = await page.$$eval('a[href*="facebook.com"]', (links) =>
            links.map((l) => l.href).filter((h) => h.includes('facebook.com/'))
        );
        for (const link of fbLinks) {
            const match = link.match(/facebook\.com\/([A-Za-z0-9_.\\-]+)\/?/);
            if (match) {
                const slug = match[1];
                const skip = ['sharer', 'share', 'dialog', 'plugins', 'tr', 'login', 'groups', 'pages'];
                if (!skip.includes(slug.toLowerCase())) {
                    facebook = slug;
                    break;
                }
            }
        }
    } catch (err) {
        console.warn(`[social_finder] Failed for "${businessName}": ${err.message}`);
    } finally {
        await browser.close();
    }

    return { instagram, facebook };
}

/**
 * Enrich a CSV row array with social handles.
 * Skips rows that already have instagram/facebook populated.
 * @param {object[]} leads - Array of lead objects from CSV
 * @param {object} options
 * @returns {Promise<object[]>}
 */
async function enrichLeadsWithSocial(leads, { concurrency = 3, onProgress } = {}) {
    const results = [...leads];
    const queue = results.filter((r) => !r.instagram && !r.facebook && r.business_name);

    console.log(`[social_finder] Enriching ${queue.length} leads with social handles...`);

    // Process in batches to avoid rate limiting
    for (let i = 0; i < queue.length; i += concurrency) {
        const batch = queue.slice(i, i + concurrency);
        await Promise.all(
            batch.map(async (lead) => {
                const { instagram, facebook } = await findSocialHandles(
                    lead.business_name,
                    lead.address?.split(',').slice(-2).join(',') || ''
                );
                lead.instagram = instagram;
                lead.facebook = facebook;
                if (onProgress) onProgress({ lead, instagram, facebook, done: i + 1, total: queue.length });
            })
        );
        // Polite delay between batches
        if (i + concurrency < queue.length) {
            await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
        }
    }

    return results;
}

module.exports = { findSocialHandles, enrichLeadsWithSocial };
