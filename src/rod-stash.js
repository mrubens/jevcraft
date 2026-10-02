'use strict';
// Blaze rods in a chest in the Nether (note 704). The user: "With low life
// and multiple rods, is it worth storing them in a chest or something?" A
// death drops everything carried, the bot comes back to life in the
// Overworld far from it, and what lies on the ground vanishes five minutes
// after its chunk is loaded or burns in lava; a chest keeps what is in it
// (no mob opens one). The flight records (scripts/after-rod.js --held): of
// the times a bot in the Nether first held 2 or more rods, most died with
// them before leaving (HELD below).
//
// Here: the chest's place (out of every blaze's and ghast's line, not by
// lava, with rock round it where there is), the option that puts the rods in
// it (stash_rods, asked in the lull and at a spawner, empty-spawner.js and
// the stance), the rods in it counted as held (eye-need.js need), and taking
// them out before the portal walk (game-progress.js, collect_rod_stash). The
// chests are kept in goal.rodStashes, per trial, so a restart or a death
// leaves them known.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { setAside, isSetAside } = require('./progress');

// What goes in: the rods and what the eyes are made of.
const KEPT = Object.freeze(['blaze_rod', 'blaze_powder', 'ender_pearl', 'ender_eye']);
// From the first rod (note 931), as the bank (rod-bank.js BANK_MIN, note
// 874): a rod kept is a rod kept, whatever the count.
const ROD_MIN = 1;
const REACH = 4.3, NEAR_STASH = 12, LAVA_NEAR = 2;
const REST_MS = 5 * 60000, TAKE_REST_MS = 10 * 60000, TAKE_TRIES = 3;
// Seconds, measured on a scratch server (scripts/rod-stash-probe.js, note
// 704): a chest carried put down and 2 stacks put in, 0.8 s; made first from
// 3 stems with a table carried (planks, the table put down, the chest), 8 s
// in all. Not timed in a trial.
const PUT_SECONDS = 1, MAKE_SECONDS = 7, WALK = 4.3;
// scripts/after-rod.js --held over the flight records 2026-09-28T00:00Z to
// 2026-09-30T00:19Z: each time a life in the Nether first carried k rods or
// more, what came first: the death with them, out of the Nether with them,
// or the record's end (a restart mostly).
const HELD = Object.freeze({ from: '2026-09-28', to: '2026-09-30',
  2: { n: 137, died: 101, left: 5, ended: 31, medianToDeath: 224, lost: 367 },
  3: { n: 85, died: 67, left: 5, ended: 13, medianToDeath: 242, lost: 299 },
  4: { n: 63, died: 47, left: 4, ended: 12, medianToDeath: 254, lost: 239 } });

