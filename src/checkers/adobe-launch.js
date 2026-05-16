/**
 * Adobe Launch / Adobe Experience Platform Tags checker
 * Supports: Legacy DTM, Adobe Launch, Adobe Web SDK via Launch.
 * Built-in endpoints: assets.adobedtm.com, adoberesources.net, launch-* scripts.
 * Optional config.customDomain: extra custom domain to validate (e.g. tags.example.com).
 */
module.exports = async function checkAdobeLaunch(page, interceptor, config) {
  const customDomain = (config && config.customDomain) ? String(config.customDomain).trim() : '';

  const findings = {
    endpoints: { adobedtm: false, customDomain: false },
    customDomainName: customDomain || '(not configured)',
    scriptFound: false,
    satelliteExists: false,
    launchScriptUrl: null,
    networkRequests: [],
    reasons: [],
  };

  // DOM check — Adobe Launch / DTM / Tags scripts
  findings.scriptFound = await page.evaluate(function(domain) {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src;
      if (src.includes('assets.adobedtm.com') ||
          (domain && src.includes(domain)) ||
          src.includes('launch-') ||
          src.includes('adobetags') ||
          src.includes('adoberesources.net')) return true;
    }
    return false;
  }, customDomain).catch(() => false);

  findings.launchScriptUrl = await page.evaluate(function(domain) {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src;
      if (src.includes('assets.adobedtm.com') || (domain && src.includes(domain)) || src.includes('launch-')) {
        return src;
      }
    }
    return null;
  }, customDomain).catch(() => null);

  // JS global check — _satellite (Adobe Launch/Tags runtime)
  findings.satelliteExists = await page.evaluate(() => {
    return typeof window._satellite === 'object' && window._satellite !== null;
  }).catch(() => false);

  // Network checks
  var adobeRequests = interceptor.getRequestsMatching(/assets\.adobedtm\.com/);
  findings.endpoints.adobedtm = adobeRequests.length > 0;
  if (adobeRequests.length > 0) findings.networkRequests.push('assets.adobedtm.com: ' + adobeRequests.length + ' request(s)');

  if (customDomain) {
    var escapedDomain = customDomain.replace(/\./g, '\\.');
    var customRequests = interceptor.getRequestsMatching(new RegExp(escapedDomain));
    findings.endpoints.customDomain = customRequests.length > 0;
    if (customRequests.length > 0) findings.networkRequests.push(customDomain + ': ' + customRequests.length + ' request(s)');
  }

  // Also check for launch-* scripts in network
  var launchRequests = interceptor.getRequestsMatching(/launch-[a-zA-Z0-9]+/);
  if (launchRequests.length > 0 && !findings.endpoints.adobedtm) {
    findings.networkRequests.push('launch script: ' + launchRequests.length + ' request(s)');
  }

  var anyFound = findings.scriptFound || findings.satelliteExists ||
    findings.endpoints.adobedtm || findings.endpoints.customDomain || launchRequests.length > 0;

  if (anyFound) {
    var parts = [];
    if (findings.scriptFound) parts.push('Launch script in DOM');
    if (findings.launchScriptUrl) parts.push('URL: ' + findings.launchScriptUrl.substring(0, 80));
    if (findings.satelliteExists) parts.push('_satellite active');
    if (findings.networkRequests.length > 0) parts.push(findings.networkRequests.join(', '));
    findings.reasons = ['OK: ' + parts.join(', ')];
  } else {
    findings.reasons.push('No Adobe Launch/Tags script found in DOM');
    findings.reasons.push('_satellite object not found');
    findings.reasons.push('No requests to assets.adobedtm.com');
    if (customDomain) findings.reasons.push('No requests to ' + customDomain);
  }

  return { status: anyFound ? 'pass' : 'fail', details: findings };
};
