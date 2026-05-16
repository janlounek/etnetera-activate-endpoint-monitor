// --- API helpers ---

async function api(path, options) {
  options = options || {};
  var res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    method: options.method || 'GET',
    body: options.body || undefined,
  });
  var data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(message, type) {
  var el = document.createElement('div');
  el.className = 'toast ' + (type || 'success');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 4000);
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  var date = new Date(dateStr + 'Z');
  var diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getReasons(details) {
  if (!details) return [];
  if (Array.isArray(details.reasons) && details.reasons.length > 0) return details.reasons;
  if (details.error) return [details.error];
  return [];
}

function formatReasons(details) {
  var reasons = getReasons(details);
  if (reasons.length === 0) return '';
  return reasons.map(function(r) {
    var cls = r.startsWith('OK:') ? 'reason-pass' : 'reason-fail';
    return '<div class="' + cls + '">' + escapeHtml(r) + '</div>';
  }).join('');
}

// For 'custom' checks, prefer the user-supplied name (stored either in the site_check
// config or in the check result details) over the generic 'Custom' label.
function checkLabel(checkType, configOrDetails) {
  var base = (typeof CHECKER_LABELS !== 'undefined' && CHECKER_LABELS[checkType]) || checkType;
  if (checkType !== 'custom') return base;
  var cfg = configOrDetails;
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = null; } }
  if (cfg && cfg.name && String(cfg.name).trim()) return String(cfg.name);
  return base;
}

function currentClientSlug() {
  return (typeof CLIENT_SLUG !== 'undefined' && CLIENT_SLUG) ? CLIENT_SLUG : null;
}

// --- Polling ---

var pollTimer = null;

