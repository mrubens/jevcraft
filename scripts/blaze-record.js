'use strict';
// What the bot's fights with blazes came to, from the flight records (note
// 631): a fight is a run of frames in the Nether with a blaze within 24
// blocks in sight, or the bot hurt by a blaze's fireball or blow, a gap of
// 30 seconds ending it (runs under 3 seconds dropped); it ended in a death
// (the health reached zero inside it), a rod (more blaze rods carried than
// at its start) or neither. Said by the health and the hunger the bot began
// it at, the most blazes within 16 blocks at once (three or more: a
// spawner's), and the iron armour worn. src/blaze-record.js holds the
// numbers this printed for 2026-09-28; the questions say the row the bot is
// in.
// With --landings: what one fireball that lands costs (the hit, and the
// ticks of fire before the next landing or a gap), for combat-estimate
// FIRE_TICKS. With --deaths: the deaths by a blaze or its fire: the damage of
// their last sixty seconds (fireball, fire, blaze blows, other) and the
// health the bot had before its last landing.
//   node scripts/blaze-record.js [--from 2026-09-28T00:00:00Z] [--to ISO] [--landings | --deaths] [--dir <flight dir>]
const fs = require('fs');
const path = require('path');

const GAP_MS = 30000, MIN_MS = 3000, RANGE = 24;
const isBlazeHurt = d => d && ((d.type === 'fireball' && d.cause === 'blaze') || (d.type === 'mob_attack' && d.cause === 'blaze'));
const IRON = /^(iron|diamond|netherite)_/;

// The fights in one connection's frames (sorted by time). Each frame: { at,
// kind, detail, snapshot: { health, food, dimension, mobs, inventory, equipment } }.
function fights(frames, { from = -Infinity, to = Infinity } = {}) {
  const out = [];
  let rods = null, hp = null, food = null, equip = null, prevHp = null, ep = null;
  const close = (t, died) => { if (ep) { ep.end = t; ep.died = died; ep.rodsGain = Math.max(0, (rods ?? ep.rods0) - ep.rods0); out.push(ep); ep = null; } };
  for (const x of frames) {
    const t = typeof x.at === 'number' ? x.at : Date.parse(x.at), s = x.snapshot || {};
    if (!(t >= from && t <= to)) continue;
    if (s.inventory) rods = s.inventory.blaze_rod || 0;
    if (s.equipment) equip = s.equipment;
    if (typeof s.food === 'number') food = s.food;
    if (typeof s.health === 'number') { if (s.health === 0 && prevHp > 0) close(t, true); prevHp = s.health; hp = s.health; }
    const blazes = (s.mobs || []).filter(m => m.name === 'blaze');
    const hurt = x.kind === 'damage' && isBlazeHurt(x.detail);
    if (s.dimension === 'the_nether' && (hurt || blazes.some(m => m.seen && m.d <= RANGE))) {
      if (ep && t - ep.last > GAP_MS) close(ep.last, false);
      ep ||= { start: t, hp0: hp, hunger0: food, rods0: rods ?? 0, max16: 0, landings: 0, last: t,
        iron: equip ? ['head', 'torso', 'legs', 'feet'].filter(k => IRON.test(equip[k] || '')).length : null };
      ep.last = t;
    }
    if (ep) {
      if (t - ep.last > GAP_MS) close(ep.last, false);
      else {
        if (blazes.length) ep.max16 = Math.max(ep.max16, blazes.filter(m => m.d <= 16).length);
        if (hurt && x.detail.type === 'fireball') ep.landings++;
      }
    }
  }
  if (ep) close(ep.last, false);
  return out.filter(e => e.end - e.start >= MIN_MS);
}

