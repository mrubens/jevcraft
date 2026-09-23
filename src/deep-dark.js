'use strict';
// An expedition to the deep dark: down to y -52 by staircase, then swept at
// that depth in legs until sculk shows, then to the ancient city it hides
// and through its chests. The user, 2026-09-23: the run had gone quiet,
// walking about after endermen, and should explore boldly "even if he
// might die". A city's chests hold enchanted books, diamond gear, echo
// shards and enchanted golden apples.
//
// Wardens are never fought. One in sight ends the trip on the spot and it
// rests half an hour; the survival layer does the running. The trip is a
// bounded piece of work (three minutes a turn) that Jev chooses among the
// other side trips (strategy.js); its state is kept, so the next turn goes
// on from the same staircase or the same city.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { setAside, isSetAside } = require('./progress');

// Three minutes a turn: the main loop's eating, air and night checks run
// between turns, not inside one.
const DEPTH = -52, LEG = 48, TRIP_MS = 3 * 60 * 1000, WARDEN_REST_MS = 30 * 60 * 1000;
const HEADINGS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];
const overworld = bot => /overworld/.test(String(bot.game?.dimension || 'overworld'));
const pickaxeTier = bot => Math.max(0, ...bot.inventory.items().map(i => /^(\w+)_pickaxe$/.exec(i.name)).filter(Boolean).map(m => TIERS.indexOf(m[1]) + 1));
const wardenNear = (bot, r = 48) => Object.values(bot.entities || {}).some(e => e.name === 'warden' && e.isValid !== false && e.position && e.position.distanceTo(bot.entity.position) <= r);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Whether a trip can be offered now: the Overworld, an iron pickaxe or
// better (deepslate), healthy and fed, and no warden rest.
function deepDarkReady(bot, goal, now = Date.now()) {
  return overworld(bot) && pickaxeTier(bot) >= 3 && (bot.health ?? 20) >= 16 && (bot.food ?? 20) >= 14 &&
    !isSetAside(goal, 'deep_dark', 'trip', now) && !goal.deepDark?.cityDoneAt;
}

function describe(goal) {
  const s = goal.deepDark;
  const city = (goal.landmarks || []).find(l => l.kind === 'ancient_city' && !l.lootedAt);
  if (city) return `An ancient city is known at ${city.x}, ${city.y}, ${city.z}: go back down and through its chests (enchanted books, diamond gear, echo shards, enchanted golden apples). Wardens live there: never fight one, leave if one shows.`;
  if (s?.legs) return `Go on with the deep dark expedition: ${s.legs} legs swept at depth so far, no ancient city yet. Its chests hold enchanted books, diamond gear, echo shards and enchanted golden apples. Wardens: never fight one, leave if one shows.`;
  return 'Expedition to the deep dark: dig a staircase down to y -52 and sweep for sculk, then an ancient city. Its chests hold enchanted books, diamond gear, echo shards and enchanted golden apples, worth a lot for the End fight. Risky: wardens live there; never fight one, leave if one shows.';
}

