'use strict';
// Is main better than the pinned baseline? The two-arm trials (note 666,
// scripts/lib/arms.js) compared over a window: per arm, the Nether hours, the
// fortress hours (and those with a blaze in sight), deaths per Nether hour by
// cause, rods per fortress hour, fights with blazes and the deaths in those
// at four or more blazes, and the midgame trials begun in the window with
// their passes, loops and strandings from the verdicts; each with its 95%
// interval, and main against each other arm as a ratio with its interval and
// p. scripts/lib/ab.js says how each is counted.
//   node scripts/ab-report.js [--since <iso>] [--to <iso>] [--json] [--dir <flight dir>] [--root <checkout>]
// --since defaults to the first start logged in .bot-state/arms/starts.log
// (the A/B's beginning), else the last 24 hours.
const path = require('node:path');
const ab = require('./lib/ab');
const arms = require('./lib/arms');

function main(argv = process.argv.slice(2)) {
  const opt = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
  const time = name => { const v = opt(name); if (v == null) return null; const t = Date.parse(v); if (!Number.isFinite(t)) throw new Error(`--${name} needs a time, as 2026-09-29T16:00Z`); return t; };
  const root = path.resolve(opt('root') || path.join(__dirname, '..'));
  const dir = path.resolve(opt('dir') || path.join(root, '.bot-state', 'flight'));
  const starts = arms.readStarts(root);
  const since = time('since') ?? starts.find(s => s.arm !== 'main')?.t ?? Date.now() - 86400000;
  const to = time('to') ?? Date.now();
  const say = (i, n, k) => process.stderr.write(`\r${i}/${n} ${k.slice(0, 50)}`.padEnd(70));
  const runs = ab.readRuns(dir, { from: since, to, starts, commits: arms.armCommits(root), progress: argv.includes('--json') ? null : say });
  process.stderr.write('\n');
  ab.serverCauses(runs.flatMap(r => r.deaths.map(d => Object.assign(d, { port: r.port }))), root, { since });
  const { trialRecords } = require('./trials/progress-audit');
  const trials = trialRecords({ since: since - 1, now: to, dir: path.join(root, 'artifacts', 'midgame'), flight: dir })
    .filter(t => t.start <= to).map(t => ({ ...t, arm: ab.trialArm(t, runs) }));
  const rows = ab.summarize(runs, trials), cmp = ab.compare(rows);
  if (argv.includes('--json')) console.log(JSON.stringify({ since: new Date(since).toISOString(), to: new Date(to).toISOString(), arms: rows, compare: cmp }, null, 2));
  else console.log(ab.table(rows, cmp, { since, to }));
}

if (require.main === module) { try { main(); } catch (err) { console.error(err.message); process.exit(1); } }
module.exports = { main };