function startPolling(callback, interval) {
  stopPolling();
  var slug = currentClientSlug();
  var statusPath = slug ? '/clients/' + slug + '/status' : '/status';
  pollTimer = setInterval(async function() {
    try {
      var status = await api(statusPath);
      if (!status.isRunning) {
        stopPolling();
        if (callback) callback();
      }
    } catch (e) {
      stopPolling();
    }
  }, interval || 3000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function enableRunBtn() {
  var btn = document.getElementById('run-all-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Run All Checks'; }
}

// --- Landing page (clients list) ---

function renderClientCard(c) {
  var hasFailing = c.sites_failing > 0;
  var statusClass = hasFailing ? 'fail' : (c.sites_total > 0 ? 'pass' : 'unknown');
  var statusText = c.sites_total === 0
    ? 'No sites yet'
    : (hasFailing ? c.sites_failing + ' failing' : 'All ' + c.sites_total + ' passing');
  var webhookBadge = c.has_webhook ? '' : '<span class="badge-warn" title="No Slack webhook configured">No Slack</span>';
  return '<a class="client-card" href="/c/' + escapeHtml(c.slug) + '">' +
    '<div class="client-card-head">' +
      '<h3>' + escapeHtml(c.name) + '</h3>' +
      '<span class="status-dot ' + statusClass + '"></span>' +
    '</div>' +
    '<div class="client-card-meta">' +
      '<span class="muted">' + c.sites_total + ' site' + (c.sites_total === 1 ? '' : 's') + '</span>' +
      ' &middot; <span class="' + (hasFailing ? 'text-fail' : 'text-pass') + '">' + statusText + '</span>' +
    '</div>' +
    '<div class="client-card-footer">' +
      '<code class="slug">/c/' + escapeHtml(c.slug) + '</code>' +
      webhookBadge +
    '</div>' +
  '</a>';
}

async function loadClients() {
  try {
    var clients = await api('/clients');
    var grid = document.getElementById('clients-grid');
    if (clients.length === 0) {
      grid.innerHTML = '<p class="loading">No clients yet. <a href="/clients/new">Add your first client</a> to start monitoring.</p>';
      return;
    }
    grid.innerHTML = clients.map(renderClientCard).join('');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Client form ---

async function saveClient(event) {
  event.preventDefault();
  var form = event.target;
  var body = {
    slack_webhook_url: form.querySelector('#slack_webhook_url').value,
  };
  // Admin-only fields are absent (or disabled) when a client edits themselves.
  // Only include fields that have an editable input on the page.
  var nameEl = form.querySelector('#name');
  if (nameEl && !nameEl.disabled) body.name = nameEl.value;
  var slugEl = form.querySelector('#slug');
  if (slugEl && !slugEl.disabled) body.slug = slugEl.value;
  var usernameEl = form.querySelector('#username');
  if (usernameEl && !usernameEl.disabled) body.username = usernameEl.value;
  var passwordEl = form.querySelector('#password');
  if (passwordEl && passwordEl.value) body.password = passwordEl.value;
  var clearEl = form.querySelector('#clear_password');
  if (clearEl && clearEl.checked) body.clearPassword = true;

  try {
    if (typeof EDIT_MODE !== 'undefined' && EDIT_MODE) {
      var resp = await api('/clients/' + CLIENT_SLUG, { method: 'PUT', body: JSON.stringify(body) });
      toast('Client updated');
      window.location.href = '/c/' + (resp.slug || CLIENT_SLUG);
    } else {
      var resp = await api('/clients', { method: 'POST', body: JSON.stringify(body) });
      toast('Client created');
      window.location.href = '/c/' + resp.slug;
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteClient(slug) {
  if (!confirm('Delete this client and ALL its sites and check history? This cannot be undone.')) return;
  try {
    await api('/clients/' + slug, { method: 'DELETE' });
    toast('Client deleted');
    window.location.href = '/';
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Client settings ---

async function loadClientSettings() {
  try {
    var c = await api('/clients/' + CLIENT_SLUG);
    var input = document.getElementById('slack_webhook_url');
    if (input) input.value = c.slack_webhook_url || '';
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function saveClientSettings(event) {
  event.preventDefault();
  try {
    var slack_webhook_url = document.getElementById('slack_webhook_url').value;
    await api('/clients/' + CLIENT_SLUG, { method: 'PUT', body: JSON.stringify({ slack_webhook_url: slack_webhook_url }) });
    toast('Saved');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function testClientSlack() {
  var resultEl = document.getElementById('slack-test-result');
  resultEl.textContent = 'Sending...';
  try {
    await api('/clients/' + CLIENT_SLUG + '/test-slack', { method: 'POST' });
    resultEl.textContent = 'Sent!';
    resultEl.style.color = 'var(--success)';
  } catch (e) {
    resultEl.textContent = e.message;
    resultEl.style.color = 'var(--danger)';
  }
}

// --- Dashboard (client-scoped) ---

function renderSiteChecks(site) {
  return (site.checks || []).filter(function(c) {
    return c.enabled === 1 || c.enabled === true;
  }).map(function(c) {
    var result = site.latestResults[c.checker_type];
    var st = result ? result.status : 'unknown';
    var label = checkLabel(c.checker_type, c.config);
    return '<span class="check-badge ' + st + '" title="' + escapeHtml(label) + ': ' + st.toUpperCase() + '"><span class="status-dot ' + st + '"></span>' + escapeHtml(label) + '</span>';
  }).join('');
}

function getLastChecked(site) {
  var times = Object.values(site.latestResults || {}).map(function(r) { return r.checked_at; });
  return times.sort().pop();
}

function renderSiteRow(site) {
  var slug = currentClientSlug();
  var checks = renderSiteChecks(site);
  var lastChecked = getLastChecked(site);
  var isPrivate = site.isPrivate;
  var rowClass = isPrivate ? 'child-row' : 'site-row';
  var nameClass = isPrivate ? 'site-name-child' : 'site-name';
  var prefix = isPrivate ? '<span class="child-indicator"></span>' : '';
  var typeLabel = isPrivate ? '<span class="type-badge private">Private zone</span>' : '';
  var sitePath = '/c/' + slug + '/sites/' + site.id;

  return '<tr class="' + rowClass + '">' +
    '<td class="' + nameClass + '">' + prefix + '<a href="' + sitePath + '">' + escapeHtml(site.name) + '</a> ' + typeLabel + '</td>' +
    '<td><a href="' + escapeHtml(site.url) + '" target="_blank" class="site-url">' + escapeHtml(site.url) + '</a></td>' +
    '<td><div class="check-badges">' + (checks || '<span class="text-muted">No checks</span>') + '</div></td>' +
    '<td>' + timeAgo(lastChecked) + '</td>' +
    '<td><a href="' + sitePath + '" class="btn btn-sm btn-secondary">Logs</a></td>' +
    '</tr>';
}

async function loadDashboard() {
  try {
    var slug = currentClientSlug();
    if (!slug) return;
    var data = await Promise.all([
      api('/clients/' + slug + '/sites?grouped=1'),
      api('/clients/' + slug + '/status'),
    ]);
    var groups = data[0];
    var status = data[1];

    document.getElementById('total-sites').textContent = status.totalSites;
    document.getElementById('passing-sites').textContent = status.passing;
    document.getElementById('failing-sites').textContent = status.failing;

    var tbody = document.getElementById('sites-tbody');
    if (groups.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading">No sites configured. <a href="/c/' + slug + '/sites/new">Add one</a></td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      html += '<tr class="domain-header-row"><td colspan="5" class="domain-header">' + escapeHtml(group.domain) + '</td></tr>';
      var sites = group.sites || [];
      for (var j = 0; j < sites.length; j++) {
        html += renderSiteRow(sites[j]);
      }
    }
    tbody.innerHTML = html;

    if (status.isRunning) {
      var btn = document.getElementById('run-all-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Scanning...';
      startPolling(function() { loadDashboard(); enableRunBtn(); });
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function runAllChecks() {
  var slug = currentClientSlug();
  var btn = document.getElementById('run-all-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Scanning...';
  try {
    await api('/clients/' + slug + '/check/run', { method: 'POST' });
    toast('Scan started.');
    startPolling(function() { loadDashboard(); enableRunBtn(); });
  } catch (e) {
    if (e.message.indexOf('already running') !== -1) {
      toast('Scan already in progress...');
      startPolling(function() { loadDashboard(); enableRunBtn(); });
    } else {
      toast(e.message, 'error');
      enableRunBtn();
    }
  }
}

async function runSiteCheck(siteId) {
  try {
    await api('/check/run/' + siteId, { method: 'POST' });
    toast('Checking site...');
    startPolling(function() {
      if (typeof SITE_ID !== 'undefined') loadSiteDetail(SITE_ID);
    });
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Site Detail ---

var resultsOffset = 0;

async function loadSiteDetail(siteId) {
  try {
    var data = await Promise.all([
      api('/sites/' + siteId),
      api('/sites/' + siteId + '/results?limit=50'),
    ]);
    var site = data[0];
    var results = data[1];

    var cardsEl = document.getElementById('status-cards');
    if (site.latestResults && site.latestResults.length > 0) {
      cardsEl.innerHTML = site.latestResults.map(function(r) {
        var label = checkLabel(r.check_type, r.details);
        var reasons = formatReasons(r.details, r.status);
        return '<div class="status-card ' + r.status + '">' +
          '<h3><span class="status-dot ' + r.status + '"></span> ' + escapeHtml(label) + '</h3>' +
          '<div class="status-text">' + r.status.toUpperCase() + ' &mdash; ' + timeAgo(r.checked_at) + '</div>' +
          (reasons ? '<div class="check-reasons">' + reasons + '</div>' : '') +
          '<button class="details-toggle" onclick="this.nextElementSibling.classList.toggle(\'visible\')">Raw JSON</button>' +
          '<div class="details-content">' + escapeHtml(JSON.stringify(r.details, null, 2)) + '</div>' +
          '</div>';
      }).join('');
    } else {
      cardsEl.innerHTML = '<p class="loading">No checks have run yet. Click "Check Now" to start.</p>';
    }

    renderResults(results);
    resultsOffset = results.length;
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderResults(results, append) {
  var tbody = document.getElementById('results-tbody');
  var html = results.map(function(r) {
    var label = checkLabel(r.check_type, r.details);
    var time = new Date(r.checked_at + 'Z').toLocaleString();
    var reasons = getReasons(r.details);
    var reasonText = reasons.length > 0 ? reasons.join(' | ') : '';
    return '<tr class="result-row ' + r.status + '">' +
      '<td>' + time + '</td>' +
      '<td>' + escapeHtml(label) + '</td>' +
      '<td><span class="status-badge ' + r.status + '">' + r.status.toUpperCase() + '</span></td>' +
      '<td>' +
        '<div class="reason-summary">' + escapeHtml(reasonText) + '</div>' +
        '<button class="details-toggle" onclick="this.nextElementSibling.classList.toggle(\'visible\')">Raw JSON</button>' +
        '<div class="details-content">' + escapeHtml(JSON.stringify(r.details, null, 2)) + '</div>' +
      '</td>' +
      '</tr>';
  }).join('');

  if (append) {
    tbody.innerHTML += html;
  } else if (results.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading">No check history yet.</td></tr>';
  } else {
    tbody.innerHTML = html;
  }

  var loadMoreBtn = document.getElementById('load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.style.display = results.length >= 50 ? 'inline-flex' : 'none';
  }
}

async function loadMoreResults() {
  try {
    var results = await api('/sites/' + SITE_ID + '/results?limit=50&offset=' + resultsOffset);
    renderResults(results, true);
    resultsOffset += results.length;
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteSite(siteId) {
  if (!confirm('Delete this site and all its check history?')) return;
  try {
    await api('/sites/' + siteId, { method: 'DELETE' });
    toast('Site deleted');
    window.location.href = '/c/' + currentClientSlug();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Site Form ---

function toggleConfig(checkbox, type) {
  var configDiv = document.getElementById('config-' + type);
  if (configDiv) configDiv.style.display = checkbox.checked ? 'block' : 'none';
}

async function saveSite(event) {
  event.preventDefault();
  var form = event.target;
  var name = form.querySelector('#name').value;
  var url = form.querySelector('#url').value;

  var checks = [];
  var checkboxes = form.querySelectorAll('input[name="checks"]:checked');
  for (var i = 0; i < checkboxes.length; i++) {
    var type = checkboxes[i].value;
    var config = {};
    var configInputs = form.querySelectorAll('[name^="config_' + type + '_"]');
    for (var j = 0; j < configInputs.length; j++) {
      var key = configInputs[j].name.replace('config_' + type + '_', '');
      if (configInputs[j].value.trim()) config[key] = configInputs[j].value.trim();
    }
    checks.push({ type: type, config: config });
  }

  try {
    var slug = currentClientSlug();
    if (typeof EDIT_MODE !== 'undefined' && EDIT_MODE) {
      await api('/sites/' + SITE_ID, { method: 'PUT', body: JSON.stringify({ name: name, url: url, checks: checks }) });
      toast('Site updated');
      window.location.href = '/c/' + slug + '/sites/' + SITE_ID;
    } else {
      var result = await api('/clients/' + slug + '/sites', { method: 'POST', body: JSON.stringify({ name: name, url: url, checks: checks }) });
      toast('Site created');
      window.location.href = '/c/' + slug + '/sites/' + result.id;
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Global settings ---

function onCronPresetChange() {
  var preset = document.getElementById('cron_preset');
  var input = document.getElementById('cron_schedule');
  var customRow = document.getElementById('cron-custom-row');
  if (!preset || !input) return;

  if (preset.value === '__custom__') {
    customRow.style.display = '';
    input.focus();
  } else {
    input.value = preset.value;
    customRow.style.display = 'none';
  }
}

function syncCronPreset(cronValue) {
  var preset = document.getElementById('cron_preset');
  var customRow = document.getElementById('cron-custom-row');
  if (!preset) return;
  var match = Array.prototype.slice.call(preset.options).find(function(o) { return o.value === cronValue; });
  if (match) {
    preset.value = match.value;
    if (customRow) customRow.style.display = 'none';
  } else {
    preset.value = '__custom__';
    if (customRow) customRow.style.display = '';
  }
}

async function loadSettings() {
  try {
    var settings = await api('/settings');
    var cron = settings.cron_schedule || '0 */4 * * *';
    var cronInput = document.getElementById('cron_schedule');
    if (cronInput) cronInput.value = cron;
    syncCronPreset(cron);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function saveSettings(event) {
  event.preventDefault();
  try {
    var preset = document.getElementById('cron_preset');
    var input = document.getElementById('cron_schedule');
    var cron_schedule = (preset && preset.value !== '__custom__') ? preset.value : input.value;
    await api('/settings', { method: 'PUT', body: JSON.stringify({ cron_schedule: cron_schedule }) });
    if (input) input.value = cron_schedule;
    toast('Settings saved');
  } catch (e) {
    toast(e.message, 'error');
  }
}
