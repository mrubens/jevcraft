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

// The food the bot knows of, nearest first, each with where it is and
// roughly how much it holds: animals in view, herds seen (sightings.js), a
// village's crops, the home's plot and pen, and the home's chest. Each read
// is guarded: a missing world or record is none. `at` is where it lies,
// `points` about what it gives (cooked), `kind` which it is.
// A grown animal's meat, cooked: a cow or pig one to three (about two) at
// eight each, a sheep one or two mutton at six, a chicken one at six, a
// rabbit one at five.
// A cod or a salmon is one fish, five and six cooked (fishing.js, note 1203).
const MEAT_POINTS = { cow: 16, mooshroom: 16, pig: 16, sheep: 9, chicken: 6, rabbit: 5, hoglin: 24, cod: 5, salmon: 6 };
// The same meat raw, as a kill leaves it and as it is counted until cooked:
// beef and porkchop three a piece, mutton two, rabbit three (half the
// rabbits drop one), a hoglin two to four porkchops. mid-244-ah (note 594)
// was told a cow in view would bring 32 of the 40 points it was short; the
// nine beef its hunts brought counted 27.
const RAW_MEAT_POINTS = { cow: 6, mooshroom: 6, pig: 6, sheep: 3, chicken: 0, rabbit: 1.5, hoglin: 9, cod: 2, salmon: 2 };
// A kill the bot tried for in the last two minutes and could not make
// (behind cover, no way to it), as the survival layer keeps it
// (foraging.js failedPrey), is not food in view.
const PREY_FAILED_MS = 120000;
const preyFailed = (goal, e, now = Date.now()) => goal?.survival?.failedPrey?.[e.uuid || e.id] > now - PREY_FAILED_MS;
function foodSources(bot, goal) {
  const here = bot.entity?.position;
  if (!here) return [];
  const found = [];
  const guard = f => { try { f(); } catch (_) { /* not known */ } };
  const overworld = /overworld/.test(String(bot.game?.dimension || 'overworld'));
  const prey = overworld ? ['cow', 'mooshroom', 'sheep', 'rabbit'] : ['hoglin'];
  guard(() => {
    const seen = Object.values(bot.entities || {}).filter(e => prey.includes(e.name) && e.isValid !== false && e.position && e.position.distanceTo(here) <= 32 && !preyFailed(goal, e))
      .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
    if (seen[0]) {
      const d = Math.round(seen[0].position.distanceTo(here)), kind = seen[0].name, count = seen.filter(e => e.name === kind).length;
      const p = seen[0].position;
      found.push({ kind: 'in_view', animal: kind, count, points: count * (MEAT_POINTS[kind] || 6), distance: d, at: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) },
        says: `a ${words(kind)} in view, ${d} blocks off` });
    }
  });
  // Cod and salmon in view in open water no deeper than the dive (fishing.js,
  // note 1203): 25588 (2026-10-04 07:29 to 08:27Z) starved on a map of
  // ocean and shore whose food list had only the land's animals. Not one
  // under ice or a roof, nor one the bot could not get to lately.
  if (overworld) guard(() => {
    const fish = require('./fishing').fishInView(bot, goal?.survival);
    if (!fish[0]) return;
    const d = Math.round(fish[0].position.distanceTo(here)), kind = fish[0].name, count = fish.filter(e => e.name === kind).length, p = fish[0].position;
    found.push({ kind: 'in_view', animal: kind, count, points: count * MEAT_POINTS[kind], distance: d, at: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) },
      says: `${count === 1 ? `a ${words(kind)}` : `${count} ${words(kind)}`} in open water in view, ${d} blocks off` });
  });
  guard(() => {
    const sightings = require('./sightings');
    for (const kind of overworld ? ['cow', 'sheep', 'rabbit'] : ['hoglin']) {
      const s = sightings.sighted(bot, goal, kind).find(f => f.distance > 32);
      if (s) found.push({ kind: 'herd', animal: kind, count: s.count, points: (s.count || 1) * (MEAT_POINTS[kind] || 6), distance: s.distance, at: { x: s.x, y: s.y, z: s.z }, sighting: s, says: s.says });
    }
  });
  // Food left cooking in a furnace (note 857): the batch the smelt step
  // keeps (goal.smelting), in this dimension. 25583 (2026-10-02 01:29 to
  // 01:33Z) left 4 mutton cooking at (44, 84, 124), walked on to a fortress
  // a hundred blocks off, and at 9.1 health and hunger 17 was told "nothing
  // to eat" and of hoglins 190 blocks off, never of the mutton.
  guard(() => {
    const sm = goal?.smelting;
    const food = sm?.item && bot.registry?.foodsByName?.[sm.item];
    const dim = v => String(v || 'overworld').replace(/^minecraft:/, '');
    if (!food || !sm.position || !here || dim(sm.dimension) !== dim(bot.game?.dimension)) return;
    // Left for good, or gone for and not had (note 1061).
    if (sm.left?.forgone || require('./progress').isSetAside(goal, 'food_source', 'furnace')) return;
    const at = sm.position, d = Math.round(here.distanceTo(new (require('vec3').Vec3)(at.x + 0.5, at.y, at.z + 0.5)));
    const count = sm.count || 1, done = sm.startedAt && Date.now() - sm.startedAt >= count * 10000;
    found.push({ kind: 'furnace', distance: d, at: { x: at.x, y: at.y, z: at.z }, points: count * food.foodPoints,
      says: `${count} ${words(sm.item)} ${done ? 'cooked and waiting' : 'cooking'} in the furnace the bot left at (${at.x}, ${at.y}, ${at.z}), ${d} blocks off (${count * food.foodPoints} hunger)` });
  });
  if (goal && overworld) {
    guard(() => {
      const v = require('./villages').villageFood(bot, goal);
      // Three wheat a loaf of five, or a crop of carrots or potatoes about three.
      if (v) found.push({ kind: 'village', distance: v.distance, at: { x: v.village.x, y: v.village.y, z: v.village.z }, village: v.village, points: Math.round(v.ripeCrops * 5 / 3 + v.hayBales * 15),
        says: `a village ${v.distance} blocks off with ${v.ripeCrops} ripe crops and ${v.hayBales} hay bales` });
    });
    guard(() => {
      const home = require('./home-base').homeOf(bot, goal);
      const h = require('./home-base').homeFood(bot, goal);
      if (h) found.push({ kind: 'home_plot', distance: h.distance, at: home?.origin ? { ...home.origin } : null, points: h.loaves * 5 + h.steaks * MEAT_POINTS.cow,
        says: `home, ${h.distance} blocks off: wheat for ${h.loaves} loaves and ${h.steaks} cows to spare` });
    });
    guard(() => {
      const { homeOf, homeDistance } = require('./home-base');
      const home = homeOf(bot, goal);
      const { safeFood } = require('./vitals');
      const stash = Object.entries(home?.stash?.contents || {}).filter(([name]) => safeFood(bot, { name }) && bot.registry.foodsByName?.[name]);
      if (home?.stash?.position && stash.length) {
        const d = Math.round(homeDistance(bot, home)), points = stash.reduce((n, [name, c]) => n + c * bot.registry.foodsByName[name].foodPoints, 0);
        found.push({ kind: 'home_chest', distance: d, at: { ...home.stash.position }, points,
          says: `home's chest, ${d} blocks off: ${stash.map(([name, c]) => `${c} ${words(name)}`).join(', ')} (${points} hunger)` });
      }
    });
  }
  return found.sort((a, b) => a.distance - b.distance);
}
const nearestFood = (bot, goal) => foodSources(bot, goal).slice(0, 3).map(f => f.says);

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

