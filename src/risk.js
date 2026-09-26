'use strict';
// The risk of dying now, as facts for every choice that weighs one: the
// hostile mobs about, what fighting all of them here would cost against
// the health the bot has (combat-estimate.js), whether more are spawning
// around it, and whether it can heal. Beside deathWouldCost it is the
// other half of a risk: how likely, and how much it would lose.
const { threats } = require('./danger');
const { shooter } = require('./combat');
const { fightEstimate } = require('./combat-estimate');
const { DAY } = require('./day');

function riskNow(bot, { radius = 24, dark = null } = {}) {
  const about = threats(bot, radius);
  const armour = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
  const weapon = require('./combat').defenseWeapon(bot)?.name || null;
  const health = bot.health ?? 20, food = bot.food ?? 20;
  const estimate = fightEstimate({ threats: about.slice(0, 8).map(t => ({ name: t.entity.name, distance: t.distance, shoots: shooter(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: t.visible })), armour, weapon, health, shield: bot.inventory?.slots?.[45]?.name === 'shield' });
  const t = bot.time?.timeOfDay ?? 0;
  const surface = (bot.blockAt?.(bot.entity.position.floored())?.skyLight ?? 15) >= 8;
  const spawning = dark ?? ((t >= DAY.NIGHT && t < DAY.DAWN && surface) || !surface);
  const fight = estimate.fightHere;
  const level = fight.healthAfter <= 0 ? 'high: the mobs about could kill the bot if they all came'
    : about.some(m => m.entity.name === 'creeper' && m.distance <= 8) ? 'high: a creeper is within eight blocks'
    : fight.damageTaken >= health / 2 ? 'moderate: fighting them all would take half the health or more'
    : about.length ? 'low: the mobs about are a fight the bot wins' : spawning ? 'low for now: nothing hostile in view, but mobs spawn here in the dark' : 'none in view';
  return {
    level,
    hostilesWithin: { blocks: radius, count: about.length, kinds: [...new Set(about.map(m => m.entity.name))], inSight: about.filter(m => m.visible).length, shooters: about.filter(m => shooter(m.entity)).length },
    fightingAllHere: { damageTaken: fight.damageTaken, healthAfter: fight.healthAfter, ...(fight.creeper ? { creeper: fight.creeper } : {}) },
    health, food, healing: food >= 18 ? 'health comes back while hunger stays at eighteen or more' : 'no healing: health comes back only at eighteen hunger or more, so eat first',
    armourPoints: estimate.armourPoints, weapon: estimate.weapon,
    mobsSpawnAround: spawning,
  };
}

// What a death now would cost, for every choice that risks one: the gear
// and valuables that would drop where the bot falls, the walk back to them
// from where it would respawn before they vanish, the real minutes that
// went into them, and the levels.
const { Vec3 } = require('vec3');
const vec = p => new Vec3(p.x, p.y, p.z);
function deathCost(bot, goal = {}, survival = goal.survival || {}) {
  const { VALUABLES } = require('./home-stash');
  const words = n => n.replaceAll('_', ' ');
  const items = bot.inventory.items();
  const worn = [5, 6, 7, 8, 45].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean).map(words);
  const gear = [...new Set(items.filter(i => /_(pickaxe|sword|axe|shovel|helmet|chestplate|leggings|boots)$|^(bow|crossbow|shield|shears|flint_and_steel|bucket|water_bucket|lava_bucket|bed)$|_bed$/.test(i.name)).map(i => words(i.name)))];
  const valuables = {};
  for (const i of items) if (Object.hasOwn(VALUABLES, i.name)) valuables[words(i.name)] = (valuables[words(i.name)] || 0) + i.count;
  const here = bot.entity.position;
  const bed = survival.respawn && bot.game?.dimension === 'overworld' ? vec(survival.respawn) : null;
  const spawn = bed || (bot.spawnPoint && bot.game?.dimension === 'overworld' ? bot.spawnPoint : null);
  const stash = require('./home-base').homeOf(bot, goal)?.stash?.position;
  return {
    dropsWorn: worn, dropsGear: gear, dropsValuables: valuables,
    otherStacks: items.length - items.filter(i => Object.hasOwn(VALUABLES, i.name) || gear.includes(words(i.name))).length,
    respawnAt: bed ? 'the bed slept in last' : 'the world spawn', walkBackBlocks: spawn ? Math.round(spawn.distanceTo(here)) : null,
    levelsLost: bot.experience?.level ?? 0,
    // Real minutes the run spent making what would drop, from the ladder's
    // clocks: the steps whose item is carried or worn.
    realMinutesToMakeAgain: Object.fromEntries(Object.entries(goal.rungClocks || {})
      .filter(([phase, clock]) => clock.activeMs >= 60000 && [...worn, ...gear].some(n => n === words(phase) || (/ armou?r$/.test(words(phase)) && n.startsWith(words(phase).replace(/armou?r$/, '')) && /(helmet|chestplate|leggings|boots)$/.test(n))))
      .map(([phase, clock]) => [words(phase), Math.round(clock.activeMs / 60000)])),
    realSecondsToWalkBack: spawn ? Math.round(spawn.distanceTo(here) / 4.3) : null,
    stashChestBlocks: stash ? Math.round(vec(stash).distanceTo(here)) : null,
    note: 'Everything carried drops where the bot dies and vanishes five minutes later; the walk back from the respawn point is the only way to get it again.',
  };
}

module.exports = { riskNow, deathCost };
