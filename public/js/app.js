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

// --- Polling ---

var pollTimer = null;

function startPolling(callback, interval) {
  stopPolling();
  pollTimer = setInterval(async function() {
    var status = await api('/status');
    if (!status.isRunning) {
      stopPolling();
      if (callback) callback();
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

// --- Dashboard (clean — no logs, just status dots) ---

async function loadDashboard() {
  try {
    var data = await Promise.all([api('/sites'), api('/status')]);
    var sites = data[0];
    var status = data[1];

    document.getElementById('total-sites').textContent = status.totalSites;
    document.getElementById('passing-sites').textContent = status.passing;
    document.getElementById('failing-sites').textContent = status.failing;

    var tbody = document.getElementById('sites-tbody');
    if (sites.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading">No sites configured. <a href="/sites/new">Add one</a></td></tr>';
      return;
    }

    tbody.innerHTML = sites.map(function(site) {
      var checks = (site.checks || []).map(function(c) {
        var result = site.latestResults[c.checker_type];
        var st = result ? result.status : 'unknown';
        var label = (typeof CHECKER_LABELS !== 'undefined' && CHECKER_LABELS[c.checker_type]) || c.checker_type;
        return '<span class="check-badge ' + st + '" title="' + label + ': ' + st.toUpperCase() + '"><span class="status-dot ' + st + '"></span>' + label + '</span>';
      }).join('');

      var lastChecked = Object.values(site.latestResults || {}).map(function(r) { return r.checked_at; }).sort().pop();

      return '<tr>' +
        '<td><a href="/sites/' + site.id + '">' + escapeHtml(site.name) + '</a></td>' +
        '<td><a href="' + escapeHtml(site.url) + '" target="_blank" class="site-url">' + escapeHtml(site.url) + '</a></td>' +
        '<td><div class="check-badges">' + (checks || '<span class="text-muted">No checks</span>') + '</div></td>' +
        '<td>' + timeAgo(lastChecked) + '</td>' +
        '<td>' +
          '<a href="/sites/' + site.id + '" class="btn btn-sm btn-secondary">Logs</a>' +
        '</td>' +
        '</tr>';
    }).join('');

    // If a scan is currently running, show spinner and poll
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
  var btn = document.getElementById('run-all-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Scanning...';
  try {
    await api('/check/run', { method: 'POST' });
    toast('Scan started. Checking all sites...');
    startPolling(function() { loadDashboard(); enableRunBtn(); });
  } catch (e) {
    if (e.message.includes('already running')) {
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
      if (typeof SITE_ID !== 'undefined') {
        loadSiteDetail(SITE_ID);
      }
    });
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Site Detail (full logs with reasons) ---

var resultsOffset = 0;

async function loadSiteDetail(siteId) {
  try {
    var data = await Promise.all([
      api('/sites/' + siteId),
      api('/sites/' + siteId + '/results?limit=50'),
    ]);
    var site = data[0];
    var results = data[1];

    // Render status cards with reasons
    var cardsEl = document.getElementById('status-cards');
    if (site.latestResults && site.latestResults.length > 0) {
      cardsEl.innerHTML = site.latestResults.map(function(r) {
        var label = (typeof CHECKER_LABELS !== 'undefined' && CHECKER_LABELS[r.check_type]) || r.check_type;
        var reasons = formatReasons(r.details, r.status);
        return '<div class="status-card ' + r.status + '">' +
          '<h3><span class="status-dot ' + r.status + '"></span> ' + label + '</h3>' +
          '<div class="status-text">' + r.status.toUpperCase() + ' &mdash; ' + timeAgo(r.checked_at) + '</div>' +
          (reasons ? '<div class="check-reasons">' + reasons + '</div>' : '') +
          '<button class="details-toggle" onclick="this.nextElementSibling.classList.toggle(\'visible\')">Raw JSON</button>' +
          '<div class="details-content">' + escapeHtml(JSON.stringify(r.details, null, 2)) + '</div>' +
          '</div>';
      }).join('');
    } else {
      cardsEl.innerHTML = '<p class="loading">No checks have run yet. Click "Check Now" to start.</p>';
    }

    // Render results history table
    renderResults(results);
    resultsOffset = results.length;
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderResults(results, append) {
  var tbody = document.getElementById('results-tbody');
  var html = results.map(function(r) {
    var label = (typeof CHECKER_LABELS !== 'undefined' && CHECKER_LABELS[r.check_type]) || r.check_type;
    var time = new Date(r.checked_at + 'Z').toLocaleString();
    var reasons = getReasons(r.details);
    var reasonText = reasons.length > 0 ? reasons.join(' | ') : '';
    return '<tr class="result-row ' + r.status + '">' +
      '<td>' + time + '</td>' +
      '<td>' + label + '</td>' +
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
    window.location.href = '/';
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
    if (typeof EDIT_MODE !== 'undefined' && EDIT_MODE) {
      await api('/sites/' + SITE_ID, { method: 'PUT', body: JSON.stringify({ name: name, url: url, checks: checks }) });
      toast('Site updated');
      window.location.href = '/sites/' + SITE_ID;
    } else {
      var result = await api('/sites', { method: 'POST', body: JSON.stringify({ name: name, url: url, checks: checks }) });
      toast('Site created');
      window.location.href = '/sites/' + result.id;
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Settings ---

async function loadSettings() {
  try {
    var settings = await api('/settings');
    var webhookInput = document.getElementById('slack_webhook_url');
    var cronInput = document.getElementById('cron_schedule');
    if (webhookInput) webhookInput.value = settings.slack_webhook_url || '';
    if (cronInput) cronInput.value = settings.cron_schedule || '0 */4 * * *';
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function saveSettings(event) {
  event.preventDefault();
  try {
    var slack_webhook_url = document.getElementById('slack_webhook_url').value;
    var cron_schedule = document.getElementById('cron_schedule').value;
    await api('/settings', { method: 'PUT', body: JSON.stringify({ slack_webhook_url: slack_webhook_url, cron_schedule: cron_schedule }) });
    toast('Settings saved');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function testSlack() {
  var resultEl = document.getElementById('slack-test-result');
  resultEl.textContent = 'Sending...';
  try {
    await api('/settings/test-slack', { method: 'POST' });
    resultEl.textContent = 'Sent!';
    resultEl.style.color = 'var(--success)';
  } catch (e) {
    resultEl.textContent = e.message;
    resultEl.style.color = 'var(--danger)';
  }
}
