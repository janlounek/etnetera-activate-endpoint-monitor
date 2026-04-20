/**
 * Google Tag Manager checker
 */
module.exports = async function checkGTM(page, interceptor, config) {
  const findings = {
    scriptFound: false,
    containerId: null,
    dataLayerExists: false,
    dataLayerLength: 0,
    gtmLoadRequest: false,
    reasons: [],
  };

  const gtmScript = await page.$('script[src*="googletagmanager.com/gtm.js"]');
  if (gtmScript) {
    findings.scriptFound = true;
    const src = await gtmScript.getAttribute('src');
    const match = src && src.match(/[?&]id=(GTM-[A-Z0-9]+)/);
    if (match) findings.containerId = match[1];
  }

  if (!findings.scriptFound) {
    findings.scriptFound = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        if (s.textContent && s.textContent.includes('googletagmanager.com/gtm.js')) return true;
      }
      return false;
    }).catch(() => false);
  }

  findings.dataLayerExists = await page.evaluate(() => Array.isArray(window.dataLayer)).catch(() => false);

  if (findings.dataLayerExists) {
    findings.dataLayerLength = await page.evaluate(() => window.dataLayer.length).catch(() => 0);
    if (!findings.containerId) {
      findings.containerId = await page.evaluate(() => {
        for (const entry of window.dataLayer) {
          if (typeof entry === 'object') {
            const str = JSON.stringify(entry);
            const match = str.match(/GTM-[A-Z0-9]+/);
            if (match) return match[0];
          }
        }
        return null;
      }).catch(() => null);
    }
  }

  if (!findings.containerId && config.containerId) findings.containerId = config.containerId;

  findings.gtmLoadRequest = interceptor.hasRequestMatching(/googletagmanager\.com\/gtm\.js/);

  const hasGtm = findings.scriptFound || findings.gtmLoadRequest;
  const hasDataLayer = findings.dataLayerExists && findings.dataLayerLength > 0;

  if (!findings.scriptFound && !findings.gtmLoadRequest) findings.reasons.push('No GTM script found in DOM or network');
  if (!findings.dataLayerExists) findings.reasons.push('dataLayer not found');
  else if (findings.dataLayerLength === 0) findings.reasons.push('dataLayer is empty');

  if (hasGtm && hasDataLayer) {
    const parts = ['GTM loaded'];
    if (findings.containerId) parts.push(`Container: ${findings.containerId}`);
    parts.push(`dataLayer: ${findings.dataLayerLength} entries`);
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  return { status: hasGtm && hasDataLayer ? 'pass' : 'fail', details: findings };
};
