/**
 * TikTok Pixel checker
 */
module.exports = async function checkTikTokPixel(page, interceptor, config) {
  const findings = {
    scriptFound: false,
    ttqExists: false,
    pixelId: null,
    networkRequests: 0,
  };

  // DOM check
  findings.scriptFound = await page.evaluate(() => {
    return !!document.querySelector('script[src*="analytics.tiktok.com"]') ||
           !!document.querySelector('script[src*="tiktok.com/i18n/pixel"]');
  }).catch(() => false);

  // Inline script check
  if (!findings.scriptFound) {
    findings.scriptFound = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        if (s.textContent && (s.textContent.includes('ttq.load') || s.textContent.includes('analytics.tiktok.com'))) return true;
      }
      return false;
    }).catch(() => false);
  }

  // JS global check
  findings.ttqExists = await page.evaluate(() => typeof window.ttq !== 'undefined').catch(() => false);

  // Try to get pixel ID
  findings.pixelId = await page.evaluate(() => {
    if (window.ttq && window.ttq._i) {
      const keys = Object.keys(window.ttq._i);
      if (keys.length > 0) return keys[0];
    }
    return null;
  }).catch(() => null);

  if (!findings.pixelId && config.pixelId) {
    findings.pixelId = config.pixelId;
  }

  // Network checks
  const tiktokRequests = interceptor.getRequestsMatching(/analytics\.tiktok\.com/);
  findings.networkRequests = tiktokRequests.length;

  const hasPixel = findings.scriptFound || findings.ttqExists;

  return {
    status: hasPixel ? 'pass' : 'fail',
    details: findings,
  };
};
