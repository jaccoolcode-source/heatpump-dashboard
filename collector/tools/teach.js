'use strict';

// Development helper: learns glyph bitmaps from captured frames whose text is known.
//
//   node collector/tools/teach.js <samples.json>
//
// samples.json: [{ "frame": "path/to/n.b64", "rows": { "0": "Ogrzewanie 123.4 kWh", ... } }, ...]
// Use the row key "label" for the main menu label and "title" for the bold title.
// Characters are paired with glyphs left to right, so the text must match the row exactly (spaces ignored).
// Letters drawn touching each other form one glyph; mark them with brackets: "[Te]mpe[ra]tury".

const fs   = require('fs');
const path = require('path');
const { Frame, GLYPHS_FILE } = require('../lcd');

const samples = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base    = path.dirname(path.resolve(process.argv[2]));
const glyphs  = fs.existsSync(GLYPHS_FILE) ? JSON.parse(fs.readFileSync(GLYPHS_FILE, 'utf8')) : {};
let learned = 0, problems = 0;

for (const sample of samples) {
  const frame = new Frame(fs.readFileSync(path.resolve(base, sample.frame), 'utf8').trim());
  for (const [row, text] of Object.entries(sample.rows)) {
    const list  = row === 'label' ? frame.menuLabelGlyphs()
                : row === 'title' ? frame.titleGlyphs()
                : frame.rowGlyphs(Number(row));
    const chars = text.replace(/ /g, '').match(/\[[^\]]+\]|./gu).map(c => c.replace(/^\[(.*)\]$/, '$1'));
    const where = `${sample.frame} row ${row} "${text}"`;

    if (list.length !== chars.length) {
      console.log(`MISMATCH ${where}: ${list.length} glyphs for ${chars.length} chars`);
      console.log('  glyph widths: ' + list.map(g => g.key.length / 3).join(' '));
      problems++;
      continue;
    }
    list.forEach((g, i) => {
      if (glyphs[g.key] && glyphs[g.key] !== chars[i]) {
        console.log(`CONFLICT ${where}: glyph already known as "${glyphs[g.key]}", now "${chars[i]}"`);
        problems++;
      } else if (!glyphs[g.key]) {
        glyphs[g.key] = chars[i];
        learned++;
      }
    });
  }
}

fs.writeFileSync(GLYPHS_FILE, JSON.stringify(glyphs, null, 1) + '\n');
console.log(`learned ${learned} glyphs, ${Object.keys(glyphs).length} total, ${problems} problem(s)`);