// Off the Overworld, hurt, and nothing carried brings hunger to eighteen:
// health does not come back where the bot is, and the ways it could are
// said with what each costs: the trip back through the portal (its walk,
// its lava, the hour it comes out at) and the food known on the other side,
// and in the Nether a hoglin, where one is known, with whether one can be
// fought at this health. Across the fortress cohort of 2026-09-28 a Nether
// trial sat under eight health, hunger under eighteen and nothing to eat
// for a minute or more forty times, about six minutes the median, and
// twenty-six of those ended in a death (note 607); every question was told
// "no: hunger 17" and the nearest hoglin, and none of them the way back.
const OVERWORLD_PREY = ['cow', 'sheep', 'rabbit'];
function overworldFoodSays(bot, goal) {
  const portals = goal?.portals || [];
  const here = bot.entity?.position;
  const netherSide = here && portals.filter(p => p.dimension === 'nether').sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
  // The game links a Nether portal to the Overworld one nearest its x and
  // z times eight; with no Nether portal remembered, the Overworld one
  // nearest to where the bot is, over there.
  const from = netherSide || here;
  const out = from && portals.filter(p => p.dimension === 'overworld').sort((a, b) => Math.hypot(a.x - from.x * 8, a.z - from.z * 8) - Math.hypot(b.x - from.x * 8, b.z - from.z * 8))[0];
  if (!out) return null;
  const now = Date.now(), parts = [];
  for (const kind of OVERWORLD_PREY) {
    const s = (goal.sightings?.[kind] || []).filter(f => now - f.at < 30 * 60000 && /overworld/.test(String(f.dimension || 'overworld')))
      .map(f => ({ ...f, d: Math.round(Math.hypot(f.x - out.x, f.z - out.z)) })).sort((a, b) => a.d - b.d)[0];
    if (s) parts.push(`${s.count} ${kind} seen ${Math.max(1, Math.round((now - s.at) / 60000))} minutes ago ${s.d} blocks from that portal`);
  }
  const home = goal.survival?.home;
  if (home?.stash?.position && bot.registry?.foodsByName) {
    const { safeFood } = require('./vitals');
    const points = Object.entries(home.stash.contents || {}).filter(([name]) => safeFood(bot, { name }) && bot.registry.foodsByName[name]).reduce((n, [name, c]) => n + c * bot.registry.foodsByName[name].foodPoints, 0);
    if (points) parts.push(`home's chest, ${Math.round(Math.hypot(home.stash.position.x - out.x, home.stash.position.z - out.z))} blocks from that portal, with ${points} hunger of food`);
  }
  return parts.length ? `Known on the Overworld side: ${parts.join('; ')}.` : 'No food is known on the Overworld side: it is hunted there, where cows, sheep and rabbits are common on grass (the bot never hurts pigs or chickens).';
}
function withoutFoodSays(bot, goal, { health, hunger, points }) {
  const overworld = /overworld/.test(String(bot.game?.dimension || 'overworld'));
  if (overworld || health >= 20 || hunger >= 18 || hunger + points >= 18) return null;
  const nether = /nether/.test(String(bot.game?.dimension || ''));
  const out = {
    withoutFood: `health ${health} does not come back here: ${points ? `eating all that is carried brings hunger only to ${hunger + points}` : 'nothing carried is food'}, and ${nether ? 'in the Nether only a hoglin, a mushroom stew or what a bastion\'s chests hold is food' : 'nothing here is food'}; every point lost from here on stays lost until the bot has eaten to eighteen`,
  };
  try {
    const trip = require('./game-progress').portalTrip(bot, goal);
    const there = overworldFoodSays(bot, goal);
    out.tripBackForFood = `back through the portal to the Overworld for food: ${trip.trim()}${there ? ` ${there}` : ''} Food there is killed and eaten raw or cooked, and health comes back once hunger is eighteen or more.`;
  } catch (_) { /* no trip known */ }
  if (nether) {
    try {
      const { hoglinsKnown, hoglinFight } = require('./nether-travel');
      const known = hoglinsKnown(bot, goal), nearest = known.inView[0], seen = known.seen[0];
      const fight = hoglinFight(bot, nearest ? nearest.position.distanceTo(bot.entity.position) : 8);
      out.hoglinHunt = nearest || seen
        ? `${nearest ? `a hoglin in view ${Math.round(nearest.position.distanceTo(bot.entity.position))} blocks off` : `${seen.says}, about ${Math.round(seen.distance / 4.3)} seconds' walk`}; it drops two to four raw porkchops, three hunger each. ${fight.says}`
        : `no hoglin in view or seen in the last half hour; ${fight.says}`;
    } catch (_) { /* no estimate */ }
  }
  return out;
}

