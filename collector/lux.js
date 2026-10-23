'use strict';

// Minimal client for the Luxtronik 2.x web interface (WebSocket "Lux_WS" on port 8214).
// Only drives the "Sieć lokalna" remote display: MOVE commands in, LCD frames out.
// Uses the `ws` package: the controller rejects the lowercase handshake headers sent by Node's built-in WebSocket.

const WebSocket = require('ws');

const PORT        = 8214;
const DISPLAY_NAME = 'Sieć lokalna';
const MOVE         = { down: 0, up: 1, okPress: 2, okRelease: 6 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

class LuxClient {
  constructor(host, password, { timeout = 10000 } = {}) {
    this.host     = host;
    this.password = password;
    this.timeout  = timeout;
    this.ws       = null;
    this.canvasId = null;
    this.frame    = null;   // latest LCD frame (base64)
    this.frameSeq = 0;
    this.waiters  = [];
  }

  // ── Connection ──────────────────────────────────────────────────────────────
  async connect() {
    this.ws = new WebSocket(`ws://${this.host}:${PORT}`, 'Lux_WS', { perMessageDeflate: false });
    this.ws.onmessage = evt => this.#onMessage(String(evt.data));
    this.ws.onclose   = () => this.#rejectAll(new Error('Connection to controller closed'));

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Cannot connect to ${this.host}:${PORT}`)), this.timeout);
      this.ws.onopen  = () => { clearTimeout(t); resolve(); };
      this.ws.onerror = () => { clearTimeout(t); reject(new Error(`Cannot connect to ${this.host}:${PORT}`)); };
    });

    this.ws.send('LOGIN;' + (this.password || '0'));
    const nav = await this.#waitFor(msg => rootTag(msg) === 'Navigation', 'navigation (wrong password?)');
    this.navigation = parseItems(nav);
  }

  close() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = null;
  }

  // ── Remote display ──────────────────────────────────────────────────────────
  async openDisplay() {
    const item = this.navigation.find(i => i.name === DISPLAY_NAME);
    if (!item) throw new Error(`"${DISPLAY_NAME}" not found in controller navigation`);

    this.ws.send('GET;' + item.id);
    const content = await this.#waitFor(msg => rootTag(msg) === 'Content' && msg.includes('<img'), 'remote display');
    this.canvasId = parseItems(content)[0].id;

    this.refreshTimer = setInterval(() => this.ws && this.ws.send('REFRESH'), 500);
    return this.nextFrame();
  }

  // Resolves with the first frame received after this call.
  nextFrame() {
    const seq = this.frameSeq;
    return this.#waitFor(() => this.frameSeq > seq, 'display frame').then(() => this.frame);
  }

  // Sends one key: 'up', 'down' or 'ok' (press + release, like a click on the knob).
  async send(key) {
    if (key === 'ok') {
      this.ws.send('MOVE;' + MOVE.okPress);
      await sleep(150);
      this.ws.send('MOVE;' + MOVE.okRelease);
    } else if (key === 'up' || key === 'down') {
      this.ws.send('MOVE;' + MOVE[key]);
    } else {
      throw new Error(`Unknown key: ${key}`);
    }
  }

  // Sends a key and returns the frame once the display has had time to redraw.
  async press(key, settleMs = 1200) {
    await this.send(key);
    await sleep(settleMs);
    return this.nextFrame();
  }

  // ── Internals ───────────────────────────────────────────────────────────────
  #onMessage(msg) {
    if (this.canvasId && rootTag(msg).toUpperCase() === 'VALUES') {
      const m = msg.match(new RegExp(`<item id='${this.canvasId}'>\\s*<value>([^<]+)</value>`));
      if (m) {
        this.frame = m[1];
        this.frameSeq++;
      }
    }
    this.waiters = this.waiters.filter(w => {
      if (!w.test(msg)) return true;
      clearTimeout(w.timer);
      w.resolve(msg);
      return false;
    });
  }

  #waitFor(test, what) {
    return new Promise((resolve, reject) => {
      const w = { test, resolve, reject };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter(x => x !== w);
        reject(new Error(`Timed out waiting for ${what}`));
      }, this.timeout);
      this.waiters.push(w);
    });
  }

  #rejectAll(err) {
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    this.waiters = [];
  }
}

function rootTag(xml) {
  const m = xml.match(/^\s*(?:<\?[^>]*\?>\s*)?<([A-Za-z_]+)/);
  return m ? m[1] : '';
}

function parseItems(xml) {
  const items = [];
  const re = /<item id='([^']+)'[^>]*>\s*<name>([^<]*)<\/name>/g;
  let m;
  while ((m = re.exec(xml))) items.push({ id: m[1], name: m[2] });
  if (!items.length) {
    const first = xml.match(/<item id='([^']+)'/);
    if (first) items.push({ id: first[1], name: '' });
  }
  return items;
}

module.exports = { LuxClient, sleep };
