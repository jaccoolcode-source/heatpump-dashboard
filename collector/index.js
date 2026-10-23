'use strict';

// Heat pump collector: reads electricity consumption from the controller's remote display
// and writes it into data/heatpump-history.json.
//
// Each run:
//   1. if last month is not final yet, reads it from Historia (consumption + average outdoor temperature)
//   2. reads Bieżący miesiąc into the current month (consumption only)
// Runs shortly after startup, daily at DAILY_AT, and on POST /run (the dashboard's "Refresh now").

const http = require('http');
const { LuxClient, sleep } = require('./lux');
const { Navigator }        = require('./navigator');
const { loadEnv }          = require('./env');
const history              = require('./history');
const { updateStatus }     = require('./status');

const env = loadEnv();
let running = false;

function log(msg) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

// ── Local time ────────────────────────────────────────────────────────────────

function localNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: env.TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value])
  );
  return {
    year:  Number(parts.year),
    month: Number(parts.month),
    date:  `${parts.year}-${parts.month}-${parts.day}`,
    time:  `${parts.hour}:${parts.minute}`,
  };
}

function previousMonth({ year, month }) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// ── Checks on what was read ───────────────────────────────────────────────────

function checkValues(v, where) {
  if ([v.heating, v.dhw, v.total].some(n => n < 0)) {
    throw new Error(`${where}: negative value ${JSON.stringify(v)}`);
  }
  if (Math.abs(v.heating + v.dhw - v.total) > 0.15) {
    throw new Error(`${where}: heating + hot water does not add up to the total ${JSON.stringify(v)}`);
  }
}

// The current month's title is abbreviated ("Październ. 2026"); unknown glyphs read as '?'.
function checkCurrentTitle(title, now) {
  const year = title.slice(-4);
  if (![...year].every((c, i) => c === '?' || c === String(now.year)[i])) {
    throw new Error(`Bieżący miesiąc shows "${title}", expected year ${now.year}`);
  }
}

// ── One run ───────────────────────────────────────────────────────────────────

async function run(reason) {
  if (running) return false;
  running = true;
  const startedAt = new Date().toISOString();
  updateStatus({ running: true, lastRun: { reason, startedAt } });
  log(`run (${reason}) started`);

  const result = { reason, startedAt };
  const lux = new LuxClient(env.LUX_HOST, env.LUX_PASSWORD);
  try {
    await lux.connect();
    const nav = new Navigator(lux, msg => log(msg));
    await nav.start();
    try {
      const now  = localNow();
      const prev = previousMonth(now);
      const data = history.readHistory();

      if (!history.isFinal(data, prev.year, prev.month)) {
        const v = await nav.readHistoryMonth(prev.year, prev.month);
        checkValues(v, v.title);
        const key = history.updateMonth(data, prev.year, prev.month, v, history.SOURCE_HISTORY);
        history.writeHistory(data);
        result.history = { month: key, ...v };
        log(`${key} final from Historia: ${JSON.stringify(v)}`);
      }

      const cur = await nav.readCurrentMonth();
      checkCurrentTitle(cur.title, now);
      checkValues(cur, cur.title);
      const key = history.updateMonth(data, now.year, now.month, cur, history.SOURCE_CURRENT);
      history.writeHistory(data);
      result.current = { month: key, ...cur };
      log(`${key} so far: ${JSON.stringify(cur)}`);
    } finally {
      await nav.leave().catch(err => log(`could not return to the standard screen: ${err.message}`));
    }
    result.ok = true;
  } catch (err) {
    result.ok    = false;
    result.error = err.message;
    log(`run failed: ${err.message}`);
  } finally {
    lux.close();
    running = false;
    result.finishedAt = new Date().toISOString();
    updateStatus({ running: false, lastRun: result, ...(result.ok ? { lastSuccess: result } : {}) });
  }
  return result.ok;
}

async function runWithRetries(reason) {
  const attempts = Number(env.RETRIES);
  for (let i = 1; i <= attempts; i++) {
    const ok = await run(i === 1 ? reason : `${reason}, attempt ${i}`);
    if (ok || running) return;
    if (i < attempts) await sleep(Number(env.RETRY_DELAY) * 1000);
  }
}

// ── Schedule ──────────────────────────────────────────────────────────────────

function startSchedule() {
  // The startup run also covers today's daily run when the PC is switched on after DAILY_AT.
  const start = localNow();
  let lastDaily = start.time >= env.DAILY_AT ? start.date : null;

  setTimeout(() => runWithRetries('startup'), Number(env.STARTUP_DELAY) * 1000);
  setInterval(() => {
    const now = localNow();
    if (now.time >= env.DAILY_AT && lastDaily !== now.date) {
      lastDaily = now.date;
      runWithRetries('daily');
    }
  }, 30 * 1000);

  log(`collector started: first run in ${env.STARTUP_DELAY} s, then daily at ${env.DAILY_AT} (${env.TIMEZONE})`);
}

// ── "Refresh now" endpoint (internal network only) ────────────────────────────

function startServer() {
  http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/run') {
      if (running) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ started: false, reason: 'A run is already in progress' }));
      }
      run('manual');
      res.writeHead(202, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ started: true }));
    }
    res.writeHead(404);
    res.end();
  }).listen(Number(env.COLLECTOR_PORT), () => log(`listening for refresh requests on port ${env.COLLECTOR_PORT}`));
}

if (!env.LUX_PASSWORD) {
  log('LUX_PASSWORD is not set; add it to .env');
}
updateStatus({ running: false });
startSchedule();
startServer();
