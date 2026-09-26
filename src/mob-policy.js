'use strict';
const vanilla = require('../data/vanilla-26.1.json');

// An explicit list of executable encounters. Other loot tables do not become
// acquisition methods until their mechanics have an action implementation.
// A blaze shoots, so a carried bow is used at range before the sword. A
// spider gives the string a bow needs; it is neutral by day and common on the
// surface, and its cost sits below an unobserved cobweb search (20) but above
// a cobweb in view (13). A chicken gives the feathers arrows need; it is
// passive, so the hunt needs no armour, shield or isolation.
const handlers = {
  blaze: { item: 'blaze_rod', dimension: 'nether', ranged: true }, enderman: { item: 'ender_pearl' },
  // Never a chicken (protected-animals.js): arrows come off skeletons.
  spider: { item: 'string', cost: 16 }, skeleton: { item: 'arrow', ranged: true },
  // Leather for a book, and a book for the enchanting table: the only other
  // way the planner knew was rabbit hide, which no action gathers.
  cow: { item: 'leather', passive: true },
};
const armor = suffix => ['iron', 'diamond', 'netherite'].map(material => `${material}_${suffix}`);
const combatGear = {
  hand: armor('sword'), head: armor('helmet'), torso: armor('chestplate'), legs: armor('leggings'),
  // Golden boots last, so they are preferred when carried: piglins leave a
  // player wearing any gold alone, and one armour point is a cheap trade.
  feet: [...armor('boots'), 'golden_boots'], 'off-hand': ['shield'],
};
const armorSlots = { head: 5, torso: 6, legs: 7, feet: 8, 'off-hand': 45 };
function durable(registry, item) {
  const max = item && registry.itemsByName[item.name]?.maxDurability;
  return !!max && max - (item.durabilityUsed || 0) >= Math.max(16, Math.ceil(max * 0.1));
}
function carriedEquipment(bot) {
  return [...bot.inventory.items(), ...Object.values(armorSlots).map(slot => bot.inventory.slots?.[slot])]
    .filter(item => item && durable(bot.registry, item));
}
function equipped(bot, destination) {
  return destination === 'hand' ? bot.heldItem : bot.inventory.slots?.[armorSlots[destination]];
}
function observedDead(bot, entity) {
  const key = bot.registry?.entitiesByName?.[entity.name]?.metadataKeys?.indexOf('health');
  const health = key >= 0 ? entity.metadata?.[key] : undefined;
  return !!bot._defeatedMobs?.has(entity) || (Number.isFinite(health) && health <= 0);
}
// `alsoInHand` lets an encounter that switched to the bow still count as
// equipped: the armour and shield are what the check is for.
function readyEquipment(bot, alsoInHand = []) {
  return Object.entries(combatGear).every(([destination, names]) => {
    const item = equipped(bot, destination);
    return (names.includes(item?.name) || (destination === 'hand' && alsoInHand.includes(item?.name))) && durable(bot.registry, item);
  });
}
// The kit is worn and a weapon is carried, whatever happens to be in hand
// this instant. Judging readiness by the hand made the hunt's claim on its
// quarry lapse the moment the bot placed a block, because it was then
// holding netherrack: it sealed itself in, which cost it the claim, which
// made it seal itself in again. Two blazes, thirteen runs, no rods.
function kitReady(bot) {
  return Object.entries(combatGear).every(([destination, names]) => {
    if (destination === 'hand') return carriedEquipment(bot).some(item => names.includes(item.name));
    const item = equipped(bot, destination);
    return names.includes(item?.name) && durable(bot.registry, item);
  });
}

