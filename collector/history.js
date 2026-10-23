'use strict';

// Reads and updates data/heatpump-history.json. Only `consumed` (and `avgTemp` for finished months)
// of one month entry is changed; everything else in the file is kept as it is.

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'heatpump-history.json');

const SOURCE_HISTORY = 'Historia';
const SOURCE_CURRENT = 'Bieżący miesiąc';

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function lastDayOfMonth(year, month) {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthKey(year, month)}-${String(day).padStart(2, '0')}`;
}

function readHistory() {
  if (!fs.existsSync(DATA_FILE)) {
    return { description: 'Historical heatpump meter readings - end of month totals from Monitor energii', readings: {} };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// Writes through a temporary file and a rename, so the dashboard never reads a half-written file.
function writeHistory(data) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak');
  fs.renameSync(tmp, DATA_FILE);
}

function isFinal(data, year, month) {
  const entry = data.readings[monthKey(year, month)];
  return Boolean(entry && entry.source === SOURCE_HISTORY);
}

function updateMonth(data, year, month, { heating, dhw, total, avgTemp }, source) {
  const key   = monthKey(year, month);
  const entry = data.readings[key] ??= {
    date:     lastDayOfMonth(year, month),
    avgTemp:  null,
    consumed: { heating: null, dhw: null, total: null },
    produced: { heating: null, dhw: null, total: null },
  };
  entry.consumed = { heating, dhw, total };
  if (avgTemp !== undefined) entry.avgTemp = avgTemp;
  entry.source    = source;
  entry.updatedAt = new Date().toISOString();
  return key;
}

module.exports = {
  DATA_DIR, DATA_FILE, SOURCE_HISTORY, SOURCE_CURRENT,
  monthKey, readHistory, writeHistory, isFinal, updateMonth,
};
