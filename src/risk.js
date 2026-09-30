'use strict';
// The risk of dying now, as facts for every choice that weighs one: the
// hostile mobs about, what fighting all of them here would cost against
// the health the bot has (combat-estimate.js), whether more are spawning
// around it, and whether it can heal. Beside deathWouldCost it is the
// other half of a risk: how likely, and how much it would lose.
const { threats } = require('./danger');
const { shooter } = require('./combat');
const { fightEstimate, slimeSize } = require('./combat-estimate');
const { DAY } = require('./day');

// Shooters count out to forty-eight: mid-227-r was told "nothing hostile
// in view" on a bridge over the void while a blaze twenty-seven off fired
// at it, and a fireball threw it off (2026-09-27). The flight recorder
// counts them as far (observer.js).
const SHOOTER_REACH = 48;
// Shots in the air whose line passes within a few blocks of the bot and
// that are still closing: what is shooting may be out of sight.
const shotsAt = bot => {
  const { INCOMING } = require('./projectile-guard');
  const flying = Object.values(bot.entities || {}).filter(e => INCOMING.has(e.name) && e.position && e.isValid !== false);
  if (!flying.length) return 0;
  const p = bot.entity.position, eye = new Vec3(p.x, p.y + 1.5, p.z);
  return flying.filter(e => {
    if (e.position.distanceTo(eye) > SHOOTER_REACH) return false;
    const v = e.velocity, speed = v ? v.norm() : 0;
    if (speed < 0.05) return false;
    const to = eye.minus(e.position), along = to.dot(v) / speed;
    return along > 0 && Math.sqrt(Math.max(0, to.dot(to) - along * along)) <= 3;
  }).length;
};

// The hostile mobs within `radius` (the shooters to forty-eight), those with
// a way to the bot and those with none, and the fight's estimate over them
// all at the health the bot has: what riskNow and standingAmong work from.
function mobsAbout(bot, radius = 24) {
  const about = threats(bot, Math.max(radius, SHOOTER_REACH)).filter(t => t.distance <= radius || shooter(t.entity));
  const armour = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
  const weapon = require('./combat').defenseWeapon(bot)?.name || null;
  const health = bot.health ?? 20;
  // Fighting them all is meeting them all, so the shooters behind a wall
  // count as in sight: first-days-201, sealed in a pocket with three
  // skeletons it could not see, was told "low: a fight the bot wins, 2.5
  // damage" beside a leave option that said 72.6, chose to leave at 0.51,
  // and died among them in half a minute (2026-09-26).
  // The walkers with no way to the bot (walk-reach.js) are no fight here:
  // counted apart and left out of the figures, as every stance leaves them
  // (note 566). mid-244-ad-nether-2's stance was told "fighting all here:
  // 8.2 damage" for a sword piglin with no way onto its bridge.
  let apart = new Set();
  try { apart = require('./danger').noWayIds(bot, about); } catch (_) { apart = new Set(); }
  const reach = about.filter(t => !apart.has(t.entity.id));
  const estimate = fightEstimate({ threats: [...reach, ...about.filter(t => apart.has(t.entity.id))].slice(0, 8).map(t => ({ name: t.entity.name, distance: t.distance, shoots: shooter(t.entity), ...(slimeSize(t.entity) ? { size: slimeSize(t.entity) } : {}), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: true, ...(apart.has(t.entity.id) ? { apart: true } : {}) })), armour, weapon, health, shield: bot.inventory?.slots?.[45]?.name === 'shield' });
  return { about, apart, reach, estimate, health };
}

