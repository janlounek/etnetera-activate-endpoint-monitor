/**
 * Adobe Analytics checker
 * Supports: Legacy AppMeasurement, Adobe Web SDK (alloy.js / Edge Network)
 * Endpoints: tracking-secure.csob.cz, edge.adobedc.net, *.adobedc.net
 */
module.exports = async function checkAdobeAnalytics(page, interceptor, config) {
  const trackingDomain = config.trackingDomain || 'tracking-secure.csob.cz';

  const findings = {
    trackingDomain,
    // Legacy AppMeasurement
    appMeasurementFound: false,
    sObjectExists: false,
    legacyRequests: 0,
    // Adobe Web SDK / Edge Network
    alloySdkFound: false,
    alloyExists: false,
    edgeRequests: 0,
    // Custom domain
    customDomainRequests: 0,
    // General
    beaconRequests: [],
    reasons: [],
  };

  // --- Legacy AppMeasurement detection ---
  findings.appMeasurementFound = await page.evaluate(() => {
    return !!document.querySelector('script[src*="AppMeasurement"]') ||
           !!document.querySelector('script[src*="s_code"]') ||
           !!document.querySelector('script[src*="appmeasurement"]');
  }).catch(() => false);

  findings.sObjectExists = await page.evaluate(() => {
    return (typeof window.s === 'object' && window.s !== null && typeof window.s.t === 'function') ||
           (typeof window.s_gi === 'function');
  }).catch(() => false);

  // --- Adobe Web SDK / alloy.js / Edge Network detection ---
  findings.alloySdkFound = await page.evaluate(() => {
    return !!document.querySelector('script[src*="alloy"]') ||
           !!document.querySelector('script[src*="launch-"]') ||
           !!document.querySelector('script[src*="adobedc.net"]');
  }).catch(() => false);

  // Check for inline alloy/Web SDK config
  if (!findings.alloySdkFound) {
    findings.alloySdkFound = await page.evaluate(() => {
      var scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var t = scripts[i].textContent;
        if (t && (t.includes('alloy(') || t.includes('configure') && t.includes('edgeConfigId') ||
            t.includes('adobedc.net') || t.includes('edgeDomain'))) return true;
      }
      return false;
    }).catch(() => false);
  }

  findings.alloyExists = await page.evaluate(() => {
    return typeof window.alloy === 'function' ||
           typeof window.__alloyNS !== 'undefined' ||
           (typeof window.alloy === 'object' && window.alloy !== null);
  }).catch(() => false);

  // --- Network checks ---

  // Legacy: requests to /b/ss/ (Adobe collect endpoint) or s_i_ image beacons
  var legacyPatterns = [
    /\/b\/ss\//,
    /2o7\.net/,
    /omtrdc\.net/,
    /sc\.omtrdc\.net/,
    /demdex\.net/,
  ];
  for (var i = 0; i < legacyPatterns.length; i++) {
    findings.legacyRequests += interceptor.getRequestsMatching(legacyPatterns[i]).length;
  }

  // Edge Network: requests to edge.adobedc.net or *.adobedc.net
  var edgePatterns = [
    /edge\.adobedc\.net/,
    /adobedc\.net/,
    /edge\.adobedc/,
    /interact\?/,  // Edge Network interact endpoint
  ];
  for (var i = 0; i < edgePatterns.length; i++) {
    findings.edgeRequests += interceptor.getRequestsMatching(edgePatterns[i]).length;
  }

  // Custom tracking domain
  var escapedDomain = trackingDomain.replace(/\./g, '\\.');
  var customRequests = interceptor.getRequestsMatching(new RegExp(escapedDomain));
  findings.customDomainRequests = customRequests.length;

  // Log sample requests for debugging
  var allTrackingRequests = [].concat(
    interceptor.getRequestsMatching(/\/b\/ss\//),
    interceptor.getRequestsMatching(/adobedc\.net/),
    interceptor.getRequestsMatching(/omtrdc\.net/),
    customRequests
  );
  findings.beaconRequests = allTrackingRequests.slice(0, 5).map(function(r) {
    try { return new URL(r.url).hostname + new URL(r.url).pathname.substring(0, 80); }
    catch (e) { return r.url.substring(0, 120); }
  });

  // --- Determine pass/fail ---
  var hasLegacy = findings.appMeasurementFound || findings.sObjectExists || findings.legacyRequests > 0;
  var hasEdge = findings.alloySdkFound || findings.alloyExists || findings.edgeRequests > 0;
  var hasCustom = findings.customDomainRequests > 0;
  var anyFound = hasLegacy || hasEdge || hasCustom;

  // Build reasons
  if (anyFound) {
    var parts = [];
    if (findings.appMeasurementFound) parts.push('AppMeasurement script loaded');
    if (findings.sObjectExists) parts.push('s object active');
    if (findings.alloySdkFound) parts.push('Web SDK/alloy.js loaded');
    if (findings.alloyExists) parts.push('alloy() active');
    if (findings.legacyRequests > 0) parts.push(findings.legacyRequests + ' legacy collect request(s)');
    if (findings.edgeRequests > 0) parts.push(findings.edgeRequests + ' Edge Network request(s)');
    if (findings.customDomainRequests > 0) parts.push(findings.customDomainRequests + ' request(s) to ' + trackingDomain);
    findings.reasons = ['OK: ' + parts.join(', ')];
  } else {
    findings.reasons.push('No AppMeasurement/s_code script found in DOM');
    findings.reasons.push('No Adobe Web SDK (alloy.js) found');
    findings.reasons.push('No alloy() or s object in window');
    findings.reasons.push('No requests to adobedc.net, omtrdc.net, or ' + trackingDomain);
  }

  return { status: anyFound ? 'pass' : 'fail', details: findings };
};
