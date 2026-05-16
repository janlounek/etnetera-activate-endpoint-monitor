/**
 * Adobe Analytics checker
 * Supports: Legacy AppMeasurement, Adobe Web SDK (alloy.js / Edge Network).
 * Built-in endpoints: edge.adobedc.net, *.adobedc.net, omtrdc.net, 2o7.net, demdex.net.
 * Optional config.trackingDomain: extra custom domain to validate (e.g. analytics.example.com).
 * Optional config.reportingSuite: expected RSID to validate in requests.
 */
module.exports = async function checkAdobeAnalytics(page, interceptor, config) {
  const trackingDomain = (config && config.trackingDomain) ? String(config.trackingDomain).trim() : '';
  const expectedRsid = (config && config.reportingSuite) ? String(config.reportingSuite).trim() : '';

  const findings = {
    trackingDomain: trackingDomain || '(not configured)',
    expectedRsid: expectedRsid || '(not configured)',
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
    // Reporting suite
    rsidFound: null,
    rsidMatch: null,
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

  // Try to get reporting suite from s object
  var rsidFromObject = await page.evaluate(() => {
    if (typeof window.s === 'object' && window.s !== null) {
      return window.s.account || window.s.rsid || null;
    }
    return null;
  }).catch(() => null);

  if (rsidFromObject) findings.rsidFound = rsidFromObject;

  // --- Adobe Web SDK / alloy.js / Edge Network detection ---
  findings.alloySdkFound = await page.evaluate(() => {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src;
      if (src.includes('alloy') || src.includes('launch-') ||
          src.includes('adobedc.net') || src.includes('adoberesources.net')) return true;
    }
    return false;
  }).catch(() => false);

  if (!findings.alloySdkFound) {
    findings.alloySdkFound = await page.evaluate(() => {
      var scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var t = scripts[i].textContent;
        if (t && (t.includes('alloy(') || (t.includes('configure') && t.includes('edgeConfigId')) ||
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

  // Legacy: /b/ss/ requests (contain rsid in path)
  var bssRequests = interceptor.getRequestsMatching(/\/b\/ss\//);
  findings.legacyRequests += bssRequests.length;

  // Extract rsid from /b/ss/{rsid}/ path
  for (var i = 0; i < bssRequests.length; i++) {
    try {
      var match = bssRequests[i].url.match(/\/b\/ss\/([^/]+)\//);
      if (match) {
        findings.rsidFound = match[1];
        break;
      }
    } catch (e) {}
  }

  var otherLegacyPatterns = [/2o7\.net/, /omtrdc\.net/, /sc\.omtrdc\.net/, /demdex\.net/];
  for (var i = 0; i < otherLegacyPatterns.length; i++) {
    findings.legacyRequests += interceptor.getRequestsMatching(otherLegacyPatterns[i]).length;
  }

  // Edge Network requests
  var edgePatterns = [/edge\.adobedc\.net/, /adobedc\.net/, /interact\?/];
  for (var i = 0; i < edgePatterns.length; i++) {
    findings.edgeRequests += interceptor.getRequestsMatching(edgePatterns[i]).length;
  }

  // Try to extract rsid from Edge Network requests (often in query params or body)
  if (!findings.rsidFound) {
    var edgeReqs = interceptor.getRequestsMatching(/adobedc\.net/);
    for (var i = 0; i < edgeReqs.length; i++) {
      try {
        var url = edgeReqs[i].url;
        // rsid can appear in configId or dataset params
        var rsidMatch = url.match(/rsid[s]?=([^&]+)/) || url.match(/reportSuite[s]?=([^&]+)/);
        if (rsidMatch) { findings.rsidFound = rsidMatch[1]; break; }
      } catch (e) {}
    }
  }

  // Custom tracking domain (optional — only checked if configured)
  var customRequests = [];
  if (trackingDomain) {
    var escapedDomain = trackingDomain.replace(/\./g, '\\.');
    customRequests = interceptor.getRequestsMatching(new RegExp(escapedDomain));
    findings.customDomainRequests = customRequests.length;

    if (!findings.rsidFound) {
      for (var i = 0; i < customRequests.length; i++) {
        try {
          var m = customRequests[i].url.match(/\/b\/ss\/([^/]+)\//);
          if (m) { findings.rsidFound = m[1]; break; }
        } catch (e) {}
      }
    }
  }

  // Log sample requests
  var allTrackingRequests = [].concat(bssRequests,
    interceptor.getRequestsMatching(/adobedc\.net/),
    interceptor.getRequestsMatching(/omtrdc\.net/),
    customRequests
  );
  findings.beaconRequests = allTrackingRequests.slice(0, 5).map(function(r) {
    try { return new URL(r.url).hostname + new URL(r.url).pathname.substring(0, 80); }
    catch (e) { return r.url.substring(0, 120); }
  });

  // --- Reporting suite validation ---
  if (expectedRsid && findings.rsidFound) {
    // rsid can be comma-separated list of suites
    var foundSuites = findings.rsidFound.split(',').map(function(s) { return s.trim().toLowerCase(); });
    findings.rsidMatch = foundSuites.includes(expectedRsid.toLowerCase());
  }

  // --- Determine pass/fail ---
  var hasLegacy = findings.appMeasurementFound || findings.sObjectExists || findings.legacyRequests > 0;
  var hasEdge = findings.alloySdkFound || findings.alloyExists || findings.edgeRequests > 0;
  var hasCustom = findings.customDomainRequests > 0;
  var analyticsPresent = hasLegacy || hasEdge || hasCustom;

  // RSID validation: only fail if we found a DIFFERENT rsid than expected.
  // If rsid couldn't be extracted (common with Edge Network), don't fail.
  var rsidOk = true;
  if (expectedRsid && findings.rsidFound && findings.rsidMatch === false) {
    rsidOk = false; // Found a different RSID — that's a real mismatch
  }

  var pass = analyticsPresent && rsidOk;

  // Build reasons
  if (analyticsPresent) {
    var parts = [];
    if (findings.appMeasurementFound) parts.push('AppMeasurement script loaded');
    if (findings.sObjectExists) parts.push('s object active');
    if (findings.alloySdkFound) parts.push('Web SDK/alloy.js loaded');
    if (findings.alloyExists) parts.push('alloy() active');
    if (findings.legacyRequests > 0) parts.push(findings.legacyRequests + ' legacy collect request(s)');
    if (findings.edgeRequests > 0) parts.push(findings.edgeRequests + ' Edge Network request(s)');
    if (trackingDomain && findings.customDomainRequests > 0) parts.push(findings.customDomainRequests + ' request(s) to ' + trackingDomain);
    if (findings.rsidFound) parts.push('RSID: ' + findings.rsidFound);
    if (expectedRsid && !findings.rsidFound) parts.push('RSID not extractable from requests (Edge Network)');

    if (!rsidOk) {
      findings.reasons = [
        'FAIL: Analytics is present but reporting suite mismatch',
        'Expected RSID: ' + expectedRsid,
        'Found RSID: ' + findings.rsidFound,
        'OK (analytics): ' + parts.join(', '),
      ];
    } else {
      findings.reasons = ['OK: ' + parts.join(', ')];
    }
  } else {
    findings.reasons.push('No AppMeasurement/s_code script found in DOM');
    findings.reasons.push('No Adobe Web SDK (alloy.js) found');
    findings.reasons.push('No alloy() or s object in window');
    findings.reasons.push('No requests to adobedc.net or omtrdc.net' + (trackingDomain ? ' or ' + trackingDomain : ''));
  }

  return { status: pass ? 'pass' : 'fail', details: findings };
};