const P = v => ({ x: v.x, y: v.y, z: v.z });
const V = p => new Vec3(p.x, p.y, p.z);
const words = s => String(s).replaceAll('_', ' ');
const round = n => Math.round(n * 10) / 10;
const at = p => `(${p.x}, ${p.y}, ${p.z})`;
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));
const dimOf = bot => inNether(bot) ? 'nether' : /end/.test(String(bot?.game?.dimension || '')) ? 'end' : 'overworld';
const countOf = (bot, name) => (bot?.inventory?.items?.() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const rodsEquivalent = bot => countOf(bot, 'blaze_rod') + Math.floor(countOf(bot, 'blaze_powder') / 2);
const solid = b => b?.boundingBox === 'block';
const empty = b => !!b && b.boundingBox === 'empty' && !/lava|water|fire/.test(b.name);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The chests known, and what is in those not lost or emptied.
const stashes = goal => (goal?.rodStashes || []).filter(s => !s.lostAt && !s.unreachable);
const withContents = s => KEPT.some(n => (s.contents?.[n] || 0) > 0);
// What the chests hold in all, by item: counted as held (eye-need.js).
function stashed(goal) {
  const out = { blaze_rod: 0, blaze_powder: 0, ender_pearl: 0, ender_eye: 0, chests: [] };
  for (const s of stashes(goal)) {
    if (!withContents(s)) continue;
    for (const n of KEPT) out[n] += s.contents[n] || 0;
    out.chests.push(s);
  }
  return out;
}
const listed = contents => KEPT.filter(n => (contents?.[n] || 0) > 0).map(n => plural(contents[n], words(n))).join(', ');
// One line where the rods are said: the chest, its place and what is in it.
function stashSays(goal) {
  const s = stashed(goal);
  if (!s.chests.length) return '';
  return s.chests.map(c => `${listed(c.contents)} in a chest at ${at(c.position)} in the ${c.dimension === 'nether' ? 'Nether' : c.dimension === 'overworld' ? 'Overworld' : c.dimension}`).join('; ');
}

// What the risk of carrying them is, from the records.
function heldSays(k) {
  const r = HELD[Math.min(4, Math.max(2, k))];
  return `Of ${r.n} times a bot in the Nether first held ${Math.min(4, k)} or more rods (${HELD.from} to ${HELD.to}), ${r.died} died with them before leaving (median ${r.medianToDeath} s later), ${r.left} left with them.`;
}

// Shooters whose line reaches a cell (blazes and ghasts about).
function shooters(bot) {
  const here = bot.entity?.position;
  if (!here) return [];
  return Object.values(bot.entities || {}).filter(e => e && e.position && (e.name === 'blaze' || e.name === 'ghast') && e.isValid !== false && e.position.distanceTo(here) <= (e.name === 'ghast' ? 64 : 48));
}
function lineTo(bot, e, cell) {
  const T = require('./blaze-tactics');
  const eye = e.position.offset(0, (e.height || 1.8) * 0.85, 0);
  return [0.2, 0.5, 0.85].some(dy => T.lineThrough(bot, eye, cell.offset(0.5, dy, 0.5), new Set()));
}
function lavaNear(bot, cell) {
  for (let dx = -LAVA_NEAR; dx <= LAVA_NEAR; dx++) for (let dy = -LAVA_NEAR; dy <= 1; dy++) for (let dz = -LAVA_NEAR; dz <= LAVA_NEAR; dz++) {
    if (/lava|fire/.test(bot.blockAt(cell.offset(dx, dy, dz))?.name || '')) return true;
  }
  return false;
}
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// A cell for the chest within reach of where the bot stands: air on solid
// ground, air over it (a chest does not open under a solid block), no lava
// or fire within two, no body in it, not the bot's own cells, and out of
// every blaze's and ghast's line. Rock round it first (the room's back),
// then the nearest. Under fire (note 759), a cell in a line is taken where
// none is out of every line: a fireball does not break a chest or burn it,
// and the line is said (`seen`). -> { cell, walls, seen } or null
function chestCell(bot, { underFire = false } = {}) {
  const feet = bot.entity.position.floored(), eye = bot.entity.position.offset(0, 1.62, 0);
  const shots = shooters(bot);
  const bodies = Object.values(bot.entities || {}).filter(e => e?.position && e !== bot.entity);
  const out = [];
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -2; dy <= 1; dy++) {
    const c = feet.offset(dx, dy, dz);
    if (c.x === feet.x && c.z === feet.z && (c.y === feet.y || c.y === feet.y + 1)) continue;
    if (eye.distanceTo(c.offset(0.5, 0.5, 0.5)) > REACH) continue;
    const floor = bot.blockAt(c.offset(0, -1, 0));
    if (!solid(floor) || /lava|magma|soul_sand|sand|gravel/.test(floor.name) || !empty(bot.blockAt(c)) || !empty(bot.blockAt(c.offset(0, 1, 0)))) continue;
    if (bodies.some(e => Math.abs(e.position.x - (c.x + 0.5)) < 0.9 && Math.abs(e.position.z - (c.z + 0.5)) < 0.9 && e.position.y > c.y - 2 && e.position.y < c.y + 1)) continue;
    if (lavaNear(bot, c)) continue;
    const seen = shots.some(e => lineTo(bot, e, c));
    if (seen && !underFire) continue;
    const walls = SIDES.filter(([x, z]) => solid(bot.blockAt(c.offset(x, 0, z)))).length;
    out.push({ cell: c, walls, seen, off: round(eye.distanceTo(c.offset(0.5, 0.5, 0.5))) });
  }
  return out.sort((a, b) => a.seen - b.seen || b.walls - a.walls || a.off - b.off)[0] || null;
}

