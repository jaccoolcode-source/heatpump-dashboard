'use strict';

// Luxtronik remote display frames: 160x64 px, 1 bit per pixel, base64 encoded.
// Bytes are laid out in 8 pages of 160 columns; bit n of a byte is the n-th pixel row of that page.
//
// Menu screens share one layout:
//   y 0..8          bold title
//   y 10+9i..18+9i  list row i (0..5): accent row, 7 rows of letters, descender row
//   x 0..15         icon column; the back arrow box sits at y 48..63
//   x 19            left margin of the rows, set only on the selected (inverted) row

const fs   = require('fs');
const path = require('path');

const WIDTH       = 160;
const HEIGHT      = 64;
const ROWS        = 6;
const ROW_TOP     = 10;
const ROW_PITCH   = 9;
const ROW_HEIGHT  = 9;
const TITLE_HEIGHT = 9;
const TEXT_LEFT   = 19;
const MENU_LEFT   = 17;
const SPACE_GAP   = 3;     // blank columns that make a space
const COLUMN_GAP  = 8;     // blank columns that separate a label from its value
const GLYPHS_FILE = path.join(__dirname, 'glyphs.json');

let glyphs = null;

function loadGlyphs() {
  if (!glyphs) glyphs = fs.existsSync(GLYPHS_FILE) ? JSON.parse(fs.readFileSync(GLYPHS_FILE, 'utf8')) : {};
  return glyphs;
}

class Frame {
  constructor(b64) {
    this.bytes = Buffer.from(b64, 'base64');
    if (this.bytes.length !== WIDTH * HEIGHT / 8) {
      throw new Error(`Unexpected frame size: ${this.bytes.length} bytes`);
    }
  }

  pixel(x, y) {
    return (this.bytes[(y >> 3) * WIDTH + x] >> (y & 7)) & 1;
  }

  equals(other) {
    return other && this.bytes.equals(other.bytes);
  }

  toAscii() {
    const rows = [];
    for (let y = 0; y < HEIGHT; y++) {
      let row = '';
      for (let x = 0; x < WIDTH; x++) row += this.pixel(x, y) ? '#' : '.';
      rows.push(row);
    }
    return rows.join('\n');
  }

  // ── Text rows ───────────────────────────────────────────────────────────────

  // Glyphs of list row i as column bitmaps, with the selection highlight undone.
  rowGlyphs(i, left = TEXT_LEFT + 1, highlight = true) {
    const top = ROW_TOP + i * ROW_PITCH;
    return this.#glyphs(top, ROW_HEIGHT, left, y => highlight && this.pixel(TEXT_LEFT, y));
  }

  isRowSelected(i) {
    const top = ROW_TOP + i * ROW_PITCH;
    let set = 0;
    for (let y = top; y < top + ROW_HEIGHT - 1; y++) set += this.pixel(TEXT_LEFT, y);
    return set >= ROW_HEIGHT - 2;
  }

  // Row text split into fields at wide gaps, e.g. ['Razem', '123.4 kWh'].
  rowFields(i) {
    return toFields(this.rowGlyphs(i));
  }

  // Bold title in the top band.
  titleGlyphs() {
    return this.#glyphs(0, TITLE_HEIGHT, TEXT_LEFT, () => false);
  }

  title() {
    return toFields(this.titleGlyphs()).join(' ');
  }

  // Main menu: label of the selected icon, in the bottom row but starting further left and never inverted.
  menuLabelGlyphs() {
    return this.rowGlyphs(ROWS - 1, MENU_LEFT, false);
  }

  menuLabel() {
    return toFields(this.menuLabelGlyphs()).join(' ');
  }

  rows() {
    const rows = [];
    for (let i = 0; i < ROWS; i++) {
      const fields = this.rowFields(i);
      rows.push({ fields, text: fields.join(' '), selected: this.isRowSelected(i) });
    }
    return rows;
  }

  // ── Back arrow ──────────────────────────────────────────────────────────────

  hasBackArrow() {
    return this.isBackSelected() || (this.#corners(0, 48, 15, 63) && !this.pixel(1, 49));
  }

  // Selected: filled box x 1..14, y 49..62; not selected: outline x 0..15, y 48..63.
  isBackSelected() {
    return this.#corners(1, 49, 14, 62) && !this.pixel(0, 49) && !this.pixel(5, 55);
  }

  // ── Internals ───────────────────────────────────────────────────────────────
  #corners(x0, y0, x1, y1) {
    return this.pixel(x0, y0) && this.pixel(x1, y0) && this.pixel(x0, y1) && this.pixel(x1, y1);
  }

  #glyphs(top, height, left, inverted) {
    const flip = [];
    for (let k = 0; k < height; k++) flip.push(inverted(top + k) ? 1 : 0);

    const out = [];
    let cur = null, gap = 0;
    for (let x = left; x < WIDTH; x++) {
      let col = 0;
      for (let k = 0; k < height; k++) {
        if (this.pixel(x, top + k) ^ flip[k]) col |= 1 << k;
      }
      if (col) {
        if (!cur) {
          cur = { x, gapBefore: out.length ? gap : 0, cols: [] };
          out.push(cur);
        }
        cur.cols.push(col);
        gap = 0;
      } else {
        cur = null;
        gap++;
      }
    }
    return out.map(g => ({ x: g.x, gapBefore: g.gapBefore, key: g.cols.map(c => c.toString(16).padStart(3, '0')).join('') }));
  }
}

function toFields(list) {
  const known  = loadGlyphs();
  const fields = [];
  let text = '';
  for (const g of list) {
    if (text && g.gapBefore >= COLUMN_GAP) {
      fields.push(text);
      text = '';
    } else if (text && g.gapBefore >= SPACE_GAP) {
      text += ' ';
    }
    text += known[g.key] ?? '?';
  }
  if (text) fields.push(text);
  return fields;
}

// "123.4 kWh" -> 123.4, "-5 °C" -> -5; anything else (e.g. an unknown glyph "12.?") -> null
function parseNumber(field) {
  const m = field && field.match(/^(-?\d+(?:\.\d+)?) (?:kWh|°C)$/);
  return m ? parseFloat(m[1]) : null;
}

module.exports = { Frame, WIDTH, HEIGHT, ROWS, GLYPHS_FILE, parseNumber };
