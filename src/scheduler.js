const cron = require('node-cron');
const { getSetting } = require('../db/database');

let task = null;

function start() {
  const schedule = getSetting('cron_schedule') || '0 */4 * * *';

  if (!cron.validate(schedule)) {
    console.error(`Invalid cron schedule: ${schedule}, falling back to every 4 hours`);
    task = cron.schedule('0 */4 * * *', runChecks);
  } else {
    task = cron.schedule(schedule, runChecks);
  }

  console.log(`Scheduler started with schedule: ${schedule}`);
}

async function runChecks() {
  // Lazy require to avoid circular dependency
  const { runAllChecks } = require('./checkers');
  try {
    await runAllChecks();
  } catch (e) {
    console.error('Scheduled check failed:', e.message);
  }
}

function stop() {
  if (task) {
    task.stop();
    task = null;
  }
}

function restart() {
  stop();
  start();
}

module.exports = { start, stop, restart };
