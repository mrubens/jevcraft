'use strict';
// The chests the world leaves lying about. A ruined portal's chest holds
// gold, obsidian, flint and steel and now and then a golden apple; a
// dungeon's and a temple's, iron, gold, bread, diamonds, string, gunpowder.
// All of it is on the ladder: gold for bartering and the boots that keep
// piglins calm, obsidian and a lighter for the portal, iron for the kit.
//
// Only a chest that is part of a remembered structure (exploration.js) is
// opened: a chest anyone placed, the stash beside the bed included, is not
// loot. Two chests are left alone whatever they hold. A desert temple's
// sit over a pressure plate wired to TNT, so any chest with TNT beside it
// is shunned; and a bastion's anger every piglin that sees the lid lift,
// so nothing in the Nether is opened.
//
// Near one, a chest is looted as a rule, the way a keepsake lying on the
// ground is picked up. A trip to a remembered structure whose chests are
// unopened is one of the idle options (decisions/work.js).
//
// Besides chest blocks: a mineshaft's chests ride in minecarts (entities,
// opened the same way), passed over where a spawner is near (cave spiders);
// a village's chests (bread, iron, now and then diamonds); and in the
// Nether a fortress's, never a bastion's, and only with no piglin in sight.
const { countOf: countCarried } = require('./skills');
const { isKeepsake, isKitMaterial } = require('./home-stash');
const { roomFor, makeRoom } = require('./inventory-tidy');
const { immediateThreat } = require('./danger');
const { setAside, isSetAside } = require('./progress');

const LOOTABLE = ['ruined_portal', 'dungeon', 'jungle_temple', 'desert_temple', 'mineshaft', 'nether_fortress', 'ancient_city', 'trial_chambers', 'bastion'];
const MINESHAFT_REACH = 64, VILLAGE_REACH = 40;
const NEAR = 24, OF_STRUCTURE = 16, HOME_CLEAR = 24;
// What is taken beyond the keepsakes and the kit: what the ladder uses.
// An ancient city's chests add the enchanted books, echo shards and
// diamond gear that make the trip worth its warden.
const LOOT = /^(gold_(ingot|nugget|block)|iron_(ingot|nugget|block)|diamond|diamond_(helmet|chestplate|leggings|boots|sword|pickaxe|axe|hoe|shovel)|obsidian|crying_obsidian|flint_and_steel|fire_charge|ender_pearl|ender_eye|blaze_rod|(enchanted_)?golden_apple|golden_carrot|golden_(helmet|chestplate|leggings|boots)|bucket|water_bucket|lava_bucket|bread|coal|emerald|enchanted_book|echo_shard|experience_bottle|lapis_lazuli|trial_key|ominous_trial_key|heavy_core|netherite_scrap|ancient_debris|netherite_ingot|spectral_arrow|arrow)$/;
const wanted = (bot, name) => LOOT.test(name) || isKeepsake(name) || isKitMaterial(bot, name);
const key = p => `${p.x},${p.y},${p.z}`;
const overworld = bot => /overworld$/.test(String(bot.game?.dimension || 'overworld'));
const where = bot => String(bot.game?.dimension || 'overworld').replace(/^minecraft:/, '').replace(/^the_/, '');
const sameDimension = (bot, l) => !l.dimension || String(l.dimension).replace(/^minecraft:/, '').replace(/^the_/, '') === where(bot);
const piglinInSight = bot => Object.values(bot.entities || {}).some(e => /^piglin/.test(e.name || '') && e.isValid !== false && e.position && e.position.distanceTo(bot.entity.position) <= 32);
const plain = p => ({ x: p.x, y: p.y, z: p.z });

