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
// With --recent: the rows of src/blaze-record.js RECENT (a spawner's fights against
// the rest, by blazes at once, with the rods each death cost) and IRON_LOST.
// With --ways: what followed each body_way answer in a fight with blazes, by the
// blazes within 16 (rows for src/blaze-record.js WAYS).
// With --by-commit: the fights table's headline row for each commit the bot
// ran (the connection frame's commit, src/recorder/commit.js; records
// without one are 'unknown'), not split by a clock time.
// With --records <file>: every fight described (setting, gear, stance chain, kills,
// damage, sight, the rod's timing; see describe) one JSON line each; with --wins
// and --sequence: the rod fights against the deaths, and the stance chains.
// With --counts (note 665): the fights at a live blaze spawner by the most blazes within 16 at once,
// the fights with none by the same, the fights at four or more by the nearest the bot was to the
// cage, and the clock: how long after a fight began four were within 16, and a first rod, and a
// death (rows for src/blaze-record.js COUNTS).
// With --runs (note 648): the funnel per run, a run being one life of the bot
// (a file's first frame, or the first frame after a respawn, to the death or the
// end of the record): the most rods it carried (a rod made into two powder
// counts as a rod), whether it was in the Nether, whether it died, and how long
// after its last rod, with the count of runs reaching 1, 3, 6 and 7 rods, and
// how many of those were alive at the end; a run that began with rods in hand (a
// stage start from a save) counts in `reaching` and not in `gainingInTheRun`.
// The seconds to a death are counted from the last rod, or from the run's start
// when it was carrying its rods from the first frame.
//   node scripts/blaze-record.js [--from 2026-09-28T00:00:00Z] [--to ISO] [--landings | --deaths | --by-commit | --runs | --records <file> | --wins | --sequence [--records-in <file>]] [--dir <flight dir>]
const fs = require('fs');
const path = require('path');

const GAP_MS = 30000, MIN_MS = 3000, RANGE = 24;
const isBlazeHurt = d => d && ((d.type === 'fireball' && d.cause === 'blaze') || (d.type === 'mob_attack' && d.cause === 'blaze'));
const IRON = /^(iron|diamond|netherite)_/;

