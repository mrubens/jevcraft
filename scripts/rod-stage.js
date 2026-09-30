'use strict';
// The blaze-rod stage, from the first rod to seven carried out (note 759):
// every life in the flight records that carried a blaze rod in the Nether,
// its rods over time, its health over the fight, and how it ended: a death
// (the game's cause, the rods it dropped), out of the Nether with them, or
// the record's end (a restart mostly). At each death, the last sixty
// seconds: the questions asked and answered, the health, the blazes near,
// the fire, the food carried and eaten, and whether stash_rods, leave_and_heal
// or a box was offered and what it said. The deaths are sorted into shapes
// (SHAPES below) and ranked.
// With --ways: body_way asked in the Nether with a blaze seeing the bot, by
// whether any way offered ended out of the shooters' line, and the deaths
// within thirty seconds.
//   node scripts/rod-stage.js [--from 2026-09-29T23:00:00Z] [--to ISO] [--dir <flight dir>] [--list] [--deaths] [--json <file>] [--ways]
const path = require('path');
const fs = require('fs');
const { eachFile } = require('./blaze-record');

const WINDOW_MS = 60000;
const FOOD = /^(cooked_|baked_potato|bread|golden_carrot|golden_apple|enchanted_golden_apple|apple|carrot|pumpkin_pie|mushroom_stew|beef$|porkchop$|mutton$|chicken$|rabbit$|cod$|salmon$|rotten_flesh|sweet_berries|melon_slice)/;
const OFFERS = ['stash_rods', 'leave_and_heal', 'box_here', 'box_at_spawner', 'box_in_line', 'retreat', 'leave_reach', 'out_of_sight', 'heal_first', 'eat', 'step_out_and_eat', 'wall_in_first', 'eat_first'];
const AWAY = new Set(['leave_and_heal', 'retreat', 'leave_reach', 'out_of_sight', 'heal_first', 'stash_rods', 'eat', 'step_out_and_eat', 'eat_first', 'wall_in_first', 'take_cover', 'seal', 'bunker', 'dig_down']);
const rodsOf = inv => (inv?.blaze_rod || 0) + Math.floor((inv?.blaze_powder || 0) / 2);
const foodOf = inv => Object.entries(inv || {}).filter(([k]) => FOOD.test(k)).reduce((n, [, v]) => n + v, 0);
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
const median = a => { const b = a.filter(v => v != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };

// What a frame keeps: the big snapshots cut to what the stage reads.
function slim(f) {
  const s = f.snapshot || {}, d = s.decision;
  const blazes = (s.mobs || []).filter(m => m.name === 'blaze');
  return { at: f.at, kind: f.kind, label: f.label, detail: f.kind === 'damage' ? f.detail : undefined,
    s: { health: s.health, food: s.food, dim: s.dimension,
      rods: s.inventory ? rodsOf(s.inventory) : undefined, foodCarried: s.inventory ? foodOf(s.inventory) : undefined,
      shield: s.equipment ? s.equipment.offhand === 'shield' : undefined,
      b16: s.mobs ? blazes.filter(m => m.d <= 16).length : undefined, bSeen: s.mobs ? blazes.filter(m => m.seen && m.d <= 24).length : undefined,
      bNear: s.mobs ? r1(Math.min(...blazes.map(m => m.d), 99)) : undefined,
      death: d?.state?.recentDeaths?.[0]?.minutesAgo <= 5 ? d.state.recentDeaths[0].cause : undefined,
      decision: d && { id: d.id, choice: d.path?.at(-1), probs: d.judgments?.[0]?.probabilities,
        offered: Object.keys(d.options || {}).filter(k => OFFERS.includes(k)),
        // body_way: each way's end in or out of the shooters' line, as it said.
        lines: d.id === 'body_way' ? Object.fromEntries(Object.entries(d.options || {}).map(([k, v]) => { const t = String(typeof v === 'string' ? v : v?.description ?? ''); return [k, /Its end is out of the line/.test(t) ? 'out' : /Its end is in the line/.test(t) ? 'in' : null]; })) : undefined,
        says: Object.fromEntries(Object.entries(d.options || {}).filter(([k]) => ['stash_rods', 'leave_and_heal', 'box_here', 'box_at_spawner'].includes(k)).map(([k, v]) => [k, String(typeof v === 'string' ? v : v?.description ?? '').slice(0, 400)])) } } };
}

// The lives of one connection's frames that carried a rod in the Nether.
function lives(frames, file, { from = -Infinity, to = Infinity } = {}) {
  const out = [];
  let cur = null, prevHp = null;
  const open = t => ({ file, start: t, rods: [], startRods: null, maxRods: 0, count: 0, inNether: false, hp: [], deathAt: null, frames: [] });
  const close = (t, how) => {
    if (cur && how === 'died') cur.cause = causeAfter(frames, t);
    if (cur && cur.maxRods > 0 && cur.inNether) out.push(finish(cur, t, how));
    cur = null;
  };
  for (const x of frames) {
    const t = x.at, s = x.s;
    if (!(t >= from && t <= to)) continue;
    const hp = typeof s.health === 'number' ? s.health : null;
    if (hp === 0 && prevHp > 0) { if (cur) cur.frames.push(x); close(t, 'died'); prevHp = 0; continue; }
    if (hp === 0) { prevHp = 0; continue; }
    if (hp == null && prevHp === 0) continue;
    if (hp != null) prevHp = hp;
    cur ||= open(t);
    cur.frames.push(x);
    if (cur.frames.length > 4000) cur.frames.splice(0, 1000); // the last minutes are what a death reads
    if (s.dim === 'the_nether') cur.inNether = true;
    if (hp != null && s.dim === 'the_nether' && cur.count > 0) cur.hp.push([t, hp]);
    if (typeof s.rods === 'number') {
      if (cur.startRods == null) cur.startRods = s.rods;
      if (s.rods !== cur.count) cur.rods.push([t, s.rods, s.dim]);
      if (s.rods > 0 && s.dim === 'the_nether') cur.inNether = true;
      cur.count = s.rods; cur.maxRods = Math.max(cur.maxRods, s.rods);
    }
    if (s.dim && s.dim !== 'the_nether' && cur.count > 0 && cur.everNetherRods) { cur.leftWith = cur.count; close(t, 'left the Nether'); continue; }
    if (s.dim === 'the_nether' && cur.count > 0) cur.everNetherRods = true;
  }
  if (cur) close(cur.frames.at(-1)?.at ?? 0, 'record ended');
  return out;
}

// The game's line for a death, from the recentDeaths a later question carries.
function causeAfter(frames, t) {
  for (const x of frames) if (x.at >= t && x.at < t + 240000 && x.s.death) return x.s.death;
  return null;
}
// A life's summary; a death's last minute read.
function finish(l, t, how) {
  const firstRod = l.rods.find(([, n]) => n > 0)?.[0] ?? l.start;
  const out = { file: l.file, start: new Date(l.start).toISOString(), end: new Date(t).toISOString(), how,
    startRods: l.startRods, maxRods: l.maxRods, rodsAtEnd: l.count, leftWith: l.leftWith ?? null, gained: Math.max(0, l.maxRods - (l.startRods || 0)),
    minutesWithRods: r1((t - firstRod) / 60000), rodsOverTime: l.rods.map(([at, n]) => [r1((at - firstRod) / 60000), n]),
    minHealth: r1(Math.min(...l.hp.map(h => h[1]), 20)), lowSpells: lowSpells(l.hp) };
  if (how === 'died') out.death = { ...lastMinute(l.frames, t), cause: l.cause ?? null };
  return out;
}
// Spells at 8 health or under while carrying rods in the Nether (health back over 12 ends one).
function lowSpells(hp) {
  let n = 0, low = false;
  for (const [, h] of hp) { if (!low && h <= 8) { low = true; n++; } else if (low && h > 12) low = false; }
  return n;
}

function lastMinute(frames, t) {
  const w = frames.filter(x => x.at >= t - WINDOW_MS && x.at <= t);
  const hs = w.filter(x => typeof x.s.health === 'number' && x.s.health > 0).map(x => [x.at, x.s.health]);
  const lastHigh = [...hs].reverse().find(([, h]) => h >= 16);
  const burst = lastHigh ? r1((t - lastHigh[0]) / 1000) : null;
  const dmg = w.filter(x => x.kind === 'damage');
  const cat = d => !d ? 'other' : d.type === 'fireball' ? 'fireball' : d.type === 'on_fire' || d.type === 'in_fire' ? 'fire' : d.type === 'mob_attack' ? `blow:${d.cause}` : d.type === 'lava' ? 'lava' : d.type || 'other';
  const hurtBy = {};
  for (const x of dmg) hurtBy[cat(x.detail)] = (hurtBy[cat(x.detail)] || 0) + 1;
  const decisions = w.filter(x => x.kind === 'decision' && x.s.decision).map(x => ({ s: r1((x.at - t) / 1000), id: x.s.decision.id, choice: x.s.decision.choice, hp: r1(x.s.health), b16: x.s.b16, offered: x.s.decision.offered, probs: x.s.decision.probs }));
  const offered = {};
  for (const d of decisions) for (const k of d.offered) offered[k] = (offered[k] || 0) + 1;
  const says = {};
  for (const x of w) for (const [k, v] of Object.entries(x.s.decision?.says || {})) says[k] = v;
  let meals = 0, prevFood = null;
  for (const x of w) { if (typeof x.s.food === 'number') { if (prevFood != null && x.s.food > prevFood) meals++; prevFood = x.s.food; } }
  const last = (key, from = w) => [...from].reverse().find(x => x.s[key] !== undefined)?.s[key];
  const b16Max = Math.max(0, ...w.map(x => x.s.b16 ?? 0));
  const lowFor = hs.find(([, h]) => h <= 8);
  return { rodsLost: last('rods') ?? null, healthAt60: r1(hs[0]?.[1]), secondsFromLast16: burst, secondsAtOrUnder8: lowFor ? r1((t - lowFor[0]) / 1000) : null,
    blazesWithin16Max: b16Max, blazesWithin16AtDeath: last('b16'), nearestBlaze: last('bNear'), shield: last('shield'), foodCarried: last('foodCarried'), hunger: last('food'), meals,
    hurtBy, questions: decisions.length, decisions, offered, says };
}

// The shapes a death with rods takes, first that fits.
const SHAPES = [
  { key: 'not_blaze', says: 'not a blaze or its fire (lava, a fall, a piglin, a wither skeleton, other)', test: d => !/Blaze|burn|flames|fire/i.test(d.cause || '') },
  { key: 'burst_at_swarm', says: 'from 16 health or more to dead within 15 seconds, four or more blazes within 16', test: d => d.secondsFromLast16 != null && d.secondsFromLast16 <= 15 && d.blazesWithin16Max >= 4 },
  { key: 'stayed_low', says: 'at 8 health or under for 15 seconds or more before the death, blazes about, still in their fire', test: d => d.secondsAtOrUnder8 != null && d.secondsAtOrUnder8 >= 15 },
  { key: 'worn_down', says: 'worn down over more than 15 seconds from 16 health, four or more blazes within 16', test: d => d.blazesWithin16Max >= 4 },
  { key: 'few_blazes', says: 'with three or fewer blazes within 16', test: () => true },
];
const shapeOf = d => SHAPES.find(s => s.test(d)).key;

function report(list) {
  const nether = list;
  const died = nether.filter(l => l.how === 'died'), left = nether.filter(l => l.how === 'left the Nether'), ended = nether.filter(l => l.how === 'record ended');
  const reach = k => { const a = nether.filter(l => l.maxRods >= k); return { lives: a.length, died: a.filter(l => l.how === 'died').length, left: a.filter(l => l.how === 'left the Nether').length, ended: a.filter(l => l.how === 'record ended').length, carriedOutWith: a.filter(l => l.leftWith).map(l => l.leftWith) }; };
  const shapes = {};
  for (const l of died) { const k = shapeOf(l.death); (shapes[k] ||= []).push(l); }
  const ranked = Object.entries(shapes).sort((a, b) => b[1].length - a[1].length).map(([k, a]) => {
    const d = a.map(l => l.death);
    const count = f => d.filter(f).length;
    return { shape: k, says: SHAPES.find(s => s.key === k).says, deaths: a.length, rodsLost: a.reduce((n, l) => n + (l.death.rodsLost || 0), 0),
      medianBlazes16: median(d.map(x => x.blazesWithin16Max)), noShield: count(x => x.shield === false), foodCarried: count(x => (x.foodCarried || 0) > 0), ateInLastMinute: count(x => x.meals > 0),
      stashOffered: count(x => x.offered.stash_rods), leaveAndHealOffered: count(x => x.offered.leave_and_heal), leaveAndHealChosen: count(x => x.decisions.some(q => q.choice === 'leave_and_heal')),
      boxOffered: count(x => x.offered.box_here || x.offered.box_at_spawner || x.offered.box_in_line), awayChosen: count(x => x.decisions.some(q => AWAY.has(q.choice))),
      huntOrDeferAtFullSwarm: count(x => x.decisions.some(q => q.id === 'hunt_target' || (q.id === 'empty_spawner' && /stand_by|hunt_on/.test(q.choice)))),
      burnOut: count(x => x.decisions.some(q => q.id === 'body_way' && q.choice === 'burn_out')), fireHurts: d.reduce((n, x) => n + (x.hurtBy.fire || 0), 0), fireballs: d.reduce((n, x) => n + (x.hurtBy.fireball || 0), 0),
      medianQuestions: median(d.map(x => x.questions)), medianSecondsFromLast16: median(d.map(x => x.secondsFromLast16)) };
  });
  return {
    lives: nether.length, gainedARod: nether.filter(l => l.gained > 0).length,
    ends: { died: died.length, leftTheNether: left.length, recordEnded: ended.length, rodsLostAtDeaths: died.reduce((n, l) => n + (l.death.rodsLost || 0), 0) },
    reaching: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(k => [k, reach(k)])),
    medianMinutesWithRodsToDeath: median(died.map(l => l.minutesWithRods)),
    shapes: ranked,
  };
}

