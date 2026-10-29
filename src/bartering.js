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
  // The Nether's gold ore mined for the barter (note 2185): with no gold to throw, ore within 32 and a pickaxe, up to
  // nine ingots' worth of ore is mined (acquireStep plans the ore, the nuggets and the ingot), two minutes at most.
  // Short of the gold the barter wants in hand (note 2193): a throw once a gold piece is worn, or the boots' four and a
  // throw with none worn. mid-231-dk-nether-1 (25600, 2026-10-26 10:40Z) dug 29 nuggets, three ingots' worth, and the
  // step then failed 'No gold to wear' on every pass: the mining ran only with no gold at all.
  const inHand = () => ingots(bot) + Math.floor(nuggets(bot) / 9);
  const shortOf = dressed(bot) ? 1 : BOOTS_INGOTS + 1;
  // Chosen as the pearls' way (pearl_order mine_gold_for_barter), the ore is mined to the ingots it promised whatever
  // gold is in hand (note 2407): full-25 (25587, 2026-10-28 17:57Z) and full-24 (25588) chose it with an ingot carried,
  // nothing was mined, and the step ended at once 'No adult piglin in view to barter with'.
  const chosenToMine = goal?.pearlOrder?.pick === 'mine_gold_for_barter';
  if ((inHand() < shortOf || (chosenToMine && inHand() < 9)) && actions.acquireStep && bot.inventory.items().some(i => /_pickaxe$/.test(i.name))) {
    let near = 0; try { const id = bot.registry?.blocksByName?.nether_gold_ore?.id; near = id !== undefined && typeof bot.findBlocks === 'function' ? bot.findBlocks({ matching: id, maxDistance: 32, count: 64 }).length : 0; } catch (_) { near = 0; }
    if (near) {
      const want = Math.max(shortOf, Math.min(9, Math.floor(near * 4 / 9)));
      goal.step = { action: 'barter_mine_gold', ores: near, ingotsWanted: want }; save();
      bot.chat?.(`Gold ore in sight: mining it to barter with the piglins.`);
      // The nether gold ore itself, dug block by block (note 2187): asked for gold ingots, the planner's way was the
      // Overworld's gold ore, and mid-231-dk-nether-1 (25600, 2026-10-26 10:07Z) chose this way with 64 nether gold
      // ores within 32 blocks and went back through its portal to mine gold ore at y 16.
      const { goals } = require('mineflayer-pathfinder');
      const id = bot.registry.blocksByName.nether_gold_ore.id, tried = new Set(), until = Date.now() + 120000;
      let dug = 0;
      try {
        while (Date.now() < until && dug < 40 && nuggets(bot) + 9 * ingots(bot) < 9 * want) {
          task.check(); checkAir(bot);
          const here = bot.entity.position;
          const ore = bot.findBlocks({ matching: id, maxDistance: 32, count: 16 }).filter(p => !tried.has(`${p}`)).sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
          if (!ore) break;
          tried.add(`${ore}`);
          // A route search that ran out of time is not a way found closed (note 2439, as the walk back's 2397): once more with
          // four times the time to think, then straight at the ore through the netherrack. full-36 (25590, 2026-10-28
          // 22:0x to 22:2xZ) and full-28 (25589) dug 0 nether gold ore go after go, their walks to the ore ending 'Took to
          // long to decide path to goal!' 46 times.
          let walkErr = null;
          try { await actions.navigate(bot, task, new goals.GoalNear(ore.x, ore.y, ore.z, 2), { timeoutMs: 15000, stallMs: 5000 }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; walkErr = err; }
          if (walkErr && /Took to long to decide path/i.test(String(walkErr.message || walkErr)) && bot.pathfinder) {
            const think = bot.pathfinder.thinkTimeout; bot.pathfinder.thinkTimeout = Math.max(20000, 4 * (think || 5000));
            try { await actions.navigate(bot, task, new goals.GoalNear(ore.x, ore.y, ore.z, 2), { timeoutMs: 30000, stallMs: 6000 }); walkErr = null; }
            catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; walkErr = err; }
            finally { if (think === undefined) delete bot.pathfinder.thinkTimeout; else bot.pathfinder.thinkTimeout = think; }
          }
          if (walkErr && ore.distanceTo(bot.entity.position) <= 24) {
            try { await require('./bridging').tunnelStraight(bot, task, ore, { maxSteps: 24, navigate: actions.navigate, down: true }); walkErr = null; }
            catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; walkErr = err; }
          }
          if (walkErr) { console.log(`[barter] the way to the gold ore at ${ore} came to nothing: ${String(walkErr.message || walkErr).slice(0, 100)}`); continue; }
          const block = bot.blockAt(ore);
          if (block?.name !== 'nether_gold_ore' || block.position.distanceTo(bot.entity.position) > 5) continue;
          const pick = bot.inventory.items().find(i => /_pickaxe$/.test(i.name));
          if (!pick) break;
          // The game's rule (note 2507): a piglin that sees the player break gold ore turns on it, and so does every piglin
          // about it. Not dug while one within sixteen blocks has a line to the bot; the next ore is tried. full-93 (25587,
          // 2026-10-29 15:12Z) dug nether gold ore for a barter at health 20 among piglins and was slain by them.
          const watching = (() => { try { const eye = bot.entity.position.offset(0, 1.62, 0); return Object.values(bot.entities || {}).filter(e => /^piglin(_brute)?$/.test(e.name || '') && e.position.distanceTo(bot.entity.position) <= 16 && require('./danger').lineClear(bot, e.position.offset(0, 1.7, 0), eye)); } catch (_) { return []; } })();
          if (watching.length) { console.log(`[barter] the gold ore at ${ore} not dug: ${watching.length} piglin${watching.length === 1 ? '' : 's'} within 16 blocks see${watching.length === 1 ? 's' : ''} the bot, and breaking gold ore in a piglin's sight turns every piglin about on it`); continue; }
          await bot.equip(pick, 'hand');
          try { await bot.dig(block); dug++; } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; continue; }
          await sleep(700);
        }
      } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      console.log(`[barter] dug ${dug} nether gold ore: ${nuggets(bot)} nuggets and ${ingots(bot)} ingots carried`);
      // Each go kept for the option's words (note 2431): what the mining came to, said when it is offered again.
      { const f = bot.entity.position; (goal.barterMineGoes ||= []).push({ at: Date.now(), dug, tried: tried.size, x: Math.round(f.x), z: Math.round(f.z) }); goal.barterMineGoes = goal.barterMineGoes.slice(-10); save(); }
      if (nuggets(bot) >= 9) {
        goal.step = { action: 'barter_make_ingots', nuggets: nuggets(bot) }; save();
        try { await actions.acquireStep(bot, task, 'gold_ingot', ingots(bot) + Math.floor(nuggets(bot) / 9), goal, save); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      }
    }
  }
  if (!ingots(bot)) throw new Error('No gold to barter with');
  if (!await wearGold(bot, task, goal, save, actions)) throw new Error('No gold to wear: piglins will not barter with a player in no gold');
  const pearlsBefore = countOf(bot, 'ender_pearl'), potionsBefore = firePotions(bot);
  const round = piglins(bot, goal).slice(0, PER_ROUND);
  // The piglins in view and set aside said with it (note 2461): 'no adult piglin in view' was said with piglins in view
  // whose walk had failed or who were admiring an ingot, and the barter was chosen again on it. full-64 (25587,
  // 2026-10-29 07:2xZ) failed the barter step 24 times running so, down from 10 ingots to 1, no pearl gained.
  if (!round.length) {
    const here = bot.entity.position;
    const aside = Object.values(bot.entities || {}).filter(e => e.name === 'piglin' && e.isValid !== false && e.position && e.position.distanceTo(here) <= SEARCH && !baby(bot, e) && isSetAside(goal, 'barter_piglin', e.id));
    const asideSays = aside.length ? `${aside.length} adult piglin${aside.length === 1 ? '' : 's'} in view, each set aside for up to a minute (admiring an ingot thrown, or the walk to it failed: no way to it from here), the nearest ${Math.round(aside[0].position.distanceTo(here))} blocks off` : 'no adult piglin in view';
    throw new Error(`No piglin free to barter with: ${asideSays}; ${ingots(bot)} gold ingot${ingots(bot) === 1 ? '' : 's'} carried`);
  }
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
