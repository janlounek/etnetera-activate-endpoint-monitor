/**
 * Adobe Analytics checker
 * Endpoint: tracking-secure.csob.cz
 */
module.exports = async function checkAdobeAnalytics(page, interceptor, config) {
  const trackingDomain = config.trackingDomain || 'tracking-secure.csob.cz';

  const findings = {
    trackingDomain,
    scriptFound: false,
    sObjectExists: false,
    networkRequests: 0,
    beaconRequests: [],
    reasons: [],
  };

  findings.scriptFound = await page.evaluate(() => {
    return !!document.querySelector('script[src*="AppMeasurement"]') ||
           !!document.querySelector('script[src*="s_code"]') ||
           !!document.querySelector('script[src*="appmeasurement"]');
  }).catch(() => false);

  findings.sObjectExists = await page.evaluate(() => {
    return (typeof window.s === 'object' && window.s !== null && typeof window.s.t === 'function') ||
           (typeof window.s_gi === 'function');
  }).catch(() => false);

  const escapedDomain = trackingDomain.replace(/\./g, '\\.');
  const trackingRequests = interceptor.getRequestsMatching(new RegExp(escapedDomain));
  findings.networkRequests = trackingRequests.length;

  findings.beaconRequests = trackingRequests.slice(0, 5).map(r => {
    try { return new URL(r.url).pathname + new URL(r.url).search.substring(0, 100); }
    catch (e) { return r.url.substring(0, 150); }
  });

  const anyFound = findings.scriptFound || findings.sObjectExists || findings.networkRequests > 0;

  if (!findings.scriptFound) findings.reasons.push('No AppMeasurement/s_code script found in DOM');
  if (!findings.sObjectExists) findings.reasons.push('Adobe Analytics s object not found (window.s)');
  if (findings.networkRequests === 0) findings.reasons.push(`No requests to ${trackingDomain}`);

  if (anyFound) {
    const parts = [];
    if (findings.scriptFound) parts.push('AppMeasurement script loaded');
    if (findings.sObjectExists) parts.push('s object active');
    if (findings.networkRequests > 0) parts.push(`${findings.networkRequests} request(s) to ${trackingDomain}`);
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  return { status: anyFound ? 'pass' : 'fail', details: findings };
};
