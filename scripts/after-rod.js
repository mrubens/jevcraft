'use strict';
// What came after a blaze rod was picked up in the Nether (note 659), from the
// flight records: for each rod gained in a life (the count carried going up,
// powder made of rods counting half a rod a piece, as blaze-record.js --runs
// counts them), what came first after it: the bot's death, another rod, the
// bot out of the Nether, or the record's end; with the seconds to it. Each is
// split by what the bot did first after the rod (the first answer to
// encounter_stance or hunt_target within sixty seconds, by blaze-record.js's
// kinds: 'heal' (leave_and_heal, eat) and 'retreat' (retreat, leave_reach) are
// going away; a strike, a fight, cover or the work are staying; no answer in
// the minute is said apart) and by the health it had at the rod. src/after-rod.js
// holds the numbers this printed, said to Jev after a rod.
//   node scripts/after-rod.js [--from 2026-09-28T00:00:00Z] [--to ISO] [--dir <flight dir>] [--list] [--held]
const fs = require('fs');
const path = require('path');
const { eachFile } = require('./blaze-record');
const { CLASS_OF } = require('../src/blaze-record');

const FIRST_ANSWER_MS = 60000;
const ANSWER_IDS = new Set(['encounter_stance', 'hunt_target']);
const AWAY = new Set(['heal', 'retreat']);
const equivalent = inv => (inv.blaze_rod || 0) + Math.floor((inv.blaze_powder || 0) / 2);

// The rods gained in one connection's frames (sorted by time), each with what
// came first after it. -> [{ at, health, rods, did, first, seconds }]
function afterRods(frames, { from = -Infinity, to = Infinity } = {}) {
  const out = [];
  let count = null, prevHp = null, open = [];
  const settle = (t, first) => { for (const r of open) { r.first = first; r.seconds = Math.round((t - r.at) / 1000); out.push(r); } open = []; };
  for (const x of frames) {
    const t = x.at, s = x.snapshot || {};
    if (!(t >= from && t <= to)) continue;
    const hp = typeof s.health === 'number' ? s.health : null;
    if (hp === 0 && prevHp > 0) { settle(t, 'died'); count = null; prevHp = 0; continue; }
    if (hp === 0) { prevHp = 0; continue; }
    if (hp != null) prevHp = hp;
    // The first answer after each open rod, within the minute.
    const d = s.decision;
    if (x.kind === 'decision' && d && ANSWER_IDS.has(d.id) && d.path?.length) {
      const choice = d.path.at(-1);
      for (const r of open) if (!r.did && t - r.at <= FIRST_ANSWER_MS) r.did = CLASS_OF[choice] ? (AWAY.has(CLASS_OF[choice]) ? 'away' : 'stayed') : choice === 'defer' ? 'stayed' : 'other', r.choice = choice;
    }
    if (s.dimension && s.dimension !== 'the_nether' && open.length) settle(t, 'left the Nether');
    if (!s.inventory) continue;
    const n = equivalent(s.inventory);
    if (count !== null && n > count && s.dimension === 'the_nether') {
      settle(t, 'another rod');
      open.push({ at: t, health: Math.round((hp ?? 0) * 10) / 10, food: s.food ?? null, rods: n, did: null, choice: null });
    }
    count = n;
  }
  if (open.length) settle(frames.at(-1)?.at ?? 0, 'record ended');
  return out.map(r => ({ ...r, did: r.did || 'no answer in the minute' }));
}