// One step of the trip. Returns 'city', 'descend', 'sweep', 'loot', 'done'
// or 'warden' for what it did.
async function deepDarkStep(bot, task, goal, save, actions) {
  const state = goal.deepDark ||= { startedAt: new Date().toISOString(), heading: Math.floor(Math.random() * 4), legs: 0, legFails: 0 };
  if (wardenNear(bot)) {
    setAside(goal, 'deep_dark', 'trip', 'a warden in sight', WARDEN_REST_MS);
    state.wardenAt = new Date().toISOString(); save();
    bot.chat?.('A warden. Leaving the deep dark for now.');
    return 'warden';
  }
  actions.notice?.(bot, goal, save);
  const here = bot.entity.position;
  const city = (goal.landmarks || []).filter(l => l.kind === 'ancient_city' && !l.lootedAt && /overworld/.test(String(l.dimension || 'overworld')))
    .sort((a, b) => flat(a, here) - flat(b, here))[0];
  if (city) {
    if (!state.foundAt) { state.foundAt = new Date().toISOString(); bot.chat?.(`An ancient city at ${city.x}, ${city.y}, ${city.z}. Going through its chests, quietly.`); }
    // A chest in reach is opened by the looting rule.
    if (await actions.loot(bot, task, goal, save)) { state.chests = (state.chests || 0) + 1; save(); return 'loot'; }
    // The next chest of the city in view, walked or dug to.
    const chestId = bot.registry?.blocksByName?.chest?.id;
    const chests = chestId === undefined ? [] : bot.findBlocks({ matching: [chestId], maxDistance: 48, count: 32 })
      .filter(p => flat(p, city) <= 80 && !(goal.looted || {})[`${p.x},${p.y},${p.z}`] && !isSetAside(goal, 'loot_chest', `${p.x},${p.y},${p.z}`));
    const next = chests.sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
    const target = next || new Vec3(city.x, city.y, city.z);
    if (!next && flat(here, city) <= 12) {
      // At the city with no chest left in view: it is done.
      city.lootedAt = new Date().toISOString(); state.cityDoneAt = city.lootedAt; save();
      bot.chat?.(`Done with the ancient city: ${state.chests || 0} chests opened.`);
      return 'done';
    }
    goal.step = { action: 'deep_dark', phase: 'city', target: { x: target.x, y: target.y, z: target.z } }; save();
    await approach(bot, task, state, save, target, actions, next ? 2 : 6);
    return 'city';
  }
  const [dx, dz] = HEADINGS[state.heading % 4];
  if (here.y > DEPTH + 6) {
    // Down: a staircase along the heading, as the night mine digs.
    const target = new Vec3(Math.floor(here.x) + dx * 16, DEPTH, Math.floor(here.z) + dz * 16);
    goal.step = { action: 'deep_dark', phase: 'descend', depth: Math.round(here.y), target: { x: target.x, y: target.y, z: target.z } }; save();
    const before = here.y;
    try { await actions.tunnel(bot, task, state, save, target, { dig: actions.dig, navigate: actions.navigate }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; state.lastError = err.message; }
    if (bot.entity.position.y >= before - 0.5 && ++state.legFails >= 6) { state.heading++; state.legFails = 0; delete state.tunnel; }
    else if (bot.entity.position.y < before - 0.5) state.legFails = 0;
    save();
    return 'descend';
  }
  // At depth: a leg along the heading, the pathfinder through the caves
  // first, the staircase where it finds none.
  const leg = new Vec3(Math.floor(here.x) + dx * LEG, DEPTH, Math.floor(here.z) + dz * LEG);
  goal.step = { action: 'deep_dark', phase: 'sweep', legs: state.legs, target: { x: leg.x, y: leg.y, z: leg.z } }; save();
  const moved = await approach(bot, task, state, save, leg, actions, 6);
  if (moved) { state.legs++; state.legFails = 0; }
  else if (++state.legFails >= 4) { state.heading++; state.legFails = 0; delete state.tunnel; }
  save();
  return 'sweep';
}

// Toward a point: the pathfinder, then a staircase step. True when it got
// six blocks closer or arrived.
async function approach(bot, task, state, save, target, actions, range) {
  const from = bot.entity.position.clone();
  const gap = () => bot.entity.position.distanceTo(target);
  const start = gap();
  try { await actions.navigate(bot, task, new goals.GoalNear(target.x, target.y, target.z, range), { timeoutMs: 30000, stallMs: 8000 }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  if (gap() <= range + 1 || gap() < start - 6) return true;
  try { await actions.tunnel(bot, task, state, save, target, { dig: actions.dig, navigate: actions.navigate }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; state.lastError = err.message; }
  return bot.entity.position.distanceTo(from) > 1 && gap() < start - 1;
}

// A turn of the trip: steps until the time is up, the city is done, or a
// warden sends it home.
async function deepDarkTrip(bot, task, goal, save, actions, { ms = TRIP_MS } = {}) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    task.check();
    const did = await deepDarkStep(bot, task, goal, save, actions);
    if (did === 'warden' || did === 'done') return did;
  }
  return 'turn';
}

module.exports = { DEPTH, LEG, deepDarkReady, deepDarkStep, deepDarkTrip, describe, wardenNear };