// The chest: carried, or made from wood carried at a table carried or made.
// -> { carried } | { planks, logs, table, spends, seconds } | null
function chestMaking(bot) {
  if (countOf(bot, 'chest')) return { carried: true, seconds: 0 };
  const items = bot.inventory?.items?.() || [];
  const planks = items.filter(i => /_planks$/.test(i.name)).reduce((n, i) => n + i.count, 0);
  const logs = items.filter(i => /_(log|stem|wood|hyphae)$/.test(i.name)).reduce((n, i) => n + i.count, 0);
  const table = countOf(bot, 'crafting_table') > 0;
  const need = 8 + (table ? 0 : 4);
  if (planks + 4 * logs < need) return null;
  const logsUsed = Math.max(0, Math.ceil((need - planks) / 4));
  return { carried: false, planks, logs, table, logsUsed, planksUsed: need, seconds: MAKE_SECONDS };
}
const makingSays = m => m.carried ? '' : ` The chest is made first: 8 planks${m.table ? ' at the crafting table carried' : ', and a crafting table of 4 more put down for it'}${m.logsUsed ? ` (${plural(m.logsUsed, 'log')} or stem${m.logsUsed === 1 ? '' : 's'} of those carried made into planks)` : ''}.`;

// The chest known near, with room, to put more in: walked to, not placed.
function nearStash(bot, goal) {
  const here = bot.entity?.position;
  if (!here) return null;
  const dim = dimOf(bot);
  return stashes(goal).filter(s => s.dimension === dim).map(s => ({ s, d: here.distanceTo(V(s.position).offset(0.5, 0.5, 0.5)) }))
    .filter(x => x.d <= NEAR_STASH && bot.blockAt(V(x.s.position))?.name === 'chest').sort((a, b) => a.d - b.d)[0] || null;
}

// The lull by a live spawner, for the seconds against its next try (note 691).
const lullNow = (bot, now) => { try { return require('./spawner-clock').lull(bot, { now }); } catch (_) { return null; } };

// Whether stash_rods is on offer here, and what it is. In the Nether in
// Survival, 2 or more rods carried and rods still wanted (with the rods done
// the next step is the portal walk, which takes them), not resting after a
// failure, and a chest here: one known within twelve, or a cell for one and
// a chest carried or the wood for it. Without `underFire`, no shooter with
// a line to the bot (the lull, empty_spawner). With it (the fight's own
// stance, note 759), the shooters that see the bot are kept in `seenBy`
// and the caller prices the seconds in their fire: at a swarm some blaze
// always has a line, and 2 of 70 deaths with rods (2026-09-29T23:00Z to
// 2026-09-30T17:00Z) had it offered in their last minute.
function stashOffer(bot, goal, { now = Date.now(), underFire = false } = {}) {
  if (!bot?.entity || !inNether(bot) || bot.game?.gameMode !== 'survival') return null;
  const rods = rodsEquivalent(bot);
  if (rods < ROD_MIN) return null;
  if (isSetAside(goal, 'rod_stash', 'here', now)) return null;
  let left = 1, wanted = null; try { const n = require('./eye-need').need(bot, goal); left = n.rodsLeft; wanted = n.rodsWanted; } catch (_) { left = 1; }
  if (!left) return null;
  const eyeOf = bot.entity.position.offset(0, 1.62, 0);
  const T = require('./blaze-tactics');
  const seenBy = shooters(bot).filter(e => T.lineThrough(bot, e.position.offset(0, (e.height || 1.8) * 0.85, 0), eyeOf, new Set()));
  if (seenBy.length && !underFire) return null;
  const what = KEPT.filter(n => countOf(bot, n) > 0).map(n => ({ item: n, count: countOf(bot, n) }));
  const near = nearStash(bot, goal);
  if (near) {
    const steps = Math.max(0, Math.round(near.d - 3));
    return { existing: near.s, what, rods, wanted, seconds: round(steps / WALK + PUT_SECONDS), steps, seenBy, lull: seenBy.length ? null : lullNow(bot, now) };
  }
  const site = chestCell(bot, { underFire });
  if (!site) return null;
  const making = chestMaking(bot);
  if (!making) return null;
  return { site, making, what, rods, wanted, seconds: round(PUT_SECONDS + making.seconds), seenBy, lull: seenBy.length ? null : lullNow(bot, now) };
}

