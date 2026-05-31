/**
 * Meta (Facebook) Pixel checker
 *
 * Presence of the pixel code (script tag, inline fbq() snippet, window.fbq) is NOT
 * proof the pixel works: the standard snippet defines window.fbq and injects the
 * <script> tag before anything is delivered. What proves it works is the beacon to
 * facebook.com/tr actually reaching Meta. If that beacon is refused by the site's
 * Content-Security-Policy (a common misconfiguration), the pixel delivers nothing
 * and the check must fail even though all the DOM/JS fingerprints are present.
 */
const { isDeliveryFailure, isCspFailure } = require('./_delivery');

module.exports = async function checkMetaPixel(page, interceptor, config) {
  const findings = {
    scriptFound: false,
    fbqFunction: false,
    pixelId: null,
    pixelFires: 0,            // beacons attempted (includes blocked)
    pixelFiresSuccessful: 0,  // beacons that actually reached Meta
    pixelFiresBlocked: 0,     // beacons refused/failed (e.g. CSP)
    events: [],
    cspBlocked: false,
    cspDirective: null,
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

  // Beacons to facebook.com/tr — split into successful vs. genuinely failed.
  // Benign cancellations (ERR_ABORTED) and unknown errors are filtered out so we
  // only fail on real blocks/failures (see _delivery.isDeliveryFailure).
  const pixelRequests = interceptor.getRequestsMatching(/facebook\.com\/tr/);
  const successfulFires = interceptor.getSuccessfulRequestsMatching(/facebook\.com\/tr/);
  const blockedFires = interceptor.getFailedRequestsMatching(/facebook\.com\/tr/).filter(r => isDeliveryFailure(r.error));
  // The fbevents.js loader being blocked also breaks the pixel (it can never fire).
  const blockedLoader = interceptor.getFailedRequestsMatching(/connect\.facebook\.net/).filter(r => isDeliveryFailure(r.error));
  findings.pixelFires = pixelRequests.length;
  findings.pixelFiresSuccessful = successfulFires.length;
  findings.pixelFiresBlocked = blockedFires.length;

  for (const req of successfulFires) {
    try {
      const ev = new URL(req.url).searchParams.get('ev');
      if (ev) findings.events.push(ev);
    } catch (e) {}
  }

  // CSP enforcement against any Facebook host (fbevents loader or the /tr beacon).
  const cspViolations = interceptor.getCspViolationsMatching(/facebook\.com|connect\.facebook\.net|fbcdn\.net/i);
  const cspBlockedReq = blockedFires.concat(blockedLoader).some(r => isCspFailure(r.error));
  findings.cspBlocked = cspViolations.length > 0 || cspBlockedReq;
  if (cspViolations.length && cspViolations[0].directive) {
    // Keep just the directive name (e.g. "img-src"), not the whole allow-list.
    findings.cspDirective = String(cspViolations[0].directive).trim().split(/\s+/)[0];
  }

  const fbeventsLoaded = interceptor.getSuccessfulRequestsMatching(/connect\.facebook\.net.*fbevents\.js/).length > 0;
  const presence = findings.scriptFound || findings.fbqFunction || fbeventsLoaded;
  const deliveryFailed = findings.pixelFiresBlocked > 0 || blockedLoader.length > 0 || findings.cspBlocked;

  let pass;
  if (findings.pixelFiresSuccessful > 0) {
    pass = true;                 // beacon reached Meta — definitively working
  } else if (deliveryFailed) {
    pass = false;                // delivery was refused/failed — pixel non-functional
  } else {
    pass = presence;             // code present, no fire observed (and not blocked)
  }

  if (pass) {
    const parts = [];
    if (findings.scriptFound || fbeventsLoaded) parts.push('fbevents.js loaded');
    if (findings.fbqFunction) parts.push('fbq() active');
    if (findings.pixelFiresSuccessful > 0) parts.push(`${findings.pixelFiresSuccessful} pixel fire(s): ${findings.events.join(', ')}`);
    if (findings.pixelId) parts.push(`Pixel ID: ${findings.pixelId}`);
    findings.reasons = ['OK: ' + parts.join(', ')];
  } else if (deliveryFailed) {
    const where = findings.cspDirective ? ` (${findings.cspDirective})` : '';
    if (findings.cspBlocked) {
      findings.reasons.push(`Meta Pixel blocked by Content Security Policy${where} — beacons to facebook.com/tr were refused, so no data reaches Meta`);
    } else {
      findings.reasons.push('Pixel fires to facebook.com/tr failed — no data reaches Meta');
    }
    if (findings.scriptFound || findings.fbqFunction) {
      findings.reasons.push('Pixel code is present on the page but cannot deliver events');
    }
  } else {
    if (!findings.scriptFound && !fbeventsLoaded) findings.reasons.push('No fbevents.js script found in DOM or network');
    if (!findings.fbqFunction) findings.reasons.push('window.fbq function not available');
    findings.reasons.push('No pixel fire requests to facebook.com/tr');
  }

  return {
    status: pass ? 'pass' : 'fail',
    details: findings,
  };
};
