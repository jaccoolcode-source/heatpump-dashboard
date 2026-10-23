'use strict';

// Development helper: logs in, opens the remote display, presses the given keys
// and saves every frame as <n>.b64 + <n>.txt (ASCII art) in the output directory.
//
//   node collector/tools/capture.js <outDir> [up|down|ok|wait ...]     (wait = 5 s idle)

const fs   = require('fs');
const path = require('path');
const { LuxClient, sleep } = require('../lux');
const { Frame }     = require('../lcd');
const { loadEnv }   = require('../env');

async function main() {
  const [outDir, ...keys] = process.argv.slice(2);
  if (!outDir) throw new Error('Usage: capture.js <outDir> [up|down|ok|wait ...]');
  for (const k of keys) {
    if (!['up', 'down', 'ok', 'wait'].includes(k)) throw new Error(`Unknown key: ${k}`);
  }

  const env = loadEnv();
  fs.mkdirSync(outDir, { recursive: true });

  const lux = new LuxClient(env.LUX_HOST, env.LUX_PASSWORD);
  await lux.connect();
  try {
    const save = (n, label, b64) => {
      fs.writeFileSync(path.join(outDir, `${n}.b64`), b64);
      fs.writeFileSync(path.join(outDir, `${n}.txt`), `# ${label}\n${new Frame(b64).toAscii()}\n`);
      console.log(`saved ${n} (${label})`);
    };

    let n = 0;
    save(n++, 'start', await lux.openDisplay());
    for (const k of keys) {
      if (k === 'wait') {
        await sleep(5000);
        save(n++, k, await lux.nextFrame());
      } else {
        save(n++, k, await lux.press(k));
      }
    }
  } finally {
    lux.close();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
