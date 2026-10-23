'use strict';

// Walks the controller menus on the remote display, one verified step at a time:
//   main menu > Serwis > Informacje > Monitor energii > Zużycie energii > Bieżący miesiąc | Historia > year > month
//
// Every key is chosen from the screen currently shown. OK is pressed only when the back arrow is selected,
// or when the selected row is the next one on the path above (checked twice, a moment apart).
// Anything unexpected is backed out of; a screen without a back arrow that is not recognised aborts the run.
//
// In every list the back arrow comes before the first row: Up from the first row selects it,
// Down from it selects the first row, and Up on it does nothing.

const { Frame, parseNumber } = require('./lcd');
const { sleep }              = require('./lux');

const MONTHS       = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
                      'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const MAIN_MENU    = ['Do menu standardowego', 'Info + ustawienia', 'Ogrzewanie', 'c.w.u', 'Serwis'];
const INFO_ITEMS   = ['Temperatury', 'Wejścia', 'Wyjścia', 'Czasy pracy', 'Przebieg', 'Pamięć błędów',
                      'Wyłączenia', 'Status instalacji', 'Monitor energii', 'BMS'];
const ENERGY_TITLE = 'Zużycie energii';
const ENERGY_MENU  = ['Razem', 'Bieżący miesiąc', 'Historia'];
const VALUE_ROWS   = ['Ogrzewanie', 'c.w.u', 'Razem'];
const TEMP_ROW     = 'Średnia temp. zewn.';

const MAX_STEPS      = 80;
const CHANGE_TIMEOUT = 4000;   // ms to wait for the display to react to a key
const SETTLE_MS      = 700;    // ms to let the display finish redrawing
const CONFIRM_MS     = 1200;   // ms between the two checks before pressing OK

// ── Screen classification ─────────────────────────────────────────────────────

function classify(frame) {
  const rows     = frame.rows();
  const labels   = rows.map(r => r.fields[0] || '');
  const visible  = labels.filter(Boolean);
  const selected = rows.findIndex(r => r.selected && r.text);
  const title    = frame.title();
  const s = { frame, title, rows, labels, selected, backSelected: Boolean(frame.isBackSelected()), type: 'other' };

  const same = list => visible.length === list.length && list.every((l, i) => visible[i] === l);

  if (isStandardScreen(frame)) {
    s.type = 'standard';
  } else if (frame.hasBackArrow() && MAIN_MENU.includes(frame.menuLabel())) {
    s.type  = 'main';
    s.label = frame.menuLabel();
  } else if (title === 'Serwis') {
    s.type = 'serwis';
  } else if (title === 'Informacje' && visible.some(l => INFO_ITEMS.includes(l))) {
    s.type = 'info';
  } else if (title === 'Monitor energii') {
    s.type = 'monitor';
  } else if (title === ENERGY_TITLE && same(ENERGY_MENU)) {
    s.type = 'energy-menu';
  } else if (title === ENERGY_TITLE && visible.length && visible.every(l => /^\d{4}$/.test(l) || l === 'Eksport historii')) {
    s.type = 'years';
  } else if (/^[\d?]{4}$/.test(title) && visible.length && visible.every(l => MONTHS.includes(l))) {
    s.type = 'months';
  } else if (same([...VALUE_ROWS, TEMP_ROW])) {
    s.type = 'month-values';
  } else if (same(VALUE_ROWS)) {
    s.type = 'current-month';
  }
  return s;
}

// "2025" matches "2025" and "20?5": unknown glyphs ('?') never contradict.
function looselyEquals(text, expected) {
  return text.length === expected.length && [...text].every((c, i) => c === '?' || c === expected[i]);
}

function readValues(s, withTemp) {
  const value = label => {
    const row = s.rows.find(r => r.fields[0] === label);
    const n   = row ? parseNumber(row.fields[1]) : null;
    if (n === null) throw new Error(`Cannot read "${label}" on screen "${s.title}": ${JSON.stringify(row && row.fields)}`);
    return n;
  };
  const values = { heating: value('Ogrzewanie'), dhw: value('c.w.u'), total: value('Razem') };
  if (withTemp) values.avgTemp = value(TEMP_ROW);
  return values;
}

// ── Navigator ─────────────────────────────────────────────────────────────────

class Navigator {
  constructor(lux, log = () => {}) {
    this.lux     = lux;
    this.log     = log;
    this.state   = null;
    this.entered = null;   // { from, row } of the last OK pressed on a menu row
  }

  async start() {
    this.state = classify(new Frame(await this.lux.openDisplay()));
    return this.state;
  }

  // Current month so far: { title, heating, dhw, total }
  readCurrentMonth() {
    return this.#goTo({ kind: 'current' });
  }

  // Finished month from Historia: { title, heating, dhw, total, avgTemp }
  readHistoryMonth(year, month) {
    return this.#goTo({ kind: 'history', year: String(year), month: MONTHS[month - 1] });
  }

