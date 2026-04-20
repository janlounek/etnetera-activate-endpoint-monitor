/**
 * Meta (Facebook) Pixel checker
 */
module.exports = async function checkMetaPixel(page, interceptor, config) {
  const findings = {
    scriptFound: false,
    fbqFunction: false,
    pixelId: null,
    pixelFires: 0,
    events: [],
    reasons: [],
  };

  findings.scriptFound = await page.evaluate(() => {
    return !!document.querySelector('script[src*="connect.facebook.net"][src*="fbevents.js"]') ||
           !!document.querySelector('script[src*="connect.facebook.net/en_US/fbevents.js"]');
  }).catch(() => false);

  if (!findings.scriptFound) {
    findings.scriptFound = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        if (s.textContent && s.textContent.includes('fbq(')) return true;
      }
      return false;
    }).catch(() => false);
  }

  findings.fbqFunction = await page.evaluate(() => typeof window.fbq === 'function').catch(() => false);

  findings.pixelId = await page.evaluate(() => {
    if (window.fbq && window.fbq.getState) {
      try {
        const state = window.fbq.getState();
        if (state && state.pixels && state.pixels.length > 0) return state.pixels[0].id;
      } catch (e) {}
    }
    const img = document.querySelector('noscript img[src*="facebook.com/tr"]');
    if (img) {
      const match = img.src.match(/[?&]id=(\d+)/);
      if (match) return match[1];
    }
    return null;
  }).catch(() => null);

  if (!findings.pixelId && config.pixelId) findings.pixelId = config.pixelId;

  const pixelRequests = interceptor.getRequestsMatching(/facebook\.com\/tr/);
  findings.pixelFires = pixelRequests.length;

  for (const req of pixelRequests) {
    try {
      const url = new URL(req.url);
      const ev = url.searchParams.get('ev');
      if (ev) findings.events.push(ev);
    } catch (e) {}
  }

  const fbeventsLoaded = interceptor.hasRequestMatching(/connect\.facebook\.net.*fbevents\.js/);
  const hasPixel = findings.scriptFound || findings.fbqFunction || fbeventsLoaded;

  // Build reasons
  if (!findings.scriptFound && !fbeventsLoaded) findings.reasons.push('No fbevents.js script found in DOM or network');
  if (!findings.fbqFunction) findings.reasons.push('window.fbq function not available');
  if (findings.pixelFires === 0) findings.reasons.push('No pixel fire requests to facebook.com/tr');

  if (hasPixel) {
    const parts = [];
    if (findings.scriptFound || fbeventsLoaded) parts.push('fbevents.js loaded');
    if (findings.fbqFunction) parts.push('fbq() active');
    if (findings.pixelFires > 0) parts.push(`${findings.pixelFires} pixel fire(s): ${findings.events.join(', ')}`);
    if (findings.pixelId) parts.push(`Pixel ID: ${findings.pixelId}`);
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  return {
    status: hasPixel ? 'pass' : 'fail',
    details: findings,
  };
};
