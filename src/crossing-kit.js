'use strict';
// What the bot carries across into the Nether, item by item: what is in the
// pockets against what the code would take and why. These were gates, one
// after another between "Nether first" and the portal (forty food points,
// sixteen health, a hundred and twenty-eight blocks, a spare pickaxe, eight
// logs and a table, the valuables walked home), each reasonable alone and
// together a second ladder that neither the strategy question nor the
// crossing itself ever said (the decision review, 2026-09-26). A player
// crosses with a stack of blocks, a few steaks and a pickaxe. Now each is a
// fact said to Jev, and topping any of them up is Jev's choice (work.js
// crossingKitReady, the crossing_kit question).
const { countOf, pickaxeDurability, pickaxeTier } = require('./skills');
const { foodSupply } = require('./foraging');
const { safeFood } = require('./vitals');
const { NETHER_FOOD_POINTS } = require('./home-stash');

// Health the code would cross at.
const NETHER_HEALTH = 16;
// Blocks for bridging, pillaring and pockets in the Nether: mid-87-k came
// out of its portal on an island in the lava sea with fifty-odd, bridged
// forty blocks east, found no shore, and stood on the island with eighteen
// while every leg of the fortress sweep failed (2026-09-26).
const NETHER_BLOCKS = 128;
const netherBlocks = bot => ['cobblestone', 'cobbled_deepslate', 'netherrack', 'blackstone', 'stone', 'deepslate', 'dirt'].reduce((n, name) => n + countOf(bot, name), 0);
// The pickaxe that goes down must have enough left to come back up.
const SPARE_PICKAXE_DURABILITY = 24;
// Eight logs: sticks for two tools and fuel for a dozen smelts.
const EXPEDITION_LOGS = 8;
const logsCarried = bot => bot.inventory.items().filter(i => /_log$/.test(i.name)).reduce((n, i) => n + i.count, 0);
const words = s => String(s).replaceAll('_', ' ');

// The kit, item by item: { key, short, carried, wants, says }. Food and
// health only where monsters are; all of it only in Survival.
function kitItems(bot) {
  if (bot.game?.gameMode !== 'survival') return [];
  const items = [];
  if (bot.game?.difficulty !== 'peaceful') {
    const food = foodSupply(bot);
    const meals = bot.inventory.items().filter(i => safeFood(bot, i)).map(i => `${i.count} ${words(i.name)}`).join(', ');
    items.push({ key: 'food', short: food < NETHER_FOOD_POINTS, carried: food, wants: NETHER_FOOD_POINTS,
      says: `Food: ${food} food points carried (${meals || 'nothing to eat'}); the code would take ${NETHER_FOOD_POINTS}, about ${Math.ceil(NETHER_FOOD_POINTS / 8)} cooked steaks' worth (a steak or a cooked porkchop is eight, bread five). Health comes back only while hunger stays at eighteen or more, and a fortress trip is fighting and running; in the Nether, hoglins are the meat and little else is food.` });
    const health = Math.round(bot.health ?? 20), hunger = bot.food ?? 20;
    const back = health >= NETHER_HEALTH ? '' : hunger >= 18
      ? ` At hunger ${hunger} it comes back about a point every four seconds: about ${(NETHER_HEALTH - health) * 4} seconds to ${NETHER_HEALTH}.`
      : ` At hunger ${hunger} none comes back until the bot has eaten to eighteen.`;
    items.push({ key: 'health', short: health < NETHER_HEALTH, carried: health, wants: NETHER_HEALTH,
      says: `Health: ${health} of 20; the code would step through at ${NETHER_HEALTH} or more. The far side of a portal can be a fight at once: a blaze's fireball is about five, a wither skeleton's blade about eight, before armour.${back}` });
  }
  const blocks = netherBlocks(bot);
  items.push({ key: 'blocks', short: blocks < NETHER_BLOCKS, carried: blocks, wants: NETHER_BLOCKS,
    says: `Blocks: ${blocks} carried for bridging and pillaring (cobblestone, netherrack, dirt and the like); the code would take ${NETHER_BLOCKS}, two stacks. A portal can open on a ledge or an island over the lava sea, a bridge takes a block a step, and netherrack there is mined for more with any pickaxe.` });
  const picks = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name));
  const uses = pickaxeDurability(bot), tier = pickaxeTier(bot);
  const best = Number.isFinite(uses) ? uses : null;
  const shortPick = tier < 2 || (best !== null && best < SPARE_PICKAXE_DURABILITY);
  items.push({ key: 'pickaxe', short: shortPick, carried: best ?? 0, wants: SPARE_PICKAXE_DURABILITY,
    says: `Pickaxe: ${picks.length ? `${picks.map(i => words(i.name)).join(', ')} carried, the best with ${best ?? 'many'} uses left` : 'none carried'}; the code would take a stone one or better with at least ${SPARE_PICKAXE_DURABILITY} uses, or a spare: the way out of a pocket, a fortress wall or a buried portal is dug. A stone pickaxe is three cobblestone or blackstone and two sticks.` });
  // A piece of gold worn: piglins leave a player wearing one be, and go for
  // one with none on sight. mid-242-g crossed in iron with no gold, a piglin
  // hit it from twenty to eight in two blows and the second threw it into
  // the lava (2026-09-27). Golden boots are worn in the Nether when carried
  // (mob-policy.js).
  const gold = bot.inventory.items().concat([5, 6, 7, 8].map(s => bot.inventory.slots?.[s]).filter(Boolean)).filter(i => /^golden_(helmet|chestplate|leggings|boots)$/.test(i?.name || ''));
  items.push({ key: 'gold', short: !gold.length, carried: gold.length, wants: 1,
    says: `Gold: ${gold.length ? `${gold.map(i => words(i.name)).join(', ')} carried, worn in the Nether` : 'no piece of golden armour carried'}; the code would take one piece, golden boots (four gold ingots). Piglins, in the crimson forests and the wastes, leave a player wearing a piece of gold be, and go for one wearing none on sight: about eight a hit with a gold sword before armour, and a hit near the lava sea is a throw.` });
  const logs = logsCarried(bot), table = countOf(bot, 'crafting_table') > 0;
  items.push({ key: 'wood', short: logs < EXPEDITION_LOGS || !table, carried: logs, wants: EXPEDITION_LOGS,
    says: `Wood: ${logs} logs and ${table ? 'a crafting table' : 'no crafting table'} carried; the code would take ${EXPEDITION_LOGS} logs and a table: sticks for the next tools and a table to make them at. The Nether's only trees are the crimson and warped fungi of its forests.` });
  return items;
}