// The fights in one connection's frames (sorted by time). Each frame: { at,
// kind, detail, snapshot: { health, food, dimension, mobs, inventory, equipment } }.
function fights(frames, { from = -Infinity, to = Infinity } = {}) {
  const out = [];
  let cur = 0, rods = null, hp = null, food = null, equip = null, prevHp = null, ep = null;
  const close = (t, died) => { if (ep) { ep.iEnd = died ? cur : ep.i1; ep.end = t; ep.died = died; ep.rodsGain = Math.max(0, (rods ?? ep.rods0) - ep.rods0); out.push(ep); ep = null; } };
  for (let idx = 0; idx < frames.length; idx++) {
    const x = frames[idx]; cur = idx;
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
      ep ||= { i0: idx, start: t, hp0: hp, hunger0: food, rods0: rods ?? 0, max16: 0, landings: 0, last: t,
        iron: equip ? ['head', 'torso', 'legs', 'feet'].filter(k => IRON.test(equip[k] || '')).length : null };
      ep.last = t; ep.i1 = idx;
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
// `slim` maps each parsed frame to what the caller keeps (a big file's frames
// are heavy).
function eachFile(dir, from, needle, each, slim = null) {
  for (const f of fs.readdirSync(dir)) {
    // A record the janitor archived while this read is gone: skipped, not an error.
    let text;
    try {
      if (!f.endsWith('.jsonl') || fs.statSync(path.join(dir, f)).mtimeMs < from) continue;
      text = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch (err) { if (err.code === 'ENOENT') continue; throw err; }
    if (needle && !text.includes(needle)) continue;
    const frames = [];
    for (const line of text.split('\n')) { if (!line) continue; try { const r = JSON.parse(line); const frame = { at: Date.parse(r.at), kind: r.kind, detail: r.detail, label: r.label, snapshot: r.snapshot }; frames.push(slim ? slim(frame) : frame); } catch (_) { /* a torn line */ } }
    frames.sort((a, b) => a.at - b.at);
    each(frames, f);
  }
}
function readFights(dir, from, to) {
  const list = [];
  eachFile(dir, from, '"blaze"', frames => list.push(...fights(frames, { from, to })));
  return list;
}

// How each fight went (note 645): the setting, the gear, the stances chosen
// in order with their timing, the kills, the damage, whether the blazes were
// in sight, and how a rod came. `describe(frames, fight)` reads the frames a
// fight (from fights(), which keeps their indices) covers. A kill is a blaze
// that was within 5 blocks in one frame carrying the mobs and gone from the
// next within 4 seconds (an estimate: the record has no kill frame; about
// half of a blaze's kills drop a rod, and `rodNearKill` checks the two agree).
const STANCE_IDS = new Set(['encounter_stance', 'hunt_target', 'fortress_visit', 'body_way']);
const SWORD = ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'netherite_sword'];
const median = a => { const b = a.filter(v => v != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const round1 = v => v == null ? null : Math.round(v * 10) / 10;
function describe(frames, e) {
  const after = [];
  for (let i = e.i0; i < frames.length && frames[i].at <= e.end + 30000; i++) after.push(frames[i]);
  const W = after.filter(x => x.at >= e.start - 1 && x.at <= e.end + 2000);
  const first = W[0]?.snapshot || {};
  const mobFrames = W.filter(x => x.snapshot?.mobs);
  const blazesOf = x => (x.snapshot.mobs || []).filter(m => m.name === 'blaze');
  const at = x => (x.at - e.start) / 1000;
  // Blazes: at the start (distinct ones within 24 in the first six seconds), at the peak, within 16 and within 8.
  const startIds = new Set(); let peak24 = 0, peak16 = 0, peak8 = 0;
  for (const x of mobFrames) {
    const b = blazesOf(x);
    if (x.at - e.start <= 6000) b.filter(m => m.d <= 24).forEach(m => startIds.add(m.id));
    peak24 = Math.max(peak24, b.filter(m => m.d <= 24).length); peak16 = Math.max(peak16, b.filter(m => m.d <= 16).length); peak8 = Math.max(peak8, b.filter(m => m.d <= 8).length);
  }
  // Time with one blaze within 16 against several (of the frames with a blaze within 16), and sight: frames with a blaze seen within 24, the breaks of 3 seconds or more.
  let solo = 0, multi = 0, seenT = 0, unseenT = 0, breaks = 0, lostSince = null, counted = false, sawAny = false;
  for (let i = 0; i < mobFrames.length; i++) {
    const x = mobFrames[i], b = blazesOf(x), dt = i + 1 < mobFrames.length ? Math.min(5000, mobFrames[i + 1].at - x.at) : 0;
    const n16 = b.filter(m => m.d <= 16).length;
    if (n16 === 1) solo += dt; else if (n16 > 1) multi += dt;
    const seen = b.some(m => m.seen && m.d <= 24);
    if (seen) { seenT += dt; sawAny = true; lostSince = null; counted = false; }
    else if (sawAny) { unseenT += dt; lostSince ??= x.at; if (!counted && x.at - lostSince >= 3000) { breaks++; counted = true; } }
  }
  // Setting: a live blaze spawner within 16 in a decision's state, the drop at the bot's feet, height against the blazes, how far the bot moved.
  const decisions = W.filter(x => x.kind === 'decision' && x.snapshot?.decision);
  const states = decisions.map(x => x.snapshot.decision.state).filter(Boolean);
  const stanceStates = decisions.filter(x => x.snapshot.decision.id === 'encounter_stance').map(x => x.snapshot.decision.state).filter(Boolean);
  const spawnerNear = states.length ? states.some(s => s.spawner && s.spawner.makes === 'blaze' && s.spawner.blocksAway <= 16) : null;
  // The nearest the bot was to a live blaze spawner in the fight (its decisions' states), and the seconds from the fight's start to four blazes within 16 (note 665).
  const aways = states.filter(s => s.spawner && s.spawner.makes === 'blaze' && typeof s.spawner.blocksAway === 'number').map(s => s.spawner.blocksAway);
  const spawnerMin = aways.length ? Math.min(...aways) : null;
  const four = mobFrames.find(x => blazesOf(x).filter(m => m.d <= 16).length >= 4);
  const toFour = four ? Math.round(at(four)) : null;
  const drops = stanceStates.map(s => s.dropWithinThreeBlocks);
  const labels = W.map(x => `${x.kind}|${x.label}`);
  const spanFrames = labels.filter(l => /hold on span|cross toward|cross_level/.test(l)).length;
  const dropNear = drops.some(d => d && d.deadly && d.blocksAway <= 1), dropClose = drops.some(d => d && d.deadly);
  const terrain = spanFrames || dropNear ? 'span' : dropClose ? 'near a drop' : stanceStates.length ? 'ground' : 'unknown';
  const dy = [];
  for (const x of mobFrames) { const y = x.snapshot.position?.y; if (y == null) continue; for (const m of blazesOf(x)) if (m.d <= 16 && m.at) dy.push(m.at.y - y); }
  const height = median(dy);
  // The frames of the life only: after a death the frames carry the respawn's position, some blocks off (note 665).
  const pos = W.filter(x => !(e.died && x.at > e.end) && x.snapshot?.health !== 0).map(x => x.snapshot?.position).filter(Boolean);
  const moved = pos.length ? Math.max(...pos.map(p => Math.hypot(p.x - pos[0].x, p.z - pos[0].z))) : null;
  // Gear.
  const inv = W.find(x => x.snapshot?.inventory)?.snapshot.inventory || {};
  const weapon = SWORD.slice().reverse().find(s => inv[s]) || states.find(s => s.weapon)?.weapon || null;
  const shield = W.some(x => x.snapshot?.equipment?.offhand === 'shield');
  // Ranged kit carried at the fight's start (note 665): a bow with arrows, snowballs.
  const bow = !!(inv.bow && inv.arrow), snowballs = inv.snowball || 0;
  // Stances in order (a decision's first pick), and the actions the bot began.
  const stances = decisions.filter(x => STANCE_IDS.has(x.snapshot.decision.id)).map(x => ({ t: Math.round(at(x)), id: x.snapshot.decision.id, choice: (x.snapshot.decision.path || [])[0] || null, hp: round1(x.snapshot.health),
    n16: blazesOf(x).filter(m => m.d <= 16).length, sp: (st => st ? (st.spawner && st.spawner.makes === 'blaze' && st.spawner.blocksAway <= 16 ? 1 : 0) : null)(x.snapshot.decision.state),
    shield: x.snapshot.equipment ? x.snapshot.equipment.offhand === 'shield' : null })).filter(s => s.choice);
  const chain = []; for (const s of stances) if (s.id !== 'fortress_visit' && chain[chain.length - 1] !== s.choice) chain.push(s.choice);
  const acts = []; for (const x of W) if (x.kind === 'action' && x.label && acts[acts.length - 1] !== x.label) acts.push(x.label);
  const shieldFrames = labels.filter(l => /shield/.test(l)).length;
  // Kills.
  const kills = [];
  for (let i = 1; i < mobFrames.length; i++) {
    const p = mobFrames[i - 1], n = mobFrames[i];
    if (n.at - p.at > 10000) continue;
    const ids = new Set(blazesOf(n).map(m => m.id));
    for (const m of blazesOf(p)) if (m.d <= 6 && !ids.has(m.id)) kills.push({ t: at(n), id: m.id, d: m.d, others: blazesOf(n).filter(o => o.d <= 16).length });
  }
  // Damage: health lost in the fight by the game's hurts, by kind; and the rod: when it came, what stood behind it.
  const hs = hurts(W), lost = hs.reduce((n, h) => n + h.drop, 0), by = {};
  for (const h of hs) by[h.cat] = Math.round(((by[h.cat] || 0) + h.drop) * 10) / 10;
  let rodT = null, rodPrev = null;
  for (const x of after) { const r = x.snapshot?.inventory?.blaze_rod; if (r != null && r > e.rods0) { rodT = at(x); break; } }
  if (rodT != null) rodPrev = kills.filter(k => k.t <= rodT + 1).pop() || null;
  const minHp = Math.min(...W.map(x => x.snapshot?.health).filter(v => typeof v === 'number' && v > 0), e.hp0 ?? 20);
  const firstStance = stances[0] || null;
  return { start: e.start, secs: Math.round((e.end - e.start) / 1000), died: !!e.died, rod: e.rodsGain > 0, rods: e.rodsGain,
    hp0: round1(e.hp0), hunger0: e.hunger0, minHp: round1(minHp), iron: e.iron, shield, weapon, bow, snowballs,
    n24start: startIds.size, peak24, peak16, peak8, spawnerNear, spawnerMin, toFour, terrain, height: round1(height), moved: round1(moved),
    soloPct: pct(solo, solo + multi), seenPct: pct(seenT, seenT + unseenT), breaks,
    chain, seq: stances.filter(x => x.id !== 'fortress_visit').map(x => [x.t, x.choice, x.hp, x.n16, x.sp, x.shield, x.id]), first: firstStance && firstStance.choice,
    // The blazes within 16 and the shield carried at the first stance itself
    // (note 720): charge_nearest into one blaze and into fourteen are not
    // the one row "charge" was, and a shield changes what a stance costs.
    firstN16: firstStance ? firstStance.n16 : null, firstShield: firstStance ? firstStance.shield : null,
    stances: stances.length, acts: acts.slice(0, 12), shieldFrames,
    kills: kills.length, killTimes: kills.map(k => Math.round(k.t)), lost: round1(lost), lostBy: by,
    lostPerKill: kills.length ? round1(lost / kills.length) : null, landings: e.landings,
    rodT: rodT == null ? null : Math.round(rodT), rodKill: rodPrev && { after: round1(rodT - rodPrev.t), d: round1(rodPrev.d), others: rodPrev.others },
    firstKillT: kills[0] ? Math.round(kills[0].t) : null };
}

// The frame a description needs, and no more (a day's records are gigabytes).
function slimFrame(f) {
  const s = f.snapshot; if (!s) return f;
  const d = s.decision, st = d?.state;
  return { ...f, snapshot: { health: s.health, food: s.food, dimension: s.dimension, position: s.position && { x: s.position.x, y: s.position.y, z: s.position.z },
    mobs: s.mobs && s.mobs.filter(m => m.name === 'blaze').map(m => ({ name: m.name, id: m.id, d: m.d, at: m.at, seen: m.seen })),
    inventory: s.inventory, equipment: s.equipment,
    decision: d && { id: d.id, path: d.path, options: d.options && Object.keys(d.options), state: st && { spawner: st.spawner, dropWithinThreeBlocks: st.dropWithinThreeBlocks, weapon: st.weapon } } } };
}
// Every fight described, with the commit its run loaded.
function describedFights(dir, from, to) {
  const { commitsByRun, runKey } = require('./lib/flight-commit');
  const commits = commitsByRun(dir), out = [];
  eachFile(dir, from, '"blaze"', (frames, file) => {
    for (const e of fights(frames, { from, to })) out.push({ file, commit: commits.get(runKey(file)) || 'unknown', ...describe(frames, e) });
  }, slimFrame);
  return out;
}
// The answers' rows (src/blaze-record.js ANSWERS): for each stance answer of
// encounter_stance in a fight, the situation it was given in and what followed
// it in that fight (a rod at or after it, the death). `list` is describedFights.
function answerRows(list) {
  const { CLASS_OF, cellKeys } = require('../src/blaze-record');
  const cells = {};
  for (const f of list) {
    const seen = new Set();
    for (const [t, choice, hp, n16, sp, sh, id] of f.seq || []) {
      const cls = CLASS_OF[choice];
      if (!cls || id !== 'encounter_stance' || sp == null || hp == null) continue;
      const rodAfter = f.rod && (f.rodT == null || f.rodT >= t);
      for (const k of cellKeys({ spawner: sp === 1, blazes: n16, health: hp, shield: typeof sh === 'boolean' ? sh : undefined })) {
        const key = k + '|' + cls;
        if (seen.has(key)) continue;
        seen.add(key);
        const c = cells[key] ||= [0, 0, 0];
        c[0]++; if (rodAfter) c[1]++; if (f.died) c[2]++;
      }
    }
  }
  return cells;
}
// A rate said with its count and Wilson 95% interval (n small: say so).
function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.round(100 * (c - m) / d), Math.round(100 * (c + m) / d)];
}
const rate = (list, f) => { const k = list.filter(f).length; const [lo, hi] = wilson(k, list.length); return `${k}/${list.length} ${pct(k, list.length)}% (${lo}-${hi})`; };
// Winning fights (a rod, alive) against the deaths: each feature's spread.
function winsTable(list) {
  const groups = { rod: list.filter(f => f.rod && !f.died), died: list.filter(f => f.died && !f.rod), neither: list.filter(f => !f.rod && !f.died) };
  const feats = {
    hp0: f => f.hp0, hunger0: f => f.hunger0, secs: f => f.secs, n24start: f => f.n24start, peak24: f => f.peak24, peak16: f => f.peak16, peak8: f => f.peak8,
    height: f => f.height, soloPct: f => f.soloPct, seenPct: f => f.seenPct, breaks: f => f.breaks, stances: f => f.stances,
    kills: f => f.kills, lost: f => f.lost, lostPerKill: f => f.lostPerKill, firstKillT: f => f.firstKillT, rodT: f => f.rodT, iron: f => f.iron,
  };
  const share = { spawnerNear: f => f.spawnerNear === true, shield: f => f.shield, ironSword: f => /iron|diamond|netherite/.test(f.weapon || ''), 'terrain span': f => f.terrain === 'span', 'terrain ground': f => f.terrain === 'ground',
    'blazes above (height>=2)': f => f.height != null && f.height >= 2, 'a kill': f => f.kills > 0, 'ever 2+ kills': f => f.kills >= 2, 'a break in sight': f => f.breaks > 0, 'hp0>16': f => f.hp0 > 16, 'hunger0>=18': f => f.hunger0 >= 18 };
  const out = { groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), median: {}, share: {} };
  for (const [name, f] of Object.entries(feats)) out.median[name] = Object.fromEntries(Object.entries(groups).map(([k, v]) => { const a = v.map(f).filter(x => x != null && !Number.isNaN(x)); return [k, a.length ? `${round1(median(a))} (n${a.length})` : '-']; }));
  for (const [name, f] of Object.entries(share)) out.share[name] = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, `${pct(v.filter(f).length, v.length)}%`]));
  return out;
}
// The stance chains (consecutive repeats collapsed) with what they came to.
function sequenceTable(list, key) {
  const by = {};
  for (const f of list) { const k = key(f); (by[k] ||= []).push(f); }
  return Object.entries(by).map(([k, v]) => ({ sequence: k, ...row(v.map(f => ({ died: f.died, rodsGain: f.rods }))), medianLost: round1(median(v.map(f => f.lost))) })).sort((a, b) => b.fights - a.fights);
}

