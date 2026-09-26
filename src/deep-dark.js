'use strict';
// Underground expeditions: down by staircase to a structure's depth, swept
// at that depth in legs until it shows, then through it. The user,
// 2026-09-23: the run had gone quiet, walking about after endermen, and
// should explore boldly "even if he might die", packed light first
// (trip-kit.js) so a death costs the kit and a walk.
//
//   deep_dark        an ancient city at y -52 among the sculk: chests of
//                    enchanted books, diamond gear, echo shards and
//                    enchanted golden apples. Wardens are never fought: one
//                    in sight ends the trip and it rests half an hour.
//   trial_chambers   tuff and copper halls around y -30: trial spawners
//                    whose waves drop trial keys, vaults a key opens, and
//                    chests. The waves are the survival layer's to fight.
//
// A trip is a bounded piece of work (three minutes a turn) that Jev
// chooses among the other side trips (strategy.js); its state is kept, so
// the next turn goes on from the same staircase or the same structure.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { setAside, isSetAside } = require('./progress');

// Three minutes a turn: the main loop's eating, air and night checks run
// between turns, not inside one.
const LEG = 48, TRIP_MS = 3 * 60 * 1000, WARDEN_REST_MS = 30 * 60 * 1000;
const EXPEDITIONS = Object.freeze({
  deep_dark: { depth: -52, landmark: 'ancient_city', reach: 80, label: 'the deep dark', site: 'ancient city', warden: true },
  trial_chambers: { depth: -30, landmark: 'trial_chambers', reach: 48, label: 'the trial chambers', site: 'trial chambers', vaults: true },
});
const DEPTH = EXPEDITIONS.deep_dark.depth;
const HEADINGS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];
const overworld = bot => /overworld/.test(String(bot.game?.dimension || 'overworld'));
const pickaxeTier = bot => Math.max(0, ...bot.inventory.items().map(i => /^(\w+)_pickaxe$/.exec(i.name)).filter(Boolean).map(m => TIERS.indexOf(m[1]) + 1));
const wardenNear = (bot, r = 48) => Object.values(bot.entities || {}).some(e => e.name === 'warden' && e.isValid !== false && e.position && e.position.distanceTo(bot.entity.position) <= r);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const stateOf = (goal, kind) => kind === 'deep_dark' ? (goal.deepDark ||= fresh()) : ((goal.expeditions ||= {})[kind] ||= fresh());
const fresh = () => ({ startedAt: new Date().toISOString(), heading: Math.floor(Math.random() * 4), legs: 0, legFails: 0 });
const peek = (goal, kind) => kind === 'deep_dark' ? goal.deepDark : goal.expeditions?.[kind];

// Whether a trip can be offered now: the Overworld, an iron pickaxe or
// better (deepslate), healthy and fed, no rest, and the site not done.
function expeditionReady(bot, goal, kind = 'deep_dark', now = Date.now()) {
  return overworld(bot) && pickaxeTier(bot) >= 3 && (bot.health ?? 20) >= 16 && (bot.food ?? 20) >= 14 &&
    !isSetAside(goal, kind, 'trip', now) && !peek(goal, kind)?.cityDoneAt;
}
const deepDarkReady = (bot, goal, now) => expeditionReady(bot, goal, 'deep_dark', now);

const LOOT_LINES = {
  deep_dark: 'Its chests hold enchanted books, diamond gear, echo shards and enchanted golden apples, worth a lot for the End fight.',
  trial_chambers: 'Trial spawners send waves of mobs; beating a wave drops a trial key, and a key opens a vault of loot (diamonds, enchanted books, a heavy core); the corridors have chests too.',
};
function describe(goal, kind = 'deep_dark', bot = null) {
  const x = EXPEDITIONS[kind], s = peek(goal, kind);
  const site = (goal.landmarks || []).find(l => l.kind === x.landmark && !l.lootedAt);
  // The climb, the warden's hit and a death's cost as they stand, not
  // "dying costs little" (the decision audit, 2026-09-25): the kit is
  // packed light only when the trip starts, and what is carried now is
  // what a death would drop.
  let facts = '';
  if (bot?.entity?.position) {
    const y = Math.floor(bot.entity.position.y), down = y - (site?.y ?? x.depth);
    const { climbMinutes, climbStraightMinutes } = require('./surface');
    if (down > 0) facts += ` Y ${site?.y ?? x.depth} is ${down} blocks below here: roughly ${climbMinutes(down)} minutes of staircase down and as long back up, or about ${Math.round(down / 2)} minutes up by hand if the pickaxe gives out (about ${climbStraightMinutes(down)} by hand straight up, where the column overhead is open).`;
    if (x.warden) {
      const { afterArmour, armourOf, MOBS } = require('./combat-estimate');
      const worn = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
      const hit = Math.round(afterArmour(MOBS.warden.hit, armourOf(worn)));
      facts += ` A warden's hit takes about ${hit} health after the armour worn, from ${Math.round(bot.health ?? 20)}${hit >= (bot.health ?? 20) ? ': one hit kills' : ''}.`;
    }
    try {
      const cost = require('./risk').deathCost(bot, goal);
      const listed = [...cost.dropsWorn, ...cost.dropsGear, ...Object.entries(cost.dropsValuables).map(([n, c]) => `${c} ${n}`)];
      facts += ` A death there drops what is carried then${listed.length ? ` (now: ${listed.slice(0, 8).join(', ')}${listed.length > 8 ? ', and more' : ''})` : ''}, ${cost.walkBackBlocks != null ? `${cost.walkBackBlocks} blocks and more from where the bot would respawn` : 'far from where the bot would respawn'}; the kit is packed light before the trip starts.`;
    } catch (_) { /* no inventory to read */ }
  }
  const risk = (x.warden ? 'Wardens live there: never fight one, leave if one shows.' : 'The waves are real fights.') + facts;
  if (site) return `The ${x.site} is known at ${site.x}, ${site.y}, ${site.z}: go back down and through it. ${LOOT_LINES[kind]} ${risk}`;
  if (s?.legs) return `Go on with the expedition to ${x.label}: ${s.legs} legs swept at depth so far, no ${x.site} yet. ${LOOT_LINES[kind]} ${risk}`;
  return `Expedition to ${x.label}: pack light, dig a staircase down to y ${x.depth} and sweep for the ${x.site}. ${LOOT_LINES[kind]} ${risk}`;
}