// The structure a chest belongs to, or null: within sixteen blocks
// sideways and twenty-four up or down of a remembered lootable landmark.
function structureOf(goal, p, bot = null) {
  const landmark = (goal.landmarks || []).find(l => LOOTABLE.includes(l.kind) && l.kind !== 'mineshaft' && (bot ? sameDimension(bot, l) : true) &&
    Math.hypot(l.x - p.x, l.z - p.z) <= ({ nether_fortress: 48, ancient_city: 80, trial_chambers: 48, bastion: 48 }[l.kind] || OF_STRUCTURE) && Math.abs((l.y ?? p.y) - p.y) <= 24);
  if (landmark) return landmark;
  // A Nether chest among nether bricks is a fortress's, whichever landmark
  // was recorded: fortresses sprawl, one is remembered per ninety-six
  // blocks, and five chests in the fortress the dream run was hunting were
  // fifty to a hundred blocks from the one it had written down, so none was
  // "a fortress chest" (the user: "why isn't Jev looting the chests?").
  if (bot && /nether/.test(where(bot)) && typeof bot.blockAt === 'function') {
    let bricks = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -2; dz <= 2; dz++) if (/^nether_brick/.test(bot.blockAt(p.offset(dx, dy, dz))?.name || '')) bricks++;
    if (bricks >= 4) return { kind: 'nether_fortress', x: p.x, y: p.y, z: p.z, dimension: 'nether', inferred: true };
  }
  // A village is its own record (villages.js), not a landmark.
  const village = (goal.villages || []).find(v => (bot ? sameDimension(bot, v) : true) && Math.hypot(v.x - p.x, v.z - p.z) <= VILLAGE_REACH);
  if (village) return { kind: 'village', ...village };
  // Any other chest seen: opened, and remembered as opened (goal.looted).
  // Nobody else plays these worlds, and the bot's own (the stash, caches)
  // are kept out by ownChest (the user: "why not just open any chest he
  // sees and then remember it?").
  return bot ? { kind: 'chest', x: p.x, y: p.y, z: p.z, inferred: true } : null;
}

function trapped(bot, p) {
  for (let dx = -3; dx <= 3; dx++) for (let dy = -4; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) {
    if (bot.blockAt(p.offset(dx, dy, dz))?.name === 'tnt') return true;
  }
  return false;
}

function ownChest(goal, p) {
  const home = goal.survival?.home;
  if (home?.stash?.position && key(home.stash.position) === key(p)) return true;
  if (home?.origin && Math.hypot(home.origin.x - p.x, home.origin.z - p.z) <= HOME_CLEAR) return true;
  // Field caches and any chest the bot placed are its own too: with every
  // other chest now open to it, those must never look like loot.
  if ((goal.caches || []).some(c => c.position && key(c.position) === key(p))) return true;
  if ((goal.placedWorkstations || []).some(w => /^chest:/.test(w) && w.replace(/\s/g, '').endsWith(`(${p.x},${p.y},${p.z})`))) return true;
  return [goal.pendingChestDelivery?.position, ...(goal.deliveryEvidence || []).map(e => e.position)].some(q => q && key(q) === key(p));
}

// The unopened structure chests within reach, nearest first.
function lootableChests(bot, goal, { reach = NEAR } = {}) {
  const id = bot.registry?.blocksByName?.chest?.id;
  if (id === undefined || typeof bot.findBlocks !== 'function') return [];
  // In the Nether a fortress's with no piglin looking on, and a bastion's
  // whoever is looking: a bastion raid is packed light and planned to die
  // (trip-kit.js); opening its chests turns the piglins, and that is the raid.
  if (!overworld(bot) && !/nether/.test(where(bot))) return [];
  const watched = !overworld(bot) && piglinInSight(bot);
  const here = bot.entity.position, looted = goal.looted || {};
  return bot.findBlocks({ matching: id, maxDistance: reach, count: 16 })
    .filter(p => { const s = !looted[key(p)] && !isSetAside(goal, 'loot_chest', key(p)) && !ownChest(goal, p) && structureOf(goal, p, bot);
      return s && (overworld(bot) || (['nether_fortress', 'chest'].includes(s.kind) && !watched) || s.kind === 'bastion') && !trapped(bot, p); })
    .sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
}

// Chest minecarts near a remembered mineshaft, none with a spawner near.
const cartKey = e => `cart:${e.uuid || e.id}`;
function spawnerNear(bot, p, r = 10) {
  const id = bot.registry?.blocksByName?.spawner?.id;
  return id !== undefined && typeof bot.findBlocks === 'function' && bot.findBlocks({ matching: id, point: p, maxDistance: r, count: 1 }).length > 0;
}
function lootableMinecarts(bot, goal, { reach = NEAR } = {}) {
  if (!overworld(bot)) return [];
  const shafts = (goal.landmarks || []).filter(l => l.kind === 'mineshaft' && sameDimension(bot, l));
  if (!shafts.length) return [];
  const here = bot.entity.position, looted = goal.looted || {};
  return Object.values(bot.entities || {}).filter(e => e.name === 'chest_minecart' && e.isValid !== false && e.position &&
    e.position.distanceTo(here) <= reach && !looted[cartKey(e)] && !isSetAside(goal, 'loot_chest', cartKey(e)) &&
    shafts.some(l => Math.hypot(l.x - e.position.x, l.z - e.position.z) <= MINESHAFT_REACH) && !spawnerNear(bot, e.position.floored()))
    .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
}

