/**
 * Adobe Launch (DTM) checker
 * Endpoints: assets.adobedtm.com, statistics.csob.cz
 */
module.exports = async function checkAdobeLaunch(page, interceptor, config) {
  const customDomain = config.customDomain || 'statistics.csob.cz';

  const findings = {
    endpoints: { adobedtm: false, customDomain: false },
    customDomainName: customDomain,
    scriptFound: false,
    satelliteExists: false,
    networkRequests: [],
    reasons: [],
  };

  findings.scriptFound = await page.evaluate((domain) => {
    return !!document.querySelector('script[src*="assets.adobedtm.com"]') ||
           !!document.querySelector(`script[src*="${domain}"]`) ||
           !!document.querySelector('script[src*="launch-"]');
  }, customDomain).catch(() => false);

  findings.satelliteExists = await page.evaluate(() => {
    return typeof window._satellite === 'object' && window._satellite !== null;
  }).catch(() => false);

  const adobeRequests = interceptor.getRequestsMatching(/assets\.adobedtm\.com/);
  findings.endpoints.adobedtm = adobeRequests.length > 0;
  if (adobeRequests.length > 0) findings.networkRequests.push(`assets.adobedtm.com: ${adobeRequests.length} request(s)`);

  const escapedDomain = customDomain.replace(/\./g, '\\.');
  const customRequests = interceptor.getRequestsMatching(new RegExp(escapedDomain));
  findings.endpoints.customDomain = customRequests.length > 0;
  if (customRequests.length > 0) findings.networkRequests.push(`${customDomain}: ${customRequests.length} request(s)`);

  const anyFound = findings.scriptFound || findings.satelliteExists ||
    findings.endpoints.adobedtm || findings.endpoints.customDomain;

  if (!findings.scriptFound) findings.reasons.push('No Adobe Launch script found in DOM');
  if (!findings.satelliteExists) findings.reasons.push('_satellite object not found');
  if (!findings.endpoints.adobedtm) findings.reasons.push('No requests to assets.adobedtm.com');
  if (!findings.endpoints.customDomain) findings.reasons.push(`No requests to ${customDomain}`);

  if (anyFound) {
    const parts = [];
    if (findings.scriptFound) parts.push('Launch script in DOM');
    if (findings.satelliteExists) parts.push('_satellite active');
    if (findings.networkRequests.length > 0) parts.push(findings.networkRequests.join(', '));
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  return { status: anyFound ? 'pass' : 'fail', details: findings };
};
