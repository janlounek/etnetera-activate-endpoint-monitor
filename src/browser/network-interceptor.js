/**
 * Captures all network requests on a Playwright page for marketing pixel detection.
 *
 * Also records enforced CSP violations (script/img/connect blocks) so checkers can
 * tell the difference between "endpoint code is present" and "endpoint actually
 * delivered". A beacon that was refused by Content-Security-Policy must NOT count
 * as a working endpoint.
 */

function createInterceptor(page) {
  const requests = [];
  const cspViolations = [];

  page.on('request', (request) => {
    requests.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      timestamp: Date.now(),
    });
  });

  page.on('response', (response) => {
    const url = response.url();
    const entry = requests.find(r => r.url === url && !r.status);
    if (entry) {
      entry.status = response.status();
    }
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    const entry = requests.find(r => r.url === url && !r.status);
    if (entry) {
      entry.status = 0;
      entry.error = request.failure()?.errorText || 'unknown';
    }
  });

  // Enforced CSP violations surface as console errors. Skip "[Report Only]"
  // messages — report-only policies log but never block, so they don't mean the
  // endpoint failed.
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text() || '';
    if (!/Content Security Policy/i.test(text)) return;
    if (/\[Report Only\]/i.test(text)) return;
    const blockedURI = (text.match(/'(https?:\/\/[^']+)'/) || [])[1] || null;
    const directive = (text.match(/directive:\s*"([^"]+)"/) || [])[1] || null;
    cspViolations.push({ text, blockedURI, directive });
  });

  return {
    getRequests() {
      return [...requests];
    },

    hasRequestMatching(urlPattern) {
      const regex = urlPattern instanceof RegExp ? urlPattern : new RegExp(urlPattern, 'i');
      return requests.some(r => regex.test(r.url));
    },

    getRequestsMatching(urlPattern) {
      const regex = urlPattern instanceof RegExp ? urlPattern : new RegExp(urlPattern, 'i');
      return requests.filter(r => regex.test(r.url));
    },

    getSuccessfulRequestsMatching(urlPattern) {
      const regex = urlPattern instanceof RegExp ? urlPattern : new RegExp(urlPattern, 'i');
      return requests.filter(r => regex.test(r.url) && r.status && r.status >= 200 && r.status < 400);
    },

    // Requests that were attempted but never completed (status 0): CSP blocks,
    // connection failures, DNS errors, etc. `error` carries the Chromium reason
    // ('csp' for CSP blocks).
    getFailedRequestsMatching(urlPattern) {
      const regex = urlPattern instanceof RegExp ? urlPattern : new RegExp(urlPattern, 'i');
      return requests.filter(r => regex.test(r.url) && r.status === 0);
    },

    getCspViolations() {
      return [...cspViolations];
    },

    // Enforced CSP violations whose blocked URL matches the pattern.
    getCspViolationsMatching(urlPattern) {
      const regex = urlPattern instanceof RegExp ? urlPattern : new RegExp(urlPattern, 'i');
      return cspViolations.filter(v => v.blockedURI && regex.test(v.blockedURI));
    },

    getRequestCount() {
      return requests.length;
    },
  };
}

module.exports = { createInterceptor };
