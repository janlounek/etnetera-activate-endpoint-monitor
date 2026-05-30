/**
 * Adform checker
 * Matches any *.adform.net host (s2, track, a1, a2, tag, regional variants, etc.)
 * plus the optional config.endpoint for first-party / proxied setups.
 */
const { evaluateDelivery, applyDeliveryOverride } = require('./_delivery');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = async function checkAdform(page, interceptor, config) {
  const customEndpoint = (config && config.endpoint)
    ? String(config.endpoint).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    : '';

  const findings = {
    scriptFound: false,
    customEndpoint: customEndpoint || '(not configured)',
    customEndpointRequests: 0,
    networkRequests: [],
    hostsMatched: [],
    totalRequests: 0,
    reasons: [],
  };

  findings.scriptFound = await page.evaluate(() => {
    return !!document.querySelector('script[src*="adform.net"]') ||
           !!document.querySelector('img[src*="adform.net"]');
  }).catch(() => false);

  if (!findings.scriptFound) {
    findings.scriptFound = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        if (s.textContent && (s.textContent.includes('adform.net') || s.textContent.includes('Adform'))) return true;
      }
      return false;
    }).catch(() => false);
  }

  // Any *.adform.net request counts — not just s2/track. Many sites use a1/a2,
  // tag, regional shards, or other subdomains depending on integration mode.
  const adformRequests = interceptor.getRequestsMatching(/adform\.net/);
  findings.totalRequests = adformRequests.length;

  // Bucket by host for legibility in the OK summary / Raw JSON view.
  const byHost = {};
  for (const r of adformRequests) {
    try {
      const host = new URL(r.url).hostname;
      byHost[host] = (byHost[host] || 0) + 1;
    } catch (e) {}
  }
  findings.hostsMatched = Object.keys(byHost).sort();
  for (const host of findings.hostsMatched) {
    findings.networkRequests.push(`${host}: ${byHost[host]} request(s)`);
  }

  // Optional: first-party / proxy endpoint (rare for Adform but possible).
  if (customEndpoint) {
    const customRegex = new RegExp(escapeRegex(customEndpoint));
    const customMatches = interceptor.getRequestsMatching(customRegex).filter(r => !/adform\.net/.test(r.url));
    findings.customEndpointRequests = customMatches.length;
    if (findings.customEndpointRequests > 0) {
      findings.totalRequests += findings.customEndpointRequests;
      findings.networkRequests.push(`${customEndpoint}: ${findings.customEndpointRequests} request(s)`);
    }
  }

  const hasNetwork = findings.totalRequests > 0;
  const pass = findings.scriptFound || hasNetwork;

  if (!pass) {
    findings.reasons.push('No Adform script tag found in DOM');
    findings.reasons.push('No requests to *.adform.net' + (customEndpoint ? ` or ${customEndpoint}` : ''));
  } else {
    const parts = [];
    if (findings.scriptFound) parts.push('Adform script in DOM');
    if (findings.networkRequests.length) parts.push(findings.networkRequests.join(', '));
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  const result = { status: pass ? 'pass' : 'fail', details: findings };
  const patterns = [/adform\.net/];
  if (customEndpoint) patterns.push(new RegExp(escapeRegex(customEndpoint)));
  const delivery = evaluateDelivery(interceptor, patterns);
  return applyDeliveryOverride(result, 'Adform', delivery, { codePresent: findings.scriptFound });
};
