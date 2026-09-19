'use strict';
const path = require('node:path');
const { startHarness } = require('../src/harness/server');
const args = process.argv.slice(2);
function option(name, fallback) { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; }
const source = path.resolve(option('--source', process.cwd()));
startHarness({ port: Number(option('--port', 3040)), artifacts: path.join(source, 'artifacts'), stateDirectory: path.join(source, '.bot-state') })
  .then(harness => {
    console.log(`Jev Observatory: ${harness.url}\nReading recordings from ${source}\nNo bot is started or controlled by this standalone viewer.`);
    for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => { harness.close().then(() => process.exit(0)); });
  }).catch(err => { console.error(err.message); process.exitCode = 1; });