// Everything that hurts from range, in one place. There were three lists
// and they disagreed: one had the witch and not the crossbow piglin, one the
// reverse, so a piglin with a crossbow counted as a threat at eight blocks
// in one module and at sixteen in another.
// Health and hunger a deliberate fight starts from, and a hunt's claim on
// its quarry holds at. The hunt, the danger layer and the drop down to a
// fight all read this one number.
const FIGHT_FLOOR = 14;
// Something to eat, counting what the vitals will eat when there is
// nothing better: the hunt judged food by the ordinary list only, and with
// rotten flesh in the pack walked home through the portal instead of eating.
function hasFood(bot) {
  const { chooseFood, lastResortFood } = require('./vitals');
  return !!(chooseFood(bot) || lastResortFood(bot));
}
// Fit to start a fight, and to keep a claim on the quarry: one test for the
// hunt, the danger layer and the pocket. They disagreed: the hunt refused
// at seventeen hunger with nothing to eat, the claim did not, so the bot
// left its pocket for claimed blazes, could not begin, and sealed in again.
function fitToFight(bot) {
  return (bot.health ?? 20) >= FIGHT_FLOOR && (bot.food ?? 20) >= FIGHT_FLOOR && kitReady(bot) && ((bot.food ?? 20) >= 18 || hasFood(bot));
}
const SHOOTERS = new Set(['skeleton', 'stray', 'bogged', 'parched', 'pillager', 'witch', 'blaze', 'ghast', 'breeze']);
// A drowned with a trident throws it, as a skeleton shoots: counted a biter
// (a threat within eight blocks), one threw from further off at mid-72-a
// underwater, 4.5 a throw, and nothing answered it (2026-09-26).
const shooter = entity => SHOOTERS.has(entity?.name) || (entity?.name === 'piglin' && entity.heldItem?.name === 'crossbow') ||
  (entity?.name === 'drowned' && entity.heldItem?.name === 'trident');

function mobSources() {
  const sources = {};
  for (const [entity, handler] of Object.entries(handlers)) {
    const table = vanilla.entityLoot?.[entity];
    const pool = table?.pools?.find(pool => pool.entries?.some(entry => entry.type === 'minecraft:item' && entry.name === `minecraft:${handler.item}`));
    if (!pool) continue;
    (sources[handler.item] ||= []).push({ entity, ...handler, lootTable: `minecraft:entities/${entity}`,
      randomDrop: true, requiresPlayerKill: pool.conditions?.some(c => c.condition === 'minecraft:killed_by_player') || false });
  }
  return sources;
}
// The best armour carried is worn, always. The dream run took its spare
// iron set out of the stash after a death and walked about with it in its
// pockets: the kit was worn only by the check before a crossing, and a
// skeleton or two found it in the meantime (2026-09-24). Golden boots on the
// feet in the Nether, where they keep piglins neutral.
// Copper (2026's copper age): ten points a set, between leather's seven and
// gold's eleven, and more durable than either.
const ARMOUR_TIER = { netherite: 6, diamond: 5, iron: 4, turtle: 4, chainmail: 3, golden: 2, copper: 1.5, leather: 1 };
const PIECES = { head: 'helmet', torso: 'chestplate', legs: 'leggings', feet: 'boots' };
async function wearBestArmour(bot) {
  if (typeof bot.equip !== 'function' || !bot.inventory?.items) return 0;
  const nether = /nether/.test(String(bot.game?.dimension || ''));
  const tier = (name, slot) => {
    const m = new RegExp(`^(\\w+?)_${PIECES[slot]}$`).exec(name || '') || (slot === 'head' && name === 'turtle_helmet' ? [0, 'turtle'] : null);
    if (!m) return -1;
    if (slot === 'feet' && nether && name === 'golden_boots') return 100;
    return ARMOUR_TIER[m[1]] ?? 0;
  };
  let changed = 0;
  for (const slot of Object.keys(PIECES)) {
    const worn = bot.inventory.slots?.[armorSlots[slot]];
    const best = bot.inventory.items().filter(i => tier(i.name, slot) >= 0 && durable(bot.registry, i))
      .sort((a, b) => tier(b.name, slot) - tier(a.name, slot))[0];
    if (!best || (worn && tier(worn.name, slot) >= tier(best.name, slot))) continue;
    try { await bot.equip(best, slot); changed++; } catch (_) { /* worn at the next step */ }
  }
  const shield = bot.inventory.items().find(i => i.name === 'shield' && durable(bot.registry, i));
  if (shield && !bot.inventory.slots?.[armorSlots['off-hand']]) { try { await bot.equip(shield, 'off-hand'); changed++; } catch (_) { /* next step */ } }
  return changed;
}

module.exports = { wearBestArmour, handlers, combatGear, armorSlots, durable, carriedEquipment, equipped, readyEquipment, kitReady, mobSources, observedDead, SHOOTERS, shooter, FIGHT_FLOOR, fitToFight, hasFood };