// The option's words: short (note 672). What goes in, where, the seconds
// (against the spawner's next try in the lull), and what a chest keeps; the
// risk of carrying them is the question's own fact (carriedSays) where the
// question says it, else said here.
function offerSays(offer, { riskInState = false } = {}) {
  const list = offer.what.map(w => plural(w.count, words(w.item)));
  const what = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  const where = offer.existing
    ? `put them in the chest at ${at(offer.existing.position)}, ${offer.steps ? `a ${offer.steps}-block walk` : 'in reach'}`
    : `set a chest down ${offer.site.off} blocks off at ${at(offer.site.cell)}, ${offer.site.seen ? 'in a blaze\'s line (no cell in reach is out of every line; a fireball neither breaks a chest nor burns it)' : 'out of every blaze\'s line'}, and put them in`;
  const fire = offer.seenBy?.length ? ` Done where the bot stands, in the line of ${plural(offer.seenBy.length, offer.seenBy.every(e => e.name === 'blaze') ? 'blaze' : 'shooter')} that ${offer.seenBy.length === 1 ? 'sees' : 'see'} it now.` : '';
  const secs = offer.lull ? require('./spawner-clock').jobSays(offer.lull, offer.seconds) : ` About ${offer.seconds} second${offer.seconds === 1 ? '' : 's'}.`;
  return `Keep the ${what} safe from a death first: ${where}, then asked again with the ways here still open.${secs}${fire}${offer.making ? makingSays(offer.making) : ''} A chest keeps them (no mob opens one), counted as held, taken out before the portal.${riskInState ? '' : ` ${carriedSays(offer)}`}`;
}
// The rods carried and what a death does to them, with the records' row.
function carriedSays(offer) {
  const of = offer.wanted ? `, ${offer.rods} of the ${offer.wanted} the goal wants` : '';
  return `${plural(offer.rods, 'blaze rod')} carried${of}. A death drops them where the bot falls (lava burns them; on the ground they vanish five minutes after) and the bot comes back to life in the Overworld, far from them. ${heldSays(offer.rods)}`;
}

