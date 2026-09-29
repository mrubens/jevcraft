'use strict';
// Piglin bartering: a gold ingot thrown to an adult piglin comes back, after
// it has admired it for a few seconds, as one of its loot table's items.
// Measured on this server: 160 ingots bought 18 ender pearls (about nine
// ingots a pearl) and, along the way, 13 obsidian, soul sand, quartz, string
// and a great deal of gravel and blackstone. It is one of two ways the pearl
// rung is filled; the enderman hunt is the other. The bot barters with the
// gold it carries while it is in the Nether, and hunts otherwise.
//
// A piglin leaves a player wearing gold alone (see danger.js), so a gold
// piece is worn first: carried golden boots, or a pair made from four
// ingots when there are enough to spare.
const { goals } = require('mineflayer-pathfinder');
const { countOf, navigate } = require('./skills');
const { checkAir } = require('./vitals');
const { checkThreats } = require('./danger');
const { setAside, isSetAside } = require('./progress');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// What is picked up afterwards. The rest (gravel, blackstone, spectral
// arrows, leather, water bottles) fills pockets for nothing and is left
// lying. A potion of fire resistance, plain or splash, is kept whatever the
// barter was for: it makes a blaze's fire nothing for three minutes
// (fire-resistance.js, note 656); a water bottle is the same item name and
// is told apart by what it holds.
const KEEP = new Set(['ender_pearl', 'obsidian', 'string', 'fire_charge', 'quartz', 'soul_sand', 'iron_nugget', 'enchanted_book']);
const fireResistance = () => require('./fire-resistance');
const keeps = item => !!item && (KEEP.has(item.name) || fireResistance().isFireResistance(item));
const firePotions = bot => fireResistance().carried(bot).reduce((n, p) => n + (p.item.count || 1), 0);
const ADMIRE_MS = 8000, PER_ROUND = 3, SEARCH = 32;
const GOLD_PIECES = ['golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots'];
const nether = bot => /nether/.test(String(bot.game?.dimension || ''));
const wearingGold = bot => [5, 6, 7, 8].some(slot => /^golden_/.test(bot.inventory?.slots?.[slot]?.name || ''));
const baby = (bot, e) => e.metadata?.[(bot.registry?.entitiesByName?.[e.name]?.metadataKeys || []).indexOf('baby')] === true;
const ingots = bot => countOf(bot, 'gold_ingot'), nuggets = bot => countOf(bot, 'gold_nugget');
// Gold that can be thrown: ingots carried, and nuggets that make ingots.
const goldOnHand = bot => ingots(bot) + Math.floor(nuggets(bot) / 9);

function piglins(bot, goal) {
  const here = bot.entity.position;
  return Object.values(bot.entities || {}).filter(e => e.name === 'piglin' && e.isValid !== false && e.position &&
    e.position.distanceTo(here) <= SEARCH && !baby(bot, e) && !isSetAside(goal, 'barter_piglin', e.id))
    .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
}

// The gold a barter can throw: all of it with a gold piece worn or
// carried; without one, what is left after the four ingots of the golden
// boots made first (wearGold makes them from five or more, one left to
// throw). mid-242-af-fortress-5 (25587) carried three ingots and six
// nuggets and no gold piece: the ladder took the barter by "gold on hand"
// and it failed at once, "No gold to wear", over and over for an hour
// ("loop: flipping detour <-> barter", note 616).
const BOOTS_INGOTS = 4;
const dressed = bot => wearingGold(bot) || (bot.inventory?.items?.() || []).some(i => GOLD_PIECES.includes(i.name));
function barterGold(bot) {
  const total = goldOnHand(bot), worn = dressed(bot);
  return { total, dressed: worn, throwable: worn ? total : Math.max(0, total - BOOTS_INGOTS) };
}
// Said where a barter is not on offer for want of gold to wear.
function barterGoldSays(bot) {
  const g = barterGold(bot);
  if (g.throwable > 0 || !g.total) return null;
  return `gold for ${g.total} ingot${g.total === 1 ? '' : 's'} carried and no gold piece to wear: piglins turn on a player in no gold, golden boots take ${BOOTS_INGOTS} ingots, and one more is needed to throw`;
}

// Whether a barter can happen from here now: in the Nether, gold to throw
// once a gold piece is worn, and a piglin in view.
function barterReady(bot, goal) {
  return nether(bot) && barterGold(bot).throwable > 0 && piglins(bot, goal).length > 0;
}

async function wearGold(bot, task, goal, save, actions) {
  if (wearingGold(bot)) return true;
  const carried = bot.inventory.items().find(i => GOLD_PIECES.includes(i.name));
  if (!carried && ingots(bot) >= 5) {
    goal.step = { action: 'barter_make_gold_boots', ingots: ingots(bot) }; save();
    await actions.acquireStep(bot, task, 'golden_boots', 1, goal, save);
  }
  const piece = bot.inventory.items().find(i => GOLD_PIECES.includes(i.name));
  if (!piece) return false;
  const slot = { golden_helmet: 'head', golden_chestplate: 'torso', golden_leggings: 'legs', golden_boots: 'feet' }[piece.name];
  await bot.equip(piece, slot);
  return wearingGold(bot);
}

