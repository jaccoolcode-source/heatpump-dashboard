'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app      = express();
const PORT     = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'heatpump-history.json');
const STATUS_FILE   = path.join(DATA_DIR, 'collector-status.json');
const COLLECTOR_URL = process.env.COLLECTOR_URL || 'http://heatpump-collector:3001';

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API: return history data ──────────────────────────────────────────────────
app.get('/api/data', (req, res) => {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return res.json({ readings: {} });
    }
    const raw  = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    console.error('Error reading data file:', err.message);
    res.status(500).json({ error: 'Failed to read data file' });
  }
});

// ── API: collector status (last run, errors) ──────────────────────────────────
app.get('/api/status', (req, res) => {
  try {
    if (!fs.existsSync(STATUS_FILE)) {
      return res.json({});
    }
    res.json(JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')));
  } catch (err) {
    console.error('Error reading status file:', err.message);
    res.status(500).json({ error: 'Failed to read status file' });
  }
});

// ── API: ask the collector to read the controller now ─────────────────────────
app.post('/api/refresh', async (req, res) => {
  try {
    const r = await fetch(`${COLLECTOR_URL}/run`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    res.status(r.status).json(await r.json());
  } catch (err) {
    console.error('Collector not reachable:', err.message);
    res.status(503).json({ started: false, reason: 'Collector is not running' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Heatpump Dashboard running on http://localhost:${PORT}`);
});
