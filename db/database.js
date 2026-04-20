const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let db;

function getDb() {
  if (!db) {
    db = new Database(path.join(__dirname, '..', 'marketing-monitor.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);
  }
  return db;
}

function initDb() {
  getDb();
}

// --- Sites ---

function getAllSites() {
  return getDb().prepare(`
    SELECT s.*,
      (SELECT json_group_array(json_object(
        'id', sc.id, 'checker_type', sc.checker_type, 'config', sc.config, 'enabled', sc.enabled
      )) FROM site_checks sc WHERE sc.site_id = s.id) AS checks
    FROM sites s ORDER BY s.name
  `).all().map(row => ({
    ...row,
    checks: JSON.parse(row.checks || '[]')
  }));
}

function getSiteById(id) {
  const site = getDb().prepare('SELECT * FROM sites WHERE id = ?').get(id);
  if (!site) return null;
  site.checks = getDb().prepare('SELECT * FROM site_checks WHERE site_id = ?').all(id);
  return site;
}

function createSite({ name, url, checks = [] }) {
  const d = getDb();
  const result = d.prepare('INSERT INTO sites (name, url) VALUES (?, ?)').run(name, url);
  const siteId = result.lastInsertRowid;
  const insertCheck = d.prepare('INSERT INTO site_checks (site_id, checker_type, config) VALUES (?, ?, ?)');
  for (const check of checks) {
    insertCheck.run(siteId, check.type, JSON.stringify(check.config || {}));
  }
  return siteId;
}

function updateSite(id, { name, url, enabled, checks }) {
  const d = getDb();
  if (name !== undefined || url !== undefined || enabled !== undefined) {
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (url !== undefined) { fields.push('url = ?'); values.push(url); }
    if (enabled !== undefined) { fields.push('enabled = ?'); values.push(enabled ? 1 : 0); }
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
  getAllSites,
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
