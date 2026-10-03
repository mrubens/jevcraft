'use strict';
// Note 976's before and after on recorded questions: surface_trip as asked
// with a portal site to dig out on offer, asked of Jev again. The arm is the
// checkout it runs from (the question's task is the registry's): from main,
// the options as recorded; from a worktree with --after, the dug site first
// and the two totals said on the climb, as work.js builds them now.
//   node scripts/surface-trip-reask.js [--after] [--limit 20] [--runs 2] [--dir <flight dir>] [--day 2026-10-03]
const fs = require('fs'), path = require('path');
require('../src/env').loadEnv();
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const dir = arg('dir', path.join(__dirname, '..', '.bot-state', 'flight')), day = arg('day', '2026-10-03'), limit = +arg('limit', 20), runs = +arg('runs', 2), after = !!arg('after', false);
(async () => {
  const { TypeSafe } = require('../src/typesafe');
  const { decide } = require('../src/decisions');
  const client = new TypeSafe();
  const qs = [];
  for (const f of fs.readdirSync(dir).filter(f => f.includes(day)).sort()) for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!l.includes('"id":"surface_trip"') || !l.includes('Dig a site for the frame out of the rock here instead')) continue;
    let d; try { d = JSON.parse(l).snapshot?.decision; } catch (_) { continue; }
    if (d?.id === 'surface_trip' && d.options?.dig_site && d.options?.climb) qs.push(d);
  }
  const step = Math.max(1, Math.floor(qs.length / limit)), sample = qs.filter((_, i) => i % step === 0).slice(0, limit);
  const tally = {}, recorded = {};
  for (const q of sample) {
    recorded[q.path[0]] = (recorded[q.path[0]] || 0) + 1;
    let tree = Object.fromEntries(Object.entries(q.options).filter(([k]) => k !== 'none_good').map(([k, v]) => [k, { description: typeof v === 'string' ? v : v.description }]));
    if (after) {
      const secs = (tree.dig_site.description.match(/about (\d+) seconds and \d+ pickaxe uses/) || [])[1], off = (tree.dig_site.description.match(/, (\d+) blocks from here/) || [])[1];
      const up = q.state?.minutesUp ? q.state.minutesUp * 60 : null;
      if (secs && up) tree.climb.description += ` Against the site dug out here: about ${secs} seconds of digging and the frame is begun ${off ? `${off} blocks from here` : 'where the bot stands'}; the climb is about ${up} seconds before a site is even looked for up top.`;
      tree = { dig_site: tree.dig_site, ...Object.fromEntries(Object.entries(tree).filter(([k]) => k !== 'dig_site')) };
    }
    for (let i = 0; i < runs; i++) {
      let k; try { const r = await decide('surface_trip', { client, bot: null, goal: {}, tree: JSON.parse(JSON.stringify(tree)), state: q.state }); k = r.noneGood ? 'none_good' : r.path[0]; } catch (err) { k = 'error'; }
      tally[k] = (tally[k] || 0) + 1;
    }
  }
  console.log(JSON.stringify({ arm: after ? 'after' : 'before', questions: sample.length, of: qs.length, runs, recorded, answers: tally }));
  process.exit(0);
})();
