#!/usr/bin/env node
'use strict';
// The game's funnel by the commit each fresh trial started on (Fable's
// check-in of 2026-10-01 17:10Z: "track the funnel per deploy commit"):
// of the trials begun on a commit, the share in the Nether by 30, 45 and 60
// minutes played, and of those that entered, the share that sighted a
// fortress within 30 minutes of entering. A trial counts toward a mark only
// once it has run that long or reached it first (younger ones are left out
// of that mark, not counted as misses). Saved stages (a fortress or Nether
// start) are left out: they begin past the first marks.
//
//   node scripts/funnel.js [--since ISO] [--min N]
//
// --min: leave out commits with fewer than N trials at the 30-minute mark
// (default 1).
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const since = Date.parse(opt('--since', '2026-10-01T00:00:00Z'));
const min = Number(opt('--min', 1));
const MARKS = [30, 45, 60], FORTRESS_WITHIN = 30;

const dir = path.join(ROOT, 'artifacts', 'midgame');
const rows = [];
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
  let r; try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
  const start = Date.parse(r.startedAt);
  if (!(start >= since) || /\/stages\/(fortress|nether)\//.test(r.source || '')) continue;
  const v = r.verdict || {}, at = v.reachedAtMinute || {};
  rows.push({ commit: r.commit || '?', start, played: Number(v.playedMinutes) || 0, nether: Number.isFinite(at.nether) ? at.nether : null, fortress: Number.isFinite(at.fortress) ? at.fortress : null });
}

const by = new Map();
for (const r of rows) { if (!by.has(r.commit)) by.set(r.commit, []); by.get(r.commit).push(r); }
const pct = (n, d) => d ? `${Math.round(100 * n / d)}% (${n}/${d})` : '-';
const order = [...by.entries()].sort((a, b) => Math.min(...a[1].map(r => r.start)) - Math.min(...b[1].map(r => r.start)));
console.log(`Fresh trials since ${new Date(since).toISOString()}: ${rows.length}, by the commit each started on.`);
console.log(['commit', 'first start', 'trials', ...MARKS.map(m => `Nether by ${m}`), `fortress within ${FORTRESS_WITHIN} of entry`].join('\t'));
for (const [commit, list] of order) {
  const cells = MARKS.map(m => {
    const judged = list.filter(r => r.played >= m || (r.nether !== null && r.nether <= m));
    return { judged: judged.length, cell: pct(judged.filter(r => r.nether !== null && r.nether <= m).length, judged.length) };
  });
  if (cells[0].judged < min) continue;
  const entered = list.filter(r => r.nether !== null && (r.played >= r.nether + FORTRESS_WITHIN || (r.fortress !== null && r.fortress - r.nether <= FORTRESS_WITHIN)));
  const fort = entered.filter(r => r.fortress !== null && r.fortress - r.nether <= FORTRESS_WITHIN).length;
  console.log([commit, new Date(Math.min(...list.map(r => r.start))).toISOString().slice(11, 16), list.length, ...cells.map(c => c.cell), pct(fort, entered.length)].join('\t'));
}
