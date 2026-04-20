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
    // Split by dots, take last 2 parts (handles .cz, .com, etc.)
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
    // Sites that are clearly private zones / login areas
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

// --- Sites ---

router.get('/sites', (req, res) => {
  const latestResults = db.getLatestResultsForAllSites();

  function attachResults(site) {
    const results = latestResults.filter(r => r.site_id === site.id);
    const statusMap = {};
    for (const r of results) {
      statusMap[r.check_type] = { status: r.status, details: r.details, checked_at: r.checked_at };
    }
    const isPrivate = site.site_type === 'private' || isPrivateZone(site.url);
    return { ...site, latestResults: statusMap, isPrivate };
  }

  if (req.query.grouped === '1') {
    const sites = db.getAllSites().map(attachResults);

    // Group by root domain
    const domainGroups = {};
    for (const site of sites) {
      const root = getRootDomain(site.url);
      if (!domainGroups[root]) domainGroups[root] = [];
      domainGroups[root].push(site);
    }

    // Build grouped output: public sites first, then private zones
    const grouped = Object.entries(domainGroups).map(([domain, members]) => {
      // Sort: public (non-private) first, then private
      members.sort((a, b) => (a.isPrivate ? 1 : 0) - (b.isPrivate ? 1 : 0));
      return {
        domain,
        sites: members,
      };
    });

    // Sort groups alphabetically by domain
    grouped.sort((a, b) => a.domain.localeCompare(b.domain));

    return res.json(grouped);
  }

  const sites = db.getAllSites();
  res.json(sites.map(attachResults));
});

router.post('/sites', (req, res) => {
  const { name, url, checks } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url are required' });

  try {
    const id = db.createSite({ name, url, checks: checks || [] });
    res.status(201).json({ id, message: 'Site created' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

// --- Check Results ---

router.get('/sites/:id/results', (req, res) => {
  const id = parseInt(req.params.id);
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const results = db.getResultsForSite(id, limit, offset);
  res.json(results);
});

// --- Run Checks ---

router.post('/check/run', async (req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Check cycle already running' });

  res.json({ message: 'Check cycle started' });
  // Run async — don't block the response
  runAllChecks().catch(e => console.error('Manual check failed:', e.message));
});

router.post('/check/run/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    res.json({ message: 'Check started' });
    await runSingleSiteCheck(id);
  } catch (e) {
    // Response already sent, log the error
    console.error(`Single site check failed for ${id}:`, e.message);
  }
});

// --- Settings ---

router.get('/settings', (req, res) => {
  const settings = db.getAllSettings();
  // Provide defaults
  settings.cron_schedule = settings.cron_schedule || '0 */4 * * *';
  settings.check_timeout_ms = settings.check_timeout_ms || '30000';
  res.json(settings);
});

router.put('/settings', (req, res) => {
  const { slack_webhook_url, cron_schedule } = req.body;

  if (slack_webhook_url !== undefined) db.setSetting('slack_webhook_url', slack_webhook_url);
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

router.post('/settings/test-slack', async (req, res) => {
  try {
    await sendTestMessage();
    res.json({ message: 'Test message sent' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Status ---

router.get('/status', (req, res) => {
  const sites = db.getAllSites();
  const latestResults = db.getLatestResultsForAllSites();

  const passing = new Set();
  const failing = new Set();

  for (const r of latestResults) {
    if (r.status === 'pass') passing.add(r.site_id);
    else failing.add(r.site_id);
  }

  // A site is "failing" if ANY of its checks fail
  const failingSites = [...failing].filter(id => failing.has(id));
  const passingSites = [...passing].filter(id => !failing.has(id));

  res.json({
    totalSites: sites.length,
    enabledSites: sites.filter(s => s.enabled).length,
    passing: passingSites.length,
    failing: failingSites.length,
    isRunning: isRunning(),
    checkerTypes: CHECKER_LABELS,
  });
});

module.exports = router;
