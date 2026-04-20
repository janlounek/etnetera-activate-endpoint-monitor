/**
 * Multi-layer cookie consent banner handler.
 * Attempts to accept cookie banners so marketing scripts can load.
 * Supports Czech and English language consent banners.
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

// Layer 3: Text patterns for button matching (English + Czech)
const ACCEPT_TEXT_PATTERNS = [
  // English
  /^accept\s*(all)?\s*(cookies)?$/i,
  /^i\s*agree$/i,
  /^agree$/i,
  /^allow\s*(all)?\s*(cookies)?$/i,
  /^got\s*it$/i,
  /^ok$/i,
  /^okay$/i,
  /^yes,?\s*i\s*agree$/i,
  /^i\s*accept$/i,
  /^consent$/i,
  // Czech
  /^souhlas[ií]m$/i,
  /^přijmout\s*(vše|všechny|cookies)?$/i,
  /^přijm/i,
  /^povolit\s*(vše|všechny|cookies)?$/i,
  /^souhlasit$/i,
  /^akceptovat$/i,
  /^rozumím$/i,
  /^přijímám$/i,
];

// Context keywords that indicate a cookie/consent container (English + Czech)
const CONSENT_CONTEXT_KEYWORDS = [
  'cookie', 'consent', 'privacy', 'gdpr', 'tracking', 'data protection',
  'souhlas', 'soukromí', 'osobní údaje', 'ochrana',
];

async function handleCookieConsent(page) {
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
        // Wait for consent to propagate and scripts to start loading
        await page.waitForTimeout(2000);
        return { handled: true, strategy: strategy.name };
      }
    } catch (e) {
      // Log but continue to next strategy
      console.log(`  Cookie consent strategy ${strategy.name} error: ${e.message}`);
    }
  }

  return { handled: false, strategy: null };
}

async function tryFrameworkSelectors(page) {
  for (const selector of FRAMEWORK_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (!el) continue;

      // Try multiple visibility checks — some banners use opacity or transform animations
      let visible = false;
      try {
        visible = await el.isVisible();
      } catch (e) {}

      // Fallback: check via evaluate if isVisible fails
      if (!visible) {
        try {
          visible = await el.evaluate(node => {
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return rect.width > 0 && rect.height > 0 &&
                   style.display !== 'none' && style.visibility !== 'hidden' &&
                   parseFloat(style.opacity) > 0;
          });
        } catch (e) {}
      }

      if (visible) {
        await el.click({ force: true });
        console.log(`  Cookie consent: clicked ${selector}`);
        return true;
      }
    } catch (e) {
      // selector not found or click failed, continue
    }
  }
  return false;
}

async function tryCssPatterns(page) {
  for (const selector of CSS_PATTERNS) {
    try {
      const el = await page.$(selector);
      if (!el) continue;
      const visible = await el.isVisible().catch(() => false);
      if (visible) {
        await el.click({ force: true });
        console.log(`  Cookie consent: clicked CSS pattern ${selector}`);
        return true;
      }
    } catch (e) {
      // continue
    }
  }
  return false;
}

async function tryTextMatching(page) {
  const candidates = await page.$$('button, a[role="button"], a[href="#"], input[type="button"], input[type="submit"]');

  for (const candidate of candidates) {
    try {
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) continue;

      const text = (await candidate.textContent() || '').trim();
      if (!text || text.length > 50) continue;

      const matchesAcceptPattern = ACCEPT_TEXT_PATTERNS.some(pattern => pattern.test(text));
      if (!matchesAcceptPattern) continue;

      // Check if this button is in a consent context
      const isInConsentContext = await candidate.evaluate((el, keywords) => {
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
        await candidate.click({ force: true });
        console.log(`  Cookie consent: clicked text match "${text}"`);
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

    for (const selector of FRAMEWORK_SELECTORS) {
      try {
        const el = await frame.$(selector);
        if (el && await el.isVisible().catch(() => false)) {
          await el.click({ force: true });
          console.log(`  Cookie consent: clicked ${selector} in iframe`);
          return true;
        }
      } catch (e) {
        // continue
      }
    }

    const candidates = await frame.$$('button, a[role="button"]');
    for (const candidate of candidates) {
      try {
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) continue;
        const text = (await candidate.textContent() || '').trim();
        if (ACCEPT_TEXT_PATTERNS.some(p => p.test(text))) {
          await candidate.click({ force: true });
          console.log(`  Cookie consent: clicked text match "${text}" in iframe`);
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
