'use strict';
// The replay suite: recorded decisions from deaths and loops, their text as
// the fixes left it, asked of Jev again through decide() (the "none of these"
// option and the shared guidance included). Seconds a case, no Minecraft.
// A case passes when most answers are among `expect` and at most a third
// among `forbid`. Run after a change that touches what Jev is told, before a
// trial finds out (the user, 2026-09-27: to go faster).
//   node scripts/replay-suite.js [--runs 3] [--only name-substring]
require('../src/env').loadEnv();
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1]]] : out), []));
const runs = Number(args.runs || 3);
const file = path.join(__dirname, '..', 'evals', 'replays', 'cases.jsonl');
const cases = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(c => !args.only || c.name.includes(args.only));
// A pick of "none of these" here is the suite's, not a trial's.
process.env.JEV_MISSING_OPTIONS = path.join(os.tmpdir(), `replay-suite-missing-${process.pid}.jsonl`);

(async () => {
  const { TypeSafe } = require('../src/typesafe');
  const { decide } = require('../src/decisions');
  const client = new TypeSafe();
  const results = [];
  for (const c of cases) {
    const tally = {};
    for (let i = 0; i < runs; i++) {
      try {
        const r = await decide(c.question, { client, bot: null, goal: {}, tree: JSON.parse(JSON.stringify(c.tree)), state: c.state });
        const k = r.noneGood ? 'none_good' : r.path[0];
        tally[k] = (tally[k] || 0) + 1;
      } catch (err) { tally[`error: ${err.message.slice(0, 60)}`] = (tally[`error: ${err.message.slice(0, 60)}`] || 0) + 1; }
    }
    const hit = Object.entries(tally).filter(([k]) => c.expect.includes(k)).reduce((n, [, v]) => n + v, 0);
    const bad = Object.entries(tally).filter(([k]) => c.forbid.includes(k)).reduce((n, [, v]) => n + v, 0);
    const pass = hit > runs / 2 && bad <= runs / 3;
    results.push({ name: c.name, pass, known: c.known || null, tally, expect: c.expect, forbid: c.forbid, note: c.note });
    // A known gap is listed, not failed: it is work to do, not a regression.
    console.log(`${pass ? 'pass' : c.known ? 'KNOWN' : 'FAIL'}  ${c.name.padEnd(34)} ${JSON.stringify(tally)}${pass ? '' : `  expected ${c.expect.join('|')}${c.forbid.length ? `, never ${c.forbid.join('|')}` : ''}`}`);
  }
  const passed = results.filter(r => r.pass).length, known = results.filter(r => !r.pass && r.known).length;
  console.log(`\n${passed} of ${results.length} passed${known ? `, ${known} known gap${known === 1 ? '' : 's'} still open` : ''}`);
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(path.join('artifacts', `replay-suite-${Date.now().toString(36)}.json`), JSON.stringify(results, null, 2));
  if (passed + known < results.length) process.exitCode = 1;
})().catch(err => { console.error(err); process.exitCode = 1; });
