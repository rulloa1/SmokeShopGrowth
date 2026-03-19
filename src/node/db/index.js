'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'leads.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    place_id       TEXT PRIMARY KEY,
    business_name  TEXT NOT NULL,
    address        TEXT DEFAULT '',
    phone          TEXT DEFAULT '',
    email          TEXT DEFAULT '',
    website        TEXT DEFAULT '',
    rating         REAL DEFAULT 0,
    review_count   INTEGER DEFAULT 0,
    google_maps_url TEXT DEFAULT '',
    image_url      TEXT DEFAULT '',
    city_slug      TEXT DEFAULT '',
    score          INTEGER DEFAULT 0,
    issues         TEXT DEFAULT '',
    status         TEXT DEFAULT 'scraped'
                   CHECK(status IN ('scraped','audited','contacted','called','paid','rejected')),
    audit_summary  TEXT DEFAULT '',
    ssl            TEXT DEFAULT '',
    load_time      TEXT DEFAULT '',
    mobile_friendly TEXT DEFAULT '',
    website_status TEXT DEFAULT '',
    instagram      TEXT DEFAULT '',
    facebook       TEXT DEFAULT '',
    has_website    TEXT DEFAULT '',
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT PRIMARY KEY,
    city       TEXT NOT NULL,
    biz_type   TEXT DEFAULT 'smoke shop',
    status     TEXT DEFAULT 'running',
    step       INTEGER DEFAULT 0,
    config     TEXT DEFAULT '{}',
    files      TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL,
    business_name TEXT DEFAULT '',
    city          TEXT DEFAULT '',
    tier          TEXT DEFAULT 'starter',
    amount        REAL DEFAULT 0,
    stripe_session TEXT DEFAULT '',
    paid_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS call_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id      TEXT,
    business_name TEXT DEFAULT '',
    phone         TEXT DEFAULT '',
    city          TEXT DEFAULT '',
    call_id       TEXT DEFAULT '',
    duration_secs INTEGER DEFAULT 0,
    outcome       TEXT DEFAULT '',
    summary       TEXT DEFAULT '',
    email_collected TEXT DEFAULT '',
    called_at     TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (place_id) REFERENCES leads(place_id)
  );

  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city_slug);
  CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score DESC);
`);

// ── Prepared statements ─────────────────────────

const upsertLead = db.prepare(`
  INSERT INTO leads (place_id, business_name, address, phone, email, website,
                     rating, review_count, google_maps_url, image_url, city_slug,
                     score, issues, status, audit_summary, ssl, load_time,
                     mobile_friendly, website_status, instagram, facebook, has_website)
  VALUES (@place_id, @business_name, @address, @phone, @email, @website,
          @rating, @review_count, @google_maps_url, @image_url, @city_slug,
          @score, @issues, @status, @audit_summary, @ssl, @load_time,
          @mobile_friendly, @website_status, @instagram, @facebook, @has_website)
  ON CONFLICT(place_id) DO UPDATE SET
    business_name = excluded.business_name,
    address = excluded.address,
    phone = CASE WHEN excluded.phone != '' THEN excluded.phone ELSE leads.phone END,
    email = CASE WHEN excluded.email != '' THEN excluded.email ELSE leads.email END,
    website = CASE WHEN excluded.website != '' THEN excluded.website ELSE leads.website END,
    rating = excluded.rating,
    review_count = excluded.review_count,
    score = excluded.score,
    issues = excluded.issues,
    status = excluded.status,
    audit_summary = CASE WHEN excluded.audit_summary != '' THEN excluded.audit_summary ELSE leads.audit_summary END,
    ssl = CASE WHEN excluded.ssl != '' THEN excluded.ssl ELSE leads.ssl END,
    load_time = CASE WHEN excluded.load_time != '' THEN excluded.load_time ELSE leads.load_time END,
    mobile_friendly = CASE WHEN excluded.mobile_friendly != '' THEN excluded.mobile_friendly ELSE leads.mobile_friendly END,
    website_status = CASE WHEN excluded.website_status != '' THEN excluded.website_status ELSE leads.website_status END,
    instagram = CASE WHEN excluded.instagram != '' THEN excluded.instagram ELSE leads.instagram END,
    facebook = CASE WHEN excluded.facebook != '' THEN excluded.facebook ELSE leads.facebook END,
    has_website = CASE WHEN excluded.has_website != '' THEN excluded.has_website ELSE leads.has_website END,
    updated_at = datetime('now')
`);

const upsertLeadMany = db.transaction((leads) => {
    for (const lead of leads) upsertLead.run(lead);
});

const getLeadByPlaceId = db.prepare('SELECT * FROM leads WHERE place_id = ?');
const getLeadsByCity = db.prepare('SELECT * FROM leads WHERE city_slug = ? ORDER BY score DESC');
const getLeadsByStatus = db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY score DESC');
const getLeadsByCityAndStatus = db.prepare('SELECT * FROM leads WHERE city_slug = ? AND status = ? ORDER BY score DESC');
const getAllLeads = db.prepare('SELECT * FROM leads ORDER BY score DESC');

// Paginated queries
const getLeadsByCityPaginated = db.prepare(`
  SELECT * FROM leads 
  WHERE city_slug = ? 
  ORDER BY score DESC 
  LIMIT ? OFFSET ?
`);

const getLeadsByCityCount = db.prepare('SELECT COUNT(*) as total FROM leads WHERE city_slug = ?');
const getLeadsByStatusPaginated = db.prepare(`
  SELECT * FROM leads 
  WHERE status = ? 
  ORDER BY score DESC 
  LIMIT ? OFFSET ?
`);

const getLeadsByStatusCount = db.prepare('SELECT COUNT(*) as total FROM leads WHERE status = ?');

const updateLeadStatus = db.prepare('UPDATE leads SET status = ?, updated_at = datetime(\'now\') WHERE place_id = ?');
const updateLeadEmail = db.prepare('UPDATE leads SET email = ?, updated_at = datetime(\'now\') WHERE place_id = ?');

// Jobs
const insertJob = db.prepare(`
  INSERT INTO jobs (id, city, biz_type, status, step, config, files)
  VALUES (@id, @city, @biz_type, @status, @step, @config, @files)
`);
const updateJob = db.prepare(`
  UPDATE jobs SET status = @status, step = @step, files = @files, updated_at = datetime('now')
  WHERE id = @id
`);
const getJob = db.prepare('SELECT * FROM jobs WHERE id = ?');
const getJobs = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC');

// Payments
const insertPayment = db.prepare(`
  INSERT INTO payments (email, business_name, city, tier, amount, stripe_session)
  VALUES (@email, @business_name, @city, @tier, @amount, @stripe_session)
`);

// Call log
const insertCallLog = db.prepare(`
  INSERT INTO call_log (place_id, business_name, phone, city, call_id, duration_secs, outcome, summary, email_collected)
  VALUES (@place_id, @business_name, @phone, @city, @call_id, @duration_secs, @outcome, @summary, @email_collected)
`);

module.exports = {
    db,
    upsertLead,
    upsertLeadMany,
    getLeadByPlaceId,
    getLeadsByCity,
    getLeadsByStatus,
    getLeadsByCityAndStatus,
    getAllLeads,
    getLeadsByCityPaginated,
    getLeadsByCityCount,
    getLeadsByStatusPaginated,
    getLeadsByStatusCount,
    updateLeadStatus,
    updateLeadEmail,
    insertJob,
    updateJob,
    getJob,
    getJobs,
    insertPayment,
    insertCallLog,
};
