'use strict';
// Trips toward a portal with 1 or more blaze rods carried, from the flight
// records (note 711, extending nether-trips.js's method, note 626): each
// stretch of the step aimed at a known portal (return_overworld, the "the
// portal back" cross_toward, or return_for_food's walk) with a rod carried,
// how it ended (out: the dimension became overworld with a rod still in the
// pack; died: health reached zero with a rod carried; turned_back: the rods
// still carried, still in the Nether, but the step left the portal's
// direction for something else, inside the recorder's own gap; dropped: no
// frame for a minute with the rods still carried and the bot still in the
// Nether) and, with --list, each stretch's own line.
//   node scripts/rod-trip-audit.js [--from 2026-09-29T00:00:00Z] [--to ISO] [--dir <flight dir>] [--list]
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
const from = Date.parse(args.from || '2026-09-29T00:00:00Z'), to = args.to ? Date.parse(args.to) : Infinity;
const GAP_MS = 150000, IDLE_MS = 60000;

function trips() {
  const byPort = {};
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/-(\d{5})-Jev-\d{4}-\d\d-\d\dT/);
    if (!m || fs.statSync(path.join(dir, f)).mtimeMs < from) continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch (_) { continue; }
      const s = r.snapshot, t = Date.parse(r.at);
      if (!s?.position || !(t >= from && t <= to)) continue;
      const rods = s.inventory?.blaze_rod || 0;
      (byPort[m[1]] ||= []).push({ t, dimension: s.dimension, health: s.health, rods,
        action: s.step?.action, portal: !!s.step?.portal, what: s.step?.what, survAction: s.survivalAction?.action });
    }
  }
  const out = [];
  for (const [port, frames] of Object.entries(byPort)) {
    frames.sort((a, b) => a.t - b.t);
    let cur = null;
    const close = (why, at) => { if (cur) { out.push({ ...cur, end: at, why }); cur = null; } };
    for (const s of frames) {
      const towardPortal = s.action === 'return_overworld' || s.action === 'return_to_portal' || s.what === 'the portal back' || (s.survAction === 'return_for_food' && s.portal);
      if (s.rods > 0 && s.health <= 0) { close('died', s.t); continue; }
      if (cur && s.dimension === 'overworld' && cur.rods > 0) { close('out', s.t); continue; }
      if (s.rods > 0 && towardPortal && s.dimension === 'the_nether') {
        if (!cur) cur = { port, start: s.t, rods: s.rods, health: s.health, lastT: s.t };
        cur.lastT = s.t; cur.rods = Math.max(cur.rods, s.rods); cur.health = s.health;
      } else if (cur && s.rods > 0 && s.dimension === 'the_nether') {
        close(s.t - cur.lastT > IDLE_MS ? 'dropped' : 'turned_back', s.t);
      } else if (cur && s.t - cur.lastT > IDLE_MS) close('dropped', cur.lastT);
    }
    if (cur) close('end', cur.lastT);
  }
  return out.sort((a, b) => a.start - b.start);
}

const all = trips();
const iso = t => new Date(t).toISOString().slice(0, 19) + 'Z';
if (args.list) for (const r of all) console.log(`${r.port} ${iso(r.start)} rods=${r.rods} ${Math.round((r.end - r.start) / 1000)}s health ${r.health?.toFixed(1)} -> ${r.why}`);
const by = {}; for (const r of all) by[r.why] = (by[r.why] || 0) + 1;
console.log(JSON.stringify({ from: iso(from), trips: all.length, ended: by }, null, 1));
