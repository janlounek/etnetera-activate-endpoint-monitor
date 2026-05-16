const express = require('express');
const router = express.Router();
const db = require('../../db/database');
const { runAllChecks, runSingleSiteCheck, isRunning, CHECKER_LABELS } = require('../checkers');
const { sendTestMessage } = require('../slack');
const scheduler = require('../scheduler');

// --- Helpers ---

function getRootDomain(urlStr) {
  try {
    const hostname = new URL(urlStr).hostname;
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return hostname;
  } catch (e) {
    return urlStr;
  }
}

function isPrivateZone(urlStr) {
  try {
    const hostname = new URL(urlStr).hostname;
    const pathname = new URL(urlStr).pathname;
    const privatePatterns = [
      /^identita\./,
      /^online\./,
      /^moje\./,
      /^ceb\./,
      /^hypotecnizona\./,
      /odhlaseni/,
      /login/,
      /portal/,
    ];
    const full = hostname + pathname;
    return privatePatterns.some(p => p.test(full));
  } catch (e) {
    return false;
  }
}

function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function attachResults(site, latestResults) {
  const results = latestResults.filter(r => r.site_id === site.id);
  const statusMap = {};
  for (const r of results) {
    statusMap[r.check_type] = { status: r.status, details: r.details, checked_at: r.checked_at };
  }
  const isPrivate = site.site_type === 'private' || isPrivateZone(site.url);
  return { ...site, latestResults: statusMap, isPrivate };
}

function clientSummary(client, allLatest) {
  const sites = db.getSitesByClientId(client.id);
  const siteIds = new Set(sites.map(s => s.id));

  const enabledChecks = {};
  for (const s of sites) {
    enabledChecks[s.id] = new Set((s.checks || []).filter(c => c.enabled).map(c => c.checker_type));
  }

  const passing = new Set();
  const failing = new Set();
  for (const r of allLatest) {
    if (!siteIds.has(r.site_id)) continue;
    const enabled = enabledChecks[r.site_id];
    if (!enabled || !enabled.has(r.check_type)) continue;
    if (r.status === 'pass') passing.add(r.site_id);
    else failing.add(r.site_id);
  }

  // Never include password_hash in any response.
  const { password_hash, ...safe } = client;
  return {
    ...safe,
    has_webhook: !!client.slack_webhook_url,
    has_password: !!client.password_hash,
    slack_webhook_url: undefined,  // don't leak the webhook in lists
    sites_total: sites.length,
    sites_passing: [...passing].filter(id => !failing.has(id)).length,
    sites_failing: failing.size,
  };
}

function requireAdmin(req, res) {
  if (req.authContext === 'admin') return true;
  res.status(403).json({ error: 'Admin access required' });
  return false;
}

// --- Clients ---

router.get('/clients', (req, res) => {
  const clients = db.getAllClients();
  const allLatest = db.getLatestResultsForAllSites();
  res.json(clients.map(c => clientSummary(c, allLatest)));
});