// A landmark's chests are done once it has been stood at and none of them
// is left unopened: an idle trip is not offered to it again.
function markLandmarkLooted(bot, goal, now = Date.now()) {
  const here = bot.entity.position;
  for (const l of goal.landmarks || []) {
    if (!LOOTABLE.includes(l.kind) || l.lootedAt || !sameDimension(bot, l) || Math.hypot(l.x - here.x, l.z - here.z) > (l.kind === 'mineshaft' ? 24 : 12)) continue;
    if (l.kind === 'mineshaft' ? !lootableMinecarts(bot, goal, { reach: MINESHAFT_REACH }).length
      : !lootableChests(bot, goal, { reach: 32 }).some(p => { const s = structureOf(goal, p, bot); return s && s.x === l.x && s.z === l.z; })) l.lootedAt = now;
  }
}

function phraseTaken(took) {
  const parts = Object.entries(took).map(([name, n]) => `${n} ${name.replaceAll('_', ' ')}`);
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

// What is wanted out of an open container, as room allows.
async function takeWanted(bot, task, window) {
  const took = {}, left = {};
  // Counted in the window's own copy of the pockets: while it is open that is
  // what mineflayer updates, and the first drill's record said nothing had
  // been taken with the bread and the iron already in hand.
  const countOf = (b, name) => Array.isArray(window.slots) && Number.isInteger(window.inventoryStart)
    ? window.slots.slice(window.inventoryStart, window.inventoryEnd).filter(i => i?.name === name).reduce((n, i) => n + i.count, 0)
    : countCarried(b, name);
  try {
    for (const item of window.containerItems()) {
      task.check();
      if (!wanted(bot, item.name)) { left[item.name] = (left[item.name] || 0) + item.count; continue; }
      if (!roomFor(bot, item.name)) { left[item.name] = (left[item.name] || 0) + item.count; continue; }
      const before = countOf(bot, item.name);
      try { await window.withdraw(item.type, item.metadata ?? null, item.count); }
      catch (_) { /* the pockets filled part way */ }
      const got = countOf(bot, item.name) - before;
      if (got > 0) took[item.name] = (took[item.name] || 0) + got;
      if (got < item.count) left[item.name] = (left[item.name] || 0) + item.count - Math.max(0, got);
    }
  } finally { window.close(); }
  return { took, left };
}

// Open one chest and take what is wanted. The record says what was taken
// and what was left, so the chest is not opened again.
async function lootChest(bot, task, goal, save, position, { approach, open, now = Date.now() } = {}) {
  const structure = structureOf(goal, position, bot);
  goal.step = { action: 'loot_chest', structure: structure?.kind, position: plain(position) }; save();
  const block = await approach(bot, task, 'chest', [position]);
  if (!block) { setAside(goal, 'loot_chest', key(position), 'could not reach the lid', 1800000); save(); return false; }
  const { took, left } = await takeWanted(bot, task, await open(bot, task, block));
  (goal.looted ||= {})[key(position)] = { at: now, structure: structure?.kind, took, left };
  markLandmarkLooted(bot, goal, now);
  save();
  const where = structure ? `the ${structure.kind.replaceAll('_', ' ')}'s chest` : 'a chest';
  bot.chat?.(Object.keys(took).length ? `Opened ${where}: ${phraseTaken(took)}.` : `Opened ${where}; nothing in it I can use.`);
  return true;
}

// A mineshaft's minecart: walked up to and opened as an entity.
async function lootMinecart(bot, task, goal, save, cart, { navigate, openEntity = (b, t, e) => b.openContainer(e), now = Date.now() } = {}) {
  const { goals } = require('mineflayer-pathfinder');
  const p = cart.position.floored();
  goal.step = { action: 'loot_minecart', position: plain(p) }; save();
  if (cart.position.distanceTo(bot.entity.position) > 3) await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2), { timeoutMs: 30000, stallMs: 6000 });
  if (bot.entities[cart.id] !== cart || cart.position.distanceTo(bot.entity.position) > 4) { setAside(goal, 'loot_chest', cartKey(cart), 'could not reach the minecart', 1800000); save(); return false; }
  const { took, left } = await takeWanted(bot, task, await openEntity(bot, task, cart));
  (goal.looted ||= {})[cartKey(cart)] = { at: now, structure: 'mineshaft', position: plain(p), took, left };
  markLandmarkLooted(bot, goal, now);
  save();
  bot.chat?.(Object.keys(took).length ? `Opened a minecart chest in the mineshaft: ${phraseTaken(took)}.` : 'Opened a minecart chest in the mineshaft; nothing in it I can use.');
  return true;
}

