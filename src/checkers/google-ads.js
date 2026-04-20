/**
 * Google Ads checker
 * Endpoints: googleads.g.doubleclick.net, google.com, google.cz
 */
module.exports = async function checkGoogleAds(page, interceptor, config) {
  const findings = {
    endpoints: {
      doubleclick: false,
      googleCom: false,
      googleCz: false,
    },
    scriptFound: false,
    networkRequests: [],
    reasons: [],
  };

  // Check for Google Ads scripts in DOM
  findings.scriptFound = await page.evaluate(() => {
    return !!document.querySelector('script[src*="googleads.g.doubleclick.net"]') ||
           !!document.querySelector('script[src*="pagead2.googlesyndication.com"]') ||
           !!document.querySelector('script[src*="googleadservices.com"]');
  }).catch(() => false);

  // Network checks
  const dcRequests = interceptor.getRequestsMatching(/googleads\.g\.doubleclick\.net/);
  findings.endpoints.doubleclick = dcRequests.length > 0;
  if (dcRequests.length > 0) findings.networkRequests.push(`doubleclick: ${dcRequests.length} request(s)`);

  const googleComRequests = interceptor.getRequestsMatching(/www\.google\.com\/(pagead|ads|conversion)/);
  findings.endpoints.googleCom = googleComRequests.length > 0;
  if (googleComRequests.length > 0) findings.networkRequests.push(`google.com: ${googleComRequests.length} request(s)`);

  const googleCzRequests = interceptor.getRequestsMatching(/www\.google\.cz\/(pagead|ads|conversion)/);
  findings.endpoints.googleCz = googleCzRequests.length > 0;
  if (googleCzRequests.length > 0) findings.networkRequests.push(`google.cz: ${googleCzRequests.length} request(s)`);

  const adservicesRequests = interceptor.getRequestsMatching(/googleadservices\.com/);
  if (adservicesRequests.length > 0) findings.networkRequests.push(`googleadservices: ${adservicesRequests.length} request(s)`);

  // Build reasons
  if (!findings.scriptFound) findings.reasons.push('No Google Ads script tag found in DOM');
  if (!findings.endpoints.doubleclick) findings.reasons.push('No requests to googleads.g.doubleclick.net');
  if (!findings.endpoints.googleCom) findings.reasons.push('No ad requests to www.google.com');
  if (!findings.endpoints.googleCz) findings.reasons.push('No ad requests to www.google.cz');
  if (adservicesRequests.length === 0) findings.reasons.push('No requests to googleadservices.com');

  const anyFound = findings.scriptFound ||
    findings.endpoints.doubleclick ||
    findings.endpoints.googleCom ||
    findings.endpoints.googleCz ||
    adservicesRequests.length > 0;

  if (anyFound) findings.reasons = ['OK: ' + findings.networkRequests.join(', ')];

  return {
    status: anyFound ? 'pass' : 'fail',
    details: findings,
  };
};