function riskNow(bot, { radius = 24, dark = null } = {}) {
  const shots = shotsAt(bot);
  const { about, apart, reach, estimate, health } = mobsAbout(bot, radius);
  const food = bot.food ?? 20;
  const t = bot.time?.timeOfDay ?? 0;
  const surface = (bot.blockAt?.(bot.entity.position.floored())?.skyLight ?? 15) >= 8;
  const spawning = dark ?? ((t >= DAY.NIGHT && t < DAY.DAWN && surface) || !surface);
  const fight = estimate.fightHere;
  // Animals that hit unprovoked, near: a ram at 0.7 health is the end of it.
  const { UNPROVOKED } = require('./danger');
  const here = bot.entity.position;
  const animals = Object.values(bot.entities || {}).filter(e => Object.hasOwn(UNPROVOKED, e.name) && e.position && e.isValid !== false && e.position.distanceTo(here) <= 16)
    .map(e => ({ name: e.name, distance: Math.round(e.position.distanceTo(here)) })).sort((a, b) => a.distance - b.distance);
  const endsIt = animals.find(a => UNPROVOKED[a.name].hit >= health);
  const level = endsIt ? `high: one hit from the ${endsIt.name.replaceAll('_', ' ')} ${endsIt.distance} blocks off would end the bot`
    : fight.healthAfter <= 0 ? 'high: the mobs about could kill the bot if they all came'
    : reach.some(m => m.entity.name === 'creeper' && m.distance <= 8) ? 'high: a creeper is within eight blocks'
    : fight.damageTaken >= health / 2 ? 'moderate: fighting them all would take half the health or more'
    : reach.length ? 'low: the mobs about are a fight the bot wins'
    : about.length ? 'low: none of the mobs about has a way to the bot, and none shoots'
    : shots ? `low: nothing hostile in view, but ${shots === 1 ? 'a shot in the air is' : `${shots} shots in the air are`} coming at the bot` : spawning ? 'low for now: nothing hostile in view, but mobs spawn here in the dark' : 'none in view';
  return {
    level,
    hostilesWithin: { blocks: radius, shootersTo: SHOOTER_REACH, count: about.length, kinds: [...new Set(about.map(m => m.entity.name))], inSight: about.filter(m => m.visible).length, shooters: about.filter(m => shooter(m.entity)).length, ...(apart.size ? { cannotGetToTheBot: about.filter(t => apart.has(t.entity.id)).length } : {}) },
    ...(shots ? { shotsComingAtTheBot: shots } : {}),
    fightingAllHere: { damageTaken: fight.damageTaken, healthAfter: fight.healthAfter, ...(fight.creeper ? { creeper: fight.creeper } : {}) },
    health, food, healing: food >= 18 ? 'health comes back while hunger stays at eighteen or more' : 'no healing: health comes back only at eighteen hunger or more, so eat first',
    armourPoints: estimate.armourPoints, weapon: estimate.weapon,
    mobsSpawnAround: spawning,
    ...(animals.length ? { animalsThatHit: { within: 16, near: animals.slice(0, 4), what: Object.fromEntries([...new Set(animals.map(a => a.name))].map(n => [n, `${UNPROVOKED[n].note}; about ${UNPROVOKED[n].hit} a hit`])) } } : {}),
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

// What standing where the bot is for `seconds` costs among the mobs about, for
// an option that stands it there (a batch cooked at a furnace put down here,
// a wait to heal): every biter that gets to it in that time, from when it
// does, the hands busy, none fought; the shooters in sight from when they
// are in range. Null with no mob about that can get to it. mid-242-ab-nether-
// 3-fortress-6 (note 628) was asked whether to cook seven mutton for 72
// seconds at a furnace put down where it stood, at 14.3 health, hunger 17,
// no armour, with two zombies in sight at 10 and 20 blocks and nine shooters
// within 48; the option said "with no walk" and nothing of who was coming,
// and the first zombie was at it three seconds after the furnace was down.
function standingAmong(bot, seconds, { what = 'here', radius = 24 } = {}) {
  let about;
  try { about = mobsAbout(bot, radius); } catch (_) { return null; }
  const { reach, estimate, health } = about;
  if (!reach.length || !(seconds > 0)) return null;
  const { stanceCost } = require('./combat-estimate');
  const cost = stanceCost({ mobs: estimate.mobs.filter(m => !m.apart), setup: seconds, seconds, health });
  const said = require('./arbiter').mobWouldSays;
  const line = t => `${/^[aeiou]/.test(t.entity.name) ? 'an' : 'a'} ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance * 10) / 10} blocks off${t.visible ? '' : ' (out of sight)'}, ${said(t, { bot })}`;
  const n = reach.length, h = Math.round(health * 10) / 10;
  const says = `Standing ${what} for those ${Math.round(seconds)} seconds with ${n} hostile ${n === 1 ? 'mob' : 'mobs'} that can get to the bot within ${radius} blocks (the shooters to ${SHOOTER_REACH}): ${reach.slice(0, 4).map(line).join('; ')}${n > 4 ? `; ${n - 4} more` : ''}. About ${cost.damage} damage from them over those seconds if none is fought, from ${h} health${cost.damage >= health ? ' (more than the bot has)' : ''}.`;
  return { says, damage: cost.damage, count: n };
}

module.exports = { riskNow, deathCost, standingAmong, mobsAbout };