// Put them in. -> true when stored.
// `opts` (rod-bank.js, note 760): the step's name, the rest a failure takes
// ([kind, key]) and the chat once stored.
async function stashRods(bot, task, goal, save, actions, offer, { step = 'stash_rods', rest = ['rod_stash', 'here'], chat = null } = {}) {
  const moves = offer.what;
  goal.step = { action: step, items: moves, at: offer.existing ? offer.existing.position : P(offer.site.cell) }; save?.();
  try {
    let entry = offer.existing, cell;
    if (entry) cell = V(entry.position);
    else {
      cell = offer.site.cell;
      if (!countOf(bot, 'chest')) {
        if (!actions?.acquireStep) throw new Error('No way to make a chest here');
        // One step a call (planks, the table put down, the chest), as the ladder takes them.
        for (let i = 0; i < 6 && !countOf(bot, 'chest'); i++) if (await actions.acquireStep(bot, task, 'chest', 1, goal, save)) break;
        if (!countOf(bot, 'chest')) throw new Error('The chest was not made');
      }
      if (!actions?.place) throw new Error('No way to put a chest down here');
      await actions.place(bot, task, cell, 'chest');
      if (bot.blockAt(cell)?.name !== 'chest') throw new Error(`The chest did not go down at ${cell}`);
      entry = { position: P(cell), dimension: dimOf(bot), contents: {}, placedAt: new Date().toISOString() };
      (goal.rodStashes ||= []).push(entry); save?.();
    }
    const eye = bot.entity.position.offset(0, 1.62, 0);
    if (eye.distanceTo(cell.offset(0.5, 0.5, 0.5)) > REACH && actions?.navigate) await actions.navigate(bot, task, new goals.GoalNear(cell.x, cell.y, cell.z, 2), { timeoutMs: 15000, stallMs: 4000 });
    const stored = await withStash(bot, task, entry, save, async window => {
      const done = [];
      for (const name of KEPT) {
        const n = countOf(bot, name);
        if (!n) continue;
        task?.check?.();
        try { await window.deposit(bot.registry.itemsByName[name].id, null, n); done.push({ item: name, count: n }); } catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      }
      return done;
    });
    if (!stored.length) throw new Error('Nothing went into the chest');
    entry.storedAt = new Date().toISOString(); save?.();
    try { require('./after-rod').noteRods(bot); } catch (_) { /* no record */ }
    const what = listed(Object.fromEntries(stored.map(m => [m.item, m.count])));
    bot.chat?.(chat ? chat(what, at(entry.position)) : `Left ${what} in a chest at ${at(entry.position)}. I'll take them on the way out.`);
    return true;
  } catch (err) {
    task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    setAside(goal, rest[0], rest[1], err, REST_MS);
    goal.rodStashFailed = { at: new Date().toISOString(), why: err.message }; save?.();
    return false;
  }
}

// The chest here as an answer of its own beside the walk out and the trip
// back for food (rods_now, leave_nether; note 931). The stash was offered
// only in a cage's lull and at the stance, 16 times in 30 hours to 19:00Z on
// 2026-10-02 and never taken; a rod carrier at low health with nothing to
// eat was asked only to carry them out, stay, or go back for food with them
// in the pack. Here: the rods in a chest where the bot stands, then the walk
// `then` names (the trip back for food) or the hunt on, the way back in
// passing them. -> { description, run } or null
function keepOption(bot, task, goal, save, actions, { then = null, thenSays = '' } = {}) {
  const offer = stashOffer(bot, goal);
  if (!offer) return null;
  const acts = { ...actions,
    place: actions?.place || require('./work').place,
    acquireStep: actions?.acquireStep || require('./work').acquireStep,
    navigate: actions?.navigate || require('./skills').navigate };
  const h = Math.round((bot.health ?? 20) * 10) / 10, food = bot.food ?? 20;
  const eats = (bot.inventory?.items?.() || []).some(i => bot.registry?.foodsByName?.[i.name]);
  const body = food >= 18 ? `health ${h}, coming back at hunger ${food}` : `health ${h}, and at hunger ${food} it does not come back${eats ? ' until the bot has eaten' : ' (nothing to eat carried)'}`;
  const description = `${offerSays(offer, { riskInState: false })} The chest stays here: it is counted as rods held, and taken out on the way out once every rod wanted is got; a death meanwhile (the bot comes back to life in the Overworld) drops none of them. A ghast's fireball breaks a chest only where it lands beside it (the chest's blast resistance 2.5); a blaze's does not. Now: ${body}.${thenSays ? ` ${thenSays}` : ''}`;
  return { description, offer,
    run: async () => {
      const kept = await stashRods(bot, task, goal, save, acts, offer);
      if (kept && then) await then();
      return kept;
    } };
}

// The lid opened, the contents read before and after, the lid shut.
async function withStash(bot, task, entry, save, work) {
  const block = bot.blockAt(V(entry.position));
  if (block?.name !== 'chest') { entry.lostAt = new Date().toISOString(); save?.(); throw new Error(`The chest at ${at(entry.position)} is not there`); }
  const window = await require('./chest-delivery').openChest(bot, task, block);
  const read = () => { const c = {}; for (const i of window.containerItems()) c[i.name] = (c[i.name] || 0) + i.count; entry.contents = c; entry.seenAt = new Date().toISOString(); save?.(); };
  try {
    if (bot._syncWindow) await bot._syncWindow(window);
    read();
    return await work(window);
  } finally {
    try { if (bot._syncWindow) await bot._syncWindow(window); } catch (_) { /* read as it is */ }
    read();
    window.close();
  }
}