// A vault in reach with a key in hand: the key goes in, the loot comes out.
async function openVault(bot, task, goal, save, actions, site) {
  const key = bot.inventory.items().find(i => i.name === 'trial_key' || i.name === 'ominous_trial_key');
  const id = bot.registry?.blocksByName?.vault?.id;
  if (!key || id === undefined) return false;
  const used = goal.vaultsUsed ||= {};
  const vault = bot.findBlocks({ matching: [id], maxDistance: 32, count: 16 }).find(p => !used[`${p.x},${p.y},${p.z}`] && flat(p, site) <= 64);
  if (!vault) return false;
  goal.step = { action: 'open_vault', at: { x: vault.x, y: vault.y, z: vault.z } }; save();
  await actions.navigate(bot, task, new goals.GoalNear(vault.x, vault.y, vault.z, 2), { timeoutMs: 20000, stallMs: 6000 });
  await bot.equip(key, 'hand');
  await bot.activateBlock(bot.blockAt(vault));
  used[`${vault.x},${vault.y},${vault.z}`] = new Date().toISOString(); save();
  bot.chat?.('Opened a vault with a trial key.');
  return true;
}

// A dropped trial key in view: walked onto.
async function pickUpKey(bot, task, goal, save, actions) {
  const drop = Object.values(bot.entities || {}).find(e => /trial_key$/.test(e.getDroppedItem?.()?.name || '') && e.position && e.position.distanceTo(bot.entity.position) <= 16);
  if (!drop) return false;
  goal.step = { action: 'pick_up_key' }; save();
  await actions.navigate(bot, task, new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0.5), { timeoutMs: 8000, stallMs: 3000 });
  return true;
}

