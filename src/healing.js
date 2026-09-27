'use strict';
// Whether the bot's health comes back, said once on every question about
// playing the game (decisions/index.js). Four deaths of 2026-09-27 ran the
// same way: health fell, nothing safe to eat, no healing under eighteen
// hunger, and the bot went on working or hunting, often at night, until an
// encounter finished it (note 515: mid-231-o, mid-207-l, mid-211-x,
// mid-231-q). It was said in a few options of a few questions; the
// stance was told a bare hunger number, and the work nothing.
//
// The game's own numbers: health comes back at hunger eighteen or more,
// about a point each four seconds, each point spending six exhaustion (a
// hunger point and a half, saturation first). Hunger falls only with
// exhaustion: moving, sprinting, jumping, swimming, mining, fighting,
// being hurt and healing. Standing still spends none.
const { DAY } = require('./day');

const round = n => Math.round(n * 10) / 10;
const words = s => String(s).replaceAll('_', ' ');
const STILL = 'standing still spends no hunger: it falls with moving, sprinting, jumping, swimming, mining, fighting, being hurt and healing';

// The food in the pockets, by kind, with its points: the safe food, and the
// last resort with what it may cost.
function foodCarried(bot) {
  const { safeFood, lastResortFoods, sideEffectSays } = require('./vitals');
  const counts = {};
  for (const i of bot.inventory?.items?.() || []) {
    if (!bot.registry?.foodsByName?.[i.name] || !(safeFood(bot, i) || lastResortFoods.has(i.name))) continue;
    counts[i.name] = (counts[i.name] || 0) + i.count;
  }
  return Object.entries(counts).map(([name, n]) => {
    const points = bot.registry.foodsByName[name].foodPoints, effect = sideEffectSays(name);
    return { name, count: n, points, says: `${n} ${name === 'chicken' ? 'raw chicken' : words(name)}, ${points} hunger each${effect ? `; ${effect}` : ''}` };
  });
}

// The nearest food the bot knows of, nearest first: animals in view, herds
// seen (sightings.js), a village's crops, the home's plot and pen, and the
// home's chest. Each read is guarded: a missing world or record is none.
function nearestFood(bot, goal) {
  const here = bot.entity?.position;
  if (!here) return [];
  const found = [];
  const guard = f => { try { f(); } catch (_) { /* not known */ } };
  const overworld = /overworld/.test(String(bot.game?.dimension || 'overworld'));
  const prey = overworld ? ['cow', 'mooshroom', 'sheep', 'rabbit'] : ['hoglin'];
  guard(() => {
    const seen = Object.values(bot.entities || {}).filter(e => prey.includes(e.name) && e.isValid !== false && e.position && e.position.distanceTo(here) <= 32)
      .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))[0];
    if (seen) { const d = Math.round(seen.position.distanceTo(here)); found.push({ distance: d, says: `a ${words(seen.name)} in view, ${d} blocks off` }); }
  });
  guard(() => {
    const sightings = require('./sightings');
    for (const kind of overworld ? ['cow', 'sheep'] : ['hoglin']) {
      const s = sightings.sighted(bot, goal, kind).find(f => f.distance > 32);
      if (s) found.push({ distance: s.distance, says: s.says });
    }
  });
  if (goal && overworld) {
    guard(() => {
      const v = require('./villages').villageFood(bot, goal);
      if (v) found.push({ distance: v.distance, says: `a village ${v.distance} blocks off with ${v.ripeCrops} ripe crops and ${v.hayBales} hay bales` });
    });
    guard(() => {
      const h = require('./home-base').homeFood(bot, goal);
      if (h) found.push({ distance: h.distance, says: `home, ${h.distance} blocks off: wheat for ${h.loaves} loaves and ${h.steaks} cows to spare` });
    });
    guard(() => {
      const { homeOf, homeDistance } = require('./home-base');
      const home = homeOf(bot, goal);
      const { safeFood } = require('./vitals');
      const stash = Object.entries(home?.stash?.contents || {}).filter(([name]) => safeFood(bot, { name }) && bot.registry.foodsByName?.[name]);
      if (home?.stash?.position && stash.length) {
        const d = Math.round(homeDistance(bot, home)), points = stash.reduce((n, [name, c]) => n + c * bot.registry.foodsByName[name].foodPoints, 0);
        found.push({ distance: d, says: `home's chest, ${d} blocks off: ${stash.map(([name, c]) => `${c} ${words(name)}`).join(', ')} (${points} hunger)` });
      }
    });
  }
  return found.sort((a, b) => a.distance - b.distance).slice(0, 3).map(f => f.says);
}

// Daylight, said as the time to it: the surface's mobs burn at dawn and
// spawn from dark. Underground the dark is the same at any hour.
function daylightSays(bot) {
  if (!/overworld/.test(String(bot.game?.dimension || 'overworld'))) return 'no day or night here: its mobs neither burn nor stop';
  const t = bot.time?.timeOfDay;
  if (!Number.isFinite(t)) return null;
  const minutes = ticks => Math.round(ticks / 1200);
  if (t >= DAY.DAWN || t < DAY.DUSK) return `day: dusk in about ${minutes(((DAY.DUSK - t) + 24000) % 24000)} real minutes`;
  return `${t >= DAY.DARK ? 'night' : 'dusk'}: dawn in about ${minutes(DAY.DAWN - t)} real minutes`;
}

// The standing fact: health and hunger, whether health comes back, the food
// carried and the nearest known, the time to daylight, and what standing
// still costs. Null where there is nothing to say (no body, Creative).
function healingSays(bot, goal) {
  if (!bot?.entity || bot.game?.gameMode === 'creative' || !Number.isFinite(bot.health)) return null;
  const health = round(bot.health), hunger = bot.food ?? 20;
  const carried = foodCarried(bot);
  const points = carried.reduce((n, f) => n + f.count * f.points, 0);
  const comesBack = hunger >= 18
    ? health >= 20 ? 'health is full' : `yes: at hunger ${hunger}, about one health each four seconds while hunger stays at eighteen or more, each point spending a hunger point and a half`
    : health >= 20 ? `health is full; at hunger ${hunger} a point lost would not come back until the bot eats to eighteen`
    : `no: hunger ${hunger}, under eighteen; every point lost stays lost until the bot eats to eighteen`;
  const eaten = Math.min(20, hunger + points);
  return {
    health, hunger, healthComesBack: comesBack,
    foodCarried: carried.length ? carried.map(f => f.says) : 'nothing to eat',
    ...(hunger < 18 && carried.length ? { eatingItAll: `brings hunger to ${eaten}${eaten >= 18 ? ', where health comes back' : ', still under eighteen'}` } : {}),
    nearestFood: (() => { const n = nearestFood(bot, goal); return n.length ? n : 'none known'; })(),
    ...(daylightSays(bot) ? { daylight: daylightSays(bot) } : {}),
    standingStill: STILL,
  };
}

module.exports = { healingSays, foodCarried, nearestFood, daylightSays };
