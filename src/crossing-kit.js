'use strict';
// What the bot carries across into the Nether, item by item: what is in the
// pockets against what the code would take and why. These were gates, one
// after another between "Nether first" and the portal (forty food points,
// sixteen health, a hundred and twenty-eight blocks, a spare pickaxe, eight
// logs and a table, the valuables walked home), each reasonable alone and
// together a second ladder that neither the strategy question nor the
// crossing itself ever said (the decision review, 2026-09-26). A player
// crosses with a stack of blocks, food for the stay and a pickaxe. Now each is a
// fact said to Jev, and topping any of them up is Jev's choice (work.js
// crossingKitReady, the crossing_kit question).
const { countOf, pickaxeDurability, pickaxeTier } = require('./skills');
const { foodSupply, lastResortSupply } = require('./foraging');
const { safeFood } = require('./vitals');

// The Nether stay the goal still needs, and the food for it. A practiced
// player has the six blaze rods and twelve ender pearls about two hours
// after reaching the Nether (the pace every question is told): the rods at
// a fortress, the pearls by piglin barter or a warped forest's endermen,
// about an hour each. Hunger over a stay: 99.5 hours of the trials' Nether
// time (flight records of 2026-09-27 and 28) healed 23.8 health an hour,
// and each point healed spends a hunger point and a half, 36 an hour on
// healing alone, the food bar falling 23.8 an hour after the saturation
// spent first; with the walking, sprinting and fighting beside it, forty
// an hour. The kit used to want forty points whatever the stay, and the
// fortress cohort of 2026-09-28 sat for minutes at a time under eight
// health, hunger under eighteen and nothing to eat, most of those
// stretches ending in a death (note 607).
const NETHER_HUNGER_AN_HOUR = 40;
const { need, rodsFor, EYES_WANTED } = require('./eye-need');
// Six rods and twelve pearls were the stay's numbers while the ladder wanted
// eight and sixteen; both read eye-need.js now (seven rods, thirteen pearls).
const STAY_FOR = { rods: { count: rodsFor(EYES_WANTED), minutes: 60 }, pearls: { count: EYES_WANTED, minutes: 60 } };
function netherStay(bot, goal = null) {
  const wants = need(bot, goal);
  const { rodsLeft, pearlsLeft } = wants;
  const minutes = Math.max(30, Math.round(STAY_FOR.rods.minutes * rodsLeft / STAY_FOR.rods.count + STAY_FOR.pearls.minutes * pearlsLeft / STAY_FOR.pearls.count));
  // Whole cooked steaks' worth: a steak or a cooked porkchop is eight.
  const points = Math.ceil(minutes / 60 * NETHER_HUNGER_AN_HOUR / 8) * 8;
  return { minutes, points, rodsLeft, pearlsLeft, rodsWanted: wants.rodsWanted, pearlsWanted: wants.pearlsWanted, eyes: wants.target };
}
function staySays(stay) {
  const left = [stay.rodsLeft ? `${stay.rodsLeft} blaze rod${stay.rodsLeft === 1 ? '' : 's'}` : null, stay.pearlsLeft ? `${stay.pearlsLeft} ender pearl${stay.pearlsLeft === 1 ? '' : 's'}` : null].filter(Boolean);
  const hours = stay.minutes >= 90 ? `about ${Math.round(stay.minutes / 30) / 2} hours` : `about ${stay.minutes} minutes`;
  return `${left.length ? `The goal still needs ${left.join(' and ')} (it wants ${stay.rodsWanted} rod${stay.rodsWanted === 1 ? '' : 's'} and ${stay.pearlsWanted} pearls in all, for ${stay.eyes} eyes: an eye is a pearl and a blaze powder, a rod makes two powder, the portal takes twelve and the stronghold search throws with a thirteenth): a practiced player takes ${hours} in the Nether for them (the rods at a fortress, the pearls by piglin barter or a warped forest's endermen, or the Overworld's endermen by night instead)` : `The goal needs nothing more from the Nether's fortress or barter: ${hours} is the stay counted`}. ` +
    `A stay spends about ${NETHER_HUNGER_AN_HOUR} hunger an hour (the bot's own Nether time healed about 24 health an hour, a hunger point and a half each, besides the walking and fighting), so ${hours} is about ${stay.points} food points, ${stay.points / 8} cooked steaks or porkchops; raw meat counts at its raw points (three a beef or porkchop), and cooking it before the crossing makes it eight.`;
}

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

