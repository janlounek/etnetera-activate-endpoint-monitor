const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let db;

// --- Password hashing (scrypt, no external deps) ---

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false;
  }
}

function getDb() {
  if (!db) {
    // DB_PATH lets the DB live on a Railway volume (or other mount) so it
    // survives redeploys. Falls back to the project root for local dev.
    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'marketing-monitor.db');
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    console.log(`SQLite DB: ${dbPath}`);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);

    // Migrations
    const siteCols = db.prepare("PRAGMA table_info(sites)").all().map(c => c.name);
    if (!siteCols.includes('parent_id')) {
      db.exec('ALTER TABLE sites ADD COLUMN parent_id INTEGER REFERENCES sites(id) ON DELETE SET NULL');
    }
    if (!siteCols.includes('site_type')) {
      db.exec("ALTER TABLE sites ADD COLUMN site_type TEXT DEFAULT 'public'");
    }
    if (!siteCols.includes('client_id')) {
      db.exec('ALTER TABLE sites ADD COLUMN client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE');
    }

    const clientCols = db.prepare("PRAGMA table_info(clients)").all().map(c => c.name);
    if (!clientCols.includes('username')) {
      db.exec('ALTER TABLE clients ADD COLUMN username TEXT');
    }
    if (!clientCols.includes('password_hash')) {
      db.exec('ALTER TABLE clients ADD COLUMN password_hash TEXT');
    }

    // Backfill: if there are sites without a client_id, create a default CSOB client
    // and move them under it (preserves existing production data).
    const orphanCount = db.prepare('SELECT COUNT(*) AS c FROM sites WHERE client_id IS NULL').get().c;
    if (orphanCount > 0) {
      let csob = db.prepare("SELECT id FROM clients WHERE slug = 'csob'").get();
      if (!csob) {
        // Best-effort read of the legacy global Slack webhook so it isn't lost on migration.
        // Wrapped in try/catch — a malformed `settings` row mustn't block startup.
        let webhook = null;
        try {
          const oldWebhook = db.prepare("SELECT value FROM settings WHERE key = 'slack_webhook_url'").get();
          webhook = oldWebhook ? oldWebhook.value : null;
        } catch (e) {
          console.warn(`Migration: could not read legacy slack_webhook_url (${e.message}); proceeding without it.`);
        }
        const r = db.prepare("INSERT INTO clients (name, slug, slack_webhook_url) VALUES (?, ?, ?)").run('CSOB', 'csob', webhook);
        csob = { id: r.lastInsertRowid };
        console.log(`Migration: created default 'CSOB' client (id=${csob.id})`);
      }
      const upd = db.prepare('UPDATE sites SET client_id = ? WHERE client_id IS NULL').run(csob.id);
      console.log(`Migration: moved ${upd.changes} existing site(s) under 'CSOB' client.`);
    }
  }
  return db;
}

function initDb() {
  getDb();
}

// --- Clients ---

function getAllClients() {
  return getDb().prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM sites s WHERE s.client_id = c.id) AS site_count
    FROM clients c
    ORDER BY c.name
  `).all();
}

function getClientBySlug(slug) {
  return getDb().prepare('SELECT * FROM clients WHERE slug = ?').get(slug);
}

function getClientById(id) {
  return getDb().prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

function getClientByUsername(username) {
  if (!username) return null;
  return getDb().prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
}

function createClient({ name, slug, slack_webhook_url = null, username = null, password = null }) {
  const password_hash = password ? hashPassword(password) : null;
  const r = getDb().prepare(
    'INSERT INTO clients (name, slug, slack_webhook_url, username, password_hash) VALUES (?, ?, ?, ?, ?)'
  ).run(name, slug, slack_webhook_url, username || null, password_hash);
  return r.lastInsertRowid;
}

function updateClient(id, { name, slug, slack_webhook_url, username, password, clearPassword }) {
  const d = getDb();
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (slug !== undefined) { fields.push('slug = ?'); values.push(slug); }
  if (slack_webhook_url !== undefined) { fields.push('slack_webhook_url = ?'); values.push(slack_webhook_url || null); }
  if (username !== undefined) { fields.push('username = ?'); values.push(username || null); }
  if (clearPassword) {
    fields.push('password_hash = ?'); values.push(null);
  } else if (password) {
    fields.push('password_hash = ?'); values.push(hashPassword(password));
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  d.prepare(`UPDATE clients SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function deleteClient(id) {
  getDb().prepare('DELETE FROM clients WHERE id = ?').run(id);
}

// --- Sites ---

function getAllSites(clientId = null) {
  const where = clientId ? 'WHERE s.client_id = ?' : '';
  const params = clientId ? [clientId] : [];
  return getDb().prepare(`
    SELECT s.*,
      (SELECT json_group_array(json_object(
        'id', sc.id, 'checker_type', sc.checker_type, 'config', sc.config, 'enabled', sc.enabled
      )) FROM site_checks sc WHERE sc.site_id = s.id) AS checks
    FROM sites s ${where}
    ORDER BY s.parent_id NULLS FIRST, s.site_type, s.name
  `).all(...params).map(row => ({
    ...row,
    checks: JSON.parse(row.checks || '[]')
  }));
}

