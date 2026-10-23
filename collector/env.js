'use strict';

const fs   = require('fs');
const path = require('path');

const DEFAULTS = {
  LUX_HOST:       '192.168.231.149',
  LUX_PASSWORD:   '',
  DAILY_AT:       '10:15',          // local time of the daily run
  TIMEZONE:       'Europe/Warsaw',
  STARTUP_DELAY:  '60',             // seconds after start before the first run
  RETRIES:        '3',              // attempts per run
  RETRY_DELAY:    '300',            // seconds between attempts
  COLLECTOR_PORT: '3001',           // internal port for "Refresh now" requests from the dashboard
};

// Docker passes .env through env_file; when run directly from the project, read .env ourselves.
function loadEnv() {
  const env  = { ...DEFAULTS };
  const file = path.join(__dirname, '..', '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  for (const key of Object.keys(env)) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

module.exports = { loadEnv };
