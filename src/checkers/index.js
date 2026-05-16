const { checkSite, launchBrowser, closeBrowser } = require('../browser/launcher');
const { saveResult, getAllSites, getSiteById, getClientById } = require('../../db/database');
const { sendNotification } = require('../slack');
const { sendNotification: sendEmailNotification } = require('../email');

const CHECKERS = {
  google_analytics: require('./google-analytics'),
  google_tag_manager: require('./google-tag-manager'),
  google_ads: require('./google-ads'),
  meta_pixel: require('./meta-pixel'),
  tiktok_pixel: require('./tiktok-pixel'),
  segment: require('./segment'),
  adform: require('./adform'),
  adobe_analytics: require('./adobe-analytics'),
  adobe_launch: require('./adobe-launch'),
  onetrust: require('./onetrust'),
  sklik: require('./sklik'),
  exponea: require('./exponea'),
  custom: require('./custom'),
};

const CHECKER_LABELS = {
  google_analytics: 'Google Analytics',
  google_tag_manager: 'Google Tag Manager',
  google_ads: 'Google Ads',
  meta_pixel: 'Meta/Facebook Pixel',
  tiktok_pixel: 'TikTok Pixel',
  segment: 'Segment',
  adform: 'Adform',
  adobe_analytics: 'Adobe Analytics',
  adobe_launch: 'Adobe Launch',
  onetrust: 'OneTrust',
  sklik: 'Sklik (Seznam)',
  exponea: 'Exponea',
  custom: 'Custom',
};

let running = false;

async function runChecksForSite(site) {
  const checks = site.checks.filter(c => c.enabled);
  if (checks.length === 0) return [];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const results = await checkSite(site, checks, CHECKERS);

      for (const result of results) {
        saveResult(site.id, result.checkType, result.status, result.details);
      }

      const allErrored = results.every(r => r.status === 'error');
      if (allErrored && attempt === 0) {
        console.log(`All checks errored for ${site.name}, retrying...`);
        continue;
      }

      return results;
    } catch (e) {
      if (attempt === 0) {
        console.log(`Check failed for ${site.name}: ${e.message}, retrying...`);
        continue;
      }
      const errorResults = checks.map(c => ({
        checkType: c.checker_type,
        status: 'error',
        details: { error: e.message },
      }));
      for (const result of errorResults) {
        saveResult(site.id, result.checkType, result.status, result.details);
      }
      return errorResults;
    }
  }
}

function labelFor(checkType, details) {
  // Custom checks carry the user-supplied name in details.name (set by the custom checker).
  if (checkType === 'custom' && details && details.name && String(details.name).trim()) {
    return String(details.name);
  }
  return CHECKER_LABELS[checkType] || checkType;
}

function buildFailures(site, results) {
  return results
    .filter(r => r.status === 'fail' || r.status === 'error')
    .map(r => ({
      siteName: site.name,
      siteUrl: site.url,
      clientId: site.client_id,
      checkType: r.checkType,
      checkLabel: labelFor(r.checkType, r.details),
      status: r.status,
      details: r.details,
    }));
}

async function notifyFailuresByClient(failures) {
  // Group failures by client_id and send one Slack message per client
  // (each client may have a different webhook configured).
  const byClient = {};
  for (const f of failures) {
    const key = f.clientId || 'none';
    if (!byClient[key]) byClient[key] = [];
    byClient[key].push(f);
  }

  for (const [clientIdStr, clientFailures] of Object.entries(byClient)) {
    if (clientIdStr === 'none') {
      console.log(`  Skipping notifications: ${clientFailures.length} failure(s) belong to sites without a client.`);
      continue;
    }
    const client = getClientById(parseInt(clientIdStr));
    if (!client) continue;
    await sendNotification(clientFailures, client.slack_webhook_url, client.name);
    await sendEmailNotification(clientFailures, client.notification_emails, client.name);
  }
}

async function runAllChecks(filterClientId = null) {
  if (running) {
    console.log('Check cycle already in progress, skipping.');
    return { skipped: true };
  }

  running = true;
  console.log(`[${new Date().toISOString()}] Starting check cycle${filterClientId ? ' for client ' + filterClientId : ''}...`);

  const sites = getAllSites(filterClientId).filter(s => s.enabled);
  const failures = [];

  try {
    await launchBrowser();

    for (const site of sites) {
      console.log(`  Checking ${site.name} (${site.url})...`);
      const results = await runChecksForSite(site);
      failures.push(...buildFailures(site, results));
    }

    if (failures.length > 0) {
      console.log(`  ${failures.length} failure(s) detected:`);
      for (const f of failures) {
        console.log(`    - ${f.siteName}: ${f.checkLabel} (${f.status})`);
      }
      await notifyFailuresByClient(failures);
    } else {
      console.log('  All checks passed, no Slack notification needed.');
    }

    console.log(`[${new Date().toISOString()}] Check cycle complete. ${sites.length} sites checked.`);
    return { sitesChecked: sites.length, failures: failures.length };
  } catch (e) {
    console.error('Check cycle error:', e.message);
    return { error: e.message };
  } finally {
    await closeBrowser();
    running = false;
  }
}

async function runSingleSiteCheck(siteId) {
  if (running) {
    console.log('Check already in progress, skipping single site check.');
    return [];
  }
  running = true;
  const site = getSiteById(siteId);
  if (!site) { running = false; throw new Error('Site not found'); }

  try {
    console.log(`  Checking ${site.name} (${site.url})...`);
    await launchBrowser();
    const results = await runChecksForSite(site);

    const failures = buildFailures(site, results);
    if (failures.length > 0) {
      console.log(`  ${failures.length} failure(s) for ${site.name}, sending Slack notification...`);
      await notifyFailuresByClient(failures);
    }

    return results;
  } finally {
    await closeBrowser();
    running = false;
  }
}

function isRunning() {
  return running;
}

module.exports = { runAllChecks, runSingleSiteCheck, isRunning, CHECKER_LABELS };
