const { getSetting } = require('../db/database');

async function sendNotification(failures) {
  const webhookUrl = getSetting('slack_webhook_url');
  if (!webhookUrl) {
    console.log('No Slack webhook configured, skipping notification.');
    return;
  }

  // Group failures by site
  const bySite = {};
  for (const f of failures) {
    if (!bySite[f.siteName]) {
      bySite[f.siteName] = { url: f.siteUrl, checks: [] };
    }
    bySite[f.siteName].checks.push(f);
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':warning: Marketing Monitor Alert', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${failures.length} check(s) failed* across ${Object.keys(bySite).length} site(s)`,
      },
    },
    { type: 'divider' },
  ];

  for (const [siteName, data] of Object.entries(bySite)) {
    const checkList = data.checks
      .map(c => {
        const statusIcon = c.status === 'fail' ? ':x:' : ':exclamation:';
        const reason = c.details?.error || 'Check did not pass';
        return `${statusIcon} *${c.checkLabel}* — ${reason}`;
      })
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${data.url}|${siteName}>*\n${checkList}`,
      },
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `Checked at ${new Date().toISOString()}` },
      ],
    }
  );

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      console.error(`Slack webhook failed: ${response.status} ${response.statusText}`);
    }
  } catch (e) {
    console.error('Slack notification error:', e.message);
  }
}

async function sendTestMessage() {
  const webhookUrl = getSetting('slack_webhook_url');
  if (!webhookUrl) throw new Error('No Slack webhook URL configured');

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: ':white_check_mark: *Marketing Monitor* — Test notification. Connection successful!' },
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack responded with ${response.status}: ${response.statusText}`);
  }

  return true;
}

module.exports = { sendNotification, sendTestMessage };