// The first stance chosen in a fight, by its class (src/blaze-record.js
// CLASS_OF), the blazes within 16 at that first ask (1, 2 to 3, or 4 or
// more) and whether a shield was carried then (note 720): charge_nearest
// into one blaze and into fourteen are not one row, and note 712's rows
// did not say which. Rows under MIN_FIGHTS are kept as { n, tooFew: true }
// so the caller can drop them and say why, rather than silently rounding a
// handful of fights into a rate.
const MIN_FIRST_CELL = 5;
function firstStanceCells(list) {
  const { CLASS_OF, BLAZES_ABOUT } = require('../src/blaze-record');
  const cells = {};
  for (const f of list) {
    const cls = CLASS_OF[f.first], bucket = f.firstN16 == null ? null : BLAZES_ABOUT(f.firstN16);
    if (!cls || !bucket || f.firstShield == null) continue;
    const key = `${cls}|${bucket}|${f.firstShield ? 'shield' : 'no shield'}`;
    (cells[key] ||= []).push(f);
  }
  const out = {};
  for (const [key, fs] of Object.entries(cells).sort()) {
    const n = fs.length;
    if (n < MIN_FIRST_CELL) { out[key] = { n, tooFew: true }; continue; }
    const died = fs.filter(f => f.died).length, rod = fs.filter(f => f.rod).length;
    const minutes = fs.reduce((s, f) => s + f.secs, 0) / 60;
    out[key] = { n, diedPct: pct(died, n), rodPct: pct(rod, n), rodsPerMin: minutes ? round1(fs.reduce((s, f) => s + f.rods, 0) / minutes) : null };
  }
  return out;
}