// A trial's world goes on across records (a deploy's quiet restart, a
// reconnect): a life that ended with the record and one on the same port
// begun within ten minutes carrying the same rods are one run.
const portOf = file => (file.match(/-(\d{5})-Jev-/) || [])[1];
function chain(list) {
  const out = [], open = new Map();
  for (const l of [...list].sort((a, b) => a.start.localeCompare(b.start))) {
    const p = portOf(l.file), prev = open.get(p);
    if (prev && prev.how === 'record ended' && Date.parse(l.start) - Date.parse(prev.end) < 10 * 60000 && l.startRods === prev.rodsAtEnd) {
      const merged = { ...l, start: prev.start, files: [...(prev.files || [prev.file]), l.file], startRods: prev.startRods, maxRods: Math.max(prev.maxRods, l.maxRods),
        minHealth: Math.min(prev.minHealth, l.minHealth), lowSpells: prev.lowSpells + l.lowSpells, minutesWithRods: r1(prev.minutesWithRods + l.minutesWithRods) };
      merged.gained = Math.max(0, merged.maxRods - (merged.startRods || 0));
      out[out.indexOf(prev)] = merged; open.set(p, merged);
    } else { out.push(l); open.set(p, l); }
  }
  return out;
}
// body_way in the Nether with a blaze seeing the bot (note 759): whether any
// way offered ended out of the shooters' line, and what came in the thirty
// seconds after (a death, by the health reaching zero).
function wayRows(frames, { from = -Infinity, to = Infinity } = {}) {
  const out = [];
  const deaths = [];
  let prev = null;
  for (const x of frames) { const h = x.s.health; if (typeof h === 'number') { if (h === 0 && prev > 0) deaths.push(x.at); prev = h; } }
  for (const x of frames) {
    const d = x.s.decision;
    if (!(x.at >= from && x.at <= to) || x.kind !== 'decision' || d?.id !== 'body_way' || x.s.dim !== 'the_nether' || !(x.s.bSeen > 0)) continue;
    const lines = Object.entries(d.lines || {}).filter(([k]) => k !== 'none_good');
    const said = lines.filter(([, v]) => v);
    out.push({ at: x.at, hp: x.s.health, blazes: x.s.bSeen, rods: x.s.rods ?? null, choice: d.choice, anyOut: said.some(([, v]) => v === 'out'), allIn: said.length > 0 && said.every(([, v]) => v === 'in'),
      died30: deaths.some(t => t > x.at && t - x.at <= 30000), outOfLine: lines.some(([k]) => k === 'out_of_their_line') });
  }
  return out;
}
function waysTable(rows) {
  const cell = a => ({ asked: a.length, diedWithin30s: a.filter(r => r.died30).length });
  return { asked: rows.length, everyWayEndsInTheirLine: cell(rows.filter(r => r.allIn)), aWayEndsOutOfTheirLine: cell(rows.filter(r => r.anyOut)), noLineSaid: cell(rows.filter(r => !r.allIn && !r.anyOut)),
    outOfTheirLineOffered: cell(rows.filter(r => r.outOfLine)), outOfTheirLineChosen: cell(rows.filter(r => r.choice === 'out_of_their_line')) };
}

