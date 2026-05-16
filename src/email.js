/**
 * Email notifications via nodemailer + SMTP.
 *
 * Configured globally via env vars:
 *   SMTP_HOST  — required (e.g. smtp.office365.com, smtp.gmail.com, smtp.resend.com)
 *   SMTP_PORT  — required (465 for SMTPS, 587 for STARTTLS)
 *   SMTP_USER  — required (mailbox username, or "resend" for Resend SMTP)
 *   SMTP_PASS  — required (mailbox password or API key)
 *   SMTP_FROM  — required (e.g. "Endpoint Monitor <monitor@etnetera.cz>")
 *
 * If any of the required env vars is missing, email is silently disabled.
 * Recipients are configured per-client (clients.notification_emails).
 */
const nodemailer = require('nodemailer');

let cachedTransport = null;

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '0', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !user || !pass || !from) return null;

  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,  // SMTPS on 465, STARTTLS on 587
      auth: { user, pass },
    });
  }
  return cachedTransport;
}

function isEnabled() {
  return !!getTransport();
}

function parseRecipients(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(s => s && s.includes('@'));
}

function getFailReason(failure) {
  const reasons = failure.details && Array.isArray(failure.details.reasons) ? failure.details.reasons : [];
  const failReasons = reasons.filter(r => !r.startsWith('OK:'));
  if (failReasons.length > 0) return failReasons[0];
  if (failure.details && failure.details.error) return failure.details.error;
  return 'Check did not pass';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSubject(failures, clientName) {
  const prefix = clientName ? `[${clientName}] ` : '';
  if (failures.length === 1) {
    const f = failures[0];
    return `${prefix}${f.checkLabel} failed on ${f.siteName}`;
  }
  const sites = new Set(failures.map(f => f.siteName));
  return `${prefix}${failures.length} endpoint check(s) failed across ${sites.size} site(s)`;
}

function buildBodies(failures, clientName) {
  const bySite = {};
  for (const f of failures) {
    if (!bySite[f.siteName]) bySite[f.siteName] = { url: f.siteUrl, checks: [] };
    bySite[f.siteName].checks.push(f);
  }

  // Plain text
  const textLines = [];
  if (clientName) textLines.push(`Client: ${clientName}`);
  textLines.push(`${failures.length} check(s) failed across ${Object.keys(bySite).length} site(s)`);
  textLines.push('');
  for (const [siteName, data] of Object.entries(bySite)) {
    textLines.push(`${siteName}  (${data.url})`);
    for (const f of data.checks) {
      textLines.push(`  - ${f.checkLabel} [${f.status.toUpperCase()}] — ${getFailReason(f)}`);
    }
    textLines.push('');
  }
  textLines.push(`Checked at ${new Date().toISOString()}`);

  // HTML
  const rows = Object.entries(bySite).map(([siteName, data]) => {
    const items = data.checks.map(f =>
      `<li><strong>${escapeHtml(f.checkLabel)}</strong> [<span style="color:#c0392b">${escapeHtml(f.status.toUpperCase())}</span>] — ${escapeHtml(getFailReason(f))}</li>`
    ).join('');
    return `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;">
      <div><a href="${escapeHtml(data.url)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(siteName)}</a></div>
      <ul style="margin:6px 0 0 18px;padding:0;">${items}</ul>
    </td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222;max-width:680px;margin:0 auto;padding:20px;">
  <h2 style="margin:0 0 8px;">Endpoint Monitor — failures detected${clientName ? ` <span style="color:#6b7280;font-weight:normal;font-size:16px;">(${escapeHtml(clientName)})</span>` : ''}</h2>
  <p style="color:#6b7280;margin:0 0 16px;">${failures.length} check(s) failed across ${Object.keys(bySite).length} site(s).</p>
  <table style="width:100%;border-collapse:collapse;">${rows}</table>
  <p style="color:#9ca3af;font-size:12px;margin-top:24px;">Checked at ${escapeHtml(new Date().toISOString())}</p>
</body></html>`;

  return { text: textLines.join('\n'), html };
}

async function sendNotification(failures, recipientsRaw, clientName) {
  const transport = getTransport();
  if (!transport) {
    console.log('  Email: SMTP not configured (set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM), skipping.');
    return;
  }
  const recipients = parseRecipients(recipientsRaw);
  if (recipients.length === 0) {
    console.log(`  Email: no recipients configured${clientName ? ' for ' + clientName : ''}, skipping.`);
    return;
  }

  const { text, html } = buildBodies(failures, clientName);
  const subject = buildSubject(failures, clientName);

  try {
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: recipients.join(', '),
      subject,
      text,
      html,
    });
    console.log(`  Email${clientName ? ' [' + clientName + ']' : ''}: sent to ${recipients.length} recipient(s) (id=${info.messageId})`);
  } catch (e) {
    console.error(`  Email${clientName ? ' [' + clientName + ']' : ''}: send failed — ${e.message}`);
  }
}

async function sendTestMessage(recipientsRaw, clientName) {
  const transport = getTransport();
  if (!transport) throw new Error('SMTP is not configured (set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM env vars)');
  const recipients = parseRecipients(recipientsRaw);
  if (recipients.length === 0) throw new Error('No notification emails configured for this client');

  const info = await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: recipients.join(', '),
    subject: `[Endpoint Monitor] Test message${clientName ? ' — ' + clientName : ''}`,
    text: `This is a test email from Endpoint Monitor${clientName ? ' for ' + clientName : ''}. If you see this, notifications are wired up correctly.`,
    html: `<p>This is a test email from <strong>Endpoint Monitor</strong>${clientName ? ' for <strong>' + escapeHtml(clientName) + '</strong>' : ''}.</p><p>If you see this, notifications are wired up correctly.</p>`,
  });
  return { recipients, messageId: info.messageId };
}

module.exports = { sendNotification, sendTestMessage, isEnabled, parseRecipients };