// What came of each way out of fire in a fight with blazes (note 661): every
// body_way answer in the Nether with a blaze within 24 blocks in the frames of
// the last five seconds, by the way chosen and the blazes within 16 at the
// answer (0 to 3, or 4 and more), with whether the bot died within thirty
// seconds of it and the health it lost in those thirty seconds (the deepest
// point below the health at the answer). Rows for src/blaze-record.js WAYS.
const WAY_WINDOW_MS = 30000, WAY_LOOK_MS = 5000;
function wayRows(frames, { from = -Infinity, to = Infinity } = {}) {
  const out = [];
  let hp = null;
  frames.forEach((x, i) => {
    const h = x.snapshot?.health;
    if (typeof h === 'number') hp = h;
    const d = x.kind === 'decision' && x.snapshot?.decision;
    if (!d || d.id !== 'body_way' || !d.path?.length || (d.options && d.options.filter(k => k !== 'none_good').length < 2) || x.snapshot.dimension !== 'the_nether' || !(x.at >= from && x.at <= to) || !(hp > 0)) return;
    let blazes = null;
    for (let j = i; j >= 0 && frames[j].at >= x.at - WAY_LOOK_MS; j--) if (frames[j].snapshot?.mobs) { blazes = frames[j].snapshot.mobs.filter(m => m.name === 'blaze'); break; }
    if (!blazes || !blazes.some(m => m.d <= 24)) return;
    let died = false, low = hp;
    for (let j = i; j < frames.length && frames[j].at <= x.at + WAY_WINDOW_MS; j++) {
      const v = frames[j].snapshot?.health;
      if (typeof v !== 'number') continue;
      low = Math.min(low, v);
      if (v === 0) died = true;
    }
    out.push({ way: d.path[0], blazes: blazes.filter(m => m.d <= 16).length >= 4 ? '4+' : '0-3', died, lost: hp - low });
  });
  return out;
}
// The rows: { '0-3': { way: [asked, died, mean health lost in tenths] } }, only
// where MIN_WAY answers are in the row.
const MIN_WAY = 8;
function waysTable(list) {
  const cells = {};
  for (const r of list) {
    const c = ((cells[r.blazes] ||= {})[r.way] ||= [0, 0, 0]);
    c[0]++; if (r.died) c[1]++; c[2] += r.lost;
  }
  return Object.fromEntries(Object.entries(cells).map(([b, ways]) => [b, Object.fromEntries(Object.entries(ways).filter(([, c]) => c[0] >= MIN_WAY).sort().map(([w, c]) => [w, [c[0], c[1], Math.round(c[2] / c[0] * 10)]]))]));
}

