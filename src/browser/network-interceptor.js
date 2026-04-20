/**
 * Captures all network requests on a Playwright page for marketing pixel detection.
 */

function createInterceptor(page) {
  const requests = [];

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

    getRequestCount() {
      return requests.length;
    },
  };
}

module.exports = { createInterceptor };
