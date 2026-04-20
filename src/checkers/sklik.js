/**
 * Sklik (Seznam) checker
 * Endpoints: c.seznam.cz, h.seznam.cz
 */
module.exports = async function checkSklik(page, interceptor, config) {
  const findings = {
    endpoints: { cSeznam: false, hSeznam: false },
    scriptFound: false,
    networkRequests: [],
    reasons: [],
  };

  findings.scriptFound = await page.evaluate(() => {
    return !!document.querySelector('script[src*="c.seznam.cz"]') ||
           !!document.querySelector('script[src*="h.seznam.cz"]') ||
           !!document.querySelector('script[src*="seznam.cz/js/rc.js"]');
  }).catch(() => false);

  if (!findings.scriptFound) {
    findings.scriptFound = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        if (s.textContent && (s.textContent.includes('seznam.cz') || s.textContent.includes('sklik'))) return true;
      }
      return false;
    }).catch(() => false);
  }

  const sklikGlobal = await page.evaluate(() => {
    return typeof window.sznIVA === 'object' || typeof window.rc === 'object';
  }).catch(() => false);
  if (sklikGlobal) findings.scriptFound = true;

  const cRequests = interceptor.getRequestsMatching(/c\.seznam\.cz/);
  findings.endpoints.cSeznam = cRequests.length > 0;
  if (cRequests.length > 0) findings.networkRequests.push(`c.seznam.cz: ${cRequests.length} request(s)`);

  const hRequests = interceptor.getRequestsMatching(/h\.seznam\.cz/);
  findings.endpoints.hSeznam = hRequests.length > 0;
  if (hRequests.length > 0) findings.networkRequests.push(`h.seznam.cz: ${hRequests.length} request(s)`);

  const anyFound = findings.scriptFound || findings.endpoints.cSeznam || findings.endpoints.hSeznam;

  if (!findings.scriptFound) findings.reasons.push('No Sklik/Seznam script found in DOM');
  if (!findings.endpoints.cSeznam) findings.reasons.push('No requests to c.seznam.cz');
  if (!findings.endpoints.hSeznam) findings.reasons.push('No requests to h.seznam.cz');

  if (anyFound) {
    const parts = [];
    if (findings.scriptFound) parts.push('Sklik script in DOM');
    if (findings.networkRequests.length > 0) parts.push(findings.networkRequests.join(', '));
    findings.reasons = ['OK: ' + parts.join(', ')];
  }

  return { status: anyFound ? 'pass' : 'fail', details: findings };
};
