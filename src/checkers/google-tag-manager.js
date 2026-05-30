/**
 * Google Tag Manager checker
 *
 * Optional config:
 *   containerId   — expected GTM-XXXX (informational fallback)
 *   dataLayerName — custom dataLayer global name (default 'dataLayer'). Sites
 *                   that customize gtm.start() with a non-standard dataLayer
 *                   (e.g. for server-side GTM or multiple containers) need
 *                   this to be set so detection looks at the right global.
 */
const { evaluateDelivery, applyDeliveryOverride } = require('./_delivery');

module.exports = async function checkGTM(page, interceptor, config) {
  const dataLayerName = (config && config.dataLayerName) ? String(config.dataLayerName).trim() : 'dataLayer';

  const findings = {
    scriptFound: false,
    containerId: null,
    dataLayerName,
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

  findings.dataLayerExists = await page.evaluate((name) => Array.isArray(window[name]), dataLayerName).catch(() => false);

  if (findings.dataLayerExists) {
    findings.dataLayerLength = await page.evaluate((name) => window[name].length, dataLayerName).catch(() => 0);
    if (!findings.containerId) {
      findings.containerId = await page.evaluate((name) => {
        const dl = window[name];
        if (!Array.isArray(dl)) return null;
        for (const entry of dl) {
          if (typeof entry === 'object' && entry !== null) {
            const str = JSON.stringify(entry);
            const match = str.match(/GTM-[A-Z0-9]+/);
            if (match) return match[0];
          }
        }
        return null;
      }, dataLayerName).catch(() => null);
    }
  }

  if (!findings.containerId && config.containerId) findings.containerId = config.containerId;

  findings.gtmLoadRequest = interceptor.hasRequestMatching(/googletagmanager\.com\/gtm\.js/);

  const hasGtm = findings.scriptFound || findings.gtmLoadRequest;
  const hasDataLayer = findings.dataLayerExists && findings.dataLayerLength > 0;

  if (!findings.scriptFound && !findings.gtmLoadRequest) findings.reasons.push('No GTM script found in DOM or network');
  if (!findings.dataLayerExists) findings.reasons.push(`window.${dataLayerName} not found`);
  else if (findings.dataLayerLength === 0) findings.reasons.push(`${dataLayerName} is empty`);

  if (hasGtm && hasDataLayer) {
    const parts = ['GTM loaded'];
    if (findings.containerId) parts.push(`Container: ${findings.containerId}`);
    parts.push(`${dataLayerName}: ${findings.dataLayerLength} entries`);
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  const result = { status: hasGtm && hasDataLayer ? 'pass' : 'fail', details: findings };
  const delivery = evaluateDelivery(interceptor, [/googletagmanager\.com\/gtm\.js/]);
  return applyDeliveryOverride(result, 'Google Tag Manager', delivery, {
    codePresent: findings.scriptFound || findings.dataLayerExists,
  });
};
