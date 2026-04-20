/**
 * Exponea (Bloomreach) checker
 * Endpoint: data-api.csob.cz
 */
module.exports = async function checkExponea(page, interceptor, config) {
  const apiDomain = config.apiDomain || 'data-api.csob.cz';

  const findings = {
    apiDomain,
    scriptFound: false,
    exponeaExists: false,
    networkRequests: 0,
    apiEndpoints: [],
    reasons: [],
  };

  findings.scriptFound = await page.evaluate((domain) => {
    return !!document.querySelector('script[src*="exponea"]') ||
           !!document.querySelector('script[src*="bloomreach"]') ||
           !!document.querySelector(`script[src*="${domain}"]`) ||
           !!document.querySelector('script[src*="cdn.exponea.com"]');
  }, apiDomain).catch(() => false);

  if (!findings.scriptFound) {
    findings.scriptFound = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        if (s.textContent && (s.textContent.includes('exponea') || s.textContent.includes('bloomreach'))) return true;
      }
      return false;
    }).catch(() => false);
  }

  findings.exponeaExists = await page.evaluate(() => {
    return (typeof window.exponea === 'object' && window.exponea !== null) ||
           (typeof window.bloomreach === 'object') ||
           (typeof window.engagement === 'object');
  }).catch(() => false);

  const escapedDomain = apiDomain.replace(/\./g, '\\.');
  const apiRequests = interceptor.getRequestsMatching(new RegExp(escapedDomain));
  findings.networkRequests = apiRequests.length;

  const cdnRequests = interceptor.getRequestsMatching(/cdn\.exponea\.com|api\.exponea\.com/);
  if (cdnRequests.length > 0) findings.networkRequests += cdnRequests.length;

  findings.apiEndpoints = apiRequests.slice(0, 5).map(r => {
    try { return new URL(r.url).pathname; }
    catch (e) { return r.url.substring(0, 100); }
  });

  const anyFound = findings.scriptFound || findings.exponeaExists || findings.networkRequests > 0;

  if (!findings.scriptFound) findings.reasons.push('No Exponea/Bloomreach script found in DOM');
  if (!findings.exponeaExists) findings.reasons.push('Exponea JS object not found (window.exponea)');
  if (apiRequests.length === 0) findings.reasons.push(`No requests to ${apiDomain}`);
  if (cdnRequests.length === 0) findings.reasons.push('No requests to cdn.exponea.com');

  if (anyFound) {
    const parts = [];
    if (findings.scriptFound) parts.push('Exponea script in DOM');
    if (findings.exponeaExists) parts.push('Exponea JS active');
    if (findings.networkRequests > 0) parts.push(`${findings.networkRequests} API request(s)`);
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  return { status: anyFound ? 'pass' : 'fail', details: findings };
};