// The stage before the portal walk: the nearest chest in this dimension with
// something in it, not resting. -> stage or null
function collectStage(bot, goal, now = Date.now()) {
  const here = bot?.entity?.position, dim = dimOf(bot);
  if (!here) return null;
  const s = stashes(goal).filter(c => c.dimension === dim && withContents(c) && !isSetAside(goal, 'rod_stash_take', at(c.position), now))
    .map(c => ({ c, d: Math.round(here.distanceTo(V(c.position))) })).sort((a, b) => a.d - b.d)[0];
  return s ? { phase: 'collect_rod_stash', action: 'collect_rod_stash', at: P(s.c.position), distance: s.d, items: { ...s.c.contents } } : null;
}

// Take out what the chest at the stage holds. -> true when taken.
async function collect(bot, task, goal, save, actions = {}) {
  const stage = collectStage(bot, goal);
  if (!stage) return false;
  const entry = stashes(goal).find(c => c.position.x === stage.at.x && c.position.y === stage.at.y && c.position.z === stage.at.z);
  const key = at(entry.position), cell = V(entry.position);
  goal.step = { action: 'collect_rod_stash', at: P(cell), distance: stage.distance, items: { ...entry.contents } }; save?.();
  if (!entry.announced) { entry.announced = true; bot.chat?.(`Taking ${listed(entry.contents)} out of the chest at ${key}${entry.dimension === 'nether' ? ' before the portal' : ''}.`); }
  try {
    if (bot.entity.position.offset(0, 1.62, 0).distanceTo(cell.offset(0.5, 0.5, 0.5)) > REACH) {
      if (!actions.navigate) throw new Error('No way to walk to the chest');
      await actions.navigate(bot, task, new goals.GoalNear(cell.x, cell.y, cell.z, 2), { timeoutMs: 120000, stallMs: 8000, passing: true });
    }
    if (!bot.blockAt(cell)) throw new Error(`The chest at ${key} is not loaded from here`);
    const taken = await withStash(bot, task, entry, save, async window => {
      const done = [];
      for (const i of window.containerItems().filter(i => KEPT.includes(i.name))) {
        task?.check?.();
        try { await window.withdraw(i.type, null, i.count); done.push({ item: i.name, count: i.count }); } catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      }
      return done;
    });
    if (taken.length) { entry.takenAt = new Date().toISOString(); bot.chat?.(`Took ${listed(Object.fromEntries(taken.map(m => [m.item, m.count])))} back out of the chest.`); }
    if (withContents(entry)) throw new Error(`Still in the chest: ${listed(entry.contents)} (no room in the pockets?)`);
    save?.();
    return true;
  } catch (err) {
    task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    entry.takeFails = (entry.takeFails || 0) + 1; entry.lastTakeError = err.message;
    // Not there: lost, and no longer counted. Not reached three times: given
    // up, said, and no longer counted, so the ladder does not cross the
    // portal and back for it.
    if (entry.lostAt) bot.chat?.(`The chest at ${key} is gone, and ${listed(entry.contents)} with it.`);
    else if (entry.takeFails >= TAKE_TRIES) { entry.unreachable = new Date().toISOString(); bot.chat?.(`I can't get back to the chest at ${key}; going on without ${listed(entry.contents)}.`); }
    else setAside(goal, 'rod_stash_take', key, err, TAKE_REST_MS);
    save?.();
    return false;
  }
}

module.exports = { keepOption, nearStash, stashes, withContents, listed, dimOf, countOf, KEPT, HELD, ROD_MIN, stashed, stashSays, heldSays, carriedSays, chestCell, chestMaking, stashOffer, offerSays, stashRods, collectStage, collect, withStash, rodsEquivalent };
