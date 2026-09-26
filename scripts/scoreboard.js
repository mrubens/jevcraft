'use strict';
// The midgame trials scored by the code that ran them: deaths and loops per
// trial-hour, how soon the Nether came, and where the minutes before it went.
// A fix is judged by these numbers moving, not by the death it answered (the
// user, 2026-09-26: "do you feel like we're making progress?").
//
//   node scripts/scoreboard.js [--size 6] [--json]
//
// Each moment of a trial is charged to the code then running: the newest
// "Trial notes: N" commit before it (the bots are restarted on every commit).
// Eras are runs of `size` note numbers.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { analyse } = require('./lib/audit');

const ROOT = path.join(__dirname, '..');
const LIMIT_MS = 3 * 3600000;
const args = process.argv.slice(2);
const SIZE = Number(args[args.indexOf('--size') + 1]) || 6;

// The note number in force at each commit time, oldest first.
const commits = execSync('git log --format=%ct%x09%s', { cwd: ROOT }).toString().split('\n')
  .map(l => { const [t, s] = l.split('\t'); const m = /Trial notes: ([\d, ]+)/.exec(s || ''); return m ? { t: Number(t) * 1000, n: Math.max(...m[1].split(/[, ]+/).filter(Boolean).map(Number)) } : null; })
  .filter(Boolean).sort((a, b) => a.t - b.t);
let high = 0;
for (const c of commits) { high = Math.max(high, c.n); c.n = high; }
const noteAt = t => { let n = null; for (const c of commits) { if (c.t <= t) n = c.n; else break; } return n; };
const eraOf = n => n === null ? 'before' : `${Math.floor(n / SIZE) * SIZE}-${Math.floor(n / SIZE) * SIZE + SIZE - 1}`;

const dir = path.join(ROOT, 'artifacts', 'midgame');
const trials = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

const eras = {};
const era = key => eras[key] ||= { minutes: 0, deaths: 0, loops: 0, trials: 0, nether: 0, toNether: [], before: {} };
const rows = [];
for (const [i, trial] of trials.entries()) {
  const from = Date.parse(trial.startedAt);
  const next = trials.slice(i + 1).find(t => t.port === trial.port);
  const to = Math.min(Date.now(), from + LIMIT_MS, next ? Date.parse(next.startedAt) : Infinity);
  const a = analyse({ identity: `127_0_0_1-${trial.port}-Jev`, from, to });
  if (!a) continue;
  // Exposure: minutes with frames, charged minute by minute to the code then.
  const seen = new Set(a.frames.map(f => Math.floor(f.t / 60000)));
  for (const m of seen) era(eraOf(noteAt(m * 60000))).minutes++;
  const deaths = [];
  for (const t of a.deaths.map(d => d.t).sort((x, y) => x - y)) if (!deaths.some(d => Math.abs(d - t) < 10000)) deaths.push(t);
  for (const t of deaths) era(eraOf(noteAt(t))).deaths++;
  const loops = [...Object.values(a.problems).filter(v => v.count >= 3).map(v => v.first ?? from), ...a.flips.map(f => f.from ?? from)];
  for (const t of loops) era(eraOf(noteAt(t))).loops++;
  const nether = a.frames.find(f => /nether/.test(String(f.snapshot?.dimension || '')));
  const startEra = era(eraOf(noteAt(from)));
  startEra.trials++;
  // Where the minutes before the Nether (or the whole trial) went: the work
  // step each observation second was charged to by the audit.
  const until = nether ? nether.t : to;
  const before = {};
  let last = null;
  for (const f of a.obs) {
    if (f.t > until) break;
    const step = a.survivalOf(f.snapshot) && f.snapshot?.survivalAction?.at && f.t - Date.parse(f.snapshot.survivalAction.at) < 8000 ? `survival:${a.survivalOf(f.snapshot)}` : a.stepOf(f.snapshot) || 'none';
    if (last) { const dt = Math.min(5000, f.t - last); before[step] = (before[step] || 0) + dt; }
    last = f.t;
  }
  for (const [k, ms] of Object.entries(before)) startEra.before[k] = (startEra.before[k] || 0) + ms;
  if (nether) { startEra.nether++; startEra.toNether.push(Math.round((nether.t - from) / 60000)); }
  rows.push({ world: trial.world, note: noteAt(from), minutes: Math.round((to - from) / 60000), deaths: deaths.length, loops: loops.length,
    netherAtMinute: nether ? Math.round((nether.t - from) / 60000) : null, rods: trial.verdict?.most?.blazeRods ?? 0, pearls: trial.verdict?.most?.enderPearls ?? 0 });
}

const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const table = Object.entries(eras).sort(([a], [b]) => (a === 'before' ? -1 : b === 'before' ? 1 : parseInt(a) - parseInt(b))).map(([key, e]) => {
  const hours = e.minutes / 60;
  const top = Object.entries(e.before).sort(([, a], [, b]) => b - a).slice(0, 5).map(([k, ms]) => `${k} ${Math.round(ms / 60000)}m`);
  return { notes: key, trials: e.trials, trialHours: Math.round(hours * 10) / 10, deathsPerHour: hours ? Math.round(e.deaths / hours * 100) / 100 : null,
    loopsPerHour: hours ? Math.round(e.loops / hours * 100) / 100 : null, reachedNether: `${e.nether}/${e.trials}`, medianMinutesToNether: median(e.toNether), timeBeforeNether: top };
});
if (args.includes('--json')) { console.log(JSON.stringify({ eras: table, trials: rows }, null, 2)); process.exit(0); }
console.log('notes    trials  hours  deaths/h  loops/h  nether  median min to nether');
for (const r of table) console.log(`${r.notes.padEnd(9)}${String(r.trials).padStart(6)}${String(r.trialHours).padStart(7)}${String(r.deathsPerHour ?? '-').padStart(10)}${String(r.loopsPerHour ?? '-').padStart(9)}${r.reachedNether.padStart(8)}${String(r.medianMinutesToNether ?? '-').padStart(8)}`);
const all = {};
for (const e of Object.values(eras)) for (const [k, ms] of Object.entries(e.before)) all[k] = (all[k] || 0) + ms;
const total = Object.values(all).reduce((a, b) => a + b, 0) || 1;
console.log(`\nAll the time before the Nether, ${Math.round(total / 3600000 * 10) / 10} hours: ${Object.entries(all).sort(([, a], [, b]) => b - a).slice(0, 14).map(([k, ms]) => `${k} ${Math.round(ms / total * 100)}%`).join(', ')}`);
console.log(`Trials that reached the Nether: ${rows.filter(r => r.netherAtMinute !== null).length} of ${rows.length}; minutes: ${rows.filter(r => r.netherAtMinute).map(r => r.netherAtMinute).sort((a, b) => a - b).join(', ')}`);
console.log('\nWhere the minutes before the Nether went (trials started in each era):');
for (const r of table) console.log(`  ${r.notes}: ${r.timeBeforeNether.join(', ')}`);
