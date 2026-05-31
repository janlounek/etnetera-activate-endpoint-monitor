/**
 * Shared delivery-health helper for endpoint checkers.
 *
 * The presence of a tag (script in DOM, JS global, inline snippet) does NOT prove
 * a marketing/analytics endpoint works — the data still has to reach the third
 * party. If the request that delivers it is refused by the site's
 * Content-Security-Policy (or otherwise fails), the endpoint is non-functional and
 * the check must fail, regardless of how much code is on the page.
 *
 * `evaluateDelivery` inspects the network interceptor for a set of endpoint URL
 * patterns and reports whether anything was delivered vs. actively blocked.
 * `applyDeliveryOverride` turns a positive block (with zero successful delivery)
 * into a fail, overriding any presence-based pass.
 */

function toRegex(p) {
  return p instanceof RegExp ? p : new RegExp(p, 'i');
}

// Classify a failed (status-0) request. We only want to treat a request as a
// real "delivery failure" when the browser actively refused it or couldn't
// reach the endpoint — NOT when the page/tracker cancelled it itself
// (net::ERR_ABORTED, common and benign), or when the reason is unknown. This
// keeps the override safe across arbitrary domains.
function isDeliveryFailure(error) {
  const e = String(error || '').toLowerCase();
  if (!e || e === 'unknown') return false;   // no concrete reason — don't assume failure
  if (e.includes('abort')) return false;     // request cancelled (navigation, tracker, etc.)
  // csp, err_blocked_by_*, err_connection_*, err_name_not_resolved, err_timed_out,
  // err_ssl_*, err_cert_*, err_address_unreachable, err_failed, etc. — all real.
  return true;
}

function isCspFailure(error) {
  const e = String(error || '').toLowerCase();
  return e.includes('csp') || e.includes('blocked_by_csp') || e.includes('content_security');
}

/**
 * @param interceptor  network interceptor from createInterceptor()
 * @param patterns     RegExp | RegExp[] matching the endpoint's delivery URLs
 * @returns {{successful, attempted, blocked, cspBlocked, cspDirective, blockedUrls, activelyBlocked}}
 */
function evaluateDelivery(interceptor, patterns) {
  const regexes = (Array.isArray(patterns) ? patterns : [patterns]).filter(Boolean).map(toRegex);

  let successful = 0;
  let attempted = 0;
  let blocked = 0;
  let cspBlocked = false;
  let cspDirective = null;
  const blockedUrls = [];

  for (const re of regexes) {
    successful += interceptor.getSuccessfulRequestsMatching(re).length;
    attempted += interceptor.getRequestsMatching(re).length;

    const failed = interceptor.getFailedRequestsMatching(re);
    for (const f of failed) {
      if (isCspFailure(f.error)) cspBlocked = true;
      if (!isDeliveryFailure(f.error)) continue;  // skip benign aborts / unknown
      blocked += 1;
      if (blockedUrls.length < 5 && !blockedUrls.includes(f.url)) blockedUrls.push(f.url);
    }

    for (const v of interceptor.getCspViolationsMatching(re)) {
      cspBlocked = true;
      if (!cspDirective && v.directive) cspDirective = String(v.directive).trim().split(/\s+/)[0];
      if (v.blockedURI && blockedUrls.length < 5 && !blockedUrls.includes(v.blockedURI)) blockedUrls.push(v.blockedURI);
    }
  }

  // Only treat as a failure when there is POSITIVE evidence of blocking and
  // nothing got through. Absence of a successful request alone is NOT a failure
  // (it falls back to the checker's existing presence logic).
  const activelyBlocked = successful === 0 && (cspBlocked || blocked > 0);

  return { successful, attempted, blocked, cspBlocked, cspDirective, blockedUrls, activelyBlocked };
}

function blockedReason(label, delivery) {
  if (delivery.cspBlocked) {
    const where = delivery.cspDirective ? ` (${delivery.cspDirective})` : '';
    return `${label} blocked by Content Security Policy${where} — requests were refused by the browser, so no data is delivered`;
  }
  return `${label} network requests failed to complete — no data is delivered`;
}

/**
 * Mutate a checker result in place: record CSP/delivery diagnostics, and if the
 * endpoint was actively blocked with zero successful delivery, force a fail and
 * replace the reasons with a clear explanation.
 *
 * @param result   { status, details }
 * @param label    human-readable endpoint name (e.g. "Google Analytics")
 * @param delivery output of evaluateDelivery()
 * @param opts     { codePresent?: boolean }
 */
function applyDeliveryOverride(result, label, delivery, opts) {
  opts = opts || {};
  result.details = result.details || {};
  result.details.cspBlocked = delivery.cspBlocked;
  result.details.cspDirective = delivery.cspDirective;
  result.details.deliveryBlocked = delivery.activelyBlocked;
  if (delivery.blockedUrls && delivery.blockedUrls.length) {
    result.details.blockedRequests = delivery.blockedUrls;
  }

  if (delivery.activelyBlocked) {
    result.status = 'fail';
    const reasons = [blockedReason(label, delivery)];
    if (opts.codePresent) reasons.push(`${label} code is present on the page but cannot deliver data`);
    result.details.reasons = reasons;
  }

  return result;
}

module.exports = { evaluateDelivery, blockedReason, applyDeliveryOverride, isDeliveryFailure, isCspFailure };