// The valuables and where they could be left: the home's chest in reach (a
// walk there and back), or a chest put down here when home is too far.
function valuablesAt(bot, goal) {
  if (bot.game?.gameMode !== 'survival' || !/overworld/.test(String(bot.game?.dimension || 'overworld'))) return null;
  const { homeOf, homeDistance, HOME_REACH } = require('./home-base');
  const { stashDeposits } = require('./home-stash');
  const { isSetAside } = require('./progress');
  const home = homeOf(bot, goal);
  if (home?.stash?.position && homeDistance(bot, home) <= HOME_REACH) {
    if (isSetAside(goal, 'stash', 'chest') || isSetAside(goal, 'stash', 'valuables')) return null;
    const moves = stashDeposits(bot, home, { valuables: true }).filter(m => m.valuable);
    if (!moves.length) return null;
    const far = Math.round(homeDistance(bot, home));
    return { how: 'stash', far, what: moves.map(m => `${m.count} ${words(m.item)}`).join(', ') };
  }
  const cache = require('./field-cache').cacheOffer(bot, goal);
  return cache ? { how: 'cache', what: cache.what, chest: cache.chest, spends: cache.spends } : null;
}

// One line for the strategy question: what the crossing would be short of
// now, so "Nether first" is weighed knowing what the kit asks.
function kitSummary(bot, goal) {
  let short, valuables;
  try { short = kitItems(bot).filter(i => i.short); valuables = valuablesAt(bot, goal); } catch (_) { return ''; }
  const parts = short.map(i => i.key === 'wood' ? `${i.carried} of ${i.wants} logs${countOf(bot, 'crafting_table') ? '' : ' and no crafting table'}`
    : i.key === 'pickaxe' ? `a pickaxe with ${i.carried} of ${i.wants} uses` : i.key === 'health' ? `${i.carried} of ${i.wants} health`
      : i.key === 'gold' ? 'a piece of gold to wear (piglins go for a player with none)'
      : `${i.carried} of ${i.wants} ${i.key === 'food' ? 'food points' : 'blocks'}`);
  if (valuables) parts.push(`valuables carried (${valuables.what})${valuables.how === 'stash' ? `, the home chest ${valuables.far} blocks away` : ''}`);
  return parts.length ? ` At the portal the kit is said and topping any of it up is a choice, not a wait: short now of ${parts.join('; ')}.`
    : ' The kit for the crossing (food, blocks, a pickaxe, gold, wood) is carried.';
}

module.exports = { kitItems, valuablesAt, kitSummary, netherBlocks, logsCarried, NETHER_HEALTH, NETHER_BLOCKS, SPARE_PICKAXE_DURABILITY, EXPEDITION_LOGS };
