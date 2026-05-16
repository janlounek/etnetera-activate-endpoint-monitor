/**
 * Google Ads checker
 * Detects: Google Ads scripts, conversion tracking, remarketing tags, DoubleClick
 * Endpoints: googleads.g.doubleclick.net, google.com, google.cz, googleadservices.com,
 *            pagead2.googlesyndication.com, google conversion linker
 */
module.exports = async function checkGoogleAds(page, interceptor, config) {
  const findings = {
    scriptFound: false,
    conversionLinker: false,
    gtagWithAds: false,
    networkMatches: [],
    reasons: [],
  };

  // DOM check — Google Ads related scripts
  findings.scriptFound = await page.evaluate(() => {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src;
      if (src.includes('googleads.g.doubleclick.net') ||
          src.includes('pagead2.googlesyndication.com') ||
          src.includes('googleadservices.com') ||
          src.includes('google.com/pagead') ||
          src.includes('google.cz/pagead') ||
          src.includes('google.com/ads') ||
          src.includes('gtag/js')) return true;
    }
    return false;
  }).catch(() => false);

  // Check for Google Ads conversion config in gtag/dataLayer
  findings.gtagWithAds = await page.evaluate(() => {
    // Check if gtag is configured with an AW- (Google Ads) ID
    if (typeof window.google_tag_data === 'object') return true;
    if (typeof window.google_trackConversion === 'function') return true;
    if (Array.isArray(window.dataLayer)) {
      var str = JSON.stringify(window.dataLayer);
      if (str.includes('AW-') || str.includes('ads') || str.includes('conversion')) return true;
    }
    // Check gtag config calls
    if (typeof window.gtag === 'function') {
      var scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var t = scripts[i].textContent;
        if (t && (t.includes("'AW-") || t.includes('"AW-'))) return true;
      }
    }
    return false;
  }).catch(() => false);

  // Check for conversion linker cookie
  findings.conversionLinker = await page.evaluate(() => {
    return document.cookie.includes('_gcl_') || document.cookie.includes('_gac_');
  }).catch(() => false);

  // Network checks — broad matching for any Google Ads related traffic
  var patterns = [
    { name: 'doubleclick.net', regex: /doubleclick\.net/ },
    { name: 'googleadservices.com', regex: /googleadservices\.com/ },
    { name: 'googlesyndication.com', regex: /googlesyndication\.com/ },
    { name: 'google.com/pagead', regex: /google\.com\/pagead/ },
    { name: 'google.cz/pagead', regex: /google\.cz\/pagead/ },
    { name: 'google.com/ads', regex: /google\.(com|cz)\/ads/ },
    { name: 'googletagmanager (ads)', regex: /googletagmanager\.com.*AW-/ },
    { name: 'google conversion', regex: /google\.(com|cz)\/.*conversion/ },
    { name: 'google gad', regex: /google\.(com|cz)\/.*gad/ },
    { name: 'gtag (collect)', regex: /googletagmanager\.com\/gtag.*collect/ },
  ];

  var totalNetworkHits = 0;
  for (var i = 0; i < patterns.length; i++) {
    var matches = interceptor.getRequestsMatching(patterns[i].regex);
    if (matches.length > 0) {
      findings.networkMatches.push(patterns[i].name + ': ' + matches.length + ' request(s)');
      totalNetworkHits += matches.length;
    }
  }

  var anyFound = findings.scriptFound || findings.gtagWithAds || findings.conversionLinker || totalNetworkHits > 0;

  if (anyFound) {
    var parts = [];
    if (findings.scriptFound) parts.push('Ad script in DOM');
    if (findings.gtagWithAds) parts.push('Ads config in gtag/dataLayer');
    if (findings.conversionLinker) parts.push('Conversion linker cookie present');
    if (findings.networkMatches.length > 0) parts.push(findings.networkMatches.join(', '));
    findings.reasons = ['OK: ' + parts.join(', ')];
  } else {
    findings.reasons.push('No Google Ads script tags found in DOM');
    findings.reasons.push('No AW- conversion ID in gtag/dataLayer config');
    findings.reasons.push('No conversion linker cookies (_gcl_, _gac_)');
    findings.reasons.push('No network requests to doubleclick.net, googleadservices.com, or googlesyndication.com');
  }

  return { status: anyFound ? 'pass' : 'fail', details: findings };
};
