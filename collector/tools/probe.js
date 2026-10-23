'use strict';

// Development helper: runs the navigator against the controller and prints every step.
//
//   node collector/tools/probe.js where
//   node collector/tools/probe.js current
//   node collector/tools/probe.js history <year> <month 1-12>
//   node collector/tools/probe.js leave

const { LuxClient } = require('../lux');
const { Navigator } = require('../navigator');
const { loadEnv }   = require('../env');

async function main() {
  const [cmd, year, month] = process.argv.slice(2);
  const env = loadEnv();
  const lux = new LuxClient(env.LUX_HOST, env.LUX_PASSWORD);
  await lux.connect();
  try {
    const nav = new Navigator(lux, msg => console.log(msg));
    const s   = await nav.start();
    console.log(`at [${s.type}] title "${s.title}" rows ${JSON.stringify(s.rows.map(r => (r.selected ? '*' : '') + r.fields.join(' | ')).filter(Boolean))}`
      + (s.type === 'main' ? ` label "${s.label}"` : '') + ` back ${s.backSelected ? 'selected' : '-'}`);

    if (cmd === 'current')      console.log(await nav.readCurrentMonth());
    else if (cmd === 'history') console.log(await nav.readHistoryMonth(Number(year), Number(month)));
    else if (cmd === 'leave')   await nav.leave();
    else if (cmd !== 'where')   throw new Error('Usage: probe.js where|current|history <year> <month>|leave');
  } finally {
    lux.close();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