function read(dir, from, to) {
  const all = [];
  eachFile(dir, from, '"blaze_rod"', (frames, f) => all.push(...lives(frames, f, { from, to })), slim);
  return chain(all);
}

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
  const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
  const from = Date.parse(args.from || '2026-09-29T23:00:00Z'), to = args.to ? Date.parse(args.to) : Infinity;
  if (args.ways) {
    const rows = [];
    eachFile(dir, from, '"body_way"', frames => rows.push(...wayRows(frames, { from, to })), slim);
    console.log(JSON.stringify(waysTable(rows), null, 1));
    return;
  }
  const list = read(dir, from, to);
  if (args.json) fs.writeFileSync(args.json, list.map(l => JSON.stringify(l)).join('\n') + '\n');
  if (args.list) for (const l of list) console.log(`${l.start.slice(5, 19)} ${l.file.replace(/^127_0_0_1-/, '').slice(0, 5)} rods ${l.startRods}->${l.maxRods} (${l.rodsAtEnd} at end) ${l.how}${l.leftWith ? ` with ${l.leftWith}` : ''} min hp ${l.minHealth} low spells ${l.lowSpells}${l.death ? ` :: ${l.death.cause} [${shapeOf(l.death)}] b16 ${l.death.blazesWithin16Max} last16 ${l.death.secondsFromLast16}s shield ${l.death.shield} food ${l.death.foodCarried}` : ''}`);
  if (args.deaths) for (const l of list.filter(x => x.death)) console.log(JSON.stringify({ start: l.start, file: l.file, maxRods: l.maxRods, shape: shapeOf(l.death), ...l.death, decisions: l.death.decisions.map(q => `${q.s}s hp${q.hp} ${q.id}->${q.choice}`) }));
  console.log(JSON.stringify(report(list), null, 1));
}

module.exports = { wayRows, waysTable, chain, slim, lives, lastMinute, report, shapeOf, SHAPES, read };
