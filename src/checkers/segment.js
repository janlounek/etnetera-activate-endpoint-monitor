/**
 * Segment Analytics checker
 */
const { evaluateDelivery, applyDeliveryOverride } = require('./_delivery');

module.exports = async function checkSegment(page, interceptor, config) {
  const findings = {
    scriptFound: false,
    analyticsObject: false,
    trackFunction: false,
    writeKey: null,
    cdnLoaded: false,
    apiRequests: 0,
  };

  // DOM check
  findings.scriptFound = await page.evaluate(() => {
    return !!document.querySelector('script[src*="cdn.segment.com"]') ||
           !!document.querySelector('script[src*="cdn.segment.io"]');
  }).catch(() => false);

  // Inline script check
  if (!findings.scriptFound) {
    findings.scriptFound = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        if (s.textContent && s.textContent.includes('analytics.load')) return true;
      }
      return false;
    }).catch(() => false);
  }

  // JS global checks
  findings.analyticsObject = await page.evaluate(() =>
    typeof window.analytics === 'object' && window.analytics !== null
  ).catch(() => false);

  findings.trackFunction = await page.evaluate(() =>
    typeof window.analytics === 'object' && typeof window.analytics.track === 'function'
  ).catch(() => false);

  // Try to get write key
  findings.writeKey = await page.evaluate(() => {
    if (window.analytics && window.analytics._writeKey) return window.analytics._writeKey;
    return null;
  }).catch(() => null);

  if (!findings.writeKey && config.writeKey) {
    findings.writeKey = config.writeKey;
  }

  // Network checks
  findings.cdnLoaded = interceptor.hasRequestMatching(/cdn\.segment\.(com|io)/);
  findings.apiRequests = interceptor.getRequestsMatching(/api\.segment\.(com|io)/).length;

  const hasSegment = findings.scriptFound || findings.analyticsObject || findings.cdnLoaded;

  const result = { status: hasSegment ? 'pass' : 'fail', details: findings };
  const delivery = evaluateDelivery(interceptor, [/cdn\.segment\.(com|io)/, /api\.segment\.(com|io)/]);
  return applyDeliveryOverride(result, 'Segment', delivery, {
    codePresent: findings.scriptFound || findings.analyticsObject,
  });
};