router.post('/clients', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { name, slug, slack_webhook_url, username, password } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const finalSlug = (slug && slugify(slug)) || slugify(name);
  if (!finalSlug) return res.status(400).json({ error: 'name must contain alphanumeric characters' });

  const existing = db.getClientBySlug(finalSlug);
  if (existing) return res.status(409).json({ error: `Client with slug "${finalSlug}" already exists` });

  if (username && db.getClientByUsername(username)) {
    return res.status(409).json({ error: `Username "${username}" is already in use by another client` });
  }

  try {
    const id = db.createClient({
      name,
      slug: finalSlug,
      slack_webhook_url: slack_webhook_url || null,
      username: username || null,
      password: password || null,
    });
    res.status(201).json({ id, slug: finalSlug, message: 'Client created' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/clients/:slug', (req, res) => {
  const client = db.getClientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const allLatest = db.getLatestResultsForAllSites();
  res.json({ ...clientSummary(client, allLatest), slack_webhook_url: client.slack_webhook_url || '' });
});

router.put('/clients/:slug', (req, res) => {
  const client = db.getClientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const update = {};
  // Slack webhook may be updated by admin OR by the client themselves.
  if (req.body.slack_webhook_url !== undefined) update.slack_webhook_url = req.body.slack_webhook_url;

  // Identity / credential / slug changes — admin only.
  const adminOnlyChange = (req.body.name !== undefined) || (req.body.slug !== undefined)
    || (req.body.username !== undefined) || (req.body.password !== undefined) || (req.body.clearPassword !== undefined);

  if (adminOnlyChange) {
    if (!requireAdmin(req, res)) return;

    if (req.body.name !== undefined) update.name = req.body.name;
    if (req.body.slug !== undefined) {
      const newSlug = slugify(req.body.slug);
      if (!newSlug) return res.status(400).json({ error: 'Invalid slug' });
      if (newSlug !== client.slug && db.getClientBySlug(newSlug)) {
        return res.status(409).json({ error: 'Slug already in use' });
      }
      update.slug = newSlug;
    }
    if (req.body.username !== undefined) {
      const u = req.body.username || null;
      if (u) {
        const other = db.getClientByUsername(u);
        if (other && other.id !== client.id) return res.status(409).json({ error: 'Username already in use by another client' });
      }
      update.username = u;
    }
    if (req.body.password) update.password = req.body.password;
    if (req.body.clearPassword) update.clearPassword = true;
  }

  try {
    db.updateClient(client.id, update);
    res.json({ message: 'Client updated', slug: update.slug || client.slug });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/clients/:slug', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const client = db.getClientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  db.deleteClient(client.id);
  res.json({ message: 'Client deleted' });
});

router.post('/clients/:slug/test-slack', async (req, res) => {
  const client = db.getClientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  try {
    await sendTestMessage(client.slack_webhook_url, client.name);
    res.json({ message: 'Test message sent' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Sites (client-scoped) ---

router.get('/clients/:slug/sites', (req, res) => {
  const client = db.getClientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const latestResults = db.getLatestResultsForAllSites();
  const sites = db.getSitesByClientId(client.id).map(s => attachResults(s, latestResults));

  if (req.query.grouped === '1') {
    const domainGroups = {};
    for (const site of sites) {
      const root = getRootDomain(site.url);
      if (!domainGroups[root]) domainGroups[root] = [];
      domainGroups[root].push(site);
    }
    const grouped = Object.entries(domainGroups).map(([domain, members]) => {
      members.sort((a, b) => (a.isPrivate ? 1 : 0) - (b.isPrivate ? 1 : 0));
      return { domain, sites: members };
    });
    grouped.sort((a, b) => a.domain.localeCompare(b.domain));
    return res.json(grouped);
  }

  res.json(sites);
});

router.post('/clients/:slug/sites', (req, res) => {
  const client = db.getClientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { name, url, checks } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url are required' });

  try {
    const id = db.createSite({ name, url, checks: checks || [], client_id: client.id });
    res.status(201).json({ id, message: 'Site created' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/clients/:slug/status', (req, res) => {
  const client = db.getClientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const sites = db.getSitesByClientId(client.id);
  const allLatest = db.getLatestResultsForAllSites();
  const summary = clientSummary(client, allLatest);

  res.json({
    totalSites: summary.sites_total,
    enabledSites: sites.filter(s => s.enabled).length,
    passing: summary.sites_passing,
    failing: summary.sites_failing,
    isRunning: isRunning(),
    checkerTypes: CHECKER_LABELS,
  });
});

router.post('/clients/:slug/check/run', async (req, res) => {
  const client = db.getClientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (isRunning()) return res.status(409).json({ error: 'Check cycle already running' });

  res.json({ message: 'Check cycle started' });
  runAllChecks(client.id).catch(e => console.error('Manual check failed:', e.message));
});

// --- Site-scoped (still keyed by site id; client inferred from site) ---

router.get('/sites/:id', (req, res) => {
  const site = db.getSiteById(parseInt(req.params.id));
  if (!site) return res.status(404).json({ error: 'Site not found' });

  site.latestResults = db.getLatestResultsForSite(site.id);
  res.json(site);
});

router.put('/sites/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const site = db.getSiteById(id);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  try {
    db.updateSite(id, req.body);
    res.json({ message: 'Site updated' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/sites/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const site = db.getSiteById(id);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  db.deleteSite(id);
  res.json({ message: 'Site deleted' });
});

router.get('/sites/:id/results', (req, res) => {
  const id = parseInt(req.params.id);
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const results = db.getResultsForSite(id, limit, offset);
  res.json(results);
});

router.post('/check/run/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    res.json({ message: 'Check started' });
    await runSingleSiteCheck(id);
  } catch (e) {
    console.error(`Single site check failed for ${id}:`, e.message);
  }
});

// --- Global Settings (cron only — Slack is per-client now) ---

router.get('/settings', (req, res) => {
  const settings = db.getAllSettings();
  settings.cron_schedule = settings.cron_schedule || '0 */4 * * *';
  settings.check_timeout_ms = settings.check_timeout_ms || '30000';
  // Strip the legacy global webhook so it isn't exposed.
  delete settings.slack_webhook_url;
  res.json(settings);
});

router.put('/settings', (req, res) => {
  const { cron_schedule } = req.body;

  if (cron_schedule !== undefined) {
    const cron = require('node-cron');
    if (!cron.validate(cron_schedule)) {
      return res.status(400).json({ error: 'Invalid cron schedule' });
    }
    db.setSetting('cron_schedule', cron_schedule);
    scheduler.restart();
  }

  res.json({ message: 'Settings updated' });
});

// --- Run-everything (all clients) — kept for the global scheduler ---

router.post('/check/run', async (req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Check cycle already running' });
  res.json({ message: 'Check cycle started' });
  runAllChecks().catch(e => console.error('Manual check failed:', e.message));
});

router.get('/status', (req, res) => {
  // Global status across all clients.
  const sites = db.getAllSites();
  const latestResults = db.getLatestResultsForAllSites();

  const enabledChecks = {};
  for (const site of sites) {
    enabledChecks[site.id] = new Set((site.checks || []).filter(c => c.enabled).map(c => c.checker_type));
  }

  const passing = new Set();
  const failing = new Set();
  for (const r of latestResults) {
    const siteChecks = enabledChecks[r.site_id];
    if (!siteChecks || !siteChecks.has(r.check_type)) continue;
    if (r.status === 'pass') passing.add(r.site_id);
    else failing.add(r.site_id);
  }

  res.json({
    totalSites: sites.length,
    enabledSites: sites.filter(s => s.enabled).length,
    passing: [...passing].filter(id => !failing.has(id)).length,
    failing: failing.size,
    isRunning: isRunning(),
    checkerTypes: CHECKER_LABELS,
  });
});

module.exports = router;
