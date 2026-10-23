'use strict';

// Run status shared with the dashboard through data/collector-status.json.

const fs   = require('fs');
const path = require('path');
const { DATA_DIR } = require('./history');

const STATUS_FILE = path.join(DATA_DIR, 'collector-status.json');

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function updateStatus(changes) {
  const status = { ...readStatus(), ...changes };
  const tmp    = STATUS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(status, null, 2) + '\n');
  fs.renameSync(tmp, STATUS_FILE);
  return status;
}

module.exports = { STATUS_FILE, readStatus, updateStatus };