// The rule: a structure chest or a mineshaft's minecart within reach, the
// bot unthreatened and able to carry something more, is opened. Returns
// whether one was.
async function lootNearby(bot, task, goal, save, actions) {
  if (bot.game?.gameMode === 'creative' || immediateThreat(bot) || (bot.health ?? 20) < 10) return false;
  const chest = lootableChests(bot, goal)[0];
  if (!chest) {
    const cart = actions.navigate && lootableMinecarts(bot, goal)[0];
    if (!cart) return false;
    if ((bot.inventory.emptySlotCount?.() ?? 1) === 0 && actions.makeRoom !== false) await (actions.makeRoom || makeRoom)(bot, task, 'gold_ingot');
    try { return await lootMinecart(bot, task, goal, save, cart, actions); }
    catch (err) {
      task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      setAside(goal, 'loot_chest', cartKey(cart), err, 1800000); save(); return false;
    }
  }
  if ((bot.inventory.emptySlotCount?.() ?? 1) === 0 && actions.makeRoom !== false) await (actions.makeRoom || makeRoom)(bot, task, 'gold_ingot');
  try { return await lootChest(bot, task, goal, save, chest, actions); }
  catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    setAside(goal, 'loot_chest', key(chest), err, 1800000); save(); return false;
  }
}

// For the idle option: remembered structures whose chests are not done.
function unlootedLandmarks(bot, goal, reach = 256) {
  if (!overworld(bot)) return [];
  const here = bot.entity?.position;
  if (!here) return [];
  return (goal.landmarks || []).filter(l => LOOTABLE.includes(l.kind) && !['nether_fortress', 'ancient_city', 'trial_chambers', 'bastion'].includes(l.kind) && !l.lootedAt && sameDimension(bot, l) &&
    !isSetAside(goal, 'landmark_trip', `${l.kind}:${l.x},${l.z}`) && atLevel(l, here))
    .map(landmark => ({ landmark, distance: Math.round(Math.hypot(landmark.x - here.x, landmark.y - here.y, landmark.z - here.z)) }))
    .filter(l => l.distance <= reach).sort((a, b) => a.distance - b.distance);
}
// Near the bot's own height: a mineshaft forty-seven blocks under the base
// was "two blocks away" by the map, and the walk there, which judges only
// the map, stopped on the grass above a dungeon and looted nothing (the
// user, 2026-09-24: "there is no mineshaft ... it just runs around"). A
// buried one is offered once the bot is down at its depth.
const LOOT_LEVEL = 12;
const atLevel = (l, here) => l.y === undefined || Math.abs(l.y - here.y) <= LOOT_LEVEL;

// The idle trip: walk to the nearest such structure and open what is there.
// A structure stood at with no chest found is done.
async function lootStep(bot, task, goal, save, actions) {
  const exploration = require('./exploration');
  const arrived = await exploration.goToLandmark(bot, task, goal, save, LOOTABLE, { navigate: actions.navigate, reach: 256, arrive: 10, filter: l => !l.lootedAt && atLevel(l, bot.entity.position) });
  if (!arrived) return false;
  if (await lootNearby(bot, task, goal, save, actions)) return true;
  if (!lootableChests(bot, goal, { reach: 32 }).length && !lootableMinecarts(bot, goal, { reach: MINESHAFT_REACH }).length) { arrived.lootedAt = Date.now(); save(); }
  return false;
}

module.exports = { LOOTABLE, wanted, structureOf, trapped, lootableChests, lootableMinecarts, lootChest, lootMinecart, lootNearby, lootStep, unlootedLandmarks, markLandmarkLooted, phraseTaken, spawnerNear };