// The rows src/blaze-record.js COUNTS says (note 665): the fights at a live spawner (a decision's
// state had one within 16) by the most blazes within 16 at once, the rest by the same, the fights
// at four or more by the nearest the bot came to the cage, and the clock of a fight at a spawner.
function countsTable(list) {
  const stat = a => ({ fights: a.length, died: a.filter(f => f.died).length, rod: a.filter(f => f.rod).length, rods: a.reduce((n, f) => n + (f.rods || 0), 0), lost: round1(a.reduce((n, f) => n + (f.lost || 0), 0) / Math.max(1, a.length)) });
  const sp = list.filter(f => f.spawnerNear === true), rest = list.filter(f => f.spawnerNear !== true);
  const q = (a, p) => { const b = a.filter(v => v != null).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : null; };
  const four = sp.filter(f => f.peak16 >= 4), began = sp.filter(f => f.n24start <= 3);
  return { fights: list.length, atSpawner: {
      'to 3': stat(sp.filter(f => f.peak16 <= 3)), '4': stat(sp.filter(f => f.peak16 === 4)), '5 to 6': stat(sp.filter(f => f.peak16 >= 5 && f.peak16 <= 6)), '7 and more': stat(sp.filter(f => f.peak16 >= 7)) },
    noSpawner: { '0 to 1': stat(rest.filter(f => f.peak16 <= 1)), '2 to 3': stat(rest.filter(f => f.peak16 >= 2 && f.peak16 <= 3)), '4 and more': stat(rest.filter(f => f.peak16 >= 4)) },
    fourAtSpawnerByNearest: { 'within 8': stat(four.filter(f => f.spawnerMin <= 8)), '9 to 12': stat(four.filter(f => f.spawnerMin > 8 && f.spawnerMin <= 12)), '13 to 16': stat(four.filter(f => f.spawnerMin > 12)) },
    ranged: { bowAndArrows: stat(list.filter(f => f.bow)), snowballs: stat(list.filter(f => f.snowballs > 0)), neither: stat(list.filter(f => !f.bow && !(f.snowballs > 0))) },
    clock: { beganWithOneToThreeInSight: began.length, reachedFour: began.filter(f => f.peak16 >= 4).length, secondsToFour: { median: q(began.map(f => f.toFour), 0.5), p90: q(began.map(f => f.toFour), 0.9) },
      firstRodSeconds: { median: q(four.map(f => f.rodT), 0.5), n: four.filter(f => f.rodT != null).length },
      deathSeconds: { p25: q(four.filter(f => f.died).map(f => f.secs), 0.25), median: q(four.filter(f => f.died).map(f => f.secs), 0.5), p75: q(four.filter(f => f.died).map(f => f.secs), 0.75) } } };
}

