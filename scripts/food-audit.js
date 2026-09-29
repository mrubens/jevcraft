'use strict';
// Food before the fortress, from the flight records (note 664): what the bot
// carries when it enters the Nether, when it first meets blazes in a life, and
// at each blaze fight; how the carried food went (eaten, or lost with a death);
// how much of the Nether time is spent where health does not come back
// (hunger under 18); and what fighting costs in hunger. Read by tail/scan, one
// file at a time.
//   node scripts/food-audit.js [--from ISO] [--to ISO] [--dir <flight dir>] [--json]
const path = require('path');
const { eachFile, fights } = require('./blaze-record');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Date.parse(arg('--from', '2026-09-28T00:00:00Z')), TO = Date.parse(arg('--to', '2026-09-29T11:40:00Z'));
const DIR = arg('--dir', path.join(__dirname, '..', '.bot-state', 'flight'));
const foods = Object.fromEntries(require('minecraft-data')('26.1').foodsArray.map(f => [f.name, f]));
// Not counted as food carried: what the bot's own rule keeps out of the safe supply.
const UNSAFE = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken', 'suspicious_stew', 'chorus_fruit']);
const points = inv => Object.entries(inv || {}).reduce((n, [k, c]) => n + (foods[k] && !UNSAFE.has(k) ? c * foods[k].foodPoints : 0), 0);
const rawMeat = inv => Object.entries(inv || {}).reduce((n, [k, c]) => n + (/^(beef|mutton|porkchop|rabbit|cod|salmon|potato)$/.test(k) ? c : 0), 0);
const cooked = inv => Object.entries(inv || {}).reduce((n, [k, c]) => n + (foods[k] && !UNSAFE.has(k) && !/^(beef|mutton|porkchop|rabbit|cod|salmon|potato)$/.test(k) ? c * foods[k].foodPoints : 0), 0);
const slim = f => { const s = f.snapshot; if (!s) return f; return { ...f, snapshot: { health: s.health, food: s.food, dimension: s.dimension, inventory: s.inventory && Object.fromEntries(Object.entries(s.inventory).filter(([k]) => foods[k] || k === 'blaze_rod')), mobs: s.mobs && s.mobs.filter(m => m.name === 'blaze').map(m => ({ name: m.name, d: m.d, seen: m.seen })) } }; };

const bin = p => p === 0 ? '0' : p < 8 ? '1-7' : p < 24 ? '8-23' : '24+';
const BINS = ['0', '1-7', '8-23', '24+'];
const pct = (n, d) => d ? Math.round(100 * n / d) : 0;
const R = { entries: [], began: [], firstFight: [], fights: [], lives: [], otherItems: {}, eatEvents: 0, hungerLostNether: 0, hungerTime: { nether: 0, under18: 0, atMost6: 0, zeroFood: 0 }, loss: { eaten: 0, lostAtDeath: 0, other: 0 }, fightDrain: [], hourDrain: [] };

