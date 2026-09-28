'use strict';
// How the bot's walks back to a portal in the Nether went, from the flight
// records (note 626): each stretch of the step return_to_portal, of a
// cross_toward "the portal back" or of return_for_food, the distance to the
// portal at its start and end, how long it ran and how it ended (arrived: the
// next frame is in the Overworld; death: health reached zero; dropped: the
// stretch stopped with the bot still in the Nether, given up, set aside or
// stalled). The pace said with the trip back for food (game-progress.js
// NETHER_TRIPS) is read from this.
// With --hunts: the hunts of a hoglin for its meat instead (the food hunt Jev
// chose, survival.js foodHunt and huntStep): how many began in the Nether, how
// many brought meat and how each ended.
//   node scripts/nether-trips.js [--from 2026-09-28T00:00:00Z] [--to ISO] [--list] [--under 8] [--hunts]
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
const dir = path.join(__dirname, '..', '.bot-state', 'flight');
const from = Date.parse(args.from || '2026-09-28T00:00:00Z'), to = args.to ? Date.parse(args.to) : Infinity;
const MIN_BLOCKS = 60, MIN_SECONDS = 60, GAP_MS = 150000, IDLE_MS = 60000;

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
      // Only what is read, or a trial's records would not fit in memory.
      (byPort[m[1]] ||= []).push({ t, position: s.position, dimension: s.dimension, health: s.health, food: s.food,
        step: s.step && { action: s.step.action, what: s.step.what, target: s.step.target, portal: s.step.portal }, action: s.survivalAction?.action });
    }
  }
  const rows = [];
  for (const [port, frames] of Object.entries(byPort)) {
    frames.sort((a, b) => a.t - b.t);
    let cur = null, last = null;
    const close = (why, t) => { if (cur) { rows.push({ ...cur, end: t, why, endD: cur.lastD }); cur = null; } };
    for (const s of frames) {
      const st = s.step || {};
      const portal = st.portal || (st.what === 'the portal back' ? st.target : null);
      const active = (st.action === 'return_to_portal' && st.portal) || st.what === 'the portal back' || (s.action === 'return_for_food' && portal);
      if (last && s.t - last > GAP_MS) close('gap', last);
      if (s.health != null && s.health <= 0) { close('death', s.t); last = s.t; continue; }
      if (cur && s.dimension === 'overworld') { close('arrived', s.t); last = s.t; continue; }
      if (active && portal && s.dimension === 'the_nether') {
        const d = Math.hypot(s.position.x - portal.x, s.position.z - portal.z);
        if (!cur) cur = { port, start: s.t, startD: d, minD: d, lastD: d, health: s.health, food: s.food, lastT: s.t };
        cur.minD = Math.min(cur.minD, d); cur.lastD = d; cur.lastT = s.t;
      } else if (cur && s.t - cur.lastT > IDLE_MS) close('dropped', cur.lastT);
      last = s.t;
    }
    if (cur) close('end', cur.lastT);
  }
  return rows.sort((a, b) => a.start - b.start);
}

// The hunt's own frames repeat while it stands, so one hunt is the run of
// hunt_over frames of one ending on a port, less than five minutes apart.
function hunts() {
  const seen = {}, out = { started: 0, meat: 0, ended: {} };
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/-(\d{5})-Jev-\d{4}-\d\d-\d\dT/);
    if (!m || fs.statSync(path.join(dir, f)).mtimeMs < from) continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.includes('hunt_over')) continue;
      let r; try { r = JSON.parse(line); } catch (_) { continue; }
      const s = r.snapshot, t = Date.parse(r.at), a = [s?.survivalAction, s?.step].find(x => x?.action === 'hunt_over' && x.kind === 'hoglin');
      if (!a || s.dimension !== 'the_nether' || !(t >= from && t <= to)) continue;
      const key = `${m[1]} ${a.why}`;
      if (seen[key] && t - seen[key] < 300000) { seen[key] = t; continue; }
      seen[key] = t; out.started++; if (a.kills > 0) out.meat++;
      out.ended[a.why] = (out.ended[a.why] || 0) + 1;
    }
  }
  return out;
}
if (args.hunts) { console.log(JSON.stringify({ from: new Date(from).toISOString(), ...hunts() })); process.exit(0); }

const all = trips();
const iso = t => new Date(t).toISOString().slice(0, 19) + 'Z';
const long = all.filter(r => r.startD >= MIN_BLOCKS && (r.end - r.start) / 1000 >= MIN_SECONDS && (args.under ? r.health < Number(args.under) : true));
const sum = (list, f) => list.reduce((n, r) => n + f(r), 0);
const rate = list => sum(list, r => r.startD - r.minD) / Math.max(1, sum(list, r => (r.end - r.start) / 1000)) * 60;
if (args.list) for (const r of long) console.log(`${r.port} ${iso(r.start)} ${Math.round((r.end - r.start) / 1000)}s from ${Math.round(r.startD)} to ${Math.round(r.endD)} (best ${Math.round(r.minD)}) health ${r.health?.toFixed(1)} hunger ${r.food} ${r.why}`);
const by = {}; for (const r of long) by[r.why] = (by[r.why] || 0) + 1;
const moving = long.filter(r => r.startD - r.minD >= 20);
const arrived = all.filter(r => r.why === 'arrived');
console.log(JSON.stringify({ from: iso(from), under: args.under ? Number(args.under) : null, trips: long.length, ended: by,
  blocksAMinute: Math.round(rate(long)), movingTrips: moving.length, blocksAMinuteMoving: Math.round(rate(moving)),
  arrivedTrips: arrived.length, blocksAMinuteArrived: arrived.length ? Math.round(sum(arrived, r => r.startD - r.endD) / sum(arrived, r => (r.end - r.start) / 1000) * 60) : null }));
