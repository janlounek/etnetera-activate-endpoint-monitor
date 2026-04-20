const { checkSite, launchBrowser, closeBrowser } = require('../browser/launcher');
const { saveResult, getAllSites, getPreviousStatus } = require('../../db/database');
const { sendNotification } = require('../slack');

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

  // Retry once on complete failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const results = await checkSite(site, checks, CHECKERS);

      // Save results to DB
      for (const result of results) {
        saveResult(site.id, result.checkType, result.status, result.details);
      }

      // Check if all errored (page-level failure) — retry
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
      // Second attempt failed — save error results
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

async function runAllChecks() {
  if (running) {
    console.log('Check cycle already in progress, skipping.');
    return { skipped: true };
  }

  running = true;
  console.log(`[${new Date().toISOString()}] Starting check cycle...`);

  const sites = getAllSites().filter(s => s.enabled);
  const failures = [];

  try {
    await launchBrowser();

    for (const site of sites) {
      console.log(`  Checking ${site.name} (${site.url})...`);
      const results = await runChecksForSite(site);

      for (const result of results) {
        if (result.status === 'fail' || result.status === 'error') {
          // Only alert on status transitions (pass -> fail/error)
          const previousStatus = getPreviousStatus(site.id, result.checkType);
          if (previousStatus === 'pass' || previousStatus === null) {
            failures.push({
              siteName: site.name,
              siteUrl: site.url,
              checkType: result.checkType,
              checkLabel: CHECKER_LABELS[result.checkType] || result.checkType,
              status: result.status,
              details: result.details,
            });
          }
        }
      }
    }

    if (failures.length > 0) {
      console.log(`  ${failures.length} new failure(s) detected, sending Slack notification...`);
      await sendNotification(failures);
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
  const { getSiteById } = require('../../db/database');
  const site = getSiteById(siteId);
  if (!site) { running = false; throw new Error('Site not found'); }

  try {
    console.log(`  Checking ${site.name} (${site.url})...`);
    await launchBrowser();
    const results = await runChecksForSite(site);
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
