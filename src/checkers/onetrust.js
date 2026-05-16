/**
 * OneTrust checker
 * Default endpoint: cdn.cookielaw.org (some sites self-host or use a custom CDN — override via config.endpoint)
 */
const DEFAULT_ENDPOINT = 'cdn.cookielaw.org';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = async function checkOneTrust(page, interceptor, config) {
  const endpoint = (config && typeof config.endpoint === 'string' && config.endpoint.trim())
    ? config.endpoint.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    : DEFAULT_ENDPOINT;

  const findings = {
    endpoint,
    scriptFound: false,
    oneTrustExists: false,
    bannerDetected: false,
    networkRequests: 0,
    reasons: [],
  };

  findings.scriptFound = await page.evaluate((ep) => {
    return !!document.querySelector('script[src*="' + ep + '"]') ||
           !!document.querySelector('script[src*="otSDKStub"]') ||
           !!document.querySelector('#onetrust-consent-sdk');
  }, endpoint).catch(() => false);

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

  const endpointRequests = interceptor.getRequestsMatching(new RegExp(escapeRegex(endpoint)));
  findings.networkRequests = endpointRequests.length;

  const anyFound = findings.scriptFound || findings.oneTrustExists || findings.networkRequests > 0;

  if (!findings.scriptFound) findings.reasons.push(`No OneTrust script found in DOM (looked for ${endpoint}, otSDKStub)`);
  if (!findings.oneTrustExists) findings.reasons.push('OneTrust/Optanon JS object not found');
  if (findings.networkRequests === 0) findings.reasons.push(`No requests to ${endpoint}`);

  if (anyFound) {
    const parts = [];
    if (findings.scriptFound) parts.push('OneTrust script in DOM');
    if (findings.oneTrustExists) parts.push('OneTrust JS active');
    if (findings.bannerDetected) parts.push('consent banner detected');
    if (findings.networkRequests > 0) parts.push(`${findings.networkRequests} request(s) to ${endpoint}`);
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  return { status: anyFound ? 'pass' : 'fail', details: findings };
};