const pct = (n, of) => of ? Math.round(100 * n / of) : 0;
function row(list) {
  return { fights: list.length, died: list.filter(e => e.died).length, diedPct: pct(list.filter(e => e.died).length, list.length),
    rodFights: list.filter(e => e.rodsGain > 0).length, rodPct: pct(list.filter(e => e.rodsGain > 0).length, list.length), rods: list.reduce((n, e) => n + e.rodsGain, 0) };
}
function tables(list) {
  const by = (key, keys) => Object.fromEntries(keys.map(k => [k, row(list.filter(e => key(e) === k))]));
  return {
    all: row(list),
    health: by(e => (e.hp0 ?? 20) > 16 ? 'over 16' : (e.hp0 ?? 20) > 8 ? '8 to 16' : 'under 8', ['over 16', '8 to 16', 'under 8']),
    hunger: by(e => e.hunger0 == null ? 'unknown' : e.hunger0 >= 18 ? '18 or more' : 'under 18', ['18 or more', 'under 18']),
    blazes: by(e => e.max16 <= 1 ? 'one or none' : e.max16 === 2 ? 'two' : 'three or more', ['one or none', 'two', 'three or more']),
    iron: by(e => e.iron == null ? 'unknown' : e.iron >= 4 ? 'four pieces' : e.iron >= 2 ? 'two or three' : 'none or one', ['four pieces', 'two or three', 'none or one']),
  };
}

// Each hurt the game reported (a damage frame carries the health before the
// hit; the next frame within 400 ms with less is after it): { t, drop, cat,
// health, detail }, cat one of fireball, blaze_blow, on_fire, in_fire, other.
const catOf = d => !d ? 'other' : d.type === 'fireball' && d.cause === 'blaze' ? 'fireball' : d.type === 'mob_attack' && d.cause === 'blaze' ? 'blaze_blow' : d.type === 'on_fire' ? 'on_fire' : d.type === 'in_fire' ? 'in_fire' : 'other';
function hurts(frames) {
  const out = [];
  for (let j = 0; j < frames.length; j++) {
    const x = frames[j], h = x.snapshot?.health;
    if (x.kind !== 'damage' || typeof h !== 'number') continue;
    let drop = 0;
    for (let k = j + 1; k < frames.length && frames[k].at - x.at <= 400; k++) { const h2 = frames[k].snapshot?.health; if (typeof h2 === 'number' && h2 < h - 0.001) { drop = h - h2; break; } }
    out.push({ t: x.at, drop, cat: catOf(x.detail), health: h, detail: x.detail });
  }
  return out;
}
// The fire that follows each fireball that lands: the ticks (on_fire hurts a
// second apart) before the next landing or a gap. `isolated`: the bot was
// not alight from an earlier hurt in the six seconds before, and the fire
// burned out (a gap) rather than being relit.
function landings(frames) {
  const ev = hurts(frames), out = [];
  ev.forEach((e, i) => {
    if (e.cat !== 'fireball') return;
    const before = ev.slice(0, i).reverse().find(p => p.cat === 'on_fire' || p.cat === 'fireball');
    let ticks = 0, last = e.t, ended = 'gap';
    for (const n of ev.slice(i + 1)) {
      if (n.t - last > 1400) break;
      if (n.cat === 'fireball') { ended = 'relit'; break; }
      if (n.cat === 'on_fire') { ticks++; last = n.t; }
    }
    out.push({ hit: e.drop, ticks, ended, isolated: !before || e.t - before.t > 6000 });
  });
  return out;
}
// The deaths by a blaze or its fire, or fire after one (the game's own line
// for the death, from the recentDeaths a later question carries).
const BLAZE_DEATH = /Blaze|burned to death|went up in flames/;
function deaths(frames) {
  const ev = hurts(frames), out = [];
  let prev = null;
  frames.forEach((x, i) => {
    const h = x.snapshot?.health;
    if (typeof h !== 'number') return;
    if (h === 0 && prev > 0 && x.snapshot.dimension) {
      let msg = null;
      for (let j = i; j < frames.length && frames[j].at < x.at + 240000 && !msg; j++) {
        const rd = frames[j].kind === 'decision' && frames[j].snapshot?.decision?.state?.recentDeaths;
        if (rd && rd[0] && rd[0].minutesAgo <= 5) msg = rd[0].cause;
      }
      // A blaze in sight within 24 blocks or its fireball in the two minutes before.
      const near = frames.some(y => y.at >= x.at - 120000 && y.at <= x.at && y.snapshot?.dimension === 'the_nether' && ((y.kind === 'damage' && isBlazeHurt(y.detail)) || (y.snapshot.mobs || []).some(m => m.name === 'blaze' && m.seen && m.d <= RANGE)));
      const last = ev.filter(e => e.t >= x.at - 60000 && e.t <= x.at + 500);
      const sums = {};
      for (const e of last) sums[e.cat] = Math.round(((sums[e.cat] || 0) + e.drop) * 100) / 100;
      const ball = [...last].reverse().find(e => e.cat === 'fireball');
      out.push({ at: x.at, msg, blaze: near && BLAZE_DEATH.test(msg || ''), sums, lastLandingHealth: ball ? Math.round(ball.health * 10) / 10 : null, lastLandingSecondsBefore: ball ? Math.round((x.at - ball.t) / 100) / 10 : null, lastLandingHit: ball ? ball.drop : null });
    }
    prev = h;
  });
  return out;
}

