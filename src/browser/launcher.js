const { chromium } = require('playwright');
const { handleCookieConsent } = require('./cookie-consent');
const { createInterceptor } = require('./network-interceptor');

let browser = null;

async function launchBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browser;
}

async function closeBrowser() {
  if (browser && browser.isConnected()) {
    await browser.close();
    browser = null;
  }
}

/**
 * Visit a site, handle cookie consent, and run checkers.
 * Returns an array of check results.
 */
async function checkSite(site, checksConfig, checkerModules) {
  const b = await launchBrowser();
  const context = await b.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  });

  const page = await context.newPage();
  const interceptor = createInterceptor(page);
  const results = [];

  try {
    // Navigate to the site
    await page.goto(site.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for cookie banner to appear
    await page.waitForTimeout(2000);

    // Handle cookie consent
    const consentResult = await handleCookieConsent(page);

    // Wait for marketing scripts to load after consent
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch (e) {
      // networkidle timeout is acceptable — some sites never fully settle
    }

    // Additional wait for late-loading scripts
    await page.waitForTimeout(3000);

    // Run each configured checker
    for (const check of checksConfig) {
      if (!check.enabled) continue;

      const checkerModule = checkerModules[check.checker_type];
      if (!checkerModule) {
        results.push({
          checkType: check.checker_type,
          status: 'error',
          details: { error: `Unknown checker type: ${check.checker_type}` },
        });
        continue;
      }

      try {
        const config = typeof check.config === 'string' ? JSON.parse(check.config) : (check.config || {});
        const result = await checkerModule(page, interceptor, config);
        results.push({
          checkType: check.checker_type,
          ...result,
          details: {
            ...result.details,
            cookieConsent: consentResult,
          },
        });
      } catch (e) {
        results.push({
          checkType: check.checker_type,
          status: 'error',
          details: { error: e.message, cookieConsent: consentResult },
        });
      }
    }
  } catch (e) {
    // Navigation or page-level failure — mark all checks as error
    for (const check of checksConfig) {
      if (!check.enabled) continue;
      results.push({
        checkType: check.checker_type,
        status: 'error',
        details: { error: `Page error: ${e.message}` },
      });
    }
  } finally {
    await context.close();
  }

  return results;
}

module.exports = { launchBrowser, closeBrowser, checkSite };