eachFile(DIR, FROM, null, (frames, file) => {
  const fl = fights(frames, { from: FROM, to: TO });
  const eatAt = [], pending = []; let prevInv = null;
  let prev = null, inN = false, life = null, lastT = null, prevPts = null, prevFood = null, netherStart = null, foodAtStart = null;
  const endLife = (t, died) => { if (life) { life.died = died; R.lives.push(life); } life = null; };
  for (const x of frames) {
    const s = x.snapshot; if (!s || !(x.at >= FROM && x.at <= TO)) continue;
    if (typeof s.health === 'number' && s.health === 0 && prev > 0) { R.loss.lostAtDeath += prevPts || 0; endLife(x.at, true); inN = false; prevPts = null; netherStart = null; }
    if (typeof s.health === 'number') prev = s.health;
    if (!s.dimension) continue;
    const n = s.dimension === 'the_nether';
    const pts = s.inventory ? points(s.inventory) : prevPts;
    if (n && !inN) {
      const wasOver = frames.length && lastT != null;
      const e = { at: x.at, file, hunger: s.food, health: s.health, pts: pts ?? 0, raw: rawMeat(s.inventory), cooked: cooked(s.inventory), fromOverworld: wasOver && life?.dim === 'overworld' };
      (e.fromOverworld ? R.entries : R.began).push(e);
      life = { entry: e, dim: 'the_nether', fights: 0 }; netherStart = x.at; foodAtStart = s.food;
    }
    if (!n && inN) { R.hourDrain.push({ ms: x.at - netherStart, drop: foodAtStart - s.food, eaten: 0 }); netherStart = null; }
    if (!life) life = { dim: s.dimension, fights: 0 };
    life.dim = s.dimension;
    if (n && lastT != null && typeof s.food === 'number') {
      const dt = x.at - lastT; if (dt > 0 && dt < 60000) {
        R.hungerTime.nether += dt; if (s.food < 18) R.hungerTime.under18 += dt; if (s.food <= 6) R.hungerTime.atMost6 += dt; if ((pts ?? 0) === 0) R.hungerTime.zeroFood += dt;
      }
    }
    // Food carried going down while hunger rose is eating; otherwise it went some other way.
    if (n && typeof s.food === 'number' && typeof prevFood === 'number') {
      if (s.food > prevFood) { eatAt.push(x.at); R.eatEvents++; } else if (s.food < prevFood) R.hungerLostNether += prevFood - s.food;
    }
    if (n && pts != null && prevPts != null && pts < prevPts && x.at - lastT < 60000) pending.push({ at: x.at, gone: prevPts - pts, items: Object.entries(prevInv || {}).filter(([k, c]) => foods[k] && !UNSAFE.has(k) && (s.inventory?.[k] || 0) < c).map(([k, c]) => [k, c - (s.inventory?.[k] || 0)]) });
    inN = n; lastT = x.at; if (pts != null) prevPts = pts; if (s.inventory) prevInv = s.inventory; if (typeof s.food === 'number') prevFood = s.food;
  }
  endLife(lastT, false);
  for (const p of pending) { if (eatAt.some(t => t >= p.at - 6000 && t <= p.at + 6000)) R.loss.eaten += p.gone; else { R.loss.other += p.gone; for (const [k, c] of p.items) R.otherItems[k] = (R.otherItems[k] || 0) + c; } }
  // Fights: the food at their start, and the hunger spent.
  const seenLife = new Set();
  for (const e of fl) {
    const f0 = frames[e.i0], inv = (() => { for (let i = e.i0; i >= 0; i--) if (frames[i].snapshot?.inventory) return frames[i].snapshot.inventory; return null; })();
    const endFrame = frames[Math.min(e.i1 ?? e.iEnd, frames.length - 1)];
    const rec = { at: e.start, ms: e.end - e.start, hp0: e.hp0, hunger0: e.hunger0, hungerEnd: endFrame?.snapshot?.food, pts: points(inv), raw: rawMeat(inv), died: e.died, rod: e.rodsGain > 0, max16: e.max16, file };
    R.fights.push(rec);
    const gap = R.fights.filter(r => r.file === file);
    if (gap.length === 1 || e.start - gap.at(-2).at > 20 * 60000) R.firstFight.push(rec);
    if (typeof rec.hungerEnd === 'number' && typeof rec.hunger0 === 'number' && rec.ms > 20000) R.fightDrain.push({ ms: rec.ms, drop: rec.hunger0 - rec.hungerEnd });
  }
}, slim);