// What a hurt bot's options leave out: that health does not come back. The
// state said it (healthComesBack, withoutFood) on every question, and the
// options that spend health said nothing: on 25589 the stall's work_free,
// cross_toward and differently at 3.5 health, hunger 13, nothing to eat,
// each said what it took in seconds and never that what it cost in health
// stayed lost (note 639). One sentence, said only where it is so: health
// under ten, hunger under eighteen, and what is carried does not bring
// hunger to eighteen.
const HEALTH_SAID = 10;
function noHealSays(bot, goal = null) {
  if (!bot?.entity || bot.game?.gameMode === 'creative' || !Number.isFinite(bot.health)) return '';
  const health = round(bot.health), hunger = bot.food ?? 20;
  if (health >= HEALTH_SAID || hunger >= 18) return '';
  const points = foodCarried(bot).reduce((n, f) => n + f.count * f.points, 0);
  if (hunger + points >= 18) return '';
  const nether = /nether/.test(String(bot.game?.dimension || ''));
  return `Health ${health} does not come back at hunger ${hunger}: ${points ? `all the food carried brings hunger only to ${hunger + points}` : 'nothing carried is food'}${nether ? ', and in the Nether only a hoglin, a mushroom stew or what the bastions hold is' : ''}, so whatever this costs in health stays lost.`;
}
// The sentence added to the options of a tree that do not say it already
// (each option's own words about health coming back, or its being out).
const SAID_ALREADY = /does not come back|comes? back only|health does not|stays? lost|no healing/i;
function withNoHealSays(bot, goal, answers) {
  const says = noHealSays(bot, goal);
  if (!says || !answers) return answers;
  for (const a of Object.values(answers)) {
    if (a && typeof a.description === 'string' && !SAID_ALREADY.test(a.description)) a.description += ` ${says}`;
  }
  return answers;
}

