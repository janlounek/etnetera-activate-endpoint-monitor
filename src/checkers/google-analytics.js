/**
 * Google Analytics checker (GA4 / Universal Analytics / gtag.js)
 */
module.exports = async function checkGoogleAnalytics(page, interceptor, config) {
  const findings = {
    scriptFound: false,
    scriptType: null,
    gtagFunction: false,
    gaFunction: false,
    dataLayerExists: false,
    measurementId: null,
    collectRequests: 0,
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
  findings.dataLayerExists = await page.evaluate(() => Array.isArray(window.dataLayer)).catch(() => false);

  if (!findings.measurementId && config.measurementId) findings.measurementId = config.measurementId;

  if (!findings.measurementId) {
    findings.measurementId = await page.evaluate(() => {
      if (!window.dataLayer) return null;
      for (const entry of window.dataLayer) {
        if (entry[0] === 'config' && typeof entry[1] === 'string' && /^(G-|UA-)/.test(entry[1])) return entry[1];
      }
      return null;
    }).catch(() => null);
  }

  const collectPatterns = [
    /google-analytics\.com\/collect/,
    /google-analytics\.com\/g\/collect/,
    /analytics\.google\.com\/g\/collect/,
    /googletagmanager\.com\/gtag/,
  ];

  for (const pattern of collectPatterns) {
    findings.collectRequests += interceptor.getRequestsMatching(pattern).length;
  }

  const hasScript = findings.scriptFound || findings.gtagFunction || findings.gaFunction;
  const hasActivity = findings.collectRequests > 0 || findings.dataLayerExists;

  if (!findings.scriptFound) findings.reasons.push('No GA script tag found in DOM');
  if (!findings.gtagFunction && !findings.gaFunction) findings.reasons.push('Neither gtag() nor ga() function found');
  if (!findings.dataLayerExists) findings.reasons.push('dataLayer not found');
  if (findings.collectRequests === 0) findings.reasons.push('No collect/beacon requests detected');

  if (hasScript) {
    const parts = [];
    if (findings.scriptType) parts.push(findings.scriptType);
    if (findings.measurementId) parts.push(`ID: ${findings.measurementId}`);
    if (findings.collectRequests > 0) parts.push(`${findings.collectRequests} collect request(s)`);
    if (findings.dataLayerExists) parts.push('dataLayer active');
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  return {
    status: hasScript && hasActivity ? 'pass' : hasScript ? 'pass' : 'fail',
    details: findings,
  };
};