// Each entry from the Overworld with the first fight after it in the same record (before the next entry).
const chain = R.entries.map(e => {
  const next = R.entries.filter(o => o.file === e.file && o.at > e.at).map(o => o.at).sort((a, b) => a - b)[0] ?? Infinity;
  const f = R.fights.filter(r => r.file === e.file && r.at >= e.at && r.at < next).sort((a, b) => a.at - b.at)[0];
  return f ? { entry: e.pts, atFight: f.pts, minutes: Math.round((f.at - e.at) / 60000), hungerEntry: e.hunger, hungerFight: f.hunger0 } : null;
}).filter(Boolean);
const row = list => ({ n: list.length, died: list.filter(r => r.died).length, diedPct: pct(list.filter(r => r.died).length, list.length), rodPct: pct(list.filter(r => r.rod).length, list.length) });
const dist = (list, key) => Object.fromEntries(BINS.map(b => [b, list.filter(r => bin(r[key]) === b).length]));
const mins = R.fights.map(r => r.ms / 60000).sort((a, b) => a - b), q = f => +mins[Math.min(mins.length - 1, Math.floor(mins.length * f))].toFixed(1);
const beganFed = R.fights.filter(r => r.hunger0 >= 18 && typeof r.hungerEnd === 'number');
const out = {
  fightLength: { n: mins.length, medianMinutes: q(0.5), p75Minutes: q(0.75), p90Minutes: q(0.9) },
  beganFedFellUnder18: { n: beganFed.length, fell: beganFed.filter(r => r.hungerEnd < 18).length, pct: pct(beganFed.filter(r => r.hungerEnd < 18).length, beganFed.length) },
  window: [new Date(FROM).toISOString(), new Date(TO).toISOString()],
  netherEntriesFromOverworld: { n: R.entries.length, pointsCarried: dist(R.entries, 'pts'), hungerUnder18: R.entries.filter(e => e.hunger < 18).length, withRawMeatUncooked: R.entries.filter(e => e.raw > 0).length,
    medianPoints: R.entries.map(e => e.pts).sort((a, b) => a - b)[R.entries.length >> 1] },
  lifeBeganInNether: { n: R.began.length, pointsCarried: dist(R.began, 'pts'), hungerUnder18: R.began.filter(e => e.hunger < 18).length },
  fights: { all: row(R.fights), byFoodCarried: Object.fromEntries(BINS.map(b => [b, row(R.fights.filter(r => bin(r.pts) === b))])),
    byHunger: { '18+': row(R.fights.filter(r => r.hunger0 >= 18)), 'under 18': row(R.fights.filter(r => r.hunger0 < 18)) },
    byFoodAndHunger: Object.fromEntries(BINS.flatMap(b => [['18+', r => r.hunger0 >= 18], ['<18', r => r.hunger0 < 18]].map(([h, fn]) => [`${b} carried, hunger ${h}`, row(R.fights.filter(r => bin(r.pts) === b && fn(r)))]))) },
  firstFightOfAVisit: { n: R.firstFight.length, pointsCarried: dist(R.firstFight, 'pts'), hungerUnder18: R.firstFight.filter(r => r.hunger0 < 18).length },
  netherTime: { hours: +(R.hungerTime.nether / 3600000).toFixed(1), pctHungerUnder18: pct(R.hungerTime.under18, R.hungerTime.nether), pctHungerAtMost6: pct(R.hungerTime.atMost6, R.hungerTime.nether), pctNothingToEat: pct(R.hungerTime.zeroFood, R.hungerTime.nether) },
  entryToFirstFight: { n: chain.length, meanEntryPoints: +(chain.reduce((n, c) => n + c.entry, 0) / chain.length).toFixed(1), meanAtFight: +(chain.reduce((n, c) => n + c.atFight, 0) / chain.length).toFixed(1), medianMinutes: chain.map(c => c.minutes).sort((a, b) => a - b)[chain.length >> 1], hadFoodAtEntryNoneAtFight: chain.filter(c => c.entry > 0 && c.atFight === 0).length, hadFoodAtEntry: chain.filter(c => c.entry > 0).length, hungerUnder18AtFight: chain.filter(c => c.hungerFight < 18).length, hungerUnder18AtEntry: chain.filter(c => c.hungerEntry < 18).length },
  foodPointsGone: R.loss, otherItemsGone: Object.fromEntries(Object.entries(R.otherItems).sort((a, b) => b[1] - a[1]).slice(0, 8)), eatEvents: R.eatEvents, hungerLostPerNetherHour: +(R.hungerLostNether / (R.hungerTime.nether / 3600000)).toFixed(1),
  hungerSpentFighting: (() => { const ms = R.fightDrain.reduce((n, r) => n + r.ms, 0), d = R.fightDrain.reduce((n, r) => n + r.drop, 0); return { fights: R.fightDrain.length, minutes: Math.round(ms / 60000), hungerLost: d, perMinute: ms ? +(d / (ms / 60000)).toFixed(2) : null }; })(),
  hungerPerNetherHour: (() => { const l = R.hourDrain.filter(r => r.ms > 20 * 60000 && r.drop >= 0); const ms = l.reduce((n, r) => n + r.ms, 0), d = l.reduce((n, r) => n + r.drop, 0); return { stays: l.length, hours: +(ms / 3600000).toFixed(1), netDrop: d, perHour: ms ? +(d / (ms / 3600000)).toFixed(1) : null, note: 'net of eating, so a floor' }; })(),
};
console.log(JSON.stringify(out, null, 1));