  // Leaves the menus and returns to the standard screen, so the panel is left as it is normally seen.
  async leave() {
    for (let step = 0; step < MAX_STEPS; step++) {
      const s = this.state;
      if (s.type === 'standard') return;
      if (s.type === 'main') {
        if (s.label === MAIN_MENU[0]) {
          if (await this.#confirm(t => t.type === 'main' && t.label === MAIN_MENU[0])) await this.#press('ok');
          return;
        }
        await this.#press('up');
      } else if (s.frame.hasBackArrow()) {
        await this.#backOut(s);
      } else {
        return;   // no way back from here: leave the display as it is
      }
    }
    throw new Error('Could not leave the menus');
  }

  async #goTo(target) {
    for (let step = 0; step < MAX_STEPS; step++) {
      const s = this.state;
      this.log(`  [${s.type}] "${s.title}" ${s.type === 'main' ? `label "${s.label}"` : `selected "${s.labels[s.selected] ?? (s.backSelected ? '<back>' : '-')}"`}`);

      switch (s.type) {
        case 'main':
          if (s.label === 'Serwis') await this.#enter(s, t => t.type === 'main' && t.label === 'Serwis');
          else await this.#press(MAIN_MENU.indexOf(s.label) < MAIN_MENU.indexOf('Serwis') ? 'down' : 'up');
          break;

        case 'serwis':
          await this.#select(s, 'Informacje');
          break;

        case 'info':
          await this.#select(s, 'Monitor energii', INFO_ITEMS);
          break;

        case 'monitor':
          await this.#select(s, 'Zużycie energii');
          break;

        case 'energy-menu':
          await this.#select(s, target.kind === 'current' ? 'Bieżący miesiąc' : 'Historia');
          break;

        case 'years':
          if (target.kind !== 'history') { await this.#backOut(s); break; }
          if (!s.labels.includes(target.year) && s.labels.includes('Eksport historii')) {
            throw new Error(`Year ${target.year} is not in Historia (${s.labels.filter(Boolean).join(', ')})`);
          }
          await this.#select(s, target.year);
          break;

        case 'months':
          if (target.kind !== 'history' || !looselyEquals(s.title, target.year) || !this.#cameFrom('years', target.year)) {
            await this.#backOut(s);
            break;
          }
          await this.#select(s, target.month, MONTHS);
          break;

        case 'current-month':
          if (target.kind === 'current' && this.#cameFrom('energy-menu', 'Bieżący miesiąc')) {
            return { title: s.title, ...readValues(s, false) };
          }
          await this.#backOut(s);
          break;

        case 'month-values':
          if (target.kind === 'history' && this.#cameFrom('months', target.month)
              && looselyEquals(s.title, `${target.month} ${target.year}`)) {
            return { title: s.title, ...readValues(s, true) };
          }
          await this.#backOut(s);
          break;

        case 'standard':
          if (!isStandardArrowSelected(s.frame)) {
            throw new Error('Standard screen shown, but its menu arrow is not selected; not touching it');
          }
          await this.#enter(s, t => t.type === 'standard' && isStandardArrowSelected(t.frame));
          break;

        default:
          if (!s.frame.hasBackArrow()) {
            throw new Error('Unrecognised screen without a back arrow:\n' + s.frame.toAscii());
          }
          await this.#backOut(s);
      }
    }
    throw new Error(`Gave up after ${MAX_STEPS} steps`);
  }

  #cameFrom(type, row) {
    return this.entered && this.entered.from === type && this.entered.row === row;
  }

  // Moves the selection to `wanted` and presses OK on it. `order` is the full list, for rows scrolled out of view.
  async #select(s, wanted, order) {
    const at = s.labels.indexOf(wanted);
    if (at >= 0 && s.selected === at) {
      return this.#enter(s, t => t.type === s.type && t.selected === at && t.labels[at] === wanted, wanted);
    }
    let key;
    if (s.selected < 0)  key = 'down';  // back arrow selected: Down goes to the first row (Up does nothing)
    else if (at >= 0)    key = at > s.selected ? 'down' : 'up';
    else if (order)      key = order.indexOf(wanted) > order.indexOf(s.labels[s.selected]) ? 'down' : 'up';
    else                 key = 'up';
    return this.#press(key);
  }

  async #backOut(s) {
    if (s.backSelected) {
      if (await this.#confirm(t => t.backSelected)) {
        this.entered = null;
        await this.#press('ok');
      }
      return;
    }
    await this.#press('up');    // Up from the first row selects the back arrow
  }

  // Presses OK only if `stillValid` holds on a fresh frame taken a moment later.
  async #enter(s, stillValid, row = null) {
    if (!(await this.#confirm(stillValid))) return;
    this.entered = { from: s.type, row };
    await this.#press('ok');
  }

  async #confirm(stillValid) {
    await sleep(CONFIRM_MS);
    this.state = classify(new Frame(await this.lux.nextFrame()));
    return stillValid(this.state);
  }

  async #press(key) {
    const before = this.state.frame;
    this.log(`    -> ${key}`);
    await this.lux.send(key);

    const deadline = Date.now() + CHANGE_TIMEOUT;
    while (Date.now() < deadline) {
      if (!new Frame(await this.lux.nextFrame()).equals(before)) break;
    }
    await sleep(SETTLE_MS);
    this.state = classify(new Frame(await this.lux.nextFrame()));
  }
}

// ── Standard (home) screen ────────────────────────────────────────────────────
// A full-width bar at y 53 above the date line, no back arrow, and the menu arrow box at the bottom right.
// Selected, that box is filled (x 145..158, y 49..62) with a hollow arrow, like the selected back arrow.

function isStandardScreen(frame) {
  for (let x = 0; x <= 140; x += 4) {
    if (!frame.pixel(x, 53)) return false;
  }
  return !frame.hasBackArrow();
}

function isStandardArrowSelected(frame) {
  return Boolean(frame.pixel(145, 49) && frame.pixel(158, 49) && frame.pixel(145, 62) && frame.pixel(158, 62)
    && !frame.pixel(144, 49) && !frame.pixel(150, 55));
}

module.exports = { Navigator, classify, MONTHS };