// The rows src/blaze-record.js RECENT and IRON_LOST say (note 661): a spawner's
// fights (a live spawner within 16 and four or more blazes within 16 at most)
// against the rest, the fights by the most blazes within 16 at once, and the
// health lost per fight by the iron worn among fights begun over 16 health.
function recentTable(list) {
  const stat = a => ({ fights: a.length, died: a.filter(f => f.died).length, rod: a.filter(f => f.rod).length, rods: a.reduce((n, f) => n + (f.rods || 0), 0), lost: round1(a.reduce((n, f) => n + (f.lost || 0), 0) / Math.max(1, a.length)) });
  const spawner = f => f.spawnerNear === true && f.peak16 >= 4, fit = list.filter(f => f.hp0 > 16);
  const lostBy = pieces => { const a = fit.filter(f => pieces(f.iron)); return { fights: a.length, lost: stat(a).lost }; };
  return { fights: list.length, spawner: stat(list.filter(spawner)), elsewhere: stat(list.filter(f => !spawner(f))),
    few: stat(list.filter(f => f.peak16 <= 1)), some: stat(list.filter(f => f.peak16 >= 2 && f.peak16 <= 3)),
    ironLost: { two: lostBy(n => n === 2), more: lostBy(n => n >= 3), none: lostBy(n => n === 0) } };
}

