/**
 * Adform checker
 * Endpoints: s2.adform.net, track.adform.net
 */
module.exports = async function checkAdform(page, interceptor, config) {
  const findings = {
    endpoints: { s2: false, track: false },
    scriptFound: false,
    networkRequests: [],
    reasons: [],
  };

  findings.scriptFound = await page.evaluate(() => {
    return !!document.querySelector('script[src*="adform.net"]') ||
           !!document.querySelector('script[src*="s2.adform.net"]') ||
           !!document.querySelector('img[src*="track.adform.net"]');
  }).catch(() => false);

  if (!findings.scriptFound) {
    findings.scriptFound = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        if (s.textContent && s.textContent.includes('adform.net')) return true;
      }
      return false;
    }).catch(() => false);
  }

  const s2Requests = interceptor.getRequestsMatching(/s2\.adform\.net/);
  findings.endpoints.s2 = s2Requests.length > 0;
  if (s2Requests.length > 0) findings.networkRequests.push(`s2.adform.net: ${s2Requests.length} request(s)`);

  const trackRequests = interceptor.getRequestsMatching(/track\.adform\.net/);
  findings.endpoints.track = trackRequests.length > 0;
  if (trackRequests.length > 0) findings.networkRequests.push(`track.adform.net: ${trackRequests.length} request(s)`);

  const anyFound = findings.scriptFound || findings.endpoints.s2 || findings.endpoints.track;

  if (!findings.scriptFound) findings.reasons.push('No Adform script tag found in DOM');
  if (!findings.endpoints.s2) findings.reasons.push('No requests to s2.adform.net');
  if (!findings.endpoints.track) findings.reasons.push('No requests to track.adform.net');

  if (anyFound) findings.reasons = ['OK: ' + findings.networkRequests.join(', ') + (findings.scriptFound ? ', script in DOM' : '')];

  return { status: anyFound ? 'pass' : 'fail', details: findings };
};