// The rods held (note 704): each time a life in the Nether first carries `k`
// rods or more (k = 2, 3, 4), what came first after it: the death with them
// (and how many were carried at it), out of the Nether with them, or the
// record's end (a restart mostly). -> [{ at, k, rods, first, seconds, lost }]
function heldRods(frames, { from = -Infinity, to = Infinity, ks = [2, 3, 4] } = {}) {
  const out = [];
  let open = [], reached = new Set(), prevHp = null, count = 0;
  const settle = (t, first) => { for (const r of open) out.push({ ...r, first, seconds: Math.round((t - r.at) / 1000), ...(first === 'died' ? { lost: count } : {}) }); open = []; };
  for (const x of frames) {
    const t = x.at, s = x.snapshot || {};
    if (!(t >= from && t <= to)) continue;
    const hp = typeof s.health === 'number' ? s.health : null;
    if (hp === 0 && prevHp > 0) { settle(t, 'died'); reached = new Set(); prevHp = 0; count = 0; continue; }
    if (hp === 0) { prevHp = 0; continue; }
    if (hp != null) prevHp = hp;
    if (s.dimension && s.dimension !== 'the_nether') { if (open.length) settle(t, 'left the Nether'); reached = new Set(); }
    if (!s.inventory) continue;
    count = equivalent(s.inventory);
    if (s.dimension !== 'the_nether') continue;
    for (const k of ks) if (count >= k && !reached.has(k)) { reached.add(k); open.push({ at: t, k, rods: count, health: Math.round((hp ?? 0) * 10) / 10 }); }
  }
  if (open.length) settle(frames.at(-1)?.at ?? 0, 'record ended');
  return out;
}
function heldTable(list) {
  return Object.fromEntries([...new Set(list.map(r => r.k))].sort().map(k => {
    const a = list.filter(r => r.k === k), by = f => a.filter(r => r.first === f);
    const died = by('died');
    return [`${k} or more`, { n: a.length, died: died.length, left: by('left the Nether').length, ended: by('record ended').length,
      medianSecondsToDeath: median(died.map(r => r.seconds)), diedWithin5Minutes: died.filter(r => r.seconds <= 300).length,
      rodsLostAtTheDeaths: died.reduce((n, r) => n + (r.lost || 0), 0), medianSecondsToLeave: median(by('left the Nether').map(r => r.seconds)) }];
  }));
}

const median = a => { const b = a.filter(v => v != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const band = h => h > 16 ? 'over 16' : h > 8 ? '8 to 16' : 'under 8';
// Counts by what came first, for a list of rods.
function tally(list) {
  const by = k => list.filter(r => r.first === k);
  const died = by('died');
  return { rods: list.length, died: died.length, diedWithin3Minutes: died.filter(r => r.seconds <= 180).length, medianSecondsToDeath: median(died.map(r => r.seconds)),
    anotherRod: by('another rod').length, leftTheNether: by('left the Nether').length, recordEnded: by('record ended').length };
}
function table(list) {
  const groups = (key) => Object.fromEntries([...new Set(list.map(key))].sort().map(k => [k, tally(list.filter(r => key(r) === k))]));
  return { all: tally(list), byWhatItDidFirst: groups(r => r.did), byHealthAtTheRod: groups(r => band(r.health)), byHungerAtTheRod: groups(r => (r.food ?? 20) >= 18 ? '18 or more' : 'under 18'), byRodsCarried: groups(r => r.rods >= 3 ? '3 or more' : String(r.rods)),
    byHealthAndWhatItDidFirst: Object.fromEntries(['over 16', '8 to 16', 'under 8'].map(b => [b, Object.fromEntries(['stayed', 'away', 'no answer in the minute'].map(d => [d, tally(list.filter(r => band(r.health) === b && r.did === d))]))])),
    stayedByRodsCarried: Object.fromEntries(['1', '2', '3 or more'].map(k => [k, tally(list.filter(r => r.did === 'stayed' && (r.rods >= 3 ? '3 or more' : String(r.rods)) === k))])) };
}

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
  const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
  const from = Date.parse(args.from || '2026-09-28T00:00:00Z'), to = args.to ? Date.parse(args.to) : Date.now();
  const all = [];
  const slim = f => ({ at: f.at, kind: f.kind, snapshot: f.snapshot && { health: f.snapshot.health, food: f.snapshot.food, dimension: f.snapshot.dimension,
    inventory: f.snapshot.inventory && { blaze_rod: f.snapshot.inventory.blaze_rod, blaze_powder: f.snapshot.inventory.blaze_powder },
    decision: f.kind === 'decision' && f.snapshot.decision ? { id: f.snapshot.decision.id, path: f.snapshot.decision.path } : undefined } });
  if (args.held) {
    const held = [];
    eachFile(dir, from, '"blaze_rod"', frames => held.push(...heldRods(frames, { from, to })), slim);
    console.log(JSON.stringify({ from: new Date(from).toISOString(), last: held.length ? new Date(Math.max(...held.map(r => r.at))).toISOString() : null, ...heldTable(held) }, null, 1));
    return;
  }
  eachFile(dir, from, '"blaze_rod"', frames => all.push(...afterRods(frames, { from, to })), slim);
  const last = all.length ? new Date(Math.max(...all.map(r => r.at))).toISOString() : null;
  console.log(JSON.stringify({ from: new Date(from).toISOString(), lastRod: last, ...table(all), ...(args.list ? { list: all.map(r => ({ ...r, at: new Date(r.at).toISOString() })) } : {}) }, null, 1));
}
module.exports = { afterRods, heldRods, heldTable, tally, table };
