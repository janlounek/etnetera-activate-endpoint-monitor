/**
 * Google Analytics checker (GA4 / Universal Analytics / gtag.js)
 *
 * Optional config:
 *   measurementId  — expected G-/UA- ID (informational fallback)
 *   dataLayerName  — custom dataLayer global name (default 'dataLayer')
 *   endpoint       — custom collection endpoint (e.g. 'events.example.com')
 *                    for server-side GTM. Extra hint; the checker also
 *                    auto-detects any '/g/collect' traffic regardless of host.
 *
 * Passes when EITHER a client-side GA/gtag fingerprint is present OR there
 * are recognizable GA collect beacons going somewhere (Google or proxy).
 */
const { evaluateDelivery, applyDeliveryOverride } = require('./_delivery');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = async function checkGoogleAnalytics(page, interceptor, config) {
  const dataLayerName = (config && config.dataLayerName) ? String(config.dataLayerName).trim() : 'dataLayer';
  const customEndpoint = (config && config.endpoint)
    ? String(config.endpoint).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    : '';

  const findings = {
    scriptFound: false,
    scriptType: null,
    gtagFunction: false,
    gaFunction: false,
    dataLayerName,
    dataLayerExists: false,
    customEndpoint: customEndpoint || '(not configured)',
    measurementId: null,
    collectRequests: 0,
    customEndpointRequests: 0,
    proxyEndpointRequests: 0,  // /g/collect on non-Google host
    serverSideDetected: false,
    sampleEndpoints: [],
    reasons: [],
  };

  const ga4Script = await page.$('script[src*="googletagmanager.com/gtag/js"]');
  const uaScript = await page.$('script[src*="google-analytics.com/analytics.js"]');

  if (ga4Script) {
    findings.scriptFound = true;
    findings.scriptType = 'GA4/gtag';
    const src = await ga4Script.getAttribute('src');
    const match = src && src.match(/[?&]id=(G-[A-Z0-9]+|UA-\d+-\d+)/);
    if (match) findings.measurementId = match[1];
  }

  if (uaScript) {
    findings.scriptFound = true;
    findings.scriptType = findings.scriptType ? 'GA4+UA' : 'UA';
  }

  findings.gtagFunction = await page.evaluate(() => typeof window.gtag === 'function').catch(() => false);
  findings.gaFunction = await page.evaluate(() => typeof window.ga === 'function').catch(() => false);
  findings.dataLayerExists = await page.evaluate((name) => Array.isArray(window[name]), dataLayerName).catch(() => false);

  if (!findings.measurementId && config.measurementId) findings.measurementId = config.measurementId;
  if (!findings.measurementId) {
    findings.measurementId = await page.evaluate((name) => {
      const dl = window[name];
      if (!Array.isArray(dl)) return null;
      for (const entry of dl) {
        if (entry && entry[0] === 'config' && typeof entry[1] === 'string' && /^(G-|UA-)/.test(entry[1])) return entry[1];
      }
      return null;
    }, dataLayerName).catch(() => null);
  }

  // GA4 beacons land on '/g/collect' regardless of host — recognize that path
  // anywhere so server-side GTM proxies are detected without explicit config.
  // (UA beacons used '/collect' which is less unique; keep it host-scoped.)
  const allCollect = interceptor.getRequestsMatching(/\/g\/collect/);
  const legacy = interceptor.getRequestsMatching(/google-analytics\.com\/collect/);
  const gtagLoader = interceptor.getRequestsMatching(/googletagmanager\.com\/gtag/);

  findings.collectRequests = allCollect.length + legacy.length + gtagLoader.length;

  // Classify each /g/collect request — Google vs. proxy.
  for (const req of allCollect) {
    try {
      const host = new URL(req.url).hostname;
      if (host.endsWith('google-analytics.com') || host.endsWith('analytics.google.com')) continue;
      findings.proxyEndpointRequests++;
      findings.serverSideDetected = true;
      if (findings.sampleEndpoints.length < 3) findings.sampleEndpoints.push(host + '/g/collect');
    } catch (e) {}
  }

  // Optional explicit endpoint: count and highlight separately.
  if (customEndpoint) {
    const customRegex = new RegExp(escapeRegex(customEndpoint));
    const customMatches = interceptor.getRequestsMatching(customRegex);
    findings.customEndpointRequests = customMatches.length;
    // If the user configured an endpoint that wasn't already counted via the
    // generic /g/collect matcher, count it now too.
    if (findings.customEndpointRequests > 0 && !findings.proxyEndpointRequests) {
      findings.collectRequests += findings.customEndpointRequests;
      findings.serverSideDetected = true;
    }
  }

  const hasClientScript = findings.scriptFound || findings.gtagFunction || findings.gaFunction;
  const hasTraffic = findings.collectRequests > 0;
  const pass = hasClientScript || hasTraffic;

  if (!pass) {
    findings.reasons.push('No GA script tag found in DOM');
    findings.reasons.push('Neither gtag() nor ga() function found');
    if (!findings.dataLayerExists) findings.reasons.push(`window.${dataLayerName} not found`);
    findings.reasons.push(customEndpoint
      ? `No collect/beacon requests detected (also checked ${customEndpoint})`
      : 'No /g/collect or google-analytics.com requests detected');
  } else {
    const parts = [];
    if (findings.scriptType) parts.push(findings.scriptType);
    else if (findings.serverSideDetected) parts.push('server-side GTM (no client gtag)');
    if (findings.measurementId) parts.push(`ID: ${findings.measurementId}`);
    if (findings.collectRequests > 0) {
      let line = `${findings.collectRequests} collect request(s)`;
      if (findings.customEndpointRequests > 0) line += ` (${findings.customEndpointRequests} via ${customEndpoint})`;
      else if (findings.proxyEndpointRequests > 0 && findings.sampleEndpoints.length) line += ` via ${findings.sampleEndpoints[0]}`;
      parts.push(line);
    }
    if (findings.dataLayerExists) parts.push(`${dataLayerName} active`);
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  const result = { status: pass ? 'pass' : 'fail', details: findings };
  const patterns = [/\/g\/collect/, /google-analytics\.com\/collect/, /googletagmanager\.com\/gtag/];
  if (customEndpoint) patterns.push(new RegExp(escapeRegex(customEndpoint)));
  const delivery = evaluateDelivery(interceptor, patterns);
  return applyDeliveryOverride(result, 'Google Analytics', delivery, { codePresent: hasClientScript });
};
