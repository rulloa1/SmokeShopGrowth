#!/usr/bin/env node
/**
 * Enhanced Demo Site Generator
 * ============================
 * Generates personalized single-file demo sites for leads.
 * 
 * Features:
 * - Rotates through multiple templates (cloud-nine, vibe, minimal)
 * - Intelligent content injection (address, phone, city, state)
 * - Dynamic color rotation for branding variety
 * - Fallback values for missing lead data
 */

'use strict';

import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates/smoke-shop-sites/sites');
const DEFAULT_OUTPUT = path.resolve(__dirname, '../../public/demos');
const DEFAULT_INPUT = path.resolve(__dirname, '../../data/leads.csv');

// Color palette to rotate through for variety
const COLORS = [
  { primary: '#7c3aed', hover: '#6d28d9', name: 'purple' },
  { primary: '#0ea5e9', hover: '#0284c7', name: 'blue' },
  { primary: '#16a34a', hover: '#15803d', name: 'green' },
  { primary: '#dc2626', hover: '#b91c1c', name: 'red' },
  { primary: '#d97706', hover: '#b45309', name: 'amber' },
  { primary: '#ec4899', hover: '#be185d', name: 'pink' },
];

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function getAvailableTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.error(`Templates directory not found: ${TEMPLATES_DIR}`);
    return [];
  }
  return fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.html'));
}

/**
 * Extracts city and state from a standard address string.
 * Example: "123 Main St, Houston, TX 77001" -> { city: "Houston", state: "TX" }
 */
function parseLocation(address) {
  if (!address) return { city: 'Your City', state: 'TX' };
  
  // Try to match "City, ST ZIP" or "City, ST"
  const match = address.match(/,\s*([^,]+),\s*([A-Z]{2})(?:\s+\d+)?$/);
  if (match) {
    return { city: match[1].trim(), state: match[2].trim() };
  }
  
  // Fallback: split by comma and take last parts
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    const city = parts[parts.length - 2];
    const stateZip = parts[parts.length - 1].split(' ');
    return { city, state: stateZip[0] || 'TX' };
  }
  
  return { city: 'Your City', state: 'TX' };
}

function personalizeTemplate(html, lead, colorIndex) {
  const color = COLORS[colorIndex % COLORS.length];
  const { city, state } = parseLocation(lead.address);
  const businessName = lead.business_name || 'Your Smoke Shop';
  const shortName = businessName.split(' ').slice(0, 2).join(' ');
  const phone = lead.phone || '(555) 000-0000';
  const address = lead.address || '123 Main St, Houston, TX';

  // Core Replacement Map
  const replacements = {
    '{{BUSINESS_NAME}}': businessName,
    '{{SHORT_NAME}}': shortName,
    '{{ADDRESS}}': address,
    '{{ADDRESS_ENCODED}}': encodeURIComponent(address),
    '{{CITY}}': city,
    '{{STATE}}': state,
    '{{PHONE}}': phone,
    '{{PHONE_RAW}}': phone.replace(/\D/g, ''),
    // Legacy support for older templates
    'Cloud Nine Smoke Shop': businessName,
    'Cloud Nine': shortName,
    '123 High St': address,
    'Denver, CO 80203': `${city}, ${state}`,
    '(303) 555-0199': phone,
  };

  let out = html;
  
  // Apply all text replacements
  for (const [key, value] of Object.entries(replacements)) {
    const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(regex, value);
  }

  // Swap brand colors (targeting common Tailwind or CSS hex codes)
  out = out
    .replace(/#7c3aed/g, color.primary)   // violet-600
    .replace(/#8b5cf6/g, color.primary)   // violet-500
    .replace(/#6d28d9/g, color.hover)     // violet-700
    .replace(/#7c3aed/g, color.hover)     // violet-600 (as hover)
    .replace(/rgba\(124,\s*58,\s*237,\s*0\.15\)/g, `${color.primary}26`); // alpha support

  return out;
}

async function loadLeads(inputPath) {
  return new Promise((resolve, reject) => {
    const leads = [];
    if (!fs.existsSync(inputPath)) return resolve([]);
    
    fs.createReadStream(inputPath)
      .pipe(csvParser())
      .on('data', row => leads.push(row))
      .on('end', () => resolve(leads))
      .on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };

  const inputPath = getArg('--input') || DEFAULT_INPUT;
  const outputDir = getArg('--output') || DEFAULT_OUTPUT;
  const templateFilter = getArg('--template');

  const templates = getAvailableTemplates();
  if (templates.length === 0) {
    console.error("No templates found in " + TEMPLATES_DIR);
    process.exit(1);
  }
  
  console.log(`Found ${templates.length} template(s): ${templates.join(', ')}`);

  const leads = await loadLeads(inputPath);
  if (leads.length === 0) {
    console.error(`No leads found in ${inputPath}.`);
    process.exit(1);
  }
  
  console.log(`Loaded ${leads.length} leads. Generating sites...`);
  fs.mkdirSync(outputDir, { recursive: true });

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    
    // Pick template: either filtered or rotate through available ones
    let templateFile;
    if (templateFilter) {
      templateFile = templates.find(t => t.includes(templateFilter)) || templates[0];
    } else {
      templateFile = templates[i % templates.length];
    }

    const templateHtml = fs.readFileSync(path.join(TEMPLATES_DIR, templateFile), 'utf8');
    const name = lead.business_name || lead.name || `lead-${i}`;
    const slug = slugify(name);
    const html = personalizeTemplate(templateHtml, lead, i);

    const shopDir = path.join(outputDir, slug);
    fs.mkdirSync(shopDir, { recursive: true });
    fs.writeFileSync(path.join(shopDir, 'index.html'), html);
    
    console.log(`  ✓ [${templateFile}] ${name} -> ${slug}/index.html`);
  }

  console.log(`\nSuccessfully generated ${leads.length} demo sites in ${outputDir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
