/**
 * Multi-layer cookie consent banner handler.
 * Attempts to accept cookie banners so marketing scripts can load.
 */

// Layer 1: Framework-specific selectors (most reliable)
const FRAMEWORK_SELECTORS = [
  // OneTrust
  '#onetrust-accept-btn-handler',
  // CookieBot
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  // Osano
  '.osano-cm-accept-all',
  '.osano-cm-accept',
  // Quantcast / CMP
  '.qc-cmp2-summary-buttons button[mode="primary"]',
  'button.qc-cmp-button',
  // Didomi
  '#didomi-notice-agree-button',
  // TrustArc / TrustE
  '.trustarc-agree-btn',
  '.truste-consent-button',
  // Klaro
  '.cm-btn-accept-all',
  '.cm-btn-accept',
  // Complianz
  '.cmplz-accept',
  '.cmplz-btn.cmplz-accept',
  // CookieYes
  '.cky-btn-accept',
  '[data-cky-tag="accept-button"]',
  // Iubenda
  '.iubenda-cs-accept-btn',
  // Cookie Notice (WordPress)
  '#cn-accept-cookie',
  // GDPR Cookie Compliance
  '#moove_gdpr_cookie_modal .mgbutton',
  // Cookie Law Info
  '#cookie_action_close_header',
  // Borlabs Cookie
  '#BorlabsCookieBoxButtonAccept',
  // Cookiebot (alternative)
  'a[data-cookiebanner="accept_button"]',
  // EU Cookie Law
  '#catapult-cookie-bar .has-click',
  // Generic CMP buttons
  'button[data-testid="cookie-accept"]',
  'button[data-testid="accept-cookies"]',
  '[data-consent="accept"]',
  '[data-action="accept-cookies"]',
];

// Layer 2: CSS selector patterns
const CSS_PATTERNS = [
  'button[id*="cookie-accept"]',
  'button[id*="cookie_accept"]',
  'button[id*="accept-cookie"]',
  'button[id*="accept_cookie"]',
  'button[id*="acceptCookie"]',
  'button[id*="consent-accept"]',
  'button[id*="accept-consent"]',
  'button[class*="cookie-accept"]',
  'button[class*="accept-cookie"]',
  'button[class*="consent-accept"]',
  'a[id*="cookie-accept"]',
  'a[id*="accept-cookie"]',
  '.cookie-accept',
  '.accept-cookies',
  '.consent-accept',
  '.js-accept-cookies',
  '.js-cookie-accept',
  '#accept-cookies',
  '#acceptCookies',
];

// Layer 3: Text patterns for button matching
const ACCEPT_TEXT_PATTERNS = [
  /^accept\s*all$/i,
  /^accept\s*all\s*cookies$/i,
  /^accept\s*cookies$/i,
  /^accept$/i,
  /^i\s*agree$/i,
  /^agree$/i,
  /^allow\s*all$/i,
  /^allow\s*all\s*cookies$/i,
  /^allow\s*cookies$/i,
  /^allow$/i,
  /^got\s*it$/i,
  /^ok$/i,
  /^okay$/i,
  /^yes,?\s*i\s*agree$/i,
  /^i\s*accept$/i,
  /^consent$/i,
  /^continue$/i,
];

// Context keywords that indicate a cookie/consent container
const CONSENT_CONTEXT_KEYWORDS = [
  'cookie', 'consent', 'privacy', 'gdpr', 'tracking', 'data protection',
];

async function handleCookieConsent(page) {
  // Try each strategy in order of reliability
  const strategies = [
    tryFrameworkSelectors,
    tryCssPatterns,
    tryTextMatching,
    tryIframeConsent,
  ];

  for (const strategy of strategies) {
    try {
      const clicked = await strategy(page);
      if (clicked) {
        // Wait for scripts to fire after consent
        await page.waitForTimeout(2000);
        return { handled: true, strategy: strategy.name };
      }
    } catch (e) {
      // Continue to next strategy
    }
  }

  return { handled: false, strategy: null };
}

async function tryFrameworkSelectors(page) {
  for (const selector of FRAMEWORK_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el && await el.isVisible()) {
        await el.click();
        return true;
      }
    } catch (e) {
      // selector not found, continue
    }
  }
  return false;
}

async function tryCssPatterns(page) {
  for (const selector of CSS_PATTERNS) {
    try {
      const el = await page.$(selector);
      if (el && await el.isVisible()) {
        await el.click();
        return true;
      }
    } catch (e) {
      // continue
    }
  }
  return false;
}

async function tryTextMatching(page) {
  // Find all visible buttons and links
  const candidates = await page.$$('button, a[role="button"], a[href="#"], input[type="button"], input[type="submit"]');

  for (const candidate of candidates) {
    try {
      if (!await candidate.isVisible()) continue;

      const text = (await candidate.textContent() || '').trim();
      if (!text) continue;

      const matchesAcceptPattern = ACCEPT_TEXT_PATTERNS.some(pattern => pattern.test(text));
      if (!matchesAcceptPattern) continue;

      // Check if this button is in a consent context
      const isInConsentContext = await candidate.evaluate((el, keywords) => {
        // Walk up the DOM tree looking for consent-related text
        let parent = el.parentElement;
        let depth = 0;
        while (parent && depth < 10) {
          const parentText = parent.textContent.toLowerCase();
          if (keywords.some(kw => parentText.includes(kw))) return true;
          parent = parent.parentElement;
          depth++;
        }
        return false;
      }, CONSENT_CONTEXT_KEYWORDS);

      if (isInConsentContext) {
        await candidate.click();
        return true;
      }
    } catch (e) {
      // continue
    }
  }
  return false;
}

async function tryIframeConsent(page) {
  const CMP_IFRAME_PATTERNS = [
    'consent', 'cookie', 'privacy', 'cmp', 'gdpr',
    'onetrust', 'cookiebot', 'didomi', 'quantcast',
  ];

  const frames = page.frames();
  for (const frame of frames) {
    const url = frame.url().toLowerCase();
    const name = (frame.name() || '').toLowerCase();
    const isConsentFrame = CMP_IFRAME_PATTERNS.some(p => url.includes(p) || name.includes(p));

    if (!isConsentFrame) continue;

    // Try framework selectors within the iframe
    for (const selector of FRAMEWORK_SELECTORS) {
      try {
        const el = await frame.$(selector);
        if (el && await el.isVisible()) {
          await el.click();
          return true;
        }
      } catch (e) {
        // continue
      }
    }

    // Try text matching within the iframe
    const candidates = await frame.$$('button, a[role="button"]');
    for (const candidate of candidates) {
      try {
        if (!await candidate.isVisible()) continue;
        const text = (await candidate.textContent() || '').trim();
        if (ACCEPT_TEXT_PATTERNS.some(p => p.test(text))) {
          await candidate.click();
          return true;
        }
      } catch (e) {
        // continue
      }
    }
  }
  return false;
}

module.exports = { handleCookieConsent };