// Lives in one connection's frames (sorted by time): { start, end, inNether,
// died, startRods, maxRods, gained, lastRodAt, secondsFromLastRodToDeath }.
// The rods counted are those carried (powder made of them counting half a rod
// a piece), so a rod made into powder is not a rod lost.
function runs(frames, { from = -Infinity, to = Infinity } = {}) {
  const out = [];
  let cur = null, prevHp = null, last = null;
  const equivalent = inv => (inv.blaze_rod || 0) + Math.floor((inv.blaze_powder || 0) / 2);
  const close = (t, died) => {
    if (!cur) return;
    Object.assign(cur, { end: t, died, gained: Math.max(0, cur.maxRods - cur.startRods), secondsFromLastRodToDeath: died ? Math.round((t - (cur.lastRodAt ?? cur.start)) / 1000) : null });
    if (cur.seen) out.push(cur);
    cur = null;
  };
  for (const x of frames) {
    const t = x.at, s = x.snapshot || {};
    if (!(t >= from && t <= to)) continue;
    const hp = typeof s.health === 'number' ? s.health : null;
    if (hp === 0 && prevHp > 0) { close(t, true); prevHp = 0; continue; }
    if (hp === 0) { prevHp = 0; continue; }
    // A frame with a health above zero after a death begins the next life; the
    // frames of the death itself carry the last life's inventory or nothing.
    const alive = hp == null ? prevHp !== 0 : hp > 0;
    if (!alive) continue;
    if (hp != null) prevHp = hp;
    if (!cur) cur = { start: t, inNether: false, startRods: null, maxRods: 0, lastRodAt: null, seen: false };
    cur.seen = true; last = t;
    if (s.dimension === 'the_nether') cur.inNether = true;
    if (s.inventory) {
      const n = equivalent(s.inventory);
      if (cur.startRods === null) { cur.startRods = n; cur.maxRods = n; }
      else if (n > cur.maxRods) { cur.maxRods = n; cur.lastRodAt = t; }
      else if (n > (cur.lastCount ?? 0)) cur.lastRodAt = t;
      cur.lastCount = n;
    }
  }
  if (cur) close(last ?? cur.start, false);
  return out.map(({ lastCount, seen, ...r }) => r);
}
// The funnel: of the runs that went into the Nether, those that reached N rods,
// and of those how many were alive at the end and how many died, with the
// median seconds from the last rod to the death.
function runsTable(list) {
  const nether = list.filter(r => r.inNether);
  const step = (n, by = r => r.maxRods) => { const a = nether.filter(r => by(r) >= n), dead = a.filter(r => r.died); return { reached: a.length, alive: a.length - dead.length, died: dead.length, medianSecondsToDeathAfterLastRod: median(dead.map(r => r.secondsFromLastRodToDeath)) }; };
  const gained = nether.filter(r => r.gained > 0);
  return { runs: list.length, inNether: nether.length, diedInNether: nether.filter(r => r.died).length, gainedARod: gained.length,
    reaching: { 1: step(1), 3: step(3), 6: step(6), 7: step(7) }, gainingInTheRun: { 1: step(1, r => r.gained), 3: step(3, r => r.gained), 6: step(6, r => r.gained) }, mostRods: nether.reduce((m, r) => Math.max(m, r.maxRods), 0) };
}

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
  const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
  const from = Date.parse(args.from || '2026-09-28T00:00:00Z'), to = args.to ? Date.parse(args.to) : Date.parse('2026-09-29T00:00:00Z');
  if (args.records) {
    const list = describedFights(dir, from, to);
    fs.writeFileSync(args.records, list.map(f => JSON.stringify(f)).join('\n') + '\n');
    console.log(list.length + ' fights described to ' + args.records);
  } else if (args.ways) {
    const list = [];
    eachFile(dir, from, '"body_way"', frames => list.push(...wayRows(frames, { from, to })), slimFrame);
    console.log(JSON.stringify({ answers: list.length, rows: waysTable(list) }, null, 1));
  } else if (args.recent) {
    // --recent: the rows RECENT and IRON_LOST hold, for the window; --records-in reads a file --records wrote.
    const list = args['records-in'] ? fs.readFileSync(args['records-in'], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(f => f.start >= from && f.start <= to) : describedFights(dir, from, to);
    console.log(JSON.stringify(recentTable(list), null, 1));
  } else if (args.counts) {
    const list = args['records-in'] ? fs.readFileSync(args['records-in'], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(f => f.start >= from && f.start <= to) : describedFights(dir, from, to);
    console.log(JSON.stringify(countsTable(list), null, 1));
  } else if (args.answers) {
    const list = args['records-in'] ? fs.readFileSync(args['records-in'], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(f => f.start >= from && f.start <= to) : describedFights(dir, from, to);
    const cells = answerRows(list), min = require('../src/blaze-record').MIN_FIGHTS;
    const last = new Date(Math.max(...list.map(f => f.start))).toISOString();
    console.log(JSON.stringify({ fights: list.length, lastFightStart: last, rows: Object.fromEntries(Object.entries(cells).filter(([, c]) => c[0] >= min).sort()) }, null, 1));
  } else if (args['first-cells']) {
    const list = args['records-in'] ? fs.readFileSync(args['records-in'], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(f => f.start >= from && f.start <= to) : describedFights(dir, from, to);
    console.log(JSON.stringify({ fights: list.length, rows: firstStanceCells(list) }, null, 1));
  } else if (args.wins || args.sequence) {
    // --wins: the fights that brought a rod (alive) against the deaths, each
    // feature side by side; --sequence: the stance chains and the first stance
    // with their counts. --records-in reads a file --records wrote.
    const list = args['records-in'] ? fs.readFileSync(args['records-in'], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(f => f.start >= from && f.start <= to) : describedFights(dir, from, to);
    console.log(JSON.stringify(args.wins ? winsTable(list) : { byChain: sequenceTable(list, f => f.chain.join(' > ') || '(no stance asked)').filter(r => r.fights >= 3), byFirstStance: sequenceTable(list, f => f.first || '(none)') }, null, 1));
  } else if (args.landings) {
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
  } else if (args.runs) {
    const all = [];
    eachFile(dir, from, null, (frames, f) => all.push(...runs(frames, { from, to })), f => ({ at: f.at, kind: f.kind, snapshot: f.snapshot && { health: f.snapshot.health, dimension: f.snapshot.dimension, inventory: f.snapshot.inventory && { blaze_rod: f.snapshot.inventory.blaze_rod, blaze_powder: f.snapshot.inventory.blaze_powder } } }));
    console.log(JSON.stringify(runsTable(all), null, 1));
  } else if (args['by-commit']) {
    const { commitsByRun, runKey } = require('./lib/flight-commit');
    const commits = commitsByRun(dir), by = {};
    eachFile(dir, from, '"blaze"', (frames, f) => { const c = commits.get(runKey(f)) || 'unknown'; (by[c] ||= []).push(...fights(frames, { from, to })); });
    console.log(JSON.stringify(Object.fromEntries(Object.entries(by).map(([c, list]) => [c, row(list)])), null, 1));
  } else console.log(JSON.stringify(tables(readFights(dir, from, to)), null, 1));
}
module.exports = { countsTable, wayRows, waysTable, MIN_WAY, recentTable, runs, runsTable, answerRows, describe, describedFights, winsTable, sequenceTable, wilson, rate, slimFrame, fights, tables, row, hurts, landings, deaths, readFights, eachFile, GAP_MS, MIN_MS, firstStanceCells, MIN_FIRST_CELL };
