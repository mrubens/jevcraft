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
  spider: { item: 'string', cost: 16 }, chicken: { item: 'feather', passive: true },
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
function readyEquipment(bot) {
  return Object.entries(combatGear).every(([destination, names]) => {
    const item = equipped(bot, destination);
    return names.includes(item?.name) && durable(bot.registry, item);
  });
}
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
module.exports = { handlers, combatGear, armorSlots, durable, carriedEquipment, equipped, readyEquipment, mobSources, observedDead };