function getSitesByClientId(clientId) {
  return getAllSites(clientId);
}

function getSiteById(id) {
  const site = getDb().prepare('SELECT * FROM sites WHERE id = ?').get(id);
  if (!site) return null;
  site.checks = getDb().prepare('SELECT * FROM site_checks WHERE site_id = ?').all(id);
  site.children = getDb().prepare('SELECT * FROM sites WHERE parent_id = ?').all(id);
  return site;
}

function createSite({ name, url, checks = [], parent_id = null, site_type = 'public', client_id = null }) {
  const d = getDb();
  const result = d.prepare(
    'INSERT INTO sites (client_id, name, url, parent_id, site_type) VALUES (?, ?, ?, ?, ?)'
  ).run(client_id, name, url, parent_id, site_type);
  const siteId = result.lastInsertRowid;
  const insertCheck = d.prepare('INSERT INTO site_checks (site_id, checker_type, config) VALUES (?, ?, ?)');
  for (const check of checks) {
    insertCheck.run(siteId, check.type, JSON.stringify(check.config || {}));
  }
  return siteId;
}

function updateSite(id, { name, url, enabled, checks, parent_id, site_type, client_id }) {
  const d = getDb();
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (url !== undefined) { fields.push('url = ?'); values.push(url); }
  if (enabled !== undefined) { fields.push('enabled = ?'); values.push(enabled ? 1 : 0); }
  if (parent_id !== undefined) { fields.push('parent_id = ?'); values.push(parent_id); }
  if (site_type !== undefined) { fields.push('site_type = ?'); values.push(site_type); }
  if (client_id !== undefined) { fields.push('client_id = ?'); values.push(client_id); }
  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    values.push(id);
    d.prepare(`UPDATE sites SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
  if (checks) {
    d.prepare('DELETE FROM site_checks WHERE site_id = ?').run(id);
    const insertCheck = d.prepare('INSERT INTO site_checks (site_id, checker_type, config, enabled) VALUES (?, ?, ?, ?)');
    for (const check of checks) {
      insertCheck.run(id, check.type, JSON.stringify(check.config || {}), check.enabled !== false ? 1 : 0);
    }
  }
}

function deleteSite(id) {
  getDb().prepare('DELETE FROM sites WHERE id = ?').run(id);
}

// --- Check Results ---

function saveResult(siteId, checkType, status, details) {
  getDb().prepare(
    'INSERT INTO check_results (site_id, check_type, status, details) VALUES (?, ?, ?, ?)'
  ).run(siteId, checkType, status, JSON.stringify(details));
}

function getResultsForSite(siteId, limit = 50, offset = 0) {
  return getDb().prepare(
    'SELECT * FROM check_results WHERE site_id = ? ORDER BY checked_at DESC LIMIT ? OFFSET ?'
  ).all(siteId, limit, offset).map(r => ({ ...r, details: JSON.parse(r.details || '{}') }));
}

function getLatestResultsForSite(siteId) {
  return getDb().prepare(`
    SELECT cr.* FROM check_results cr
    INNER JOIN (
      SELECT site_id, check_type, MAX(checked_at) as max_checked
      FROM check_results WHERE site_id = ?
      GROUP BY site_id, check_type
    ) latest ON cr.site_id = latest.site_id
      AND cr.check_type = latest.check_type
      AND cr.checked_at = latest.max_checked
  `).all(siteId).map(r => ({ ...r, details: JSON.parse(r.details || '{}') }));
}

function getLatestResultsForAllSites() {
  return getDb().prepare(`
    SELECT cr.* FROM check_results cr
    INNER JOIN (
      SELECT site_id, check_type, MAX(checked_at) as max_checked
      FROM check_results
      GROUP BY site_id, check_type
    ) latest ON cr.site_id = latest.site_id
      AND cr.check_type = latest.check_type
      AND cr.checked_at = latest.max_checked
  `).all().map(r => ({ ...r, details: JSON.parse(r.details || '{}') }));
}

function getPreviousStatus(siteId, checkType) {
  const row = getDb().prepare(
    'SELECT status FROM check_results WHERE site_id = ? AND check_type = ? ORDER BY checked_at DESC LIMIT 1 OFFSET 1'
  ).get(siteId, checkType);
  return row ? row.status : null;
}

// --- Settings ---

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function getAllSettings() {
  const rows = getDb().prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

module.exports = {
  initDb,
  getDb,
  hashPassword,
  verifyPassword,
  getAllClients,
  getClientBySlug,
  getClientById,
  getClientByUsername,
  createClient,
  updateClient,
  deleteClient,
  getAllSites,
  getSitesByClientId,
  getSiteById,
  createSite,
  updateSite,
  deleteSite,
  saveResult,
  getResultsForSite,
  getLatestResultsForSite,
  getLatestResultsForAllSites,
  getPreviousStatus,
  getSetting,
  setSetting,
  getAllSettings
};
