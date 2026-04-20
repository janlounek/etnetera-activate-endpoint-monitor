/**
 * Custom script/variable checker.
 * Config: { scriptUrl?: string, globalVar?: string, name?: string }
 */
module.exports = async function checkCustom(page, interceptor, config) {
  const findings = {
    name: config.name || 'Custom check',
    scriptUrl: config.scriptUrl || null,
    globalVar: config.globalVar || null,
    scriptFound: null,
    scriptLoaded: null,
    globalVarExists: null,
  };

  let allPassed = true;

  // Check script URL in DOM and network
  if (config.scriptUrl) {
    findings.scriptFound = await page.evaluate((url) => {
      const scripts = document.querySelectorAll('script[src]');
      for (const s of scripts) {
        if (s.src.includes(url)) return true;
      }
      return false;
    }, config.scriptUrl).catch(() => false);

    const escapedUrl = config.scriptUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    findings.scriptLoaded = interceptor.hasRequestMatching(new RegExp(escapedUrl));

    if (!findings.scriptFound && !findings.scriptLoaded) allPassed = false;
  }

  // Check global JS variable
  if (config.globalVar) {
    findings.globalVarExists = await page.evaluate((varName) => {
      // Support dot notation (e.g., "window.myLib.version")
      const parts = varName.replace(/^window\./, '').split('.');
      let obj = window;
      for (const part of parts) {
        if (obj == null) return false;
        obj = obj[part];
      }
      return obj !== undefined;
    }, config.globalVar).catch(() => false);

    if (!findings.globalVarExists) allPassed = false;
  }

  // If neither scriptUrl nor globalVar configured, report error
  if (!config.scriptUrl && !config.globalVar) {
    return {
      status: 'error',
      details: { ...findings, error: 'No scriptUrl or globalVar configured' },
    };
  }

  return {
    status: allPassed ? 'pass' : 'fail',
    details: findings,
  };
};