// What the health is in Nether terms, through what is worn: a blaze's
// fireball (combat-estimate MOBS, afterArmour) and the five seconds of burn
// each that lands sets, about one a second that armour does not stop (note
// 512), and a wither skeleton's blade. "Health 9" was a number; the four
// low-health deaths of 2026-09-27 went on told no more (note 515).
function netherHitSays(bot) {
  const { MOBS, afterArmour, armourOf, FIRE_TICKS, landingsApart, landingsToEnd } = require('./combat-estimate');
  const r = n => Math.round(n * 10) / 10;
  const names = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
  const worn = armourOf(names);
  const hp = r(bot.health ?? 20), hunger = bot.food ?? 20;
  // The fire a landing sets is four ticks (combat-estimate FIRE_TICKS, note 631), not five.
  const hit = r(afterArmour(MOBS.blaze.hit, worn)), burn = (MOBS.blaze.burns || 0) * FIRE_TICKS.fireball, blade = r(afterArmour(MOBS.wither_skeleton.hit, worn));
  const fireballs = Math.max(1, landingsApart(hp, hit) || 1), inOne = Math.max(1, landingsToEnd(hp, hit) || 1);
  const back = hunger >= 18 ? 'coming back about one each four seconds at hunger ' + hunger : `not coming back at hunger ${hunger}, under eighteen`;
  return `One blaze fireball through what is worn (${names.length ? names.map(words).join(', ') : 'no armour'}): about ${hit} hit and ${burn} burn over the next five seconds (four ticks of fire; ${r(hit + burn)} for one landing); a wither skeleton's blade about ${blade}, and wither on top. Health ${hp}, ${back}: about ${fireballs} fireball${fireballs === 1 ? '' : 's'} end${fireballs === 1 ? 's' : ''} it, each from its own volley${inOne !== fireballs ? `; ${inOne} within one volley, whose fire is one fire` : ''}.`;
}

