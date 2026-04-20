/**
 * OneTrust checker
 * Endpoint: cdn.cookielaw.org
 */
module.exports = async function checkOneTrust(page, interceptor, config) {
  const findings = {
    scriptFound: false,
    oneTrustExists: false,
    bannerDetected: false,
    networkRequests: 0,
    reasons: [],
  };

  findings.scriptFound = await page.evaluate(() => {
    return !!document.querySelector('script[src*="cdn.cookielaw.org"]') ||
           !!document.querySelector('script[src*="cookielaw.org"]') ||
           !!document.querySelector('script[src*="otSDKStub"]') ||
           !!document.querySelector('#onetrust-consent-sdk');
  }).catch(() => false);

  findings.oneTrustExists = await page.evaluate(() => {
    return (typeof window.OneTrust === 'object' && window.OneTrust !== null) ||
           (typeof window.OptanonWrapper === 'function') ||
           (typeof window.Optanon === 'object');
  }).catch(() => false);

  findings.bannerDetected = await page.evaluate(() => {
    return !!document.querySelector('#onetrust-banner-sdk') ||
           !!document.querySelector('#onetrust-consent-sdk') ||
           !!document.querySelector('.optanon-alert-box-wrapper');
  }).catch(() => false);

  const cookielawRequests = interceptor.getRequestsMatching(/cdn\.cookielaw\.org/);
  findings.networkRequests = cookielawRequests.length;

  const anyFound = findings.scriptFound || findings.oneTrustExists || findings.networkRequests > 0;

  if (!findings.scriptFound) findings.reasons.push('No OneTrust/cookielaw script found in DOM');
  if (!findings.oneTrustExists) findings.reasons.push('OneTrust/Optanon JS object not found');
  if (findings.networkRequests === 0) findings.reasons.push('No requests to cdn.cookielaw.org');

  if (anyFound) {
    const parts = [];
    if (findings.scriptFound) parts.push('OneTrust script in DOM');
    if (findings.oneTrustExists) parts.push('OneTrust JS active');
    if (findings.bannerDetected) parts.push('consent banner detected');
    if (findings.networkRequests > 0) parts.push(`${findings.networkRequests} request(s) to cdn.cookielaw.org`);
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  return { status: anyFound ? 'pass' : 'fail', details: findings };
};