// One step of a trip. Returns 'city', 'descend', 'sweep', 'loot', 'vault',
// 'key', 'done' or 'warden' for what it did.
async function expeditionStep(bot, task, goal, save, actions, kind = 'deep_dark') {
  const x = EXPEDITIONS[kind];
  const state = stateOf(goal, kind);
  if (x.warden && wardenNear(bot)) {
    setAside(goal, kind, 'trip', 'a warden in sight', WARDEN_REST_MS);
    state.wardenAt = new Date().toISOString(); save();
    bot.chat?.('A warden. Leaving the deep dark for now.');
    return 'warden';
  }
  actions.notice?.(bot, goal, save);
  const here = bot.entity.position;
  const site = (goal.landmarks || []).filter(l => l.kind === x.landmark && !l.lootedAt && /overworld/.test(String(l.dimension || 'overworld')))
    .sort((a, b) => flat(a, here) - flat(b, here))[0];
  if (site) {
    if (!state.foundAt) { state.foundAt = new Date().toISOString(); bot.chat?.(`The ${x.site} at ${site.x}, ${site.y}, ${site.z}. Going through it.`); }
    if (x.vaults) {
      if (await pickUpKey(bot, task, goal, save, actions)) return 'key';
      if (await openVault(bot, task, goal, save, actions, site)) { state.vaults = (state.vaults || 0) + 1; save(); return 'vault'; }
    }
    // A chest in reach is opened by the looting rule.
    if (await actions.loot(bot, task, goal, save)) { state.chests = (state.chests || 0) + 1; save(); return 'loot'; }
    // The next chest of the site in view, walked or dug to.
    const ids = ['chest', 'barrel'].map(n => bot.registry?.blocksByName?.[n]?.id).filter(id => id !== undefined);
    const chests = ids.length ? bot.findBlocks({ matching: ids, maxDistance: 48, count: 32 })
      .filter(p => flat(p, site) <= x.reach && !(goal.looted || {})[`${p.x},${p.y},${p.z}`] && !isSetAside(goal, 'loot_chest', `${p.x},${p.y},${p.z}`)) : [];
    const next = chests.sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
    const target = next || new Vec3(site.x, site.y, site.z);
    if (!next && flat(here, site) <= 12) {
      site.lootedAt = new Date().toISOString(); state.cityDoneAt = site.lootedAt; save();
      bot.chat?.(`Done with the ${x.site}: ${state.chests || 0} chests${x.vaults ? ` and ${state.vaults || 0} vaults` : ''} opened.`);
      return 'done';
    }
    goal.step = { action: kind, phase: 'site', target: { x: target.x, y: target.y, z: target.z } }; save();
    const got = await approach(bot, task, state, save, target, actions, next ? 2 : 6);
    // A container that cannot be got to rests after two tries, and the next
    // one is taken: trial 39 walked at a barrel built into a trial chamber's
    // wall of tuff bricks and copper, no path in, for as long as the audit
    // allowed.
    if (next && !got) {
      const key = `${next.x},${next.y},${next.z}`, misses = state.chestMisses ||= {};
      if ((misses[key] = (misses[key] || 0) + 1) >= 2) { setAside(goal, 'loot_chest', key, 'no way to it', 20 * 60000); delete misses[key]; }
      save();
    }
    return 'city';
  }
  const [dx, dz] = HEADINGS[state.heading % 4];
  if (here.y > x.depth + 6) {
    // Down: a staircase along the heading, as the night mine digs.
    const target = new Vec3(Math.floor(here.x) + dx * 16, x.depth, Math.floor(here.z) + dz * 16);
    goal.step = { action: kind, phase: 'descend', depth: Math.round(here.y), target: { x: target.x, y: target.y, z: target.z } }; save();
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
  const leg = new Vec3(Math.floor(here.x) + dx * LEG, x.depth, Math.floor(here.z) + dz * LEG);
  goal.step = { action: kind, phase: 'sweep', legs: state.legs, target: { x: leg.x, y: leg.y, z: leg.z } }; save();
  const moved = await approach(bot, task, state, save, leg, actions, 6);
  if (moved) { state.legs++; state.legFails = 0; }
  else if (++state.legFails >= 4) { state.heading++; state.legFails = 0; delete state.tunnel; }
  save();
  return 'sweep';
}
const deepDarkStep = (bot, task, goal, save, actions) => expeditionStep(bot, task, goal, save, actions, 'deep_dark');

// Toward a point: the pathfinder, then a staircase step. True when it got
// six blocks closer or arrived.
async function approach(bot, task, state, save, target, actions, range) {
  const { valuableInPassing, mineValuableInPassing } = require('./opportunistic-mining');
  // A diamond within four blocks of the way is dug first.
  if (actions.goal && await mineValuableInPassing(bot, task, actions.goal, save, actions)) return true;
  const from = bot.entity.position.clone();
  const gap = () => bot.entity.position.distanceTo(target);
  const start = gap();
  const stopWhen = actions.goal ? () => valuableInPassing(bot, actions.goal) : undefined;
  try { await actions.navigate(bot, task, new goals.GoalNear(target.x, target.y, target.z, range), { timeoutMs: 30000, stallMs: 8000, stopWhen }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  if (gap() <= range + 1 || gap() < start - 6) return true;
  try { await actions.tunnel(bot, task, state, save, target, { dig: actions.dig, navigate: actions.navigate }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; state.lastError = err.message; }
  return bot.entity.position.distanceTo(from) > 1 && gap() < start - 1;
}

// A turn of the trip, packed light first: steps until the time is up, the
// site is done, or a warden sends it home.
async function expeditionTrip(bot, task, goal, save, actions, kind = 'deep_dark', { ms = TRIP_MS } = {}) {
  const trip = require('./trip-kit');
  actions = { ...actions, goal };
  if (actions.place && actions.acquireStep) await trip.packLight(bot, task, goal, save, actions, kind);
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    task.check();
    const did = await expeditionStep(bot, task, goal, save, actions, kind);
    if (did === 'warden' || did === 'done') { trip.tripOver(goal, kind); save(); return did; }
  }
  return 'turn';
}
const deepDarkTrip = (bot, task, goal, save, actions, options) => expeditionTrip(bot, task, goal, save, actions, 'deep_dark', options);

module.exports = { EXPEDITIONS, DEPTH, LEG, expeditionReady, expeditionStep, expeditionTrip, deepDarkReady, deepDarkStep, deepDarkTrip, describe, wardenNear, openVault };