// Every connection's frames in a day, one file at a time (a trial's records
// would not fit in memory together): `each(frames, file)`.
function eachFile(dir, from, needle, each) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl') || fs.statSync(path.join(dir, f)).mtimeMs < from) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (needle && !text.includes(needle)) continue;
    const frames = [];
    for (const line of text.split('\n')) { if (!line) continue; try { const r = JSON.parse(line); frames.push({ at: Date.parse(r.at), kind: r.kind, detail: r.detail, label: r.label, snapshot: r.snapshot }); } catch (_) { /* a torn line */ } }
    frames.sort((a, b) => a.at - b.at);
    each(frames, f);
  }
}
function readFights(dir, from, to) {
  const list = [];
  eachFile(dir, from, '"blaze"', frames => list.push(...fights(frames, { from, to })));
  return list;
}

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
  const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
  const from = Date.parse(args.from || '2026-09-28T00:00:00Z'), to = args.to ? Date.parse(args.to) : Date.parse('2026-09-29T00:00:00Z');
  if (args.landings) {
    const all = [];
    eachFile(dir, from, '"fireball"', frames => all.push(...landings(frames.filter(f => f.at >= from && f.at <= to))));
    const clean = all.filter(l => l.isolated && l.ended === 'gap'), dist = a => a.reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {});
    console.log(JSON.stringify({ landings: all.length, isolatedAndBurnedOut: clean.length, fireTicks: dist(clean.map(l => l.ticks)), hits: dist(all.map(l => Math.round(l.hit * 10) / 10)) }, null, 1));
  } else if (args.deaths) {
    const all = [];
    eachFile(dir, from, '"health":0', frames => all.push(...deaths(frames).filter(d => d.at >= from && d.at <= to)));
    const blaze = all.filter(d => d.blaze), sum = {};
    for (const d of blaze) for (const [k, v] of Object.entries(d.sums)) sum[k] = Math.round((sum[k] || 0) + v);
    const withBall = blaze.filter(d => d.lastLandingHealth != null && d.lastLandingSecondsBefore <= 15);
    const bucket = v => v <= 4 ? 'to 4' : v <= 6.5 ? '4 to 6.5' : v <= 8 ? '6.5 to 8' : v <= 12 ? '8 to 12' : 'over 12';
    console.log(JSON.stringify({ deaths: all.length, byBlazeOrItsFire: blaze.length, damageOfTheirLastMinute: sum,
      lastLandingWithinFifteenSeconds: withBall.length, healthBeforeIt: withBall.reduce((m, d) => ({ ...m, [bucket(d.lastLandingHealth)]: (m[bucket(d.lastLandingHealth)] || 0) + 1 }), {}) }, null, 1));
  } else console.log(JSON.stringify(tables(readFights(dir, from, to)), null, 1));
}
module.exports = { fights, tables, row, hurts, landings, deaths, readFights, GAP_MS, MIN_MS };