// The kit, item by item: { key, short, carried, wants, says }. Food and
// health only where monsters are; all of it only in Survival.
function kitItems(bot) {
  if (bot.game?.gameMode !== 'survival') return [];
  const items = [];
  if (bot.game?.difficulty !== 'peaceful') {
    const food = foodSupply(bot), last = lastResortSupply(bot);
    const meals = bot.inventory.items().filter(i => safeFood(bot, i)).map(i => `${i.count} ${words(i.name)}`).join(', ');
    const lastSays = last.points ? ` Beside it, ${last.points} points in the last resort, not counted: ${last.says}.` : '';
    const stay = netherStay(bot);
    items.push({ key: 'food', short: food < stay.points, carried: food, wants: stay.points,
      says: `Food: ${food} food points carried (${meals || 'nothing to eat'}); the code would take ${stay.points}, food for the whole stay. ${staySays(stay)} Health comes back only while hunger stays at eighteen or more, and a fortress trip is fighting and running; in the Nether, hoglins are the meat (a mushroom stew and a bastion's chests are the only other food there, note 639), and a hoglin hits for three to eight and has forty health, so a hurt bot with nothing to eat is left to go back through the portal for food or fight one at the health it has.${lastSays}` });
    const health = Math.round(bot.health ?? 20), hunger = bot.food ?? 20;
    const back = health >= NETHER_HEALTH ? '' : hunger >= 18
      ? ` At hunger ${hunger} it comes back about a point every four seconds: about ${(NETHER_HEALTH - health) * 4} seconds to ${NETHER_HEALTH}.`
      : ` At hunger ${hunger} none comes back until the bot has eaten to eighteen.`;
    items.push({ key: 'health', short: health < NETHER_HEALTH, carried: health, wants: NETHER_HEALTH,
      says: `Health: ${health} of 20; the code would step through at ${NETHER_HEALTH} or more. The far side of a portal can be a fight at once. ${netherHitSays(bot)}${back}` });
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
  const set = cauldronSet(bot);
  if (set) items.push({ key: 'cauldron', short: false, optional: true, offer: set.offer, carried: set.cauldrons, wants: 1, says: set.says });
  return items;
}

// A cauldron of water for the Nether (note 634): fire is 40% of the damage in
// a blaze fight and nothing puts it out there (a poured bucket evaporates),
// but a cauldron filled from a water bucket puts a burning body out that
// steps into it, in the Nether as anywhere. Said whenever the set is carried
// or could be made from what is carried; never a gate (not "short").
function cauldronSet(bot) {
  const iron = countOf(bot, 'iron_ingot'), cauldrons = countOf(bot, 'cauldron'), water = countOf(bot, 'water_bucket'), empty = countOf(bot, 'bucket');
  const { CAULDRON_IRON } = require('./cauldron');
  const makeable = !cauldrons && iron >= CAULDRON_IRON;
  const bucket = water || empty;
  const complete = cauldrons && water;
  if (!complete && !(bucket && (cauldrons || makeable))) return null;
  const parts = [`${cauldrons} cauldron${cauldrons === 1 ? '' : 's'}`, `${water} water bucket${water === 1 ? '' : 's'}`];
  const how = 'A body that steps into a cauldron with water in it is put out at once (measured in the Nether: the fire out a tenth of a second after the feet are under the water), and the Nether is where nothing else does it, a poured bucket evaporating there; fire is about 40% of the damage in the blaze fights that killed the bot (note 631). It takes putting down and filling first (about half a second each, from a bucket of water, one cauldron of three levels, three fires), then a hop onto its rim and the middle of the body lined up over the bowl: about a second in all, the fire burning meanwhile, so it is worth most set down before a fight, away from the blazes, and it only helps where the bot is when it is alight. The bucket is emptied into it, so it is no longer a water bucket for a fall or a portal cast.';
  if (complete) return { offer: false, cauldrons, says: `Cauldron: ${parts.join(' and ')} carried, one slot each. ${how}` };
  const need = [];
  if (!cauldrons) need.push(`a cauldron (${CAULDRON_IRON} iron ingots in a U at a crafting table, ${iron} carried, one slot)`);
  if (!water) need.push(`a bucket of water (${empty} empty ${empty === 1 ? 'bucket' : 'buckets'} carried, filled at water in the Overworld, one slot)`);
  return { offer: true, cauldrons, says: `Cauldron: ${parts.join(' and ')} carried; the set is ${need.join(' and ')} short of complete. ${how} Its cost is ${cauldrons ? '' : `${CAULDRON_IRON} iron ingots (the bot carries ${iron}; an iron pickaxe is three) and `}a slot or two.` };
}

// The cauldron set as it can be made INSIDE the Nether (note 649). At the
// portal top_up_cauldron was one line of the crossing kit; the trials now
// mostly begin in the Nether (saves), where it was never asked and never
// reached (note 643: the way was seen 0 times in play). Water is the limit:
// the Nether has none to fill an empty bucket, so the set can be made there
// only from a water bucket already carried, seven iron ingots, and a crafting
// table (the recipe is a 3 by 3; the two-by-two of the inventory cannot make
// it) that is carried or made from wood carried. Nothing is given: null when
// the bot could not make it. Said with what it saves, what it costs and the
// place it has to be used from.
function stayCauldron(bot) {
  if (bot?.game?.gameMode !== 'survival' || !/nether/.test(String(bot.game?.dimension || '')) || bot.game?.difficulty === 'peaceful') return null;
  const { CAULDRON_IRON } = require('./cauldron');
  const iron = countOf(bot, 'iron_ingot'), water = countOf(bot, 'water_bucket');
  if (countOf(bot, 'cauldron') || !water || iron < CAULDRON_IRON) return null;
  const table = countOf(bot, 'crafting_table') > 0;
  const planks = bot.inventory.items().filter(i => /_planks$/.test(i.name)).reduce((n, i) => n + i.count, 0);
  const wood = bot.inventory.items().filter(i => /_(log|stem)$/.test(i.name)).reduce((n, i) => n + i.count, 0);
  if (!table && planks < 4 && !wood) return null;
  const tableSays = table ? 'a crafting table is carried' : `a crafting table is made first from ${planks >= 4 ? '4 of the planks carried' : 'a log or stem carried (one makes four planks)'} and put down for the craft (one more slot, and a few seconds to put it down and take it up again; not timed in a trial)`;
  const others = 'an iron pickaxe is 3 of them, an iron sword 2, a chestplate 8';
  const says = `A cauldron for the fire, made here: ${CAULDRON_IRON} of the ${iron} iron ingots carried in a U at a crafting table (${others}; they are not made back), ${tableSays}, one slot for the cauldron and the water bucket carried (${water}) kept for it; nothing is given and nothing else is needed. What it is for: fire is about 40% of the damage taken in the blaze fights that killed the bot, 44 of 70 blaze deaths were alight at the end, and a fireball that lands costs its hit plus about four ticks of fire (note 631); in the Nether nothing but a cauldron's water puts a burning body out (a poured bucket evaporates there). What it is not: it puts a fire out only where it stands, so it has to be set down near the fight before the bot is alight, or carried and set down when it is (the way set_down_cauldron, offered to the burning body): about a second in the open (put down, filled, lined up, a hop onto its rim and a drop into the bowl; measured on a test server, note 634), the fire burning meanwhile, one cauldron of three levels puts out three fires and stays where it is put, the water bucket is spent filling it (no bucket of water is then left for a fall or the portal cast). Not yet played: no trial has carried the set in the Nether, so there is no record of it putting a fire out in a fight.`;
  return { iron, water, table, planks, wood, says };
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
  let short, valuables, all;
  try { all = kitItems(bot); short = all.filter(i => i.short); valuables = valuablesAt(bot, goal); } catch (_) { return ''; }
  const parts = short.map(i => i.key === 'wood' ? `${i.carried} of ${i.wants} logs${countOf(bot, 'crafting_table') ? '' : ' and no crafting table'}`
    : i.key === 'pickaxe' ? `a pickaxe with ${i.carried} of ${i.wants} uses` : i.key === 'health' ? `${i.carried} of ${i.wants} health`
      : i.key === 'gold' ? 'a piece of gold to wear (piglins go for a player with none)'
      : `${i.carried} of ${i.wants} ${i.key === 'food' ? 'food points' : 'blocks'}`);
  if (valuables) parts.push(`valuables carried (${valuables.what})${valuables.how === 'stash' ? `, the home chest ${valuables.far} blocks away` : ''}`);
  const cauldron = all.find(i => i.key === 'cauldron' && i.offer);
  if (cauldron) parts.push('a cauldron and a water bucket to put a fire out in the Nether, which the bot could make now (an option, not a gap)');
  return parts.length ? ` At the portal the kit is said and topping any of it up is a choice, not a wait: short now of ${parts.join('; ')}.`
    : ' The kit for the crossing (food, blocks, a pickaxe, gold, wood) is carried.';
}

module.exports = { cauldronSet, stayCauldron, netherStay, staySays, NETHER_HUNGER_AN_HOUR, netherHitSays, kitItems, valuablesAt, kitSummary, netherBlocks, logsCarried, NETHER_HEALTH, NETHER_BLOCKS, SPARE_PICKAXE_DURABILITY, EXPEDITION_LOGS };