// The standing fact: health and hunger, whether health comes back, the food
// carried and the nearest known, the time to daylight, and what standing
// still costs. Null where there is nothing to say (no body, Creative).
function healingSays(bot, goal) {
  if (!bot?.entity || bot.game?.gameMode === 'creative' || !Number.isFinite(bot.health)) return null;
  const health = round(bot.health), hunger = bot.food ?? 20;
  const carried = foodCarried(bot);
  const points = carried.reduce((n, f) => n + f.count * f.points, 0);
  // At full hunger with saturation left it is quicker (FoodData: a point
  // each half second at six saturation, spending it): mid-243-f came back
  // 0.3 a half second after eating (note 542).
  const comesBack = hunger >= 18
    ? health >= 20 ? 'health is full' : hunger >= 20 && bot.foodSaturation > 0 ? `yes: at full hunger with ${round(bot.foodSaturation)} saturation, up to a point each half second while the saturation lasts (spending it), then about one each four seconds while hunger stays at eighteen or more` : `yes: at hunger ${hunger}, about one health each four seconds while hunger stays at eighteen or more, each point spending a hunger point and a half`
    : health >= 20 ? `health is full; at hunger ${hunger} a point lost would not come back until the bot eats to eighteen`
    : `no: hunger ${hunger}, under eighteen; every point lost stays lost until the bot eats to eighteen`;
  const eaten = Math.min(20, hunger + points);
  // Poison does not stop healing (26.1 FoodData looks at no effect), but it
  // takes a point each 1.25 seconds to healing's one each four: said beside
  // it, so "yes" is not read as holding even. mid-243-f was poisoned from
  // 8.1 to 0.23 (note 542).
  const poisoned = require('./combat-estimate').effectLeft(bot, 'poison');
  const poisonSays = poisoned && poisoned.seconds > 0 && health > 1
    ? `poisoned, about ${Math.round(poisoned.seconds)} seconds left: one health each 1.25 seconds that armour does not stop, about ${Math.min(Math.floor(poisoned.seconds / 1.25), Math.ceil(health - 1))} more before it ends, ${hunger >= 20 && bot.foodSaturation > 0 ? 'while hunger is full and saturation lasts health comes back as fast or faster (up to a point each half second), after that a point each four seconds, which it outruns three to one' : hunger >= 18 ? 'three times as fast as health comes back here' : 'and none comes back meanwhile'}; it takes a point only while health is above 1, so it never kills on its own, but it leaves the bot at 1 or just under for the next hit`
    : null;
  return {
    health, hunger, healthComesBack: comesBack,
    ...(poisonSays ? { poison: poisonSays } : {}),
    foodCarried: carried.length ? carried.map(f => f.says) : 'nothing to eat',
    ...(hunger < 18 && carried.length ? { eatingItAll: `brings hunger to ${eaten}${eaten >= 18 ? ', where health comes back' : ', still under eighteen'}` } : {}),
    nearestFood: (() => { const n = nearestFood(bot, goal); return n.length ? n : 'none known'; })(),
    ...(withoutFoodSays(bot, goal, { health, hunger, points }) || {}),
    ...(daylightSays(bot) ? { daylight: daylightSays(bot) } : {}),
    standingStill: STILL,
  };
}

module.exports = { healingSays, noHealSays, withNoHealSays, HEALTH_SAID, withoutFoodSays, overworldFoodSays, foodCarried, nearestFood, foodSources, daylightSays, MEAT_POINTS, RAW_MEAT_POINTS, preyFailed };