// One round: up to three piglins each thrown one ingot, the admiring waited
// out, and what is worth keeping picked up. Returns what the round brought.
async function barterStep(bot, task, goal, save, actions = {}) {
  task.check(); checkAir(bot);
  if (!nether(bot)) throw new Error('Bartering is done in the Nether: piglins turn in the Overworld');
  // Nuggets to ingots when the ingots alone are short of a throw, or of
  // the boots and a throw (barterGold counts the nuggets).
  if ((!ingots(bot) || (!dressed(bot) && ingots(bot) < BOOTS_INGOTS + 1)) && nuggets(bot) >= 9) {
    goal.step = { action: 'barter_make_ingots', nuggets: nuggets(bot) }; save();
    await actions.acquireStep(bot, task, 'gold_ingot', ingots(bot) + Math.floor(nuggets(bot) / 9), goal, save);
  }
  if (!ingots(bot)) throw new Error('No gold to barter with');
  if (!await wearGold(bot, task, goal, save, actions)) throw new Error('No gold to wear: piglins will not barter with a player in no gold');
  const pearlsBefore = countOf(bot, 'ender_pearl'), potionsBefore = firePotions(bot);
  const round = piglins(bot, goal).slice(0, PER_ROUND);
  if (!round.length) throw new Error('No adult piglin in view to barter with');
  const state = goal.barter ||= { thrown: 0, pearls: 0 };
  const ingot = bot.registry.itemsByName.gold_ingot.id;
  const thrownAt = [];
  for (const piglin of round) {
    if (!ingots(bot)) break;
    task.check(); checkThreats(bot);
    if (piglin.position.distanceTo(bot.entity.position) > 4) {
      const p = piglin.position.floored();
      goal.step = { action: 'barter_approach', piglin: piglin.id, distance: Math.round(piglin.position.distanceTo(bot.entity.position)) }; save();
      try { await (actions.navigate || navigate)(bot, task, new goals.GoalNear(p.x, p.y, p.z, 3), { timeoutMs: 10000, stallMs: 3000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'barter_piglin', piglin.id, err, 60000); continue; }
    }
    if (bot.entities[piglin.id] !== piglin || piglin.position.distanceTo(bot.entity.position) > 5) { setAside(goal, 'barter_piglin', piglin.id, 'out of reach', 60000); continue; }
    await bot.lookAt(piglin.position.offset(0, 0.5, 0), true);
    await bot.toss(ingot, null, 1);
    state.thrown++; thrownAt.push(piglin.position.clone());
    // One ingot a piglin at a time: it admires one and ignores the rest.
    setAside(goal, 'barter_piglin', piglin.id, 'admiring', ADMIRE_MS);
    goal.step = { action: 'barter', piglin: piglin.id, thrown: state.thrown, pearls: countOf(bot, 'ender_pearl'), ingotsLeft: ingots(bot) }; save();
  }
  if (!thrownAt.length) return { thrown: 0, pearls: 0, firePotions: 0 };
  for (let waited = 0; waited < ADMIRE_MS; waited += 200) { task.check(); checkAir(bot); await sleep(200); }
  // What the piglins dropped, near where they stood.
  const near = p => thrownAt.some(t => t.distanceTo(p) <= 8);
  // Pearls first, and the fire resistance potions with them.
  const first = e => { const i = e.getDroppedItem(); return i.name === 'ender_pearl' || fireResistance().isFireResistance(i) ? 1 : 0; };
  const loot = () => Object.values(bot.entities).filter(e => { try { return keeps(e.getDroppedItem?.()); } catch (_) { return false; } }).filter(e => e.position && near(e.position))
    .sort((a, b) => first(b) - first(a));
  for (const drop of loot().slice(0, 8)) {
    task.check();
    if (bot.entities[drop.id] !== drop) continue;
    const p = drop.position.floored();
    try { await (actions.navigate || navigate)(bot, task, new goals.GoalNear(p.x, p.y, p.z, 1), { timeoutMs: 6000, stallMs: 2500 }); await sleep(300); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
  const gained = countOf(bot, 'ender_pearl') - pearlsBefore, potions = firePotions(bot) - potionsBefore;
  state.pearls += Math.max(0, gained);
  if (potions > 0) state.firePotions = (state.firePotions || 0) + potions;
  save();
  return { thrown: thrownAt.length, pearls: gained, firePotions: Math.max(0, potions) };
}

// A barter for a fire resistance potion (Jev's barter_fire_resistance,
// fortress_visit, note 656): rounds until one is carried, the gold to throw
// is gone, no piglin is in view, or `maxThrows` are thrown. Pearls and the
// rest are picked up as in any barter. -> { thrown, firePotions, pearls, why }
async function barterForFireResistance(bot, task, goal, save, actions = {}, { maxThrows = Infinity } = {}) {
  const start = firePotions(bot);
  let thrown = 0, pearls = 0, why = 'a potion carried';
  goal.step = { action: 'barter_fire_resistance', ingots: barterGold(bot).throwable, maxThrows: Number.isFinite(maxThrows) ? maxThrows : null }; save();
  while (firePotions(bot) <= start) {
    if (thrown >= maxThrows) { why = `the ${maxThrows} throws chosen are thrown`; break; }
    if (!barterGold(bot).throwable) { why = 'no gold left to throw'; break; }
    if (!barterReady(bot, goal)) { why = 'no adult piglin in view to barter with'; break; }
    const r = await barterStep(bot, task, goal, save, actions);
    thrown += r.thrown; pearls += Math.max(0, r.pearls);
    if (!r.thrown) { why = 'no piglin could be reached to throw to'; break; }
  }
  const got = Math.max(0, firePotions(bot) - start);
  return { thrown, firePotions: got, pearls, why: got ? 'a potion carried' : why };
}

// Gold for bartering from a bastion remembered by exploration.js: a gold
// block is nine ingots. Piglins turn on a player who mines gold where they
// can see it, gold armour or not, so only a block no piglin is within
// sixteen blocks of is taken, and gilded blackstone (a nugget now and then)
// the same way. A trip there is one leg at a time; at the bastion, one block.
const BASTION_GOLD = ['gold_block', 'gilded_blackstone'];
function bastionGold(bot) {
  const ids = BASTION_GOLD.map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  const watchers = Object.values(bot.entities || {}).filter(e => /^piglin/.test(e.name || '') && e.isValid !== false && e.position);
  return bot.findBlocks({ matching: ids, maxDistance: 24, count: 32 })
    .filter(p => watchers.every(e => e.position.distanceTo(p) > 16))
    .sort((a, b) => (bot.blockAt(b)?.name === 'gold_block') - (bot.blockAt(a)?.name === 'gold_block') || a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
}
const bastionKnown = (bot, goal) => require('./exploration').knownLandmarks(bot, goal, 'bastion', 384).length > 0;
async function gatherBastionGold(bot, task, goal, save, actions = {}) {
  task.check(); checkAir(bot); checkThreats(bot);
  const exploration = require('./exploration');
  const raid = require('./bastion-raid');
  // The trip is Jev's (bastion_raid, note 636): the chests too, or only the
  // gold in the walls, or not at all. Asked once and held for the trip.
  const pick = await raid.chooseTrip(bot, task, goal, save, actions);
  if (pick === null || pick === 'leave_it') return false;
  // A raid: packed light first (trip-kit.js), planned to die.
  if (actions.place && actions.acquireStep) await require('./trip-kit').packLight(bot, task, goal, save, actions, 'bastion');
  const arrived = await exploration.goToLandmark(bot, task, goal, save, ['bastion'], { navigate: actions.navigate || navigate, reach: 384, arrive: 20 });
  if (!arrived) { if (arrived === null) throw new Error('No bastion remembered within reach'); return false; }
  // Its chests, only on a raid Jev chose (looting.js reads the flag): gold,
  // and whatever else a bastion keeps. One chest a pass; the raid closes
  // when none is left to open.
  if (pick === 'raid_chests') {
    if (actions.loot && await actions.loot(bot, task, goal, save)) return true;
    if (!require('./looting').lootableChests(bot, goal, { reach: raid.RAID_REACH }).length) { raid.closeRaid(goal); save(); }
  }
  const target = bastionGold(bot)[0];
  if (!target) { setAside(goal, 'landmark_trip', `bastion:${arrived.x},${arrived.z}`, 'no gold here that no piglin can see', 1800000); save(); return false; }
  const name = bot.blockAt(target)?.name, drop = name === 'gold_block' ? 'gold_block' : 'gold_nugget';
  goal.step = { action: 'bastion_gold', block: name, position: { x: target.x, y: target.y, z: target.z } }; save();
  const before = countOf(bot, 'gold_block') + countOf(bot, 'gold_nugget');
  await actions.approachDryMining(bot, task, target, { navigate: actions.navigate || navigate, dig: actions.dig });
  await actions.dig(bot, task, target, { requiredTool: 'iron_pickaxe', requireDrops: name === 'gold_block' });
  if (actions.collectNearbyDrops) await actions.collectNearbyDrops(bot, task, drop, { origin: target, radius: 6, waitForSpawnMs: 800 });
  // Gold blocks go straight to ingots: nine to throw.
  if (countOf(bot, 'gold_block') && actions.acquireStep) await actions.acquireStep(bot, task, 'gold_ingot', countOf(bot, 'gold_ingot') + 9 * countOf(bot, 'gold_block'), goal, save);
  return countOf(bot, 'gold_block') + countOf(bot, 'gold_nugget') + countOf(bot, 'gold_ingot') > before;
}

module.exports = { barterReady, barterGold, barterGoldSays, barterStep, barterForFireResistance, dressed, keeps, goldOnHand, wearingGold, KEEP, bastionGold, bastionKnown, gatherBastionGold };
