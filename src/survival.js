'use strict';
const { move } = require('./motion');
const { makeRoom } = require('./inventory-tidy');
const { attemptsFor, setAside, isSetAside, failedWithin, watch, unwatch } = require('./progress');
const { HOLDS, EMERGENCIES, refused, flipped } = require('./stillness');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { threats, immediateThreat, checkThreats, hunted, claimed, hostileEntities, nightHunted, stanceHeld, STANCE_HOLD_MS, STANCE_HEALTH, STANCE_NEWCOMER } = require('./danger');
const shelter = require('./shelter');
const { decide } = require('./decisions');
const { maintainVitals, chooseFood, checkAir } = require('./vitals');
const { foodSupply, forageChoices } = require('./foraging');
const { bedCarried, placeOriented, isBed, homeOf, layout, homeChores } = require('./home-base');
const { kitReady } = require('./mob-policy');
const { fightEstimate, stanceCost, RANGE } = require('./combat-estimate');
const { darkCells, groundCells, placeTorches, lightSources, blockLight } = require('./torches');
// Dark enough where the bot stands for monsters to spawn: a fact for the
// questions that weigh staying against leaving.
const darkHere = bot => { const feet = bot.entity.position.floored(); return blockLight(feet, lightSources(bot, feet, 4)) === 0 && ((bot.blockAt(feet)?.skyLight ?? 15) < 8 || night(bot)); };
const { verifyHouse } = require('./objectives');
const { recoverItems } = require('./recovery');
const { surveyRoute, countOf } = require('./skills');
const { defendNearby, defenseWeapon, shooter, shotTargets, shoot, lowerShield, raiseShield, canStrike } = require('./combat');
const { digBunker, bunkerSide, wallStands, nearWall, centroid } = require('./bunker');
const { deflect } = require('./projectile-guard');
const { reservedForConstruction } = require('./build-sites');
const { reachShore } = require('./shore');
const { surfaceObserver } = require('./surface');
const { tunnelStep } = require('./tunneling');
const { thinking } = require('./speech');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MEAL_CUT_MS = 10000;
const pos = p => new Vec3(p.x, p.y, p.z);
const { DAY, night } = require('./day');
const { NETHER_FOOD_POINTS, KIT_FOOD_POINTS } = require('./home-stash');
// Lava within two blocks sideways or one below: a knockback lands in it.
// A cell the bot can step into without falling or burning: solid under it,
// room for its body, and no lava beside.
// A witch too: it throws from where it stands and drinks to heal, so it is
// closed on, not waited out behind a wall (trial 7's bot walled off from
// one five times and was poisoned to death between).
// What reaches a player two blocks up, said beside the pillar: spiders
// climb, endermen teleport, witches throw up, a blast reaches (the audit).
// A mob's swing reaches as high as it stands: a wither skeleton (2.4 tall)
// hits a player two up, and mid-92-p pillared from one at twenty health
// and was cut down in four blows while it placed the blocks (2026-09-26).
const REACH_UP = { spider: 'climbs', cave_spider: 'climbs', enderman: 'teleports, and is tall enough to hit two up', witch: 'throws potions up', creeper: 'goes off at the foot and the blast reaches',
  wither_skeleton: 'is tall enough to hit a player two up', ravager: 'is tall enough to hit two up', iron_golem: 'is tall enough to hit two up', warden: 'is tall enough to hit two up',
  // Those that fly: mid-205-g pillared from phantoms twice at five health,
  // told two up was out of reach of all but the climbers (2026-09-27).
  phantom: 'flies, and dives on a player wherever it stands; only a roof keeps it off', blaze: 'flies', vex: 'flies, through walls too', bee: 'flies', allay: 'flies',
  // Those that jump: mid-211-h pillared from a magma cube over the lava sea
  // and it jumped up and knocked the bot off, fifty-five blocks down
  // (2026-09-27).
  magma_cube: 'jumps higher than two blocks, and its hit throws', slime: 'jumps higher than two blocks' };
const climbers = danger => { const kinds = [...new Set(danger.map(t => t.entity.name).filter(n => REACH_UP[n]))]; return kinds.length ? ` Two up does not stop ${kinds.map(n => `a ${n.replaceAll('_', ' ')} (${REACH_UP[n]})`).join(' or ')}.` : ''; };
// Two up is out of reach only of mobs on the bot's own level: one standing
// a block or more higher (stairs, a slope, a ledge) is level with the top
// of the pillar or near it. mid-239-b pillared at the foot of its stairs
// with the zombies coming down them (2026-09-27).
const above = (bot, danger) => {
  const y = Math.floor(bot.entity.position.y), up = danger.filter(t => !shooter(t.entity) && t.distance <= 8 && Math.floor(t.entity.position?.y ?? y) >= y + 1);
  return up.length ? ` ${up.length === 1 ? `A ${up[0].entity.name.replaceAll('_', ' ')} stands` : `${up.length} of the mobs stand`} a block or more above the bot's feet (${up.map(t => `${Math.floor(t.entity.position.y) - y} up, ${Math.round(t.distance)} off`).join('; ')}): two up is within reach of ${up.length === 1 ? 'it' : 'them'}.` : '';
};
// A retreat's footing is found when it runs, not before (runAway): said, so
// the run is not read as a known safe place (the decision audit, 2026-09-25).
const NO_ROUTE_YET = ' No route is checked yet: where it ends, how high and how lit, is found as it runs.';
// The race a pocket is: blocks to place against the nearest biter's walk.
// Trial 70 chose to seal with four zombies coming, the nearest six blocks
// off, told nothing of either, and went from twelve to nothing with the
// pocket half built.
function pocketRace(bot, danger) {
  const feet = bot.entity.position.floored();
  const biter = danger.filter(t => !shooter(t.entity) && t.entity.name !== 'creeper').sort((x, y) => x.distance - y.distance)[0];
  const shellCells = (() => { try { return shelter.missingShell(bot, { origin: { x: feet.x, y: feet.y, z: feet.z } }).length; } catch (_) { return null; } })();
  return shellCells != null ? ` About ${shellCells} block${shellCells === 1 ? '' : 's'} to place here, some ${Math.round(shellCells * BLOCK_SECONDS)} seconds of building${biter ? `; the nearest ${biter.entity.name.replaceAll('_', ' ')}, ${Math.round(biter.distance)} blocks off${biter.visible === false ? ' and out of sight' : ''}, can be at the bot in about ${Math.max(0, Math.round((biter.distance - 1.5) / 3))} seconds` : ''}.` : '';
}
// A creeper close walks up to a pillar or a pocket and goes off, and a
// pocket is not closed before the blast (the live run, 17:16, at three
// health): said, not decided by hiding the options.
function creeperNoteFor(danger) {
  const creeper = danger.filter(t => t.entity.name === 'creeper' && t.distance <= 7).sort((a, b) => a.distance - b.distance)[0];
  return creeper ? ` A creeper is ${Math.round(creeper.distance)} blocks off${creeper.visible === false ? ', out of sight' : ''}: it walks up to whatever is built and goes off, and a pocket is not closed before the blast.` : '';
}
const GROUND_SHOOTERS = new Set(['skeleton', 'stray', 'bogged', 'parched', 'pillager', 'witch']);
// The stances that move the bot or keep its hands busy building, digging or
// eating: a shield raised at each arrow stops them.
// The most a route drops the bot (movement.js).
const ROUTE_DROP = 3;
const MOVING_STANCES = new Set(['retreat', 'seal', 'bunker', 'charge_shooter', 'creeper_dance', 'come_down', 'dig_down', 'eat', 'eat_golden_apple']);
// Two blocks up: from the pillar's report to two up took a second and a
// half to two seconds in mid-92-e, mid-92-g and mid-110-k (2026-09-26).
const PILLAR_SECONDS = 1.5;
// A block of a pocket six tenths of a second (the median over 229 pocket
// passes in the flight records of 2026-09-23 to 26); eating a second and six
// tenths; digging down a second a block more than the dig itself (below).
const BLOCK_SECONDS = 0.6, EAT_SECONDS = 1.6, SHAFT_BLOCK_SECONDS = 1;
// A run: about five and a half blocks a second sprinting. The route searches
// made before the stance is asked, at most (scoutRetreat).
const SPRINT = 5.6, SCOUT_MS = 300;
// Walkers that still get at a player two blocks up.
const CLIMBERS = new Set(['spider', 'cave_spider', 'enderman', 'wither_skeleton', 'ravager', 'iron_golem', 'warden']);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// "the spider, the zombie and 3 skeletons": the mobs of these kinds in `mobs`.
function mobList(names, mobs) {
  const parts = names.map(n => { const k = mobs.filter(m => m.name === n).length; return k > 1 ? `${k} ${n.replaceAll('_', ' ')}s` : `the ${n.replaceAll('_', ' ')}`; });
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || '';
}
// What a stance costs against the mobs about, said the same way on every
// stance (combat-estimate.js stanceCost): the crowd deaths were each told
// the fight's cost and nothing of the others', and Jev took the stances
// that carried no figure. `doing` names the building or digging first;
// `done` says what the bot is once it is done ("Two up", "Sealed in").
function costSays(cost, health, mobs, { doing = null, done = null, over = 'in the next fifteen seconds this way' } = {}) {
  const h = Math.round(health * 10) / 10;
  const setupSays = !doing || !cost.setup ? '' : cost.setup >= cost.seconds ? `, and the ${cost.setup} seconds of ${doing} not done within them` : `, the ${cost.setup} seconds of ${doing} included`;
  let s = ` About ${cost.damage} damage from the mobs here ${over}${setupSays}, from ${h} health${cost.damage >= health ? ' (more than the bot has)' : ''}.`;
  for (const b of cost.blasts) s += ` The creeper ${Math.round(b.distance)} blocks off can go off beside the bot in about ${b.seconds} seconds${doing && cost.setup ? `, ${b.seconds <= cost.setup ? 'before' : 'after'} the ${doing} is done` : ''}: about ${Math.round(b.hitsBot)} two blocks off after the armour worn${b.hitsBot >= health ? ', more than the bot has' : ''}.`;
  if (done && cost.setup < cost.seconds) s += cost.still.length ? ` ${done}, ${mobList(cost.still, mobs)} still reach${cost.still.length === 1 && mobs.filter(m => m.name === cost.still[0]).length === 1 ? 'es' : ''} it.` : ` ${done}, none of them reaches it.`;
  return s;
}
// How many biters can be at arm's length at once where the bot stands: the
// cells round it a mob could stand in (room for a body, ground under it or
// a step up). Two in a tunnel, eight on open ground.
function openCells(bot, feet = bot.entity.position.floored()) {
  const open = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'empty' && !/lava/.test(b.name); };
  const floor = p => bot.blockAt(p)?.boundingBox === 'block';
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dz) continue;
    const c = feet.offset(dx, 0, dz);
    if (open(c) && open(c.offset(0, 1, 0)) && (floor(c.offset(0, -1, 0)) || floor(c.offset(0, -2, 0)))) n++;
    else if (floor(c) && open(c.offset(0, 1, 0)) && open(c.offset(0, 2, 0))) n++;
  }
  return n;
}
// A meal worth a stance: the bot is hurt, and hunger after it is high enough
// for health to come back. At full health, or still under eighteen after
// it, eating in a fight is a second and a half for nothing; offered anyway,
// its small bill (the mobs over those seconds only) outbid the stances that
// deal with them (mid-92-e's replay, 2026-09-26).
function mealHelps(bot) {
  if ((bot.food ?? 20) >= 20 || (bot.health ?? 20) >= 20) return null;
  const food = chooseFood(bot);
  if (!food) return null;
  return (bot.food ?? 20) + (bot.registry.foodsByName?.[food.name]?.foodPoints || 0) >= 18 ? food : null;
}
// The meal's bill is for the eating alone: said, so it is not read as a way
// out of the crowd.
const EAT_AFTER = ' The mobs are all still here when it is done.';
// Eating in an encounter, said: what the meal gives back and when. Health
// comes back once a half second while hunger is full and saturation lasts
// (a point and a half of saturation each), once in four seconds from
// eighteen hunger, and not below.
function eatSays(bot, food) {
  const f = bot.registry.foodsByName?.[food.name] || {};
  const hunger = Math.min(20, (bot.food ?? 20) + (f.foodPoints || 0));
  const saturation = Math.min(hunger, (bot.foodSaturation ?? 0) + (f.saturation || 0));
  const missing = Math.max(0, Math.round(20 - (bot.health ?? 20)));
  const back = hunger >= 20 && saturation >= 1.5 && missing
    ? `then health comes back about one each half second while the saturation lasts, about ${Math.min(missing, Math.floor(saturation / 1.5))} in ${Math.round(Math.min(missing, Math.floor(saturation / 1.5)) / 2)} seconds`
    : hunger >= 18 && missing ? 'then health comes back about one each four seconds' : missing ? 'and health does not come back below eighteen hunger' : 'health is full';
  return `Eat the ${food.name.replaceAll('_', ' ')} now (${countOf(bot, food.name)} carried): about ${EAT_SECONDS} seconds standing still, the hand busy and the shield down, no swing; hunger ${bot.food} to ${hunger}, ${back}.`;
}
function firmStep(bot, p) {
  if (!p) return false;
  const floor = bot.blockAt(p.offset(0, -1, 0)), body = [bot.blockAt(p), bot.blockAt(p.offset(0, 1, 0))];
  return floor?.boundingBox === 'block' && !/lava|magma|fire/.test(floor.name) && body.every(b => b && b.boundingBox === 'empty' && !/lava|fire/.test(b.name)) && !lavaBeside(bot, p);
}
// The charge's own way to a shooter, walked ahead of time: straight at it,
// a cell at a time, level, a step up or a step down onto firm ground, as
// closeOnShooter moves. How far it gets, or null when it gets to reach.
// mid-110-h was offered a charge at two skeletons the ground between would
// not carry it to, and fought on for fifty-four seconds (2026-09-26).
function chargeStopsAt(bot, target) {
  let at = bot.entity.position.floored();
  const goal = target.position.floored();
  for (let i = 0; i < 24; i++) {
    const flat = goal.minus(at); flat.y = 0;
    if (Math.hypot(flat.x, flat.z) <= 2.5 && Math.abs(goal.y - at.y) <= 2) return null;
    const len = Math.hypot(flat.x, flat.z) || 1;
    const ahead = at.offset(Math.round(flat.x / len), 0, Math.round(flat.z / len));
    const next = [ahead, ahead.offset(0, 1, 0), ahead.offset(0, -1, 0)].find(c => firmStep(bot, c));
    if (!next) return { blocks: i, left: Math.round(target.position.distanceTo(at.offset(0.5, 0, 0.5))) };
    at = next;
  }
  return null;
}
// The last run at this mob, if it got no nearer: a mob that keeps its
// distance (a witch, a skeleton backing off) or a way that does not carry
// the bot to it.
const CHARGE_REMEMBERED_MS = 30000;
function chargeSays(bot, entity) {
  const last = bot._charges?.[entity?.id];
  if (!last || Date.now() - last.at > CHARGE_REMEMBERED_MS || last.to < last.from - 1) return '';
  const name = (last.name || entity.name || 'mob').replaceAll('_', ' ');
  return ` The last run at the ${name}, ${Math.round((Date.now() - last.at) / 1000)} seconds ago, ended ${Math.round(last.to)} blocks off, no nearer than the ${Math.round(last.from)} it began at.`;
}
// Ore worth a night's digging, nearest first, below the bot or level with
// it: a tunnel up toward an ore in the roof is a tunnel toward the surface.
// Not copper: nothing on the ladder wants it, and trial 20's stone pickaxe
// wore out on fifty-seven of it and left the bot without one (2026-09-24).
// (Jev may still choose it: nightTarget offers every kind, copper's use said.)
const NIGHT_ORES = new Set(['coal_ore', 'iron_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore', 'copper_ore', 'deepslate_copper_ore',
  'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_redstone_ore', 'deepslate_lapis_ore', 'deepslate_diamond_ore', 'deepslate_emerald_ore']);
// What each ore gives and what it is for, said to Jev with the choice.
const ORE_YIELD = { coal: ['coal', 'fuel for every smelt, and torches'], iron: ['raw_iron', 'tools, armour, a shield and a bucket'], copper: ['raw_copper', 'nothing on the ladder wants it'],
  gold: ['raw_gold', 'golden boots for the Nether'], redstone: ['redstone', 'nothing on the ladder wants it'], lapis: ['lapis_lazuli', 'enchanting'],
  diamond: ['diamond', 'the best tools and armour'], emerald: ['emerald', 'trading with villagers'] };
const oreKind = name => (/(?:deepslate_)?(\w+?)_ore$/.exec(name || '') || [])[1];
// The nearest of each kind of ore the night mine could go for: dry, not
// above the feet (a tunnel up is a tunnel toward the surface), in the
// working depth, and not a target that failed lately.
function nightOreChoices(bot, feet, attempts) {
  const names = Object.keys(bot.registry?.blocksByName || {}).filter(n => ORE_YIELD[oreKind(n)] && /_ore$/.test(n));
  const ids = names.map(name => bot.registry.blocksByName[name].id);
  const found = bot.findBlocks?.({ matching: ids, maxDistance: 24, count: 64 }) || [];
  const wet = q => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]
    .some(([x, y, z]) => /water|lava|bubble_column|kelp|seagrass/.test(bot.blockAt(q.offset(x, y, z))?.name || ''));
  const byKind = new Map();
  for (const q of found.filter(q => q.y <= feet.y + 1 && q.y >= -48 && !attempts?.resting('night_mine', q) && !wet(q)).sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))) {
    const name = bot.blockAt(q)?.name, kind = oreKind(name);
    if (kind && !byKind.has(kind)) byKind.set(kind, { position: q, name, kind });
  }
  return [...byKind.values()];
}
// What the rock about the bot holds, for a choice about mining it: the ore
// in view with its distance, and which kinds the best pickaxe carried
// mines. A pocket's "mine the night away" said only "toward ore in the
// rock", and Jev sat the night out with iron wanted and a stone pickaxe.
const PICK_TIER = { wooden: 1, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 };
const ORE_TIER = { coal: 1, copper: 2, iron: 2, lapis: 2, gold: 3, redstone: 3, diamond: 3, emerald: 3 };
function rockHolds(bot, feet, attempts) {
  const tier = Math.max(0, ...bot.inventory.items().map(i => /^(\w+)_pickaxe$/.exec(i.name)).filter(Boolean).map(m => PICK_TIER[m[1]] || 0));
  if (!tier) return 'No pickaxe is carried: stone and ore cannot be mined.';
  const pick = Object.keys(PICK_TIER).find(k => PICK_TIER[k] === tier);
  const mines = Object.keys(ORE_TIER).filter(k => ORE_TIER[k] <= tier), not = Object.keys(ORE_TIER).filter(k => ORE_TIER[k] > tier);
  const seen = nightOreChoices(bot, feet, attempts).map(c => `${c.kind} ${Math.round(c.position.distanceTo(feet))} blocks off`);
  const uses = Math.max(0, ...bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).map(i => remainingUses(bot, i)));
  const keep = usesToClimbOut(bot);
  const wear = Number.isFinite(uses) ? ` The best pickaxe has ${uses} uses left; about ${keep} of them are the climb back out from here, and the mine stops when it gets down to that.` : '';
  return `${seen.length ? `Ore in view: ${seen.join(', ')}.` : 'No ore in view from here; a branch finds it in the rock.'} The ${pick} pickaxe carried mines ${mines.join(', ')} ore${not.length ? `; ${not.join(', ')} need a better one` : ''}.${wear}`;
}
// Without Jev: the nearest of the ores the ladder uses (not copper).
function nightOre(bot, feet, attempts) {
  const ids = [...NIGHT_ORES].filter(name => !/copper/.test(name)).map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
  const found = bot.findBlocks?.({ matching: ids, maxDistance: 24, count: 32 }) || [];
  // Not ore touching water or lava. The staircase will not open a cell onto
  // a liquid, so every step toward such an ore is refused but the sideways
  // ones: the mine paced back and forth under a copper in the wall of a
  // flooded cave, the same cave it had drowned in.
  const wet = q => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]
    .some(([x, y, z]) => /water|lava|bubble_column|kelp|seagrass/.test(bot.blockAt(q.offset(x, y, z))?.name || ''));
  const p = found.filter(q => q.y <= feet.y + 1 && q.y >= -48 && !attempts?.resting('night_mine', q) && !wet(q))
    .sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))[0];
  return p ? { position: p, name: bot.blockAt(p)?.name } : null;
}

// What a pocket is built of: what the bot carries to wall itself in with.
// Natural ground in the shell was never placed and stays where it is.
const POCKET_BLOCKS = new Set(['cobblestone', 'cobbled_deepslate', 'netherrack', 'dirt', 'andesite', 'diorite', 'granite', 'tuff', 'blackstone', 'basalt',
  'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks']);

async function clearAboveBed(bot, task, actions, site) {
  for (const cell of [site.foot, site.head].filter(Boolean).map(p => p.offset(0, 1, 0))) {
    const block = bot.blockAt(cell);
    if (!block || block.boundingBox !== 'block' || !block.diggable || /bed$|chest|furnace|crafting_table/.test(block.name)) continue;
    task.check();
    try { await actions.dig(bot, task, cell, { requireDrops: false }); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
}
function lavaBeside(bot, p) {
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 0; dy++) {
    if (bot.blockAt(new Vec3(p.x + dx, p.y + dy, p.z + dz))?.name === 'lava') return true;
  }
  return false;
}
// In lava, nothing else is the question: a hoglin knocked the bot into
// the pool beside it at eight health, and it "held a defensive position"
// in the lava four times until it burned. The nearest cell with a floor,
// air for the body and no lava in it, forward and jumping at it.
// Phantoms spawn over a player awake for three in-game days (72000 ticks).
const SLEEP_DEBT_TICKS = 48000;
const worldAge = bot => Number(bot.time?.age);

const inLava = bot => require('./terrain').bodyInLava(bot);
const inWater = bot => !!bot.entity?.isInWater || bot.blockAt(bot.entity.position.floored())?.name === 'water';
// Out to six blocks: at three, a fall into the Nether's lava sea found no
// shore, the step did nothing, and the bot burned four seconds standing.
function lavaExit(bot, radius = 6, { water = false } = {}) {
  const feet = bot.entity.position.floored(), cells = [];
  // Water is a way out too, and the best one: it puts the fire out. Making
  // obsidian, the water poured over the pool filled every cell beside the
  // bot when it went into the lava, the nearest dry cell was seven blocks
  // off through the pool, and mid-92-h burned without moving (2026-09-26).
  const dry = c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'empty' && !(water ? /lava|fire/ : /lava|fire|water/).test(b.name); };
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -1; dy <= 5; dy++) {
    const c = feet.offset(dx, dy, dz);
    if (bot.blockAt(c.offset(0, -1, 0))?.boundingBox !== 'block' || bot.blockAt(c.offset(0, -1, 0))?.name === 'magma_block' || !dry(c) || !dry(c.offset(0, 1, 0))) continue;
    // Out of lava, never the cell the feet are in: the body leaned from it
    // into the lava beside, it was "the nearest dry cell", and mid-92-m
    // burned from sixteen health standing in it (2026-09-26). Cells with
    // lava beside them come after those without.
    if (water && c.equals(feet)) continue;
    // Water a step up is no way out: the climb out of a liquid is refused
    // where the body would rise into liquid, so mid-92-n bobbed in the
    // lava against the obsidian under the water it had poured, the one
    // exit it was steered at, and burned from sixteen (2026-09-26).
    if (water && c.y > feet.y && [c, c.offset(0, 1, 0)].some(p => bot.blockAt(p)?.name === 'water')) continue;
    cells.push(c);
  }
  const far = c => c.offset(0.5, 0, 0.5).distanceTo(bot.entity.position);
  const lavaBy = c => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([x, z]) => [0, 1].some(dy => /lava/.test(bot.blockAt(c.offset(x, dy, z))?.name || ''))) ? 4 : 0;
  // Out of lava upright, the push can carry past the cell: one on a ledge
  // comes after one with a floor all round. mid-235-a stepped out onto the
  // Nether ledge's edge and over it, twenty blocks into the lava below
  // (2026-09-26).
  const edge = c => require('./terrain').besideDrop(bot, c) ? 4 : 0;
  // A jump rises one block: a cell two up is out of reach from lava one
  // deep. mid-230-d was steered at a ledge two above its feet, hopped in
  // place five seconds and burned (2026-09-26).
  const high = c => c.y > feet.y + 1 ? 8 : 0;
  const cost = c => far(c) + (water ? lavaBy(c) : 0) + edge(c) + high(c);
  return cells.sort((a, b) => cost(a) - cost(b))[0] || null;
}

// A fight is not taken with a drop beside the bot: one hit's knockback on
// a Nether ledge was a thirty-block fall, twice in ten minutes. Beside a
// drop means a neighbouring cell the body could be pushed into with no
// floor for three blocks under it, or lava under it.
const { besideDrop, dropWithin, KNOCKBACK } = require('./terrain');
const BUNKER_DIG_MS = 3000;
const heavyHitters = (danger, radius) => danger.filter(t => KNOCKBACK.has(t.entity.name) && t.distance <= radius);
function firmGround(bot, radius = 4, { margin = 1 } = {}) {
  const feet = bot.entity.position.floored(), cells = [];
  const open = c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'empty' && !/lava|fire|water|powder_snow/.test(b.name); };
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -1; dy <= 1; dy++) {
    const c = feet.offset(dx, dy, dz);
    const floor = bot.blockAt(c.offset(0, -1, 0));
    if (floor?.boundingBox !== 'block' || /magma/.test(floor.name) || !open(c) || !open(c.offset(0, 1, 0)) || (margin > 1 ? dropWithin(bot, c, margin) : besideDrop(bot, c)) || lavaBeside(bot, c)) continue;
    cells.push(c);
  }
  const far = c => c.offset(0.5, 0, 0.5).distanceTo(bot.entity.position);
  return cells.sort((a, b) => far(a) - far(b))[0] || null;
}

// Hostiles that daylight does not remove and that keep following.
const PERSISTENT_THREATS = new Set(['creeper', 'spider', 'cave_spider', 'enderman', 'witch', 'pillager', 'vindicator', 'husk', 'drowned']);
// Mobs worth hiding from rather than meeting. A wither skeleton carries a
// sword: the arena's first drill had the bot wall itself in against one and
// take fourteen damage through the doorway instead of four swings and done.
// A piglin only shoots when it is holding a crossbow, which `shooter` knows.
const shoots = threat => shooter(threat.entity);
// Ground to run to. It was the overworld's surface only, so in the Nether
// no retreat and no step back from a lava edge could find anywhere to
// stand, and every flee there fell straight through to sealing in. Magma is
// left out: it burns whoever stands on it.
const ESCAPE_FOOTING = ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'stone', 'deepslate', 'tuff', 'andesite', 'diorite', 'granite',
  'sand', 'red_sand', 'gravel', 'cobblestone', 'cobbled_deepslate', 'sandstone', 'terracotta',
  'netherrack', 'soul_sand', 'soul_soil', 'basalt', 'smooth_basalt', 'blackstone', 'nether_bricks', 'crimson_nylium', 'warped_nylium',
  'end_stone', 'obsidian'];
const shelterNeeded = bot => bot.game.difficulty !== 'peaceful' && bot.game.dimension === 'overworld' &&
  bot.time?.timeOfDay >= DAY.DUSK && bot.time.timeOfDay < DAY.DAWN;
// The server lets a player sleep from 12541 until 23458; with the only
// survival player in bed the night passes in a hundred ticks.
const { SLEEP_FROM, SLEEP_UNTIL } = DAY;
// Whether a failed sleep is still being waited out. Older saved state has
// only the time of the failure, which waits the full ten minutes.
const sleepWaiting = holder => isSetAside(holder, 'sleep', 'bed');
// Real minutes until dawn: what a night waited out costs the run.
const minutesToDawn = bot => Math.round(((DAY.DAWN - (bot.time?.timeOfDay ?? 0) + 24000) % 24000) / 1200);
const sleepable = bot => bot.time?.timeOfDay >= SLEEP_FROM && bot.time.timeOfDay <= SLEEP_UNTIL;
// Three cells in a line: where the bot stands, the bed's foot, its head.
// Level floor under both bed cells, air at feet and head height.
// The bed at the base, when it stands and is within a short walk: the
// first night of run two was spent walled in two blocks from it.
// Within a short walk means within a hundred and sixty blocks: the second
// run walled itself in thirty blocks from its bed because the bed was out of
// view. (A hundred at first; the base's pond and plot pulled the working
// radius out to a hundred and sixty.)
// A bed remembered as claimed counts while its chunk is unloaded; a bed
// seen to be gone does not.
// The walk home to bed: a long one at dusk, a short one once the night has
// come. Dark already, the clean run walked a hundred and thirty blocks to
// its bed through the mobs, arrived at three health with a skeleton, a
// spider and a spear-carrying zombie beside it, could not sleep, and died
// there twice (2026-09-24 00:48).
const HOME_BED_WALK = 160, NIGHT_BED_WALK = 48;
const darkNow = bot => { const t = bot.time?.timeOfDay ?? 0; return t >= 13000 && t < 23000; };
function nearbyHomeBed(bot, goal) {
  const home = homeOf(bot, goal);
  if (!home?.bed?.claimedAt) return null;
  const { bed } = layout(home);
  const foot = pos(bed.foot), block = bot.blockAt(foot);
  if (foot.distanceTo(bot.entity.position) > (darkNow(bot) ? NIGHT_BED_WALK : HOME_BED_WALK) || (block && !isBed(block))) return null;
  return { foot, head: pos(bed.head), stand: pos(bed.stand), placed: true };
}
// Any bed in view, not only our own: the live run sealed itself into a
// pocket, then mined out of it, with a village bed a few blocks off,
// because the only beds it knew were one carried and one at a base four
// hundred blocks away. Overworld only (a bed anywhere else explodes), not
// one a villager is in, and with a cell beside it to stand in.
const FACING = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
function observedBed(bot) {
  if (!/overworld/.test(String(bot.game?.dimension || '')) || typeof bot.findBlocks !== 'function') return null;
  const ids = (bot.registry?.blocksArray || []).filter(b => /_bed$/.test(b.name)).map(b => b.id);
  if (!ids.length) return null;
  const here = bot.entity.position;
  const found = bot.findBlocks({ matching: ids, maxDistance: 48, count: 16 }).sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
  const standable = p => bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block' &&
    [0, 1].every(dy => { const b = bot.blockAt(p.offset(0, dy, 0)); return !!b && b.boundingBox === 'empty' && !/water|lava/.test(b.name); });
  for (const p of found) {
    const block = bot.blockAt(p);
    if (!isBed(block)) continue;
    const props = block.getProperties?.() || {};
    if (props.part === 'head' || props.occupied === true || props.occupied === 'true') continue;
    const [dx, dz] = FACING[props.facing] || [0, 0];
    const head = p.offset(dx, 0, dz);
    const stand = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => p.offset(x, 0, z)).find(c => !c.equals(head) && standable(c));
    if (stand) return { foot: p, head, stand, placed: true, observed: true };
  }
  return null;
}
const bedToSleepIn = (bot, goal) => nearbyHomeBed(bot, goal) || observedBed(bot);

function bedSite(bot) {
  const feet = bot.entity.position.floored();
  const floor = p => bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block';
  const free = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'empty' && !/water|lava/.test(b.name); };
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const foot = feet.offset(dx, 0, dz), head = feet.offset(2 * dx, 0, 2 * dz);
    if ([foot, head].every(p => floor(p) && free(p) && free(p.offset(0, 1, 0)))) return { stand: feet, foot, head };
  }
  return null;
}
// A bed nook: where no two level cells lie beside the feet (a staircase, a
// shaft, a one-by-two pocket), the two are dug out of the rock as a player
// does underground, the foot beside the bot and the head past it, each with
// the floor under it kept and the cell above it cleared: a bed needs air
// over it. The one carried bed that did go down in the six midgame trials
// of 2026-09-26 found no level cells in a staircase or a pocket, and the
// bot sealed itself in eleven times with it on its back.
// Nothing that falls over the nook, no liquid beside it, and nothing dug
// that is kept (a bed, a chest, a spawner, construction). Closed in rock
// all round (the bot's own two cells aside) is said, and is required from
// a sealed pocket: the pocket stays shut. `shell` counts cells a pocket
// about to be sealed will fill as solid.
const NOOK_KEEP = /bed$|chest|furnace|crafting_table|spawner|obsidian|bedrock|portal|barrel|shulker|amethyst/;
const FALLS = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder|pointed_dripstone|[a-z_]*anvil)$/;
const WET = /water|lava|bubble_column/;
const AROUND = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function bedNook(bot, goal = {}, { sealed = false, shell = [] } = {}) {
  if (!bot.entity?.position || typeof bot.blockAt !== 'function') return null;
  const feet = bot.entity.position.floored(), filled = new Set(shell.map(String));
  const open = b => !!b && b.boundingBox === 'empty' && !WET.test(b.name) && !/cobweb|fire/.test(b.name);
  const found = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const foot = feet.offset(dx, 0, dz), head = feet.offset(2 * dx, 0, 2 * dz);
    const cells = [foot, foot.offset(0, 1, 0), head, head.offset(0, 1, 0)];
    if (![foot, head].every(p => { const floor = bot.blockAt(p.offset(0, -1, 0)); return floor?.boundingBox === 'block' && !/magma/.test(floor.name); })) continue;
    const dig = [];
    let ok = true;
    for (const c of cells) {
      const b = bot.blockAt(c);
      if (open(b)) continue;
      if (!b || b.boundingBox !== 'block' || !b.diggable || NOOK_KEEP.test(b.name) || reservedForConstruction(goal, c, { from: feet })) { ok = false; break; }
      dig.push(c);
    }
    if (!ok) continue;
    if ([foot, head].some(p => FALLS.test(bot.blockAt(p.offset(0, 2, 0))?.name || ''))) continue;
    if (cells.some(c => AROUND.some(([x, y, z]) => WET.test(bot.blockAt(c.offset(x, y, z))?.name || '')))) continue;
    const own = new Set([...cells, feet, feet.offset(0, 1, 0)].map(String));
    const enclosed = cells.every(c => AROUND.every(([x, y, z]) => { const n = c.offset(x, y, z); return own.has(`${n}`) || filled.has(`${n}`) || bot.blockAt(n)?.boundingBox === 'block'; }));
    if (sealed && !enclosed) continue;
    found.push({ stand: feet, foot, head, dig, enclosed });
  }
  return found.sort((a, b) => (b.enclosed - a.enclosed) || a.dig.length - b.dig.length)[0] || null;
}
// Sleep is refused while a monster is within eight blocks of the bed and
// five up or down (vanilla), seen or not: counted the one way for every
// bed option (the decision audit).
const monstersByBed = (bot, foot, radius = 48) => threats(bot, radius).filter(t => t.entity.position.distanceTo(foot) <= 8 && Math.abs(t.entity.position.y - foot.y) <= 5).length;
// What a bed nook is, said the one way wherever it is offered.
function nookSays(bot, nook, { pocket = false, later = false } = {}) {
  const n = nook.dig.length, near = monstersByBed(bot, nook.foot);
  const where = pocket ? 'out of the pocket\'s wall' : 'beside the bot';
  const closed = nook.enclosed ? `, closed in rock all round${pocket ? ' so the pocket stays shut' : ''}` : ', open to the air on a side';
  const wait = later ? ` Bedtime is from ${SLEEP_FROM}, about ${Math.max(0, Math.round((SLEEP_FROM - (bot.time?.timeOfDay ?? 0)) / 20))} seconds off.` : '';
  return `dig a bed nook ${where}, the two cells in a line where the bed goes (foot and head), ${n ? `${n} block${n === 1 ? '' : 's'} to dig` : 'nothing to dig'} and the floor under them kept${closed}; put the carried bed in it and sleep. The night passes in seconds, instead of about ${minutesToDawn(bot)} real minutes ${pocket ? 'in the pocket' : 'in a pocket or a night mine'}; the bed is picked back up after.${wait} Sleep is refused while a monster is within about eight blocks sideways and five up or down of the bed (vanilla), seen or not: ${near ? `${near} ${near === 1 ? 'is' : 'are'} now` : 'none now'}.`;
}
const emptySite = (bot, refuge) => refuge.kind !== 'house' && !refuge.verifiedAt &&
  shelter.shell(refuge.origin).every(p => shelter.replaceable(bot.blockAt(p)));

// Encounter stances are Jev's; JEV_ENCOUNTERS=0 hands them to the rules.
// A creeper within seven blocks: no pocket or bunker is begun, the blast
// comes before the last block.
// Night-mine tools: the uses left on a pickaxe, and the one the pockets
// can make now (iron before stone), with sticks or planks and a table carried.
const PICKAXE_SPARE_USES = 24;
// The uses the climb out takes: about two digs for every block of rock over
// the head, a staircase's step and its headroom, and a margin. Twenty-four
// was kept at any depth, and mid-87-a stopped mining forty blocks down with
// that many left, wore through them on the stairs and dug the last
// twenty-four blocks by hand, at two a minute (2026-09-25).
function usesToClimbOut(bot) {
  const feet = bot.entity.position.floored();
  let top = feet.y;
  for (let y = feet.y + 2; y <= Math.min(feet.y + 200, 319); y++) {
    const b = bot.blockAt(new Vec3(feet.x, y, feet.z));
    if (!b) break;
    if (b.boundingBox === 'block') top = y;
  }
  return Math.max(PICKAXE_SPARE_USES, 2 * (top - feet.y) + 16);
}
function remainingUses(bot, item) {
  const max = bot.registry?.itemsByName?.[item.name]?.maxDurability;
  return max ? max - (item.durabilityUsed || 0) : Infinity;
}
function pickaxeCraftable(bot) {
  const has = name => countOf(bot, name);
  const planks = bot.inventory.items().filter(i => /_planks$/.test(i.name)).reduce((n, i) => n + i.count, 0);
  const logs = bot.inventory.items().filter(i => /_log$/.test(i.name)).reduce((n, i) => n + i.count, 0);
  if (!(has('stick') >= 2 || planks >= 2 || logs >= 1) || !has('crafting_table')) return null;
  if (has('iron_ingot') >= 3) return 'iron_pickaxe';
  if (has('cobblestone') >= 3 || has('cobbled_deepslate') >= 3) return 'stone_pickaxe';
  return null;
}
// A creeper whose fuse is lit (its swell direction is 1).
function creeperSwelling(bot, entity) {
  const i = bot.registry?.entitiesByName?.creeper?.metadataKeys?.indexOf('swell_dir');
  return i >= 0 && entity.metadata?.[i] === 1;
}
const creeperClose = danger => danger.some(t => t.entity.name === 'creeper' && t.distance <= 7);
const encounterJudgments = survival => !!survival.client && process.env.JEV_ENCOUNTERS !== '0';

// Minecraft actions are injected to avoid a dependency cycle with the work
// executor. The state lives on the retained goal and can also be shared by an
// idle companion session. No survival interruption replaces the player request.
// A pocket is not begun where a creeper in sight would reach it and go off
// before it closed: its walk to lighting distance and its fuse against
// six tenths of a second a block. mid-79-g began twenty blocks with two
// creepers close (note 157); mid-92-u, followed half a minute by one, dug
// in with it eight blocks off and was blown up at full health (2026-09-26).
// The dance and the backing off answer a creeper; the pocket after.
function creeperRace(bot, blocks) {
  const { APPROACH, LIGHTS_AT, FUSE } = require('./combat-estimate');
  return threats(bot, 16).some(t => t.entity.name === 'creeper' && (t.visible || t.distance <= 5) &&
    blocks * BLOCK_SECONDS > Math.max(0, (t.distance - LIGHTS_AT) / APPROACH) + FUSE);
}

function creeperSays(bot) {
  const { APPROACH, LIGHTS_AT, FUSE } = require('./combat-estimate');
  const near = threats(bot, 16).filter(t => t.entity.name === 'creeper' && (t.visible || t.distance <= 5)).sort((a, b) => a.distance - b.distance)[0];
  if (!near) return '';
  const secs = Math.round((Math.max(0, (near.distance - LIGHTS_AT) / APPROACH) + FUSE) * 10) / 10;
  return ` A creeper is ${Math.round(near.distance)} blocks off: coming on, it could go off beside the bot in about ${secs} seconds; a shelter is walled or dug at about ${BLOCK_SECONDS} seconds a block.`;
}

class Survival {
  constructor(bot, actions, { state, client } = {}) {
    this.bot = bot; this.actions = actions; this.client = client;
    this.state = state || { shelters: [] };
    this.state.shelters ||= [];
    if (!bot._survivalHurtListener) {
      bot._survivalHurtListener = (entity, source) => {
        if (entity !== bot.entity) return;
        bot._recentHurtAt = Date.now();
        // Who did it, by kind: a neutral mob that hits the bot has turned.
        if (source?.name) (bot._hurtBy ||= {})[source.name] = Date.now();
        // Hurt three times in fifteen seconds with no survival action at all
        // is a bug with no trace: the replay run was shot for forty-eight
        // seconds in the Nether and the record held nothing but its health.
        // Say what was going on, once in a while, so it can be found.
        const now = Date.now();
        bot._hurtTimes = [...(bot._hurtTimes || []).filter(t => now - t < 15000), now];
        // Hit twice in four seconds with no survival action in three: the
        // turn is held by a step that is not looking (a crafting window, a
        // dig, a walk). Trial 29's night mine stopped to craft a pickaxe at
        // y -9 and a zombie took it from twenty to nothing in seven seconds.
        // The walk, the dig and any window are stopped, and the step's next
        // check unwinds to the survival layer, where the stance is chosen.
        // Once, when a hostile mob landed it. A survival action counts only
        // if it answers the mobs: trial 57 was told to keep working, went
        // on digging stone by hand for its shelter, and was hit five times
        // before anything looked up (the arena replay of its ledge).
        const byMob = source && require('./danger').hostileEntities(bot, 8).includes(source);
        // A stance Jev chose is the answer while it holds: the watchdog threw
        // a retreat out at the first hit (it reports nothing as it runs), and
        // a pocket or a charge at the first hit three seconds after they
        // began. Leaving the mobs be is not an answer.
        const held = require('./danger').stanceHeld(bot, now);
        const answering = held && held.choice !== 'keep_working';
        if (bot._hurtTimes.filter(t => now - t < 4000).length >= (byMob ? 1 : 2) && !answering && !(bot._threatResponseAt > now - 3000) && !(bot._threatAbortAt > now - 5000) && (bot.health ?? 0) > 0) {
          bot._threatAbortAt = now; bot._threatAbort = true;
          try { bot.stopDigging?.(); } catch (_) { /* not digging */ }
          try { bot.pathfinder?.setGoal?.(null); } catch (_) { /* not walking */ }
          try { bot.clearControlStates?.(); } catch (_) { /* nothing held */ }
          try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch (_) { /* no window */ }
          console.log(`[hurt] hit with no survival response (health ${Math.round(bot.health)}): the step is stopped for the survival layer ${JSON.stringify({
            sinceCheckMs: bot._lastCheckAt ? now - bot._lastCheckAt : null, digging: bot.targetDigBlock?.name || null, window: bot.currentWindow?.type ?? null,
            pathing: bot.pathfinder?.isMoving?.() ?? null, step: bot._survivalGoal?.step?.action || null })}`);
        }
        if (bot._hurtTimes.length >= 3 && !(bot._survivalReportedAt > now - 15000) && !(bot._silentHurtLoggedAt > now - 30000)) {
          bot._silentHurtLoggedAt = now;
          const { threats: seen, immediateThreat: urgent, hunted, combatTarget } = require('./danger');
          const goal = bot._survivalGoal;
          console.log(`[bug] hurt without a survival response ${JSON.stringify({ health: Math.round(bot.health), source: source?.name,
            step: goal?.step?.action, lastSurvival: goal?.survivalAction?.action,
            immediate: urgent(bot)?.entity?.name || null,
            threats: seen(bot, 32).slice(0, 5).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), visible: t.visible,
              hunted: !!hunted(bot, t.entity), target: !!combatTarget(bot, t.entity) })) })}`);
        }
      };
      bot.on('entityHurt', bot._survivalHurtListener);
    }
  }

  currentShelter() {
    const bot = this.bot;
    return this.state.shelters.filter(s => (!(s.avoidUntil > Date.now()) || shelter.inside(bot, s)) && s.dimension === bot.game.dimension &&
      pos(s.origin).distanceTo(bot.entity.position) < 128 && bot.blockAt(pos(s.origin)) &&
      // An unfinished emergency site is useful only while nearby. After a
      // descent or a gathering trip, choose a new local site instead of hauling
      // supplies back up a tree. Retain old records to protect partial work.
      (s.verifiedAt || s.kind === 'house' || shelter.inside(bot, s) ||
        (pos(s.origin).distanceTo(bot.entity.position) <= 12 && Math.abs(s.origin.y - bot.entity.position.y) <= 3)) &&
      // A pocket well below is not worth the walk back down when a new one
      // costs five blocks: the by-hand climb lost a day's height each dusk.
      !(s.kind !== 'house' && !shelter.inside(bot, s) && s.origin.y < bot.entity.position.y - 6 && shelter.materialStock(bot) >= 16))
      .sort((a, b) => pos(a.origin).distanceTo(bot.entity.position) + (a.verifiedAt ? 0 : 32) -
        pos(b.origin).distanceTo(bot.entity.position) - (b.verifiedAt ? 0 : 32))[0];
  }

  rememberHouse(blueprint) {
    if (!blueprint || !verifyHouse(this.bot, blueprint).ok) return false;
    if (this.state.shelters.some(s => s.kind === 'house' && s.dimension === this.bot.game.dimension && pos(s.origin).equals(pos(blueprint.origin)))) return false;
    this.state.shelters.push({ kind: 'house', origin: { ...blueprint.origin }, blueprint,
      dimension: this.bot.game.dimension, verifiedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    return true;
  }

  report(goal, save, action) {
    // An action that stalled (stillness.js) is refused for ten minutes and
    // the layer falls through to its next answer. Never a wait worth
    // making, nor a way out of danger.
    // Refused where the supervisor set it aside too, which is the goal: a
    // flip raised forty-four times in mid-92-c (return to the surface and
    // dig in, once a second at the surface with a spider coming) was set
    // aside on the goal and never refused here (2026-09-25).
    const key = `survival:${action.action}`;
    const flip = !EMERGENCIES.has(action.action) && flipped(goal, key);
    if (flip || (!HOLDS.has(action.action) && !EMERGENCIES.has(action.action) && (refused(this, key) || refused(goal, key)))) {
      const entry = (flip && attemptsFor(goal).of('flip')[key]) || attemptsFor(this).of('act')[key] || attemptsFor(goal).of('act')[key];
      throw Object.assign(new Error(`${action.action.replaceAll('_', ' ')} is set aside: ${entry?.why || 'it stalled'}`), { name: 'SetAside', until: entry?.until });
    }
    goal.survivalAction = { ...action, at: new Date().toISOString() }; save();
    this.bot._survivalReportedAt = Date.now(); this.bot._survivalGoal = goal;
    // An answer to the mobs about, as the hurt listener counts one: leaving
    // them be is not.
    if (action.threats && action.action !== 'keep_working') this.bot._threatResponseAt = Date.now();
  }

  async flee(task, goal, save) {
    const bot = this.bot;
    // On a one-wide span over a drop, nothing is swung at, turned to or
    // walked from: the bot holds still, crouched (terrain.js onSpan). A
    // swing at a hoglin behind mid-215-e turned it about on its span, and
    // the crossing walked it off the far end into the lava sea (note 273).
    if (require('./terrain').onSpan(bot)) {
      const close = threats(bot).filter(t => t.distance <= 8);
      this.report(goal, save, { action: 'hold_on_span', threats: close.map(t => t.entity.name).slice(0, 4), health: bot.health });
      bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.(); lowerShield(bot);
      bot.setControlState?.('sneak', true);
      // Crouched is no hold against a hit: its knockback throws a player a
      // block, and off a one-wide ledge that is the fall. mid-230-f, on a
      // ravine ledge at y -28 with zombies at arm's length, held still,
      // was hit from ten to seven and knocked twenty-three blocks down
      // (2026-09-27). With a mob that hits within six, the open sides are
      // walled first, the floor beside the feet and a block on it: a
      // player thrown into a wall stays where it is.
      // Shots too: a blocked fireball still pushes, and mid-242-h, bridging
      // toward a fortress under a blaze's fire, blocked four and drifted
      // off its span with them, thirty blocks into the lava (2026-09-27).
      // A shooter in sight within its own reach counts, not only within
      // eight: mid-202-g held still on a span four seconds with a ghast in
      // sight twenty-two blocks off, walls never raised, and its fireball
      // threw the bot into the lava (2026-09-27).
      const { RANGE } = require('./combat-estimate');
      const shots = require('./projectile-guard').incoming(bot, { reach: 24 }).length > 0 ||
        threats(bot, 48).some(t => t.visible && shooter(t.entity) && t.distance <= Math.max(16, RANGE[t.entity.name] || 0));
      if (!bot._spanning && (shots || close.some(t => t.distance <= 6 && !shooter(t.entity))) && await this.railSpan(task, goal, save)) return;
      // A mob at arm's length is struck crouched and still (combat.js
      // defendNearby on a span); nothing else is done about it here.
      if (await defendNearby(bot, task, goal, save)) return;
      try { for (let n = 0; n < 4; n++) { task.check(); await sleep(100); } }
      finally { if (!bot._spanning) bot.setControlState?.('sneak', false); }
      return;
    }
    // Off the edge before anything else is done about the mob. Only when
    // one is close enough to hit, and only to a cell a few blocks off.
    // A hoglin close and a drop within its toss: a pocket, the one thing it
    // cannot throw the bot out of. Fighting, pillaring and stepping away on
    // the ledge by the live run's Nether portal each ended thirty blocks down,
    // three deaths in five minutes. The reserve always has the blocks.
    // With Jev asked, the drop is a fact on the stance question instead.
    const jev = encounterJudgments(this);
    const tossers = heavyHitters(threats(bot), 6);
    if (!jev && tossers.length && dropWithin(bot, bot.entity.position.floored(), 3) && !creeperClose(threats(bot)) && shelter.materialStock(bot) >= 4) {
      this.report(goal, save, { action: 'seal_on_ledge', threats: tossers.map(t => t.entity.name), health: bot.health });
      if (await this.sealHere(task, goal, save, threats(bot).filter(t => t.visible))) return;
    }
    // A hoglin throws the body blocks, not a step: with one about, the edge
    // three blocks off is the edge, and the ground moved to is three blocks
    // from any drop (the day audit's two Nether falls, one into lava).
    const close = threats(bot).filter(t => t.distance <= 8);
    const heavy = heavyHitters(threats(bot), 10).length > 0;
    const feet = bot.entity.position.floored();
    // A deep drop two blocks off is the edge too, with a mob close: an
    // arrow's knockback and a step of the fight carried mid-100-d two blocks
    // and down a twenty-one-block shaft (2026-09-25). Deep is half the
    // health or more from the fall, or lava; the ground moved to is three
    // blocks from it.
    const deep = require('./terrain').dropNear(bot, feet, 2);
    // Lava level with the feet within two blocks is as deadly as a drop into
    // it: mid-214-b, on a fortress leg at y 51 in the Nether, was hit by an
    // enderman beside a pool, went in, and two seconds of lava and the fire
    // after it took all twenty health (2026-09-26).
    const deadly = (!!deep && (deep.into === 'lava' || deep.damage >= (bot.health ?? 20) / 2)) || lavaBeside(bot, feet);
    // Not while a stance that moves holds, as with the shield below: its
    // own steps keep off edges, and mid-208-a, dancing with a creeper four
    // blocks off, was walked away from an edge in the creeper's face and
    // took its blast from twenty to eleven (2026-09-26).
    const moving = stanceHeld(bot) && MOVING_STANCES.has(stanceHeld(bot).choice);
    // Up on its own pillar the drop round it is the point of it, the
    // walkers' reach kept off: mid-205-e chose the pillar at 0.97 among
    // five zombies, and each time it was up this stepped it back off the
    // edge into them (2026-09-26). A hoglin's toss still counts.
    const pillar = this.state.pillar;
    const onPillar = !heavy && pillar && Math.hypot(feet.x - pillar.x, feet.z - pillar.z) < 1 && feet.y >= pillar.y + 1;
    if ((close.length || heavy) && !moving && !onPillar && (heavy ? dropWithin(bot, feet, 3) : besideDrop(bot, feet) || deadly) && !isSetAside(this, 'firm_ground', 'here')) {
      const cell = ((heavy || deadly) && firmGround(bot, 8, { margin: 3 })) || firmGround(bot);
      if (cell) {
        this.report(goal, save, { action: 'off_the_edge', to: { ...cell }, threats: close.map(t => t.entity.name) });
        require('./terrain').holdOffEdge(bot, feet, threats(bot, 64).map(t => t.entity));
        // Given up for the fight once a biter is at arm's length, unless the
        // edge is a heavy hitter's toss: mid-236-d's way to a cell a block
        // off stalled for three seconds while a zombie walked up and hit it
        // from nine to three (2026-09-26).
        const biter = () => !heavy && threats(bot, 5).some(t => t.distance <= 3 && !shooter(t.entity));
        // A shot on its way stops it for the shield, as in stepOnce's copy.
        const { incoming, deflect } = require('./projectile-guard');
        const shot = () => bot.inventory.slots?.[45]?.name === 'shield' && incoming(bot).length > 0;
        try {
          await this.actions.navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 3000, stallMs: 1500, stopWhen: () => biter() || shot() });
          if (shot()) { await deflect(bot, task); return; }
          if (!biter()) return; setAside(this, 'firm_ground', 'here', 'a biter at arm\'s length', 5000);
        }
        catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; setAside(this, 'firm_ground', 'here', err, 5000); }
      }
    }
    // A swing can buy room, but it must not consume the escape action. Ending
    // the turn after every hit trapped an unarmed bot in a losing melee loop.
    const swung = await defendNearby(bot, task, goal, save);
    // With a creeper out of sight within four blocks among them (danger.js
    // immediateThreat): it is the danger, seen or not.
    const danger = threats(bot).filter(t => t.visible || (t.entity.name === 'creeper' && t.distance <= 4) || (t.entity.name === 'warden' && t.distance <= 24));
    // The mob that stopped the work is among them, whatever its sight line
    // reads this time: mid-244-f's skeleton at three blocks stopped the work
    // twenty times a second for four minutes while the stance, held for a
    // creeper, never saw it, its line of sight flickering between the two
    // looks; seven health to under three (2026-09-27).
    const urgent = require('./danger').immediateThreat(bot);
    if (urgent && !urgent.projectile && !danger.some(t => t.entity.id === urgent.entity.id)) danger.push(urgent), danger.sort((a, b) => a.distance - b.distance);
    // A shot from a shooter out of view: the shield up to it, since there
    // is no mob here to answer (danger.js immediateThreat, projectile).
    if (!danger.length) {
      if (!swung && await deflect(bot, task)) { this.report(goal, save, { action: 'block_shot', threats: [], health: bot.health }); return; }
      lowerShield(bot); return;
    }
    // Something already in the air is answered before anything is decided:
    // the decision takes longer than the flight.
    // Not while a stance that moves or builds holds: with three skeletons
    // shooting there is nearly always an arrow in the air, and each block
    // raised the shield and ended the tick, so the run, the pocket or the
    // pillar chosen did not go on: in 13 of the 70 such stances chosen with
    // three or more mobs and a shooter about in the midgame trials of
    // 2026-09-25 and 26, the shield came up within five seconds instead.
    const held = stanceHeld(bot);
    const busy = held && (MOVING_STANCES.has(held.choice) || (held.choice === 'pillar' && !(this.state.pillar && bot.entity.position.y >= this.state.pillar.y + 1.9)));
    if (!swung && !busy && await deflect(bot, task)) {
      this.report(goal, save, { action: 'block_shot', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health });
      return;
    }
    // The stance is Jev's. The rules below answer only when Jev cannot be
    // reached, is switched off (JEV_ENCOUNTERS=0), or every stance has just
    // failed.
    if (jev && await this.stanceStep(task, goal, save, danger, swung)) return;
    // The rule: a creeper is fought the player's way.
    if (await this.creeperDance(task, goal, save, danger, swung)) return;
    if (!swung && await this.closeOnShooter(task, goal, save, danger)) return;
    // A mob at arm's length is fought, swing after swing, while health holds:
    // a route search between swings is seconds of free hits, and nothing
    // outruns a zombie in a tunnel anyway. Low health falls through to the
    // escape search below.
    const armed = /_(sword|axe)$|^trident$/.test(defenseWeapon(bot)?.name || '');
    // Two hoglins on open ground are fought from two blocks up: they cannot
    // climb, a player two up is out of their reach but not out of the
    // sword's, and there are no free hits while a pocket is built around
    // them. The replay run died to a pair in nine seconds; the arena pair
    // drill lost two of three the same way, digging in while both hit.
    // Up before they are in reach, not after: on the live run the pillar went
    // up with a hoglin already at arm's length, which threw the bot off it.
    // Two in sight within sixteen, or one within ten once health is down.
    const hoglins = creeperClose(danger) ? [] : danger.filter(t => ['hoglin', 'zoglin'].includes(t.entity.name) && t.distance <= 16);
    if ((hoglins.length >= 2 || (hoglins.some(t => t.distance <= 10) && bot.health < 14)) && await this.pillarFrom(task, goal, save, hoglins)) return;
    // An enderman teleports after a runner and hits for four through iron:
    // death eighteen ran, held, ate, and died at the fifth hit. It is fought
    // where it stands while health holds, and below that sealed out: a
    // two-high pocket is a room a three-high enderman cannot stand in.
    const enderman = danger.find(t => t.entity.name === 'enderman' && t.distance <= 8);
    if (enderman && !danger.some(t => t.entity.name !== 'enderman' && t.distance <= 8)) {
      if (armed && bot.health >= 8) {
        this.report(goal, save, { action: 'fight', threats: ['enderman'], health: bot.health, stand: true });
        if (!swung && !canStrike(bot, enderman.entity)) await this.charge(task, goal, save, enderman, false);
        return;
      }
      if (await this.sealHere(task, goal, save, danger)) return;
    }
    // Within a sword's reach, not an arm's: a wither skeleton hits from
    // three blocks, and at two and a half the bot was searching for a
    // route instead of swinging.
    const inReach = t => t.distance <= 3.2 || canStrike(bot, t.entity);
    if (swung && armed && bot.health >= 8 && danger.some(inReach)) {
      this.report(goal, save, { action: 'fight', threats: danger.filter(inReach).map(t => t.entity.name), health: bot.health });
      // A blaze hovers a half block outside the sword and shoots from there;
      // holding ground at three blocks is standing still to be shot. Close
      // the gap. The arena's weak spawner run took twelve health in thirty
      // seconds of "fight" with three swings landed, all four blazes at 3.0.
      const hover = danger.find(t => shooter(t.entity) && t.distance > 2.4 && t.distance <= 3.6 && !canStrike(bot, t.entity));
      // Only onto ground: the step is taken blind, and a fortress bridge
      // has lava on both sides of it.
      const ahead = hover && bot.entity.position.plus(hover.entity.position.minus(bot.entity.position).scaled(1 / Math.max(hover.distance, 1))).floored();
      if (hover && firmStep(bot, ahead)) {
        lowerShield(bot);
        await move(bot, task, { label: 'close_on_shooter', keys: ['forward'], sneak: false, why: 'a step onto ground checked firm and dry, in a fight',
          look: hover.entity.position.offset(0, 1, 0), maxMs: 360, tick: 60, until: () => canStrike(bot, hover.entity) });
      }
      return;
    }
    // Moving on: a raised shield is a crawl.
    lowerShield(bot);
    if (await this.rangedChoice(task, goal, save, danger, armed)) return;
    await this.escape(task, goal, save, danger, armed);
  }

  // Home for the night: out of the shaft by the stairs it dug, then over the
  // ground to the bed.
  async goHomeForNight(task, goal, save, homeBed, underground) {
    const bot = this.bot;
    this.report(goal, save, { action: 'go_home_for_night', distance: Math.round(homeBed.foot.distanceTo(bot.entity.position)), underground });
    // Out of the shaft by the stairs it dug, then home over the ground:
    // a path search from the bottom of a mine to a bed timed out. A
    // stumble on the stairs is retried next tick; only the walk itself
    // failing sets the bed aside, and only for two minutes.
    if (underground && this.actions.surfaceStep) {
      try { await this.actions.surfaceStep(bot, task, goal, save); }
      catch (err) {
        task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
        // A climb that fails every tick is not a way home: sixteen blocks
        // under the bed the dream run tried it once a second, reporting
        // nothing. Three failures in a minute set the walk aside, and the
        // night is spent the other ways (a pocket, the mine).
        const now = Date.now();
        this.state.surfaceFailures = [...(this.state.surfaceFailures || []).filter(t => now - t < 60000), now];
        if (this.state.surfaceFailures.length >= 3) { setAside(this, 'surface_home', 'here', err, 600000); this.state.surfaceFailures = []; this.report(goal, save, { action: 'surface_home_set_aside', reason: err.message }); }
      }
    } else {
      // At any hour: the held walk comes here every tick, and one that waited
      // for dusk did nothing after bedtime. Trial 94 held it thirty blocks
      // from its bed twenty times a second for the night, the sleep option
      // never offered (2026-09-25).
      try { await this.actions.navigate(bot, task, new goals.GoalNear(homeBed.foot.x, homeBed.foot.y, homeBed.foot.z, 3), { timeoutMs: 60000, stallMs: 8000, sprint: true }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(this, 'bed_route', 'home', err, 120000); }
    }
  }

  // A lone shooter on the ground, the player's way: run at it and hit it.
  // Measured in the arena (2026-09-24, scripts/shield-probe.js), one
  // skeleton eight blocks off, twenty seconds a stance: 17.7 damage standing,
  // 16.3 raising the shield as each arrow came (it takes a quarter second to
  // come up; the arrow is quicker), 15.8 to 17.5 with the bow and no kill,
  // none holding the shield up throughout and no kill either, 2 walking at
  // it behind the shield (dead in five seconds), and 0 to 2 sprinting at it
  // with a stone sword and no shield (dead in four). The first trials'
  // skeleton deaths were the per-arrow block and pockets built under fire.
  // Two at once the same way: standing, 16.3 in twenty seconds; running at
  // the nearer and then the other, none, both dead in eight seconds (trial
  // 8's bot was shot dead walking away from a pair, 2026-09-24). Up to three,
  // armed, at six health for one and ten for more, with no melee mob at
  // arm's length and no creeper close; ground that is not firm ahead is held
  // behind the shield, if there is one.
  // Chosen by Jev, only what makes the charge possible is checked (a blade,
  // ground shooters in view, dry firm footing); health and the other mobs
  // about were Jev's to weigh.
  async closeOnShooter(task, goal, save, danger, { chosen = false } = {}) {
    const bot = this.bot;
    const weapon = defenseWeapon(bot);
    if (!/_(sword|axe)$/.test(weapon?.name || '')) return false;
    if (!chosen && (bot.health < 6 || creeperClose(danger) || danger.some(t => t.distance <= 3 && !shooter(t.entity)))) return false;
    const shooters = danger.filter(t => t.visible && shooter(t.entity) && t.distance <= 16);
    const ground = shooters.filter(t => GROUND_SHOOTERS.has(t.entity.name)).sort((a, b) => a.distance - b.distance);
    if (!ground.length) return false;
    // As measured: from dry, firm footing, at full-ish health for more than
    // one. The dream run charged three from a river at ten health and stood
    // in the water, shot, for thirty-seven seconds (2026-09-24).
    if (!chosen && (ground.length !== shooters.length || shooters.length > 3 || (shooters.length > 1 && bot.health < 14))) return false;
    // A charge that could not get going rests: re-chosen every tick, trial
    // 21's bot raised its shield for a moment a tick and stood forty seconds
    // under a skeleton's arrows across uneven ground (2026-09-24).
    if (isSetAside(this, 'close_on_shooter', 'here')) return false;
    if (bot.entity.isInWater || inWater(bot) || bot.entity.onGround === false) return false;
    let target = ground[0];
    const shielded = bot.inventory.slots?.[45]?.name === 'shield';
    let e = target.entity;
    this.report(goal, save, { action: 'close_on_shooter', entity: e.name, target: { x: Math.floor(e.position.x), y: Math.floor(e.position.y), z: Math.floor(e.position.z) },
      distance: Number(target.distance.toFixed(1)), health: bot.health });
    if (bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand');
    const end = Date.now() + 12000 * Math.min(3, ground.length);
    // Three seconds without getting nearer and the charge is not working.
    // Chosen, six health lost hands the encounter back to Jev.
    let best = Infinity, bestAt = Date.now();
    const startHealth = bot.health;
    const startedAt = Date.now(), expects = chosen ? bot._stance?.expects : null;
    const onPace = () => { const t = (Date.now() - startedAt) / 1000; return t <= expects.seconds && startHealth - bot.health <= expects.damage * Math.min(1, t / Math.max(0.1, expects.seconds)) + (expects.oneHit || 0); };
    const going = () => chosen ? (expects ? onPace() : bot.health > startHealth - 6) : bot.health >= 4;
    try {
      while (Date.now() < end && going()) {
        const gap = bot.entity.position.distanceTo(e.position);
        if (gap < best - 0.5) { best = gap; bestAt = Date.now(); }
        else if (Date.now() - bestAt > 3000 && !canStrike(bot, e)) { setAside(this, 'close_on_shooter', 'here', 'three seconds without getting nearer', 15000); return false; }
        task.check(); checkAir(bot);
        // The one down, the next: nearest of the others still in sight.
        if (bot.entities[e.id] !== e || e.isValid === false) {
          const next = threats(bot).filter(t => t.visible && GROUND_SHOOTERS.has(t.entity.name) && t.distance <= 16).sort((a, b) => a.distance - b.distance)[0];
          if (!next) break;
          target = next; e = next.entity; best = Infinity; bestAt = Date.now();
        }
        if (threats(bot).some(t => t.entity !== e && ((t.distance <= 3 && !shooter(t.entity)) || (t.entity.name === 'creeper' && t.distance <= 5)))) break;
        await bot.lookAt(e.position.offset(0, 1.5, 0), true);
        if (canStrike(bot, e)) {
          bot.clearControlStates?.(); lowerShield(bot);
          if (bot.entities[e.id] === e) bot.attack(e);
          if (shielded) raiseShield(bot);
          await sleep(650); lowerShield(bot);
          continue;
        }
        const flat = e.position.minus(bot.entity.position); flat.y = 0;
        const ahead = bot.entity.position.plus(flat.scaled(1 / Math.max(flat.norm(), 1))).floored();
        // Level, a step up, or a step down: a block's drop is walked.
        const level = firmStep(bot, ahead), up = !level && firmStep(bot, ahead.offset(0, 1, 0)), down = !level && !up && firmStep(bot, ahead.offset(0, -1, 0));
        if (!level && !up && !down) { setAside(this, 'close_on_shooter', 'here', 'no firm ground toward the shooter', 15000); return false; }
        await move(bot, task, { label: 'close_on_shooter', keys: up ? ['forward', 'sprint', 'jump'] : ['forward', 'sprint'], sneak: false,
          why: 'running at a lone shooter over ground checked firm', look: e.position.offset(0, 1.5, 0), maxMs: 250, tick: 50, until: () => canStrike(bot, e) });
      }
    } finally { lowerShield(bot); bot.clearControlStates?.(); }
    return true;
  }

  // A creeper, the player's way: hit it, back off out of the blast while
  // the hit's knockback and the distance put its fuse out, and hit it again
  // when it comes on. Running only delays it (a creeper follows), and a
  // pocket beside it is worse: the dream run ran from one for forty
  // seconds, walled itself in with it outside, and one blast took twelve
  // health through iron. Only armed, at eight health or more, with no other
  // mob within five blocks and no drop within two for the knockback.
  // A step back from a creeper coming on, while a question is out: only
  // with no drop or lava behind, and not past what the question waits for.
  async backFromCreeper(task, stop = () => false) {
    const bot = this.bot;
    const { LIGHTS_AT } = require('./combat-estimate');
    const near = () => threats(bot, 12).filter(t => t.entity.name === 'creeper' && t.visible).sort((a, b) => a.distance - b.distance)[0];
    const creeper = near();
    if (!creeper || creeper.distance > LIGHTS_AT + 3) return false;
    const feet = bot.entity.position.floored();
    if (dropWithin(bot, feet, 2) || lavaBeside(bot, feet)) return false;
    await move(bot, task, { label: 'creeper_back_off_waiting', keys: ['back'], sneak: false, why: 'backing from a creeper coming on while the stance is chosen',
      look: creeper.entity.position.offset(0, 1, 0), maxMs: 600, tick: 50,
      until: () => stop() || !near() || near().distance > LIGHTS_AT + 3 || dropWithin(bot, bot.entity.position.floored(), 1) });
    return true;
  }

  async creeperDance(task, goal, save, danger, swung, { chosen = false } = {}) {
    const bot = this.bot;
    const creeper = danger.find(t => t.entity.name === 'creeper' && t.distance <= 6);
    if (!creeper) return false;
    const armed = /_(sword|axe)$/.test(defenseWeapon(bot)?.name || '');
    const feet = bot.entity.position.floored();
    // Backing out blind is only safe with no drop or lava behind.
    if (!armed || dropWithin(bot, feet, 2) || lavaBeside(bot, feet)) return false;
    // Other creepers are the same dance, the nearest hit and all of them
    // backed from; any other mob close is not (the pair drill: 11 damage
    // while a second creeper kept the dance off). Chosen, that was Jev's to
    // weigh.
    if (!chosen && ((bot.health ?? 20) < 8 || danger.some(t => t.entity.name !== 'creeper' && t.distance <= 5))) return false;
    const e = creeper.entity;
    const creepers = danger.filter(t => t.entity.name === 'creeper').map(t => t.entity);
    const look = e.position.offset(0, 1, 0);
    const distance = () => Math.min(...creepers.map(c => c.position.distanceTo(bot.entity.position)));
    const swelling = creepers.some(c => creeperSwelling(bot, c) && c.position.distanceTo(bot.entity.position) < 4);
    // Just hit, or lit within reach, or in reach while the sword recovers:
    // back off out of the blast.
    if (swung || (swelling && creeper.distance < 3.5) || canStrike(bot, e)) {
      this.report(goal, save, { action: 'creeper_back_off', distance: Number(creeper.distance.toFixed(1)), swelling, struck: swung, health: bot.health });
      await move(bot, task, { label: 'creeper_back_off', keys: ['back'], sneak: false, why: 'backing out of a creeper\'s blast between hits', look, maxMs: 700, tick: 50, until: () => distance() >= 4.5 });
      return true;
    }
    // Out of reach and not lit: close in for the next hit, the swing reflex
    // takes it at the next look.
    const lit = () => creepers.some(c => creeperSwelling(bot, c) && c.position.distanceTo(bot.entity.position) < 4);
    if (!swelling) {
      this.report(goal, save, { action: 'creeper_close_in', distance: Number(creeper.distance.toFixed(1)), health: bot.health });
      await move(bot, task, { label: 'creeper_close_in', keys: ['forward'], sneak: false, why: 'closing to swing range on a creeper that is not lit', look, maxMs: 600, tick: 50,
        until: () => canStrike(bot, e) || lit() });
      return true;
    }
    // Lit, out of reach and already backing room: nothing for the dance to
    // do. Answering "back off until five away" at five away returned at once,
    // every step, and the loop never let the connection breathe: the arena
    // server timed the bot out twice in the creeper pair drill.
    if (distance() >= 5) return false;
    await move(bot, task, { label: 'creeper_back_off', keys: ['back'], sneak: false, why: 'a lit creeper just out of reach', look, maxMs: 500, tick: 50, until: () => distance() >= 5 });
    return true;
  }

  // The stance for an encounter: fight, go up, dig into the wall, dig down,
  // seal in, run, eat or shoot, each already checked possible from here.
  // Asked once and held for fifteen seconds, until health falls by six,
  // until it fails, or until a mob it was not chosen against comes within
  // six blocks; the reflexes (the swing at arm's length, off a ledge, away
  // from lava) run before it every tick whatever the stance, and the shield
  // against an arrow in flight while the stance stands its ground.
  // Every stance says what the mobs here cost the bot over the fifteen
  // seconds, worked out the same way (stanceCost).
  stanceOptions(task, goal, save, danger, swung) {
    const bot = this.bot, options = {};
    const nearest = danger[0];
    const armed = /_(sword|axe)$|^trident$/.test(defenseWeapon(bot)?.name || '');
    const inReach = t => t.distance <= 3.2 || canStrike(bot, t.entity);
    const { SCAFFOLD } = require('./pillar-recovery');
    const scaffold = bot.inventory.items().filter(i => SCAFFOLD.includes(i.name)).reduce((n, i) => n + i.count, 0);
    const feet = bot.entity.position.floored();
    const headroom = [1, 2, 3].every(dy => { const b = bot.blockAt(feet.offset(0, dy, 0)); return b && b.boundingBox === 'empty' && !/lava|water/.test(b.name); });
    // Nothing is built, dug or drawn with a mob at arm's length that does
    // not shoot: a pillar, a pocket, a bunker and a bow each take a second
    // or more of standing still, and every one of those seconds is its hit.
    // The dream run pillared with two zombies beside it, unarmoured, and
    // went from twenty to nothing in eight seconds (2026-09-24).
    const armsLength = danger.some(t => t.distance <= 3 && !shooter(t.entity));
    // Building costs a second or so a block: said to Jev with the options
    // below rather than decided for it by hiding them.
    const buildCost = armsLength ? ' Something that bites is at arm\'s length now, and it hits freely while the blocks go down.' : '';
    const creeperNote = creeperNoteFor(danger);
    // A witch's potions come over a pillar and into a doorway: mid-72-c dug
    // a bunker against one at twenty health, the harm (armour does not stop
    // it) and the poison came in at the doorway, and a skeleton finished it
    // at five (2026-09-26). A shut pocket is the cover a thrown potion stops at.
    const witch = danger.find(t => t.entity.name === 'witch');
    const witchNote = witch ? ` A witch ${Math.round(witch.distance)} blocks off throws its potions over a pillar and into a doorway: harm that armour does not stop, and poison that keeps taking health for half a minute; a shut pocket stops them.` : '';
    // How many can reach at once here: two in a tunnel, eight in the open.
    const open = openCells(bot, feet);
    const shielded = bot.inventory?.slots?.[45]?.name === 'shield';
    const estimate = fightEstimate({ threats: danger.slice(0, 8).map(t => ({ name: t.entity.name, distance: t.distance, shoots: shooter(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: t.visible })),
      armour: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean), weapon: defenseWeapon(bot)?.name || null, health: bot.health, shield: shielded, atOnce: open });
    const cost = estimate.fightHere;
    const mobs = estimate.mobs || [];
    // One blow from the hardest hitter here: the give a stance's pace is
    // allowed before it is asked again (holding below).
    const oneHit = Math.max(0, ...mobs.filter(m => m.name !== 'creeper').map(m => m.hitsBot || 0));
    const bitersHere = danger.filter(t => !shooter(t.entity) && t.entity.name !== 'creeper').length;
    // How few hits the health left is, said on the stances that stand in
    // reach or in the line of fire: mid-110-h charged a skeleton at 4.5
    // health told only "hands back after six health lost" (2026-09-26).
    const hardest = (estimate.mobs || []).filter(m => m.name !== 'creeper' && m.hitsBot > 0).sort((a, b) => b.hitsBot - a.hitsBot)[0];
    const hitsLeft = hardest && bot.health < 14 ? ` At ${Math.round(bot.health * 10) / 10} health, ${Math.max(1, Math.ceil(bot.health / hardest.hitsBot))} ${hardest.name === 'witch' ? 'potion' : hardest.shoots ? 'arrow' : 'hit'}${Math.ceil(bot.health / hardest.hitsBot) === 1 ? '' : 's'} from the ${hardest.name.replaceAll('_', ' ')} (about ${hardest.hitsBot} each after armour) end it.` : '';
    // The estimate leaves creepers out of its numbers (a blast is once, not
    // per second); said beside them: trial 118 fought two creepers and a
    // spider with no armour at twelve health, told only "6.7 damage".
    const creeperCount = danger.filter(t => t.entity.name === 'creeper').length;
    // The decision audit (2026-09-25): what the lists above leave out.
    const unseen = require('./danger').unseenNote(bot, danger);
    const nearestCreeper = nearest?.entity.name === 'creeper' ? ` The nearest is a creeper ${Math.round(nearest.distance)} blocks off: closing on it is walking into its fuse.` : '';
    const { creeperBlastSays, creeperBlast: blastAt, afterArmour, armourOf } = require('./combat-estimate');
    const worn = armourOf([5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean));
    const creeperBlast = Math.round(afterArmour(blastAt(2), worn)), blastSays = creeperBlastSays(worn);
    // The drop beside the bot, measured, on every stance that stays or moves
    // on this ground (mid-100-d, 2026-09-25).
    const edge = require('./terrain').dropNote(require('./terrain').dropNear(bot, feet, 3), bot.health);
    // How many can be at arm's length at once, said where it is not all of
    // them: in a tunnel a crowd comes one or two at a time.
    const atOnceNote = bitersHere >= 2 ? (open >= 8 ? ' Open ground all round: every biter can be at arm\'s length at once.' : ` ${open} of the eight cells round the bot are open ground: at most ${open} at arm's length at once.`) : '';
    // What the estimate leaves out, said wherever it is quoted: the charge
    // quoted it without, and mid-110-k's replay went from the pillar to the
    // charge past a creeper six blocks off.
    const creeperLeftOut = creeperCount ? ` Not counted there: ${creeperCount === 1 ? 'the creeper' : `each of the ${creeperCount} creepers`}, whose blast takes ${blastSays} health after the armour worn${creeperBlast >= bot.health ? ', two blocks off more than the bot has' : ''}.` : '';
    options.fight = { expects: { damage: cost.damageTaken, seconds: cost.seconds, oneHit }, description: `Fight here${armed ? '' : ' with bare hands (no sword or axe)'}: swing at whatever comes into reach, and close on the nearest mob when it is within eight blocks and not at reach yet. Estimated for these mobs with this weapon and armour: about ${cost.seconds} seconds and ${cost.damageTaken} damage to kill them all, from ${cost.healthNow} health${cost.healthAfter <= 0 ? ' (more than the bot has)' : ''}; about ${cost.inFifteenSeconds} of it in the first fifteen seconds.${atOnceNote}${creeperLeftOut}${nearestCreeper}${nearest && shooter(nearest.entity) && !inReach(nearest) ? (() => { const stop = chargeStopsAt(bot, nearest.entity); return stop ? ` The nearest shoots, and the ground straight at it stops a closing run after ${stop.blocks} block${stop.blocks === 1 ? '' : 's'}, ${stop.left} short, in its line of fire.` : ''; })() : ''}${nearest && !inReach(nearest) ? chargeSays(bot, nearest.entity) : ''}${unseen}${edge}${hitsLeft}`,
      run: async () => {
        if (danger.some(inReach)) { this.report(goal, save, { action: 'fight', threats: danger.filter(inReach).map(t => t.entity.name), health: bot.health, stance: true }); await this.swingFor(task, goal, save); return true; }
        if (await this.charge(task, goal, save, nearest, false, { chosen: true })) return true;
        // Out of reach, and the charge showed it: a stance that failed.
        if (bot._unreachable?.until > Date.now() && bot._unreachable.ids.includes(nearest.entity.id)) return false;
        // A shooter does not come into reach: held, the fight stood in its
        // fire. mid-100-e held one at eleven blocks from 5.9 health to 4 and
        // chose a pocket too late (2026-09-25). Not taken, so the stance is
        // asked again without it.
        if (shooter(nearest.entity) && !danger.some(inReach)) return false;
        // No level way to it: the fight is held here, facing it, and the
        // swing takes it when it comes into reach. Not a stance that failed,
        // unless it does not come: trial 73 held a fight at a creeper that
        // stayed six blocks off for three minutes, beside a drop, and nothing
        // else was done. Eight seconds without it a block nearer and it is
        // left be like one a charge could not reach.
        const held = this.state.standing;
        if (!held || held.id !== nearest.entity.id) this.state.standing = { id: nearest.entity.id, since: Date.now(), distance: nearest.distance };
        else if (nearest.distance < held.distance - 1) Object.assign(held, { since: Date.now(), distance: nearest.distance });
        else if (Date.now() - held.since > 8000) {
          delete this.state.standing;
          bot._unreachable = { ids: [...new Set([...(bot._unreachable?.until > Date.now() ? bot._unreachable.ids : []), nearest.entity.id])], until: Date.now() + 20000 };
          return false;
        }
        this.report(goal, save, { action: 'fight', threats: [nearest.entity.name], health: bot.health, stance: true, stand: true });
        await bot.lookAt?.(nearest.entity.position.offset(0, 1, 0), true);
        await sleep(250);
        return true;
      } };
    // Already up is the stance held, not a stance that failed: read as a
    // failure it was asked again every tick, a hundred and twenty times in
    // three hoglin drills.
    const up = this.state.pillar && feet.y >= this.state.pillar.y + 2 && Math.hypot(feet.x - this.state.pillar.x, feet.z - this.state.pillar.z) < 1;
    // Two up, what still reaches: the shooters, the climbers (fought from
    // there), a witch's potions and a creeper's blast at the foot. mid-110-k
    // pillared at thirteen health with a creeper six blocks off and three
    // skeletons, told nothing of what that cost, and the blast was all of it.
    const pillarCost = stanceCost({ mobs, setup: up ? 0 : PILLAR_SECONDS, fight: { only: m => CLIMBERS.has(m.name) }, reaches: m => m.shoots || m.name === 'creeper' || m.name === 'warden', shield: shielded });
    if ((scaffold >= 2 && headroom) || up) options.pillar = { expects: { damage: pillarCost.damage, seconds: pillarCost.seconds, oneHit }, description: 'Go two blocks straight up on placed blocks and fight from there: hoglins, zombies, piglins and other walkers of a player\'s height cannot reach a player two up, but the sword still reaches them; shooters still can hit.' + (up ? '' : buildCost) + creeperNote + climbers(danger) + (up ? '' : above(bot, danger)) + witchNote + costSays(pillarCost, bot.health, mobs, { doing: up ? null : 'going up', done: 'Two up' }) + (edge && heavyHitters(danger, 16).length ? edge.replace(/ A drop of/, ' Two up, a hoglin\'s toss still reaches the bot, and a drop of') : edge),
      // Held up there, the stance is kept: facing the nearest, the swing and
      // the shield (the tick's own, before this) taking what comes. Returned
      // at once, it ran twenty passes a second with nothing reported, and the
      // hurt watchdog stopped the work under it at each hit (mid-243-i).
      run: async () => {
        if (!up) return this.pillarFrom(task, goal, save, danger);
        const nearest = danger[0];
        this.report(goal, save, { action: 'pillar_hold', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health });
        if (nearest?.entity?.position) await bot.lookAt?.(nearest.entity.position.offset(0, 1, 0), true);
        await sleep(250);
        return true;
      } };
    // Down off a pillar of the bot's own: stood on one, nothing else here
    // moves it (a route drops three blocks at most), and mid-83-e stood five
    // up on its dirt for seventy seconds, shot by a skeleton, choosing to
    // retreat and not moving (2026-09-26). A block a time, dug underfoot.
    const { pillarDescent, descendPillar, pillarHeight } = require('./pillar-recovery');
    const down = pillarDescent(bot, goal, { combat: true });
    // Up off the ground by more than a route drops: only then is there no
    // way off it but digging down.
    let onPillar = 0;
    const high = down ? pillarHeight(bot, feet) : null;
    if (down && high) {
      const stranded = high > ROUTE_DROP;
      if (stranded) onPillar = high;
      options.come_down = { description: stranded
        ? `Get down off the pillar to the ground, ${high} blocks: its top block is dug out and the bot drops onto the next, about a second each, the only way off it; shot at meanwhile if a shooter is about. On the ground the retreat, the pocket and the charge work again; up here none of them can.${hitsLeft}`
        : `Dig out the block under the feet and drop onto the next, about a second each, down to the ground beside, ${high} block${high === 1 ? '' : 's'} below; shot at meanwhile if a shooter is about. A route steps down ${ROUTE_DROP} blocks, so the retreat and the charge get off it as well, and the walls of a pocket go up beside ${high} block${high === 1 ? '' : 's'} of open air.${hitsLeft}`,
        run: async () => {
          this.report(goal, save, { action: 'come_down', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health, stance: true });
          let steps = 0;
          while (steps < 24) {
            try { if (!await descendPillar(bot, task, goal, save, null, { combat: true })) break; }
            catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; break; }
            steps++;
          }
          return steps > 0;
        } };
    }
    // A bunker that is quick to dig: three seconds of digging under fire is
    // the most it is worth (bunker.js bunkerDigMs).
    // At the doorway the biters come one at a time and are fought; the
    // shooters in line with it and a creeper at it still reach.
    const bunkerMs = nearWall(bot, centroid(danger)) ? require('./bunker').bunkerDigMs(bot, centroid(danger)) : Infinity;
    if (bunkerMs <= BUNKER_DIG_MS) options.bunker = { description: 'Dig one block into the nearby wall so only one mob at a time can reach, and fight them at the doorway.' + buildCost + creeperNote + witchNote +
      costSays(stanceCost({ mobs, setup: bunkerMs / 1000 + BLOCK_SECONDS, fight: { atOnce: 1, only: m => !m.shoots }, reaches: m => m.shoots || m.name === 'creeper' || m.name === 'warden', shield: shielded }), bot.health, mobs, { doing: 'digging in', done: 'At the doorway, one biter at a time' }),
      run: async () => { this.report(goal, save, { action: 'dig_in_bunker', threats: danger.map(t => t.entity.name).slice(0, 6), health: bot.health, stance: true });
        try { await digBunker(bot, task, goal, save, { from: centroid(danger), navigate: this.actions.navigate }); return true; }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; } } };
    const race = pocketRace(bot, danger);
    // Underground the dawn changes nothing: no mob there burns in it.
    const nightLong = shelterNeeded(bot) && surfaceObserver(bot)(bot.entity.position) ? ` At night the mobs outside do not lose interest: about ${minutesToDawn(bot)} real minutes to dawn.` : '';
    // The blocks against what the crowd deals while they go down: mid-92-e
    // and mid-83-d chose pockets of twenty to thirty-four blocks with a
    // zombie at arm's length and four shooters about, and neither was shut.
    const shellCells = (() => { try { return shelter.missingShell(bot, { origin: { x: feet.x, y: feet.y, z: feet.z } }).length; } catch (_) { return null; } })();
    const sealPriced = shellCells != null ? stanceCost({ mobs, setup: shellCells * BLOCK_SECONDS }) : null;
    const sealCost = sealPriced ? costSays(sealPriced, bot.health, mobs, { doing: 'building', done: 'Shut in' }) : '';
    if (shelter.materialStock(bot) >= 4) options.seal = { ...(sealPriced ? { expects: { damage: sealPriced.damage, seconds: sealPriced.seconds, oneHit } } : {}), description: 'Close a two-block pocket around the bot where it stands and wait inside for the mobs to lose interest; no fighting.' + race + buildCost + creeperNote + sealCost + nightLong + unseen + (high ? ` The bot stands ${high} block${high === 1 ? '' : 's'} above the ground beside it: the walls go up beside nothing, placed against open air.` : ''),
      run: () => this.sealHere(task, goal, save, danger) };
    // Down into the ground where the bot stands, a block over its head: a
    // player's pocket in a crowd, two or three digs and one block where the
    // pocket above takes twenty to thirty-four (shelter.shell) on open
    // ground. The night's shaft pocket (digShaft), straight down from here
    // only: a walk to another column is a walk through the crowd.
    const column = typeof this.actions.dig === 'function' && typeof this.actions.place === 'function' && shelter.materialStock(bot) >= 1 && !inWater(bot) ? this.shaftColumn({ radius: 0 }) : null;
    if (column?.bottom && column.start.equals(feet)) {
      const { cheapestTool } = require('./skills');
      let digMs = 0, depth = 0;
      for (let y = feet.y - 1; y >= column.bottom.y; y--) {
        const b = bot.blockAt(new Vec3(feet.x, y, feet.z)); depth++;
        if (b?.boundingBox !== 'block') continue;
        if (typeof b.digTime !== 'function') { digMs += 750; continue; }
        const tool = cheapestTool(bot, b);
        digMs += b.digTime(tool ? tool.type : null, false, false, false, [], {});
      }
      // Each block dug, a second more to turn, drop and settle: the night's
      // shaft pockets took three seconds to the bottom of two blocks and
      // four of three (the medians of 144 in the flight records of
      // 2026-09-23 to 26); then the cap.
      const setup = Math.round((digMs / 1000 + depth * SHAFT_BLOCK_SECONDS + BLOCK_SECONDS) * 10) / 10;
      // A creeper that walks up to the lid goes off through it: mid-220-c dug
      // down three with one seventeen blocks off, told "none of them reaches
      // it", and the blast came through the cap fourteen seconds later
      // (2026-09-26).
      const digCost = stanceCost({ mobs, setup, reaches: m => m.name === 'creeper' || m.name === 'warden' });
      options.dig_down = { expects: { damage: digCost.damage, seconds: digCost.seconds, oneHit }, description: `Dig straight down ${plural(depth, 'block')} where the bot stands, put a block over its head and wait inside for the mobs to lose interest; no fighting. Walled in the ground on every side; about ${setup} seconds of digging and the one block.` + buildCost + creeperNote + costSays(digCost, bot.health, mobs, { doing: 'digging down', done: 'Shut in below' }) + nightLong,
        run: async () => {
          this.report(goal, save, { action: 'dig_down', threats: danger.map(t => t.entity.name).slice(0, 6), health: bot.health, depth, stance: true });
          try { return await this.digShaft(task, goal, save, { start: column.start, bottom: column.bottom, spot: column.spot, here: feet }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
        } };
    }
    // Something to eat, as a stance: in an encounter the meal is Jev's to
    // choose, not a reflex between two of its stances (vitals.js). mid-83-d
    // ate for three seconds at twelve health in the middle of the retreat
    // it had chosen, and mid-92-g twice under a skeleton's arrows; of 56
    // retreats chosen with three or more mobs about, 15 had a meal within
    // five seconds.
    const meal = mealHelps(bot);
    const eatCost = stanceCost({ mobs, setup: EAT_SECONDS, seconds: EAT_SECONDS });
    // Held to what it was said to cost: mid-205-a chose to eat told about
    // 1.6 seconds, and ate on for four more with two zombies hitting and a
    // creeper walking up to it (2026-09-26).
    if (meal && !(this.state.mealCutAt > Date.now() - MEAL_CUT_MS)) options.eat = { expects: { damage: eatCost.damage, seconds: EAT_SECONDS, oneHit }, description: eatSays(bot, meal) + (armsLength ? ' Something that bites is at arm\'s length now, and it hits freely while the bot eats.' : '') + costSays(eatCost, bot.health, mobs, { over: 'while it eats' }) + EAT_AFTER,
      run: async () => {
        this.report(goal, save, { action: 'eat', item: meal.name, food: bot.food, health: bot.health, stance: true });
        // Marked before the meal and cleared when it is eaten: a meal cut
        // short, however it was cut, is not offered again for ten seconds.
        // mid-235-g chose to eat with two drowned at arm's length; the meal
        // began every half second and was never eaten, food at seventeen
        // throughout, twelve health to none (2026-09-27).
        // Eaten is hunger up: the consume came back in half a second with
        // nothing eaten while a zombie hit, was taken for a meal and the
        // mark cleared, and mid-227-f began its beef nine times (2026-09-27).
        this.state.mealCutAt = Date.now();
        const hungerBefore = bot.food ?? 20, saturationBefore = bot.foodSaturation ?? 0;
        try {
          await bot.equip(meal, 'hand'); await bot.consume();
          if ((bot.food ?? 20) > hungerBefore || (bot.foodSaturation ?? 0) > saturationBefore) { delete this.state.mealCutAt; return true; }
          return false;
        }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
      } };
    // The charge at a few ground shooters, where it can be run.
    const ground = danger.filter(t => t.visible && GROUND_SHOOTERS.has(t.entity.name) && t.distance <= 16);
    if (ground.length && /_(sword|axe)$/.test(defenseWeapon(bot)?.name || '') && !inWater(bot) && !isSetAside(this, 'close_on_shooter', 'here')) options.charge_shooter = {
      expects: { damage: cost.damageTaken, seconds: cost.seconds, oneHit },
      description: `Run at the ${ground.map(t => t.entity.name).join(', ')} (nearest ${Math.round(ground[0].distance)} blocks) and strike, one after another, over ground checked firm; gives way if it cannot get nearer, and hands back to be chosen again once it has cost more health or time than estimated here.${(() => { const stop = chargeStopsAt(bot, ground[0].entity); return stop ? ` The ground straight at the nearest does not carry the charge there: it stops after ${stop.blocks} block${stop.blocks === 1 ? '' : 's'}, ${stop.left} short, in the line of fire.` : ' The ground straight at the nearest carries the charge to it.'; })()}${chargeSays(bot, ground[0].entity)} Estimated for all the mobs here with this weapon and armour: about ${cost.seconds} seconds and ${cost.damageTaken} damage, from ${cost.healthNow} health${cost.healthAfter <= 0 ? ' (more than the bot has)' : ''}; about ${cost.inFifteenSeconds} of it in the first fifteen seconds.${creeperLeftOut}${unseen}${edge}${hitsLeft}`,
      run: () => this.closeOnShooter(task, goal, save, danger, { chosen: true }) };
    // A creeper the player's way: hit, back out of the blast, hit again.
    // Possible with a blade and no drop or lava to back into.
    const feetDrop = dropWithin(bot, feet, 2) || lavaBeside(bot, feet);
    if (danger.some(t => t.entity.name === 'creeper' && t.distance <= 6) && /_(sword|axe)$/.test(defenseWeapon(bot)?.name || '') && !feetDrop) options.creeper_dance = {
      // What a blast costs, said: trial 114 danced at twelve health with no
      // armour and a zombie beside it, and one blast was all of it.
      description: `Hit the creeper, back out of its blast while the knockback puts its fuse out, and close in to hit again when it comes on; other creepers are backed from the same way, other mobs are not watched. A blast takes ${require('./combat-estimate').creeperBlastSays(require('./combat-estimate').armourOf([5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean)))} health after the armour on (armour takes little off a blast: full iron about an eighth); the bot has ${Math.round(bot.health)} health and ${[5, 6, 7, 8].filter(slot => bot.inventory.slots?.[slot]).length} pieces of armour on.${(() => {
        // How many there are, and how many blasts the health takes: mid-215-b
        // danced with three creepers five to seven blocks off, told only of
        // one blast, and two went off (2026-09-26).
        const creepers = danger.filter(t => t.entity.name === 'creeper');
        const blast = (estimate.mobs || []).find(m => m.name === 'creeper')?.hitsBot;
        const count = creepers.length > 1 ? ` ${creepers.length} creepers are here (${creepers.map(t => Math.round(t.distance)).join(', ')} blocks off): the dance hits one at a time while the others come on.` : '';
        const blasts = blast ? ` A blast two blocks off is about ${blast} after the armour worn: ${Math.max(1, Math.ceil(bot.health / blast))} of them end${Math.ceil(bot.health / blast) === 1 ? 's' : ''} it.` : '';
        return count + blasts; })()}${edge}`,
      run: () => this.creeperDance(task, goal, save, danger, swung, { chosen: true }) };
    // Leave them be: the work goes on, and they are a threat again when one
    // comes within three blocks or lands a hit, or after fifteen seconds.
    if (!danger.some(t => t.distance <= 3)) options.keep_working = { description: `Carry on with the work and leave these mobs be for fifteen seconds (nearest ${Math.round(danger[0].distance)} blocks). The work stops at once if one comes within three blocks or lands a hit. Suits mobs that are far, slow, cannot reach the bot, or are not coming this way.${creeperCount ? (() => {
      // When the work would stop, against when the creeper lights: the
      // work stops at three blocks, which is where the fuse starts (the
      // decision review, 2026-09-26).
      const { APPROACH, LIGHTS_AT, FUSE } = require('./combat-estimate');
      const c = danger.filter(t => t.entity.name === 'creeper').sort((a, b) => a.distance - b.distance)[0];
      const secs = Math.max(0, Math.round((c.distance - LIGHTS_AT) / APPROACH * 10) / 10);
      return ` The creeper ${Math.round(c.distance)} blocks off, coming on, is at three blocks in about ${secs} seconds: that is when the work stops, and when its fuse lights; it goes off ${FUSE} seconds later unless the bot is out of its blast (about five blocks).`;
    })() : ''}${(() => { const shooting = (estimate.mobs || []).filter(m => m.shoots && m.visible); if (!shooting.length) return ''; const in15 = Math.round(shooting.reduce((n, m) => n + m.hitsBot / 2, 0) * 15); return ` The ${shooting.length === 1 ? shooting[0].name.replaceAll('_', ' ') : `${shooting.length} shooters`} in sight keep${shooting.length === 1 ? 's' : ''} shooting while the bot works: about ${in15} damage in the fifteen seconds, from ${Math.round(bot.health)} health${in15 >= bot.health ? ', more than the bot has' : ''}; the first hit ends it.`; })()}${unseen}${edge}${hitsLeft}`,
      run: async () => {
        bot._wavedOff = { ids: danger.map(t => t.entity.id), until: Date.now() + 15000 };
        this.report(goal, save, { action: 'keep_working', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health, stance: true });
        return true;
      } };
    // A golden apple carried is what a fight at low health is kept for:
    // trial 81 took one from a dungeon chest in its first minute and died to
    // a spider two minutes later with it still in the pack, never offered.
    const apple = bot.inventory.items().find(i => i.name === 'enchanted_golden_apple') || bot.inventory.items().find(i => i.name === 'golden_apple');
    if (apple && bot.health < 20) options.eat_golden_apple = {
      description: apple.name === 'enchanted_golden_apple'
        ? `Eat the enchanted golden apple now (${countOf(bot, apple.name)} carried): about 1.6 seconds eating while the mobs hit, then sixteen extra health as absorption, strong regeneration for twenty seconds and resistance for five minutes. Worth more later in the game than any other food.`
        : `Eat the golden apple now (${countOf(bot, apple.name)} carried): about 1.6 seconds eating while the mobs hit, then four extra health as absorption and regeneration of about eight health over five seconds. Eight gold ingots and an apple to make another.`,
      run: async () => {
        this.report(goal, save, { action: 'eat', item: apple.name, food: bot.food, health: bot.health, stance: true });
        try { await bot.equip(apple, 'hand'); await bot.consume(); return true; }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
      } };
    // Where a run could go, said before it is chosen: with three or more
    // mobs about, 25 of the 39 retreats chosen with none at arm's length in
    // the midgame trials of 2026-09-25 and 26 found no way and failed (a
    // retreat that failed did so in 1.2 seconds on the median), and the next
    // stance was asked from lower health. The way found before the question
    // (scoutRetreat), or at least the footing.
    const runShot = seconds => { const c = stanceCost({ mobs: mobs.filter(m => m.shoots), setup: seconds, seconds }); return c.damage ? ` About ${c.damage} damage from the shooters in range over those seconds, the shield down, from ${Math.round(bot.health * 10) / 10} health${c.damage >= bot.health ? ' (more than the bot has)' : ''}.` : ''; };
    let footing = NO_ROUTE_YET;
    const scout = this.state.retreatScout;
    if (onPillar) footing = ` The bot stands ${onPillar} blocks up on a pillar of its own, and a route drops three blocks at most: from up here there is no way off it to run by.`;
    else if (scout && scout.feet === `${feet}` && Date.now() - scout.at < 2000) {
      if (scout.destination) { const secs = Math.round(scout.blocks / SPRINT * 10) / 10; footing = ` A way is found: ${scout.blocks} blocks to footing ${scout.gain} blocks further from every mob about, passing none of them, about ${secs} seconds at a run.${runShot(secs)}`; }
      else if (!scout.spots) footing = ` Nowhere to run to: no footing within ${scout.radius} blocks is four blocks further than here from every mob about, so a run from here fails at once.`;
      else if (scout.tried >= scout.candidates) footing = ` No way out: none of the ${plural(scout.candidates, 'spot')} further from every mob has a route that passes none of them, so a run from here fails at once.`;
      else footing = ` No way found yet: ${scout.tried} of ${plural(scout.candidates, 'spot')} further from every mob tried and none has a route passing none of them; the rest are tried as it runs.`;
    }
    // A rider on a horse or a camel is faster than a running player:
    // mid-215-a ran four times from a zombie on a zombie horse with a spear,
    // caught each time, 11.3 health to 4.4 in one charge (2026-09-26).
    const riders = danger.filter(t => t.entity.vehicle).map(t => `a ${t.entity.name.replaceAll('_', ' ')} on a ${t.entity.vehicle.name?.replaceAll('_', ' ') || 'mount'}`);
    const riderSays = riders.length ? ` ${riders[0][0].toUpperCase()}${riders[0].slice(1)}${riders.length > 1 ? ` and ${riders.length - 1} more riding` : ''} ${riders.length > 1 ? 'are' : 'is'} faster than a running player: a run from ${riders.length > 1 ? 'them' : 'it'} is caught.` : '';
    options.retreat = { description: 'Run for footing out of the mobs\' reach and sight by a route that passes none of them; shooters keep shooting while the bot runs.' + (creeperCount ? ' Creepers and spiders follow a running player.' : '') + riderSays + footing + unseen,
      run: () => this.runAway(task, goal, save, danger) };
    // In the Nether with its portal close, the way home is a stance too:
    // mid-92-q came out beside its portal among skeletons and ghasts, turned
    // between six stances in twenty-five seconds and burned, the portal
    // five blocks off the whole time (2026-09-26).
    const portalId = bot.registry?.blocksByName?.nether_portal?.id;
    const portal = /nether/.test(String(bot.game?.dimension || '')) && portalId !== undefined && this.actions.returnOverworld && typeof bot.findBlocks === 'function'
      ? bot.findBlocks({ matching: portalId, maxDistance: 8, count: 1 })[0] : null;
    if (portal) {
      const blocks = Math.round(portal.distanceTo(bot.entity.position));
      options.portal_back = { description: `Go back through the portal ${blocks} block${blocks === 1 ? '' : 's'} off, to the Overworld where the bot came from: about ${Math.max(1, Math.round(blocks / 4.3))} second${blocks > 4 ? 's' : ''} to it and about four standing in it before it takes the bot, shot at meanwhile; the mobs here stay here. The work comes back through it afterwards.` + (armsLength ? ' Something that bites is at arm\'s length now, and follows the walk.' : ''),
        run: async () => { this.report(goal, save, { action: 'portal_back', portal: { x: portal.x, y: portal.y, z: portal.z }, threats: danger.map(t => t.entity.name) }); await this.actions.returnOverworld(bot, task, goal, save); return true; } };
    }
    // What each shot is up against: arrows to bring it down (about six a
    // full draw) and, for one that walks, how soon it is at the bot.
    const shotFacts = t => {
      const { MOBS, APPROACH, LIGHTS_AT, FUSE } = require('./combat-estimate');
      const hp = MOBS[t.entity.name]?.health, arrows = hp ? Math.ceil(hp / 6) : null;
      const walks = !shooter(t.entity);
      const at = t.entity.name === 'creeper' ? Math.max(0, (t.distance - LIGHTS_AT) / APPROACH) + FUSE : Math.max(0, (t.distance - 1.5) / APPROACH);
      return `${arrows ? ` About ${arrows} arrow${arrows === 1 ? '' : 's'} bring it down, about ${arrows} seconds of drawing.` : ''}${walks ? ` It walks on meanwhile: ${t.entity.name === 'creeper' ? `beside the bot and going off in about ${Math.round(at * 10) / 10} seconds if it keeps coming` : `at the bot in about ${Math.round(at * 10) / 10} seconds`}.` : ''}`;
    };
    // In water: the blocks of a pillar, a pocket or a bunker do not hold
    // the bot there (a pocket is full of water, a pillar's jump is a swim),
    // the bot sinks unless it swims, and a drowned is at home in it. Out
    // of the water is a stance of its own. mid-227-d fell into a flooded
    // pit with a drowned, chose the fight, the pillar and the bunker in
    // turn while it sank, and drowned-and-was-hit from fourteen to none;
    // no option said it was in water (2026-09-27).
    if (inWater(bot)) {
      for (const k of ['pillar', 'seal', 'bunker', 'dig_down']) delete options[k];
      const drowned = danger.filter(t => t.entity.name === 'drowned').length;
      const wet = ` The bot is in water, air ${bot.oxygenLevel ?? 20} of 20 (air runs out in about fifteen seconds under water, then it drowns at two health a second), and sinks unless it swims; a pillar, a pocket or a bunker cannot be built here.${drowned ? ` ${drowned === 1 ? 'The drowned swims' : `${drowned} drowned swim`} faster than the bot in water.` : ''}`;
      if (options.fight) options.fight.description += wet;
      options.get_out_of_water = { description: `Swim for the nearest dry ground with air over it, digging a step into the bank if that is the way out, and deal with the mobs from there.${wet}`,
        run: async () => { this.report(goal, save, { action: 'out_of_water', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health, air: bot.oxygenLevel });
          return !!await reachShore(bot, task, goal, save, { move: this.actions.navigate, client: this.client, dig: this.actions.dig }); } };
    }
    for (const t of shotTargets(bot, danger, { any: true }).slice(0, 3)) options[`shoot_${t.entity.id}`] = { description: `Shoot the ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off with the bow from here; each arrow takes about a second to draw, standing still.` + shotFacts(t) + (armsLength ? ' Something that bites is at arm\'s length now, and the draw stops when it closes.' : '') + edge,
      run: async () => { await this.shootAt(task, goal, save, t); return true; } };
    return options;
  }

  async stanceStep(task, goal, save, danger, swung) {
    const bot = this.bot;
    // Measured from the ground, not mid-jump: floored in the air, the feet
    // are a block high and every stance's cells with them (mid-239-b's
    // pillar, offered and then refused by its own headroom check).
    for (let n = 0; n < 8 && bot.entity.onGround === false && !bot.entity.isInWater; n++) { task.check(); await sleep(100); }
    const kinds = [...new Set(danger.map(t => t.entity.name))].sort().join(',');
    const feet = bot.entity.position.floored();
    const held = this.state.stance;
    // Leaving the mobs be ends at the first hit, as the option says: held
    // until six health was gone, mid-92-g stood working in the Nether under
    // skeletons from fifteen health to three (2026-09-26).
    const hitSince = held?.choice === 'keep_working' && bot._recentHurtAt > held.at;
    // Held through the crowd: a stance is asked again when it fails, when
    // six health is gone since it was chosen, after fifteen seconds, or
    // when a mob the choice was not made against comes within six blocks.
    // Not when a kind of mob comes into view far off or goes out of it: a
    // crowd's kinds change all the time, and mid-83-d went retreat, pillar,
    // charge, fight, seal in eighteen seconds, none carried through. Of 168
    // stances asked again for a change of kinds in the midgame trials, 81
    // were for a kind gone out of view and 54 for one come into view more
    // than eight blocks off; a third of those changed the stance.
    const newcomer = held?.ids && danger.find(t => t.distance <= STANCE_NEWCOMER && !held.ids.includes(t.entity.id));
    // A stance chosen on an estimate is asked again once it has cost more
    // than it was said to, health or time: first-days-219 chose to fight one
    // skeleton in full iron, told 1.3 damage in 3.8 seconds; it stood eleven
    // seconds under a ledge it could not reach and went from 9.2 health to
    // 2.9 before six health lost handed it back (2026-09-26).
    // At its pace: the damage said, spread over the seconds said, and one
    // blow of the hardest hitter's give; past its seconds, done.
    const elapsed = held ? (Date.now() - held.at) / 1000 : 0;
    const overEstimate = !!held?.expects && (held.health - bot.health > held.expects.damage * Math.min(1, elapsed / Math.max(0.1, held.expects.seconds)) + (held.expects.oneHit || 0) || elapsed > held.expects.seconds);
    const holding = held && (held.ids ? !newcomer : held.kinds === kinds) && Date.now() - held.at < STANCE_HOLD_MS && (held.expects ? !overEstimate : bot.health > held.health - STANCE_HEALTH) && !hitSince;
    // About to ask: the run's way is looked for first, so the retreat says
    // whether there is one (a moment ago from here will do).
    const scouted = this.state.retreatScout;
    if (!holding && !(scouted && scouted.feet === `${feet}` && Date.now() - scouted.at < 2000)) await this.scoutRetreat(task, danger);
    const options = this.stanceOptions(task, goal, save, danger, swung);
    // A stance that just failed here is not offered again for twenty
    // seconds: the clean run's pillar, knocked off by four zombies, was
    // chosen again each tick, the rules fought between, and the bot went
    // pillar, fight, pillar, defend, off the edge, fight, flee, and died.
    // Every stance that failed in the last twenty seconds, so two that fail
    // are not tried turn about.
    // Here, not against these kinds of mob: a crowd's kinds change as mobs
    // come into view and go out of it, and each change offered the stances
    // that had just failed again. Of the stances chosen again within twenty
    // seconds and four blocks of failing in the midgame trials of
    // 2026-09-25 and 26, half were offered again that way (25 of 50).
    const failed = [].concat(this.state.stanceFailed || []).filter(f => Date.now() - f.at < 20000 && (f.where ? Math.hypot(f.where.x - feet.x, f.where.y - feet.y, f.where.z - feet.z) <= 4 : f.kinds === kinds));
    // Except a fight that failed for want of reach, once a mob is at reach:
    // trial 106's charge could not climb the stairs to a zombie at three
    // and a half blocks, the zombie came down to one, and with the fight
    // set aside the bot was offered a pillar, a retreat and a pocket in a
    // one-wide staircase, and died from fifteen health in nine seconds.
    const atReach = danger.some(t => !shooter(t.entity) && (t.distance <= 3.2 || (t.entity.position && canStrike(bot, t.entity))));
    for (const f of failed) if (!(f.choice === 'fight' && atReach)) delete options[f.choice];
    if (!Object.keys(options).length) return false;
    let choice = holding && options[held.choice] ? held.choice : null;
    // One stance possible is no choice: it is taken without asking.
    if (!choice && Object.keys(options).length === 1) choice = Object.keys(options)[0];
    if (!choice) {
      const armour = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
      const state = { health: bot.health, food: bot.food, dimension: String(bot.game?.dimension || ''), armour, weapon: defenseWeapon(bot)?.name || 'bare hands',
        shield: bot.inventory.slots?.[45]?.name === 'shield', arrows: countOf(bot, 'arrow'), buildingBlocks: shelter.materialStock(bot),
        dropWithinThreeBlocks: require('./terrain').dropNear(bot, bot.entity.position.floored(), 3) || false,
        darkHere: darkHere(bot),
        threats: danger.slice(0, 8).map(t => ({ name: t.entity.name, distance: Math.round(t.distance * 10) / 10, shoots: shooter(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: t.visible })),
        // This bot's numbers: each mob's hit after its armour, swings to
        // kill with its weapon, and what fighting all of them here costs.
        estimate: fightEstimate({ threats: danger.slice(0, 8).map(t => ({ name: t.entity.name, distance: t.distance, shoots: shooter(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: t.visible })),
          armour, weapon: defenseWeapon(bot)?.name || null, health: bot.health, shield: bot.inventory?.slots?.[45]?.name === 'shield', atOnce: openCells(bot, feet) }),
        previousStance: held ? { choice: held.choice, secondsAgo: Math.round((Date.now() - held.at) / 1000), healthThen: held.health,
          ...(newcomer ? { askedAgainFor: `a ${newcomer.entity.name.replaceAll('_', ' ')} come within ${Math.round(newcomer.distance)} blocks` } : {}) } : null,
        riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal), recentPositions: require('./stillness').recentPositions(bot) };
      const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description }]));
      let decision;
      try {
        // Jev's answer can take seconds, and a creeper's fuse is a second
        // and a half: while it is out, the bot backs from a creeper coming
        // on, as a player steps back while thinking. mid-231-a stood still
        // four seconds waiting for the answer with one eight blocks off and
        // was blown up twice, the second time dead before the answer came
        // (2026-09-26).
        let answered = false;
        const asking = this.decide(task, goal, save, { id: 'encounter_stance', state, tree,
          isFresh: () => Math.abs(bot.health - state.health) < 4 }).finally(() => { answered = true; });
        const guarding = (async () => { while (!answered) { try { if (!await this.backFromCreeper(task, () => answered)) await sleep(100); } catch (_) { return; } } })();
        try { decision = await asking; } finally { answered = true; await guarding; }
      } catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
      // Stale: the moment moved on while Jev answered; the next tick asks
      // again from where the bot is then.
      if (decision.stale) return true;
      // Jev could not be reached: the rules answer this tick.
      if (decision.fallback) return false;
      choice = decision.path.at(-1);
    }
    if (!holding || held.choice !== choice) this.state.stance = { choice, kinds, ids: danger.map(t => t.entity.id), at: Date.now(), health: bot.health, ...(options[choice]?.expects ? { expects: options[choice].expects } : {}) };
    // The reflexes see the stance too (the hurt watchdog, the shield, the
    // meal): they give way to it while it holds.
    const stance = bot._stance = this.state.stance;
    if (!/^shoot_/.test(choice)) lowerShield(bot);
    stance.running = true;
    let done;
    try { done = await options[choice].run(); } finally { stance.running = false; stance.ranAt = Date.now(); }
    // A stance that could not be carried out is not offered again for a
    // while, and Jev chooses again at the next tick from what is left.
    if (!done) { delete this.state.stance; delete bot._stance; this.state.stanceFailed = [...failed, { choice, kinds, where: { x: feet.x, y: feet.y, z: feet.z }, at: Date.now() }]; }
    return true;
  }

  // A shooter in view at bow range, and a bow in the pack: running from a
  // skeleton is how most of the dream run's deaths went, arrows in the back.
  // Code lists the shots that have a clear arc, the retreat and the pocket;
  // Jev picks. Without Jev: shoot while health holds and nothing is at arm's
  // length, otherwise retreat. A melee mob within three blocks is the swing
  // and escape rules' business, not a moment to draw a bow.
  async rangedChoice(task, goal, save, danger, armed) {
    const bot = this.bot;
    if (bot.health < 8 || danger.some(t => t.distance <= 3 && !shooter(t.entity))) return false;
    const targets = shotTargets(bot, danger).slice(0, 3);
    if (!targets.length) return false;
    const tree = {};
    // What the shot, the run and the pocket each risk, said (the decision
    // audit, 2026-09-25): a creeper closing while the bow draws, the mobs
    // the list in view leaves out, and the pocket no longer hidden when a
    // creeper is near but offered with what a creeper does to one.
    const unseen = require('./danger').unseenNote(bot, danger);
    const creeper = danger.filter(t => t.entity.name === 'creeper' && t.distance <= 7).sort((a, b) => a.distance - b.distance)[0];
    const creeperShot = creeper ? ` A creeper is ${Math.round(creeper.distance)} blocks off: it closes while the bow draws, and its blast reaches about five.` : '';
    for (const t of targets) tree[`shoot_${t.entity.id}`] = { description: { action: 'Shoot this mob with the bow from where the bot stands. It is in clear view at bow range and shoots back; each arrow takes about a second to draw, standing still.' + creeperShot + unseen,
      entity: t.entity.name, distance: Math.round(t.distance), arrowsCarried: countOf(bot, 'arrow') }, run: () => this.shootAt(task, goal, save, t) };
    tree.retreat = { description: 'Run for footing out of its range and out of its sight; the mob keeps shooting while the bot runs.' + NO_ROUTE_YET + unseen, run: () => this.escape(task, goal, save, danger, armed) };
    if (shelter.materialStock(bot) >= 12) tree.dig_in = { description: 'Seal a two-block pocket where the bot stands and wait for it to lose interest.' + (creeper ? ` A creeper ${Math.round(creeper.distance)} blocks off walks up to a pocket and goes off before it closes.` : '') + unseen, run: () => this.sealHere(task, goal, save, danger) };
    const about = [...danger];
    for (const t of threats(bot, 16)) if (!about.some(a => a.entity.id === t.entity.id)) about.push(t);
    const state = { health: bot.health, food: bot.food, arrowsCarried: countOf(bot, 'arrow'), recentSurvivalAction: goal.survivalAction,
      threats: about.sort((a, b) => a.distance - b.distance).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), shoots: shooter(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: t.visible !== false })),
      riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal) };
    const decision = await this.decide(task, goal, save, { id: 'ranged_response', state, tree, context: { health: bot.health },
      isFresh: () => Math.abs(bot.health - state.health) < 4 && targets.some(t => bot.entities[t.entity.id] === t.entity && t.entity.isValid !== false) });
    if (decision.stale) return true;
    await decision.action.run();
    return true;
  }

  async shootAt(task, goal, save, threat) {
    const bot = this.bot, target = threat.entity;
    this.report(goal, save, { action: 'shoot', target: target.name, entityId: target.id, distance: Number(threat.distance.toFixed(1)), arrows: countOf(bot, 'arrow'), health: bot.health });
    // The target is the point; the draw stops only for a melee mob closing
    // to arm's length, which the next loop meets with the sword.
    const threatCheck = b => {
      if (threats(b, 3).some(t => t.entity !== target && !shooter(t.entity) && (t.visible || t.distance <= 2))) throw Object.assign(new Error('A mob closed to arm\'s length during the draw'), { name: 'ShotInterrupted' });
    };
    try {
      const shot = await shoot(bot, task, target, { threatCheck });
      goal.survivalAction = { ...goal.survivalAction, released: true, arrowId: shot.arrowId, ticks: Number(shot.ticks.toFixed(1)), at: new Date().toISOString() }; save();
    } catch (err) {
      task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err;
      goal.survivalAction = { ...goal.survivalAction, released: false, reason: err.message, at: new Date().toISOString() }; save();
    }
    delete this.state.trappedSince;
  }

  // Footing out of reach and out of sight, by a route that does not pass a
  // hostile: true when the bot set off (arrived or was cut short, so the
  // next look is from wherever it got to), false when no route was found.
  // With `only`, the room gained is measured from those mobs alone (the
  // creepers in a crowd), and a nearer hop will do; the route still passes
  // no hostile.
  // The footing a run could go to, found without a route search: the far
  // spots past a persistent chaser's follow range, and the nearer ones that
  // gain `gain` blocks on every mob about. Said on the retreat option too.
  escapeFootings(danger, { gain = 4, only = false } = {}) {
    const bot = this.bot;
    const ids = ESCAPE_FOOTING.map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
    // Away from every hostile about, not only the ones in view this
    // instant: at two health the bot ran from a blaze, then from a piglin
    // twenty blocks the other way, straight back to the blaze, which had
    // dropped out of sight for the second look.
    const about = [...new Set([...danger.map(t => t.entity), ...hostileEntities(bot, 32)])];
    const from = only ? danger.map(t => t.entity) : about;
    const distance = p => Math.min(...from.map(e => e.position.distanceTo(p)));
    // A creeper does not burn off at dawn and follows to about sixteen
    // blocks. A six-block hop from one only buys a minute before it is back
    // at the same tree; the escape from a mob that persists has to reach
    // past its follow range, or the same creeper interrupts all morning.
    const persistent = danger.some(t => PERSISTENT_THREATS.has(t.entity.name));
    const radius = persistent ? 40 : 20;
    const footing = bot.findBlocks({ matching: ids, maxDistance: radius, count: 512,
      useExtraInfo: b => shelter.solid(b) && shelter.replaceable(bot.blockAt(b.position.offset(0, 1, 0))) && shelter.replaceable(bot.blockAt(b.position.offset(0, 2, 0))),
    }).map(p => p.offset(0, 1, 0)).filter(p => !isSetAside(this, 'escape', p) && !lavaBeside(bot, p));
    const gaining = p => distance(p) >= distance(bot.entity.position) + gain;
    // With a hoglin about, no footing near an edge and no route along one.
    const heavy = heavyHitters(threats(bot, 16), 16).length > 0;
    const edgeSafe = p => !heavy || !dropWithin(bot, p, 2);
    // The far spots first when the chaser persists; the ordinary hop is the
    // fallback, because standing still beside a creeper is never the answer.
    const far = persistent ? footing.filter(p => p.distanceTo(bot.entity.position) >= 20 && distance(p) >= 20 && edgeSafe(p)).sort((a, b) => distance(b) - distance(a)) : [];
    const near = footing.filter(p => p.distanceTo(bot.entity.position) >= (only ? 3 : 6) && gaining(p) && edgeSafe(p)).sort((a, b) => distance(b) - distance(a));
    return { about, footing, far, near, heavy, persistent, radius };
  }

  async runAway(task, goal, save, danger, { gain = 4, only = false } = {}) {
    const bot = this.bot;
    const movements = bot.pathfinder.movements;
    const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, allowSprinting: movements.allowSprinting };
    Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: true });
    try {
      const { about, footing, far, near, heavy, persistent } = this.escapeFootings(danger, { gain, only });
      // Beside lava, one knockback is the end: the dream run died that way at
      // its pouring spot, in full iron, with the diamond pickaxe. Get two
      // blocks from the lava first, whatever the mob does meanwhile.
      if (lavaBeside(bot, bot.entity.position.floored())) {
        const dry = footing.filter(p => p.distanceTo(bot.entity.position) <= 8).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
        for (const p of dry.slice(0, 6)) {
          const route = await surveyRoute(bot, task, movements, new goals.GoalBlock(p.x, p.y, p.z), 150);
          if (route.status !== 'success') continue;
          this.report(goal, save, { action: 'leave_lava_edge', destination: { ...p }, threats: danger.map(t => t.entity.name) });
          try { await this.actions.navigate(bot, task, new goals.GoalBlock(p.x, p.y, p.z), { timeoutMs: 5000, stallMs: 2000 }); } catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; }
          return true;
        }
      }
      // The way the stance question already found from here, if it is fresh.
      const scout = this.state.retreatScout;
      const fresh = scout && !only && gain === 4 && Date.now() - scout.at < 2000 && scout.feet === `${bot.entity.position.floored()}`;
      // Every candidate already tried a moment ago from here, none a way.
      if (fresh && !scout.destination && scout.tried >= scout.candidates) { delete this.state.retreatScout; return false; }
      const way = fresh && scout.destination ? { p: pos(scout.destination) } : await this.wayAway(task, movements, { about, heavy }, [...far.slice(0, 12), ...near.slice(0, 12)]);
      delete this.state.retreatScout;
      if (!way.p) return false;
      const p = way.p, destination = new goals.GoalBlock(p.x, p.y, p.z);
      try { await this.actions.navigate(bot, task, destination, { timeoutMs: persistent ? 14000 : 7000, stallMs: 3000 }); delete this.state.trappedSince; return true; }
      catch (err) {
        task.check(); if (err.name === 'NeedsAir') throw err;
        setAside(this, 'escape', p, err, 60000); save();
        // Reobserve positions after a partial escape instead of running the
        // next stale route against the old mob positions.
        return true;
      }
    } finally { Object.assign(movements, previous); bot.clearControlStates(); }
  }

  // The first of the candidates with a route that passes no hostile (and, a
  // hoglin about, no edge), within `budgetMs` of route searches:
  // { p, route, tried } or { p: null, tried }.
  async wayAway(task, movements, { about, heavy }, candidates, { budgetMs = Infinity } = {}) {
    const bot = this.bot;
    const end = Date.now() + budgetMs;
    let tried = 0;
    for (const p of candidates) {
      if (Date.now() >= end) break;
      tried++;
      const route = await surveyRoute(bot, task, movements, new goals.GoalBlock(p.x, p.y, p.z), Math.max(20, Math.min(150, end - Date.now())));
      if (route.status !== 'success') continue;
      // Do not run through another hostile to escape the closest one.
      if (route.path.some(point => about.some(e => e.position.distanceTo(pos(point)) < Math.min(4, e.position.distanceTo(bot.entity.position) - 1)))) continue;
      if (heavy && route.path.some(point => besideDrop(bot, pos(point).floored()))) continue;
      return { p, route, tried };
    }
    return { p: null, tried };
  }

  // The run's way found before the stance is asked, a few route searches at
  // most: the retreat was chosen blind ("no route is checked yet"), and with
  // three or more mobs about, 25 of the 39 chosen with none at arm's length
  // in the midgame trials of 2026-09-25 and 26 found no way and failed. What
  // was found is said on the option, and a way found is the one run.
  async scoutRetreat(task, danger, { budgetMs = SCOUT_MS } = {}) {
    const bot = this.bot;
    const movements = bot.pathfinder?.movements;
    if (!movements || typeof surveyRoute !== 'function') return null;
    const feet = `${bot.entity.position.floored()}`;
    const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, allowSprinting: movements.allowSprinting };
    Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: true });
    try {
      const { about, far, near, heavy, radius } = this.escapeFootings(danger);
      const candidates = [...far.slice(0, 12), ...near.slice(0, 12)];
      const way = candidates.length ? await this.wayAway(task, movements, { about, heavy }, candidates, { budgetMs }) : { p: null, tried: 0 };
      const from = bot.entity.position;
      return this.state.retreatScout = { at: Date.now(), feet, radius, spots: far.length + near.length, tried: way.tried, candidates: candidates.length,
        ...(way.p ? { destination: { x: way.p.x, y: way.p.y, z: way.p.z }, blocks: Math.round(way.route.path.length || way.p.distanceTo(from)),
          gain: Math.round(Math.min(...about.map(e => e.position.distanceTo(way.p))) - Math.min(...about.map(e => e.position.distanceTo(from)))) } : {}) };
    } catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return null; }
    finally { Object.assign(movements, previous); }
  }

  async escape(task, goal, save, danger, armed) {
    const bot = this.bot;
    lowerShield(bot);
    this.report(goal, save, { action: 'escape_threat', threats: danger.map(t => ({ name: t.entity.name, distance: t.distance })) });
    // No route away from here a moment ago is no route now: the search is
    // a second of route surveys, and in the replay of trial 57's ledge each
    // one was a second without a swing while a zombie hit.
    const here = bot.entity.position.floored(), none = this.state.noRoute;
    if (!(none && Date.now() - none.at < 5000 && here.distanceTo(pos(none)) < 1.5)) {
      if (await this.runAway(task, goal, save, danger)) { delete this.state.noRoute; return; }
      this.state.noRoute = { x: here.x, y: here.y, z: here.z, at: Date.now() };
    }
    const movements = bot.pathfinder.movements;
    const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, allowSprinting: movements.allowSprinting };
    Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: true });
    try {
      // The cornered rules: no route away was found (or it was cut short).
      const nearest = danger[0];
      // A creeper close is not sealed against: the pocket takes seconds of
      // block after block and the blast comes first. The day audit's cave
      // death began an eighteen-cell pocket with three creepers at four
      // blocks, and one blast took seventeen health. Away from the creepers
      // first, by any footing that puts more room between them and the bot.
      const creepers = creeperClose(danger) ? danger.filter(t => t.entity.name === 'creeper' && t.distance <= 7) : [];
      if (creepers.length && await this.runAway(task, goal, save, creepers, { gain: 2, only: true })) { delete this.state.trappedSince; return; }
      // Cornered with stone in hand: a wall between us and the mob beats a
      // hold. Only the cell one step toward it, and only while that cell is
      // still empty; a mob already in it is fought, not walled.
      // A wall on one side is not cover: a skeleton shot the bot while it
      // hid from a piglin. With a ranged mob in view and no way out, close
      // every open side into a two-block pocket and let it pass. Against a
      // melee mob alone, the single wall toward it is enough.
      // A herd is sealed out like a shooter: one wall toward one hoglin
      // leaves the other four, and the bot held a "defensive position" at
      // five health in the middle of seven of them.
      //
      // Counted at two ranges, because the arena's herd drill died three
      // times out of three: the nearest hoglin was eleven blocks off, so
      // nothing was a crowd, the bot charged it, and met four at three
      // blocks. A pack seen coming is a pack. Seal while there is still
      // time to place the blocks, and never charge into one.
      // A sword-wielder already at arm's length is fought, not walled: the
      // pocket is seconds of standing still placing blocks with no swing,
      // and in the fortress a wither skeleton beside the bot, two blazes
      // behind it, took it from 19 to nothing in five of them (the dream
      // run, 2026-09-24 00:07). The fight rule swings at the top of every
      // tick; here the tick ends so the next one swings again.
      // A shooter at arm's length too: a blaze three blocks off was walled
      // against for twelve seconds of block placing while it shot, where two
      // swings would have ended it (the user, 2026-09-24).
      const melee = danger.find(t => t.entity.name !== 'creeper' && (t.distance <= 3.2 || canStrike(bot, t.entity)));
      if (armed && melee && bot.health >= 6) {
        this.report(goal, save, { action: 'fight', threats: [melee.entity.name], health: bot.health, cornered: true });
        delete this.state.trappedSince; return;
      }
      const crowd = danger.filter(t => t.distance <= 12).length >= 2;
      const pack = danger.filter(t => t.distance <= 16).length >= 2;
      // Tried and measured: charging a pack of shooters killed the bot in the
      // open swarm drill where holding had not. The half-block step toward a
      // hovering shooter that is already in the fight stays; the charge into
      // four of them from eight blocks does not.
      // A pack in the open is met at a door, not in the middle of it. One
      // block into the rock and only one of them can reach at a time; the
      // ordinary fight rule then takes them one by one. The herd drill died
      // two runs in three standing in the room with four hoglins.
      // Held until the pack thins, then given up: four hoglins were waited
      // out for seventy-five seconds without a scratch, which is the right
      // answer, but a hold with no end would be a new way to stall a run.
      if (pack) this.state.bunkerSince ||= Date.now(); else delete this.state.bunkerSince;
      const holding = this.state.bunkerSince && Date.now() - this.state.bunkerSince > 45000;
      if (pack && !holding && bot.health >= 10 && nearWall(bot, centroid(danger)) && require('./bunker').bunkerDigMs(bot, centroid(danger)) <= BUNKER_DIG_MS) {
        this.report(goal, save, { action: 'dig_in_bunker', threats: danger.map(t => t.entity.name).slice(0, 6), health: bot.health,
          held: Math.round((Date.now() - this.state.bunkerSince) / 1000) });
        try { await digBunker(bot, task, goal, save, { from: centroid(danger), navigate: this.actions.navigate }); delete this.state.trappedSince; return; }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
      }
      if ((crowd || danger.some(shoots)) && !creepers.length && await this.sealHere(task, goal, save, danger)) { delete this.state.trappedSince; return; }
      // A lone mob that does not shoot is met, not walled: the wall came
      // first, and a wither skeleton standing between the sword's reach
      // and the charge's minimum was walled off every time.
      if (armed && danger.length === 1 && !shoots(nearest) && await this.charge(task, goal, save, nearest, pack)) { delete this.state.trappedSince; return; }
      if (await this.wallOff(task, goal, save, danger)) { delete this.state.trappedSince; return; }
      // No way out and a mob a few blocks off, shooting: standing still is
      // how a crossbow piglin took half the bot's health. Armed and able,
      // close the gap so the fight rule can do its work.
      // One mob is charged; a herd is not.
      if (armed && await this.charge(task, goal, save, nearest, pack)) { delete this.state.trappedSince; return; }
      // In a narrow tunnel, wait for the next bounded defensive action rather
      // than spending five failed route searches while a mob hits us. The
      // encounter still has a deadline and reports a concrete blocker.
      this.state.trappedSince ||= Date.now();
      if (Date.now() - this.state.trappedSince > 30000) {
        const error = new Error('No safe escape after 30 seconds of defending the constrained position'); error.name = 'Blocked'; throw error;
      }
      this.report(goal, save, { action: 'hold_defensive_position', threats: danger.map(t => t.entity.name),
        reason: 'No safe retreat; defend visible hostiles that enter reach' });
      // Held for a second, swinging at whatever comes into reach, bare
      // hands or not: a hold that only waited let trial 57's zombie take
      // twenty health with no swing between its hits.
      await this.swingFor(task, goal, save);
    } finally { Object.assign(movements, previous); bot.clearControlStates(); }
  }

  // Swing after swing at whatever is in reach, for a second, before the
  // next look round: one swing a tick, with a tick's half second of checks
  // between, was a bare-handed bot punching once a second against a zombie
  // hitting once a second (the replay of trial 57's ledge).
  async swingFor(task, goal, save, ms = 1000) {
    const bot = this.bot;
    let swung = false;
    for (const until = Date.now() + ms; Date.now() < until;) {
      task.check(); checkAir(bot);
      // A creeper is hit and backed from (creeperDance), not stood at.
      // Where the dance cannot run (no blade, a drop behind) the chosen
      // fight still swings: handed straight back, trial 99's bare-handed
      // fight with a creeper at arm's length ran twenty times a second and
      // struck nothing.
      const close = threats(bot, 5);
      if (close.some(t => t.entity.name === 'creeper') && await this.creeperDance(task, goal, save, close, swung, { chosen: true })) { swung = false; continue; }
      swung = await defendNearby(bot, task, goal, save);
      if (!swung) await sleep(100);
    }
  }

  // Two blocks straight up, where the head room allows and blocks are
  // carried; true once the feet are clear of what was beneath them.
  // The open sides of a one-wide ledge walled at the feet, each with the
  // floor beside it laid first to place against. True when a block went down.
  async railSpan(task, goal, save) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function') return false;
    const { dropAt } = require('./terrain');
    const feet = bot.entity.position.floored();
    const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => feet.offset(dx, 0, dz)).filter(c => dropAt(bot, c));
    const material = bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name) && i.count >= 2 * open.length)?.name;
    if (!open.length || !material) return false;
    this.report(goal, save, { action: 'rail_span', sides: open.length, health: bot.health });
    let placed = 0;
    for (const c of open) {
      for (const p of [c.offset(0, -1, 0), c]) {
        if (bot.blockAt(p)?.boundingBox === 'block') continue;
        task.check();
        try { await this.actions.place(bot, task, p, material); placed++; }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; break; }
      }
    }
    return placed > 0;
  }

  async pillarFrom(task, goal, save, danger) {
    const bot = this.bot;
    const feet = bot.entity.position.floored();
    if (this.state.pillar && feet.y >= this.state.pillar.y + 2 && Math.hypot(feet.x - this.state.pillar.x, feet.z - this.state.pillar.z) < 1) return false;
    const { pillarUp, SCAFFOLD } = require('./pillar-recovery');
    if (bot.inventory.items().filter(i => SCAFFOLD.includes(i.name)).reduce((n, i) => n + i.count, 0) < 2) return false;
    if (![1, 2, 3].every(dy => { const b = bot.blockAt(feet.offset(0, dy, 0)); return b && b.boundingBox === 'empty' && !/lava|water/.test(b.name); })) return false;
    this.report(goal, save, { action: 'pillar_from', threats: danger.map(t => t.entity.name), health: bot.health });
    lowerShield(bot);
    try { await pillarUp(bot, task, feet.y + 2, { dig: this.actions.dig, maxBlocks: 2, threats: false }); }
    catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
    if (bot.entity.position.y < feet.y + 1.9) return false;
    this.state.pillar = { x: feet.x, y: feet.y, z: feet.z, at: Date.now() };
    return true;
  }

  // A saved shelter is only useful if there is a way to it. Forty blocks up
  // a shaft at dusk, the surface shelter from last night is not a shelter,
  // and the dream run spent a whole night failing to path to it. One that
  // cannot be reached is set aside for a while so a pocket can be sealed
  // where the bot stands.
  // The ways that are not a room: a pocket here, a shaft, a mine.
  async shelterBy(task, goal, save, method) {
    const bot = this.bot;
    if (method === 'seal_here') return this.sealHere(task, goal, save, threats(bot).filter(t => t.visible));
    if (method === 'shaft_pocket') return this.shaftPocket(task, goal, save);
    if (method === 'night_mine') {
      if (!this.canNightMine(goal)) return false;
      this.state.nightMine ||= { startedAt: Date.now(), origin: { ...bot.entity.position.floored() }, heading: Math.floor(Math.random() * 4), failures: 0, mined: 0 };
      return this.nightMine(task, goal, save);
    }
    return false;
  }

  async reachableRefuge(task, goal, save, refuge) {
    const bot = this.bot;
    if (!refuge || shelter.inside(bot, refuge)) return refuge;
    const o = pos(refuge.origin);
    if (o.distanceTo(bot.entity.position) <= 6 || !bot.pathfinder?.movements) return refuge;
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalNear(o.x, o.y, o.z, 2), 400);
    if (route.status === 'success') return refuge;
    refuge.avoidUntil = Date.now() + 600000;
    this.report(goal, save, { action: 'shelter_unreachable', origin: refuge.origin, reason: route.status });
    return null;
  }

  // True when it did something toward a shelter; false when there is none
  // to be had here for now (the caller then leaves the tick to the work).
  // How the night is sheltered is Jev's: the saved shelter, a room built at
  // a site, a pocket sealed where the bot stands, a shaft pocket dug down,
  // or a mine. Chosen once and held for the night; a way that fails rests
  // three minutes and the question is asked again. With `method`, the
  // caller has already chosen (the emergency beside a prepared site).
  async refugeStep(task, goal, save, { method: given = null } = {}) {
    const bot = this.bot;
    // No shelter is made under water: a pocket sealed there is full of it.
    // The way up comes first (mid-205-b, 2026-09-26).
    if (require('./vitals').headSubmerged(bot)) throw new (require('./vitals').NeedsAir)();
    if (isSetAside(this, 'refuge', 'anywhere')) return false;
    if (await reachShore(bot, task, goal, save, { move: this.actions.navigate, client: this.client, dig: this.actions.dig })) return true;
    let refuge = await this.reachableRefuge(task, goal, save, this.currentShelter());
    // Last night's pocket beside a flooded cave is not gone back to from
    // outside it: the night mine had nowhere to go there, and the bot waited
    // two nights in it. A dry site is looked for first (shelterSites).
    if (refuge && refuge.kind !== 'house' && !shelter.inside(bot, refuge) && shelter.wetBelow(bot, pos(refuge.origin)) > 0) refuge = null;
    const plan = this.state.nightPlan;
    let method = given || (plan?.method && !isSetAside(this, 'shelter_method', plan.method) ? plan.method : null);
    // A room already begun or chosen goes on without a question.
    if (!method && refuge && shelter.inside(bot, refuge)) method = 'saved_shelter';
    let site = null;
    if (!method || (method === 'build_at_site' && !refuge)) {
      // Beside a lava lake nothing within twelve blocks has a safe shell;
      // look further before giving the night up as unsafe.
      if (!refuge) {
        let sites = shelter.shelterSites(bot, goal);
        if (!sites.length) sites = shelter.shelterSites(bot, goal, 32);
        // Six sites, a little over half a second each: at a hundred and fifty
        // milliseconds every survey from a hollow eleven blocks under the
        // surface timed out, and the dream run retried the whole list for
        // seven attempts at dusk.
        for (const p of sites.slice(0, 6)) {
          if ((await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalBlock(p.x, p.y, p.z), 600)).status === 'success') { site = p; break; }
        }
      }
    }
    if (!method) {
      const stock = shelter.materialStock(bot);
      const options = {};
      const resting = key => isSetAside(this, 'shelter_method', key);
      // What each way risks, said (the decision audit, 2026-09-25): the walk
      // to a room with its time against the dark and the mobs about the
      // place, the pocket's race with every mob about, seen or not, and
      // whether a shaft has a dry column to go down at all.
      const about = threats(bot, 64);
      const walkTo = dest => {
        const distance = dest.distanceTo(bot.entity.position), seconds = Math.round(distance / 4.3), tod = bot.time?.timeOfDay ?? 6000;
        const there = about.filter(t => t.entity.position.distanceTo(dest) <= 16);
        const dark = tod >= DAY.DARK && tod < DAY.DAWN ? ' It is dark already: mobs spawn along the way.' : tod + seconds * 20 >= DAY.DARK ? ' It arrives after dark.' : '';
        return ` About ${seconds} seconds at a walk.${dark}${there.length ? ` Within sixteen blocks of it now: ${there.slice(0, 4).map(t => `a ${t.entity.name.replaceAll('_', ' ')}`).join(', ')}${there.some(t => t.entity.name === 'creeper') ? ' (a creeper among them)' : ''}.` : ''}`;
      };
      if (refuge && !resting('saved_shelter')) options.saved_shelter = { description: `Go back to the ${refuge.verifiedAt ? 'shelter used before' : 'shelter begun before'}, ${Math.round(pos(refuge.origin).distanceTo(bot.entity.position))} blocks away, and seal it: ${shelter.missingShell(bot, refuge).length} blocks to place, ${stock} carried.${shelter.inside(bot, refuge) ? '' : walkTo(pos(refuge.origin))}` };
      if (site && !resting('build_at_site')) { const need = shelter.missingShell(bot, { origin: site }).length;
        options.build_at_site = { description: `Build a small room at a dry site ${Math.round(site.distanceTo(bot.entity.position))} blocks away: ${need} blocks to place, ${stock} carried${stock < need + 4 ? ', the rest gathered first' : ''}. A room is kept and can be used again on later nights.${walkTo(site)}` }; }
      const near = about.filter(t => t.distance <= 24);
      if (!resting('seal_here')) options.seal_here = { description: (stock >= 12 ? `Seal a two-block pocket around the bot where it stands with the ${stock} blocks carried; quick, and kept for later nights.` : `Dig into the ground where the bot stands and close it over (${stock} blocks carried, too few for a pocket on open ground).`) + pocketRace(bot, near) + (creeperNoteFor(near) || creeperSays(bot)) };
      if (!resting('shaft_pocket')) {
        const column = this.shaftColumn();
        const found = column.bottom ? ` A dry column is found${column.start.equals(bot.entity.position.floored()) ? ' underfoot' : ` ${Math.round(column.start.distanceTo(bot.entity.position))} blocks over`}: ${column.start.y - column.bottom.y} blocks down.` : ` ${column.none.charAt(0).toUpperCase()}${column.none.slice(1)}; chosen, it fails and the question comes again.`;
        // The creeper's race said here too: mid-211-a chose the shaft pocket
        // at 9.2 health told "done in seconds", a creeper eight blocks off
        // and said only beside the room, and it followed the bot down and
        // went off (2026-09-26).
        options.shaft_pocket = { description: 'Dig two or three blocks straight down here and cap it with one block: the fewest blocks, done in seconds.' + found + creeperSays(bot) };
      }
      // The carried bed, in a nook dug beside the bot: now at bedtime, or in
      // the wall of a pocket sealed here and dug at bedtime. The one bot of
      // the six midgame trials of 2026-09-26 that carried a bed chose
      // seal_here eleven times, and the bed was never on this list.
      if (bedCarried(bot) && bot.game?.dimension === 'overworld' && !sleepWaiting(this) && !resting('bed_nook') && !isSetAside(this, 'bed_nook', 'here')) {
        const now = sleepable(bot);
        const nook = bedNook(bot, goal, now ? {} : { sealed: true, shell: shelter.shell(bot.entity.position.floored()) });
        if (nook) options.bed_nook = { description: now ? `Put the carried bed down here instead of a shelter: ${nookSays(bot, nook)}${creeperSays(bot)}`
          : `Seal a pocket where the bot stands, as seal_here does (${stock} blocks carried), and at bedtime ${nookSays(bot, nook, { pocket: true, later: true })}${pocketRace(bot, near)}${creeperNoteFor(near)}` };
      }
      if (this.canNightMine(goal) && !resting('night_mine')) options.night_mine = { description: 'Dig a mine from here for the night: a staircase into the rock is shelter and a mine at once, and gains ore while the night passes.' + creeperSays(bot) };
      if (!Object.keys(options).length) {
        // Nowhere, nothing to build with, no ground to dig: failing that every
        // tick was trial 9's loop at minute ten, with no wood yet to make any
        // of it possible (2026-09-24). It rests three minutes and the work
        // goes on, which is what finds the wood.
        setAside(this, 'refuge', 'anywhere', 'no way to shelter here', 180000);
        delete this.state.nightPlan;
        this.report(goal, save, { action: 'no_shelter_here', reason: 'no way to shelter here' });
        return false;
      }
      const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description }]));
      const decision = Object.keys(tree).length === 1 ? { path: [Object.keys(tree)[0]] }
        : await this.decide(task, goal, save, { id: 'shelter_method', tree, state: { timeOfDay: bot.time?.timeOfDay, health: bot.health, food: bot.food, buildingBlocks: stock, darkHere: darkHere(bot), torches: countOf(bot, 'torch'),
          underground: !surfaceObserver(bot)(bot.entity.position), pickaxe: bot.inventory.items().find(i => /_pickaxe$/.test(i.name))?.name || null,
          nearbyThreats: threats(bot).filter(t => t.distance < 24).slice(0, 6).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), visible: t.visible })),
          riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal) } });
      if (decision.stale) return true;
      method = decision.path.at(-1);
      this.state.nightPlan = { ...(plan || { plan: 'shelter' }), until: Date.now() + 120000, method };
      save();
      // Without Jev, the old cascade in one tick: each way in order until one
      // works (a pocket, a shaft, a mine), the room last as before.
      if (!this.client || decision.fallback) {
        for (const key of ['seal_here', 'shaft_pocket', 'night_mine'].filter(k => options[k] && !['saved_shelter', 'build_at_site', 'bed_nook'].includes(method))) {
          if (await this.shelterBy(task, goal, save, key)) { this.state.nightPlan.method = key; save(); return true; }
          setAside(this, 'shelter_method', key, 'did not work here', 180000);
        }
        if (!['saved_shelter', 'build_at_site', 'bed_nook'].includes(method)) {
          setAside(this, 'refuge', 'anywhere', 'no way to shelter here', 180000); delete this.state.nightPlan;
          this.report(goal, save, { action: 'no_shelter_here', reason: 'no way to shelter here' });
          return false;
        }
      }
    }
    const failed = why => { setAside(this, 'shelter_method', method, why, 180000); if (this.state.nightPlan?.method === method) delete this.state.nightPlan.method; save(); return true; };
    if (['seal_here', 'shaft_pocket', 'night_mine'].includes(method)) return (await this.shelterBy(task, goal, save, method)) || failed(`${method.replaceAll('_', ' ')} did not work here`);
    // The bed nook: slept in now at bedtime; before it, the pocket sealed
    // here, and the nook dug from inside it at bedtime (the pocket's step).
    if (method === 'bed_nook') {
      if (sleepable(bot)) {
        try { await this.nookSleep(task, goal, save); return true; }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return failed(`the bed nook: ${err.message}`); }
      }
      this.state.bedNookPlan = { until: Date.now() + 600000 };
      return (await this.sealHere(task, goal, save, threats(bot).filter(t => t.visible))) || failed('the pocket for the bed nook did not seal here');
    }
    if (method === 'build_at_site' && !refuge) {
      if (!site) return failed('no dry site within reach');
      refuge = { origin: { ...site }, dimension: bot.game.dimension, createdAt: new Date().toISOString() };
      this.state.shelters.push(refuge); save();
    }
    if (!refuge) return failed('the saved shelter is out of reach');
    const missing = shelter.missingShell(bot, refuge);
    const stock = shelter.materialStock(bot);
    // Navigation can consume scaffold blocks or clear natural walls. Keep a
    // small travel reserve, then recheck the actual shell after entering.
    const required = missing.length + (shelter.inside(bot, refuge) ? 0 : 4);
    if (stock < required) {
      // A site selected above a mining pocket can reserve every block needed
      // to escape it. Reach that still-empty site before searching for supplies;
      // approachRefuge relaxes only this reservation and restores it afterwards.
      // Well below it, not one block: gathering dirt steps the bot into the
      // hole it dug, and read as "below the site" that sent it back up
      // after every block, one dirt a trip, with a creeper closing in.
      if (bot.entity.position.y < refuge.origin.y - 1.5 && emptySite(bot, refuge)) {
        this.report(goal, save, { action: 'return_to_surface', target: refuge.origin });
        task.interruptCheck = () => checkThreats(bot);
        try {
          const o = refuge.origin;
          await this.approachRefuge(task, goal, refuge, new goals.GoalBlock(o.x, o.y, o.z));
        } finally { task.interruptCheck = undefined; }
        return;
      }
      if (shelter.inside(bot, refuge)) {
        await this.leave(task, goal, save, refuge);
        if (shelter.inside(bot, refuge)) return;
      }
      // Short of blocks: a shaft pocket costs one block where the room costs
      // twenty-eight. Two or three down into dirt or rock and a block over
      // the head, before a trip for blocks (the dream run gathered dirt one
      // block at a time on open grass at night and a creeper found it).
      // Without Jev only: a room Jev chose knowing the count is built.
      if (!this.client && !shelter.inside(bot, refuge) && await this.shaftPocket(task, goal, save)) return;
      this.report(goal, save, { action: 'gather_shelter_materials', need: required, carried: stock, origin: refuge.origin });
      task.interruptCheck = () => checkThreats(bot);
      try {
        const supply = shelter.supplyTarget(bot, required - stock);
        await this.actions.acquireStep(bot, task, supply.item, supply.count, goal, save,
          { minimumMiningY: Math.min(refuge.origin.y, bot.entity.position.floored().y) - 1 });
      } finally { task.interruptCheck = undefined; }
      return;
    }
    if (!shelter.inside(bot, refuge)) {
      // Reenter a previously sealed room through a verified two-block exit.
      if (shelter.sealed(bot, refuge)) {
        const exit = shelter.exits(bot, refuge).sort((a, b) => a.outside.distanceTo(bot.entity.position) - b.outside.distanceTo(bot.entity.position))[0];
        if (!exit) throw new Error('The saved shelter has no safe approach');
        await this.actions.navigate(bot, task, new goals.GoalBlock(exit.outside.x, exit.outside.y, exit.outside.z), { timeoutMs: 20000 });
        await this.actions.dig(bot, task, exit.door.offset(0, 1, 0), { requireDrops: false });
        await this.actions.dig(bot, task, exit.door, { requireDrops: false });
      }
      const o = pos(refuge.origin);
      await this.approachRefuge(task, goal, refuge, new goals.GoalBlock(o.x, o.y, o.z));
    }
    if (shelter.materialStock(bot) < shelter.missingShell(bot, refuge).length) return;
    this.report(goal, save, { action: 'seal_shelter', origin: refuge.origin });
    const threat = immediateThreat(bot);
    const blocks = shelter.missingShell(bot, refuge).sort((a, b) => {
      // Finish a full-height wall on the threat-facing side first. Roof comes
      // last so every placement has a solid adjacent anchor.
      const rank = p => p.y < refuge.origin.y
        ? -1000 + Math.abs(p.x - refuge.origin.x) + Math.abs(p.z - refuge.origin.z)
        : (p.y === refuge.origin.y + 2 ? 1000 : 0) +
          (threat ? Math.hypot(p.x - threat.entity.position.x, p.z - threat.entity.position.z) * 10 : 0) + p.y - refuge.origin.y;
      return rank(a) - rank(b);
    });
    // Twenty seconds for the pass: trial 75 stood fifty-three seconds in one
    // on a hillside by a flooded shaft, a block now and then, never sealed,
    // and the audit failed it. A pass that runs out ends, and the place is
    // set aside for a minute so the next answer is another one.
    const passEnds = Date.now() + 20000;
    for (const [i, p] of blocks.entries()) {
      task.check(); checkAir(bot);
      // A creeper that would reach the pocket and go off before the last
      // block: the build stops and the mobs are answered. Checked when the
      // pass began only, mid-226-c went on walling itself in at night for
      // five seconds while one walked up, and one blast took it from twenty
      // (2026-09-26).
      if (creeperRace(bot, blocks.length - i)) {
        this.report(goal, save, { action: 'seal_failed', at: { ...refuge.origin }, error: 'a creeper coming on would go off before the pocket closed' }); save();
        return;
      }
      if (Date.now() > passEnds) {
        setAside(this, 'seal_here', `${pos(refuge.origin)}`, 'the pocket took more than twenty seconds to seal', 60000);
        this.report(goal, save, { action: 'seal_failed', at: { ...refuge.origin }, error: 'twenty seconds and not sealed' }); save();
        return;
      }
      const material = bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name))?.name;
      if (!material) throw new Error('Shelter material inventory changed before sealing');
      // Snow/vegetation is being cleared to seal a room, not harvested. A
      // shovel must not become a prerequisite for emergency shelter.
      if (!['air', 'cave_air', 'void_air'].includes(bot.blockAt(p)?.name)) await this.actions.dig(bot, task, p, { requireDrops: false });
      try { await this.actions.place(bot, task, p, material); }
      catch (err) {
        task.check();
        // Reaching a placement can spend the selected block as scaffolding.
        // Other shelter blocks may still be available: reobserve the shell
        // and choose from current inventory on the next bounded step.
        if (err.name === 'Blocked' && !bot.inventory.items().some(i => i.name === material && i.count > 0) && shelter.materialStock(bot) > 0) {
          save(); return;
        }
        throw err;
      }
      save();
    }
    if (!shelter.inside(bot, refuge) || !shelter.sealed(bot, refuge)) throw new Error('Shelter verification failed');
    refuge.verifiedAt = new Date().toISOString();
    this.report(goal, save, { action: 'sheltered', origin: refuge.origin, health: bot.health });
  }

  async approachRefuge(task, goal, refuge, destination) {
    const bot = this.bot, movement = bot.pathfinder?.movements;
    const previous = movement?.exclusionAreasBreak;
    // Selecting a still-empty surface site must not forbid excavating the
    // natural approach beneath it. That reservation used to invalidate the
    // very route which had just selected the site from an underground start.
    // Existing/partial walls and every other construction remain protected.
    if (emptySite(bot, refuge) && movement && bot._constructionProtection) {
      const approaching = { ...goal, survival: { ...this.state, shelters: this.state.shelters.filter(s => s !== refuge) } };
      movement.exclusionAreasBreak = (previous || []).filter(rule => rule !== bot._constructionProtection);
      movement.exclusionAreasBreak.push(block => reservedForConstruction(approaching, block.position) ? 100 : 0);
    }
    try { await this.actions.navigate(bot, task, destination, { timeoutMs: 20000 }); }
    finally { if (movement) movement.exclusionAreasBreak = previous; }
  }

  // Shot at with no way out: build the whole shell where the bot stands and
  // register it as tonight's pocket, so the next loop sees a sealed shelter
  // and waits inside until nothing is watching, instead of digging straight
  // back out into the arrows. The eighth death was exactly that.
  async sealHere(task, goal, save, danger) {
    const bot = this.bot;
    if (shelter.materialStock(bot) < 12) return this.digIn(task, goal, save, danger);
    const origin = bot.entity.position.floored();
    if (isSetAside(this, 'seal_here', `${origin}`)) return false;
    let refuge = this.state.shelters.find(s => s.origin.x === origin.x && s.origin.y === origin.y && s.origin.z === origin.z && s.dimension === bot.game.dimension);
    if (!refuge) { refuge = { origin: { ...origin }, dimension: bot.game.dimension, createdAt: new Date().toISOString(), emergency: true }; this.state.shelters.push(refuge); save(); }
    // Not with a creeper at arm's length and more of the pocket to build
    // than its fuse allows: about a second and a half from lighting, a block
    // every 0.6 s. mid-79-g began a twenty-block pocket with two creepers
    // close and was blown up from twenty health (2026-09-26); the backing
    // off and the dance are the answers to a creeper that near.
    if (creeperRace(bot, shelter.missingShell(bot, refuge).length)) return false;
    this.report(goal, save, { action: 'dig_in', threats: danger.map(t => t.entity.name), cells: shelter.missingShell(bot, refuge).length });
    // The nearest cells first: the ones a mob could step into.
    const material = () => bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name))?.name;
    // The side over a drop first, lowest first: a hit while the pocket goes
    // up throws the bot a block, and mid-242-e, sealing beside a hole with
    // zombies at arm's length, was knocked twenty-two blocks down before
    // that side was walled (2026-09-27).
    const { dropAt } = require('./terrain');
    const feetY = bot.entity.position.floored().y;
    const overDrop = c => dropAt(bot, new Vec3(c.x, feetY, c.z));
    const cells = shelter.missingShell(bot, refuge).sort((a, b) => (overDrop(b) - overDrop(a)) || (overDrop(a) && a.y - b.y) || a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    // Beside a drop the bot does not move to place: what it can reach from
    // where it stands, and nothing else (place's `stay`).
    const stay = dropWithin(bot, origin, 2);
    // Three placements that fail in a row end the pass: trial 53 spent fifty
    // seconds in one, each block of the shell failing slowly and silently.
    let failedInRow = 0;
    const passEnds = Date.now() + 20000;
    for (const p of cells) {
      task.check();
      if (Date.now() > passEnds) { this.report(goal, save, { action: 'seal_failed', at: { ...origin }, error: 'twenty seconds and not sealed' }); break; }
      const name = material(); if (!name) break;
      if (danger.some(t => t.entity.position.floored().equals(p))) continue;
      try { await this.actions.place(bot, task, p, name, { stay }); failedInRow = 0; }
      catch (err) {
        task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err;
        this.state.lastSealError = err.message;
        if (++failedInRow >= 3) { this.report(goal, save, { action: 'seal_failed', at: { ...origin }, error: err.message.slice(0, 160) }); break; }
      }
    }
    if (shelter.inside(bot, refuge) && shelter.sealed(bot, refuge)) { refuge.verifiedAt = new Date().toISOString(); save(); return true; }
    // A pass that closed nothing is not a pocket: saying it was sent the
    // caller straight back here, fourteen times a second, all evening.
    // Nor is one with nothing to close and the bot still not sealed in: trial
    // 38 stood ninety-eight seconds at a shell with no missing cells, told
    // "sealed" twenty times a second, and the audit failed it.
    if (shelter.missingShell(bot, refuge).length >= cells.length) {
      setAside(this, 'seal_here', `${origin}`, cells.length ? `${cells.length} cells of the shell would not take a block` : 'the shell is whole and the bot is not sealed in it', 60000); save();
      return false;
    }
    return true;
  }

  // Straight down to a pocket walled in rock, then one block over the head.
  // The dream run came back from the Nether onto a sand island in the sea
  // at dusk with one netherrack: no site for a shelter, no blocks to build
  // one, and a staircase toward ore ran out under the water every time.
  // Down the column the bot stands on, while every cell dug and every wall
  // beside it is dry, until the two cells it stands in are walled by solid
  // blocks (sand is not: it falls), twelve blocks at most.
  async shaftPocket(task, goal, save) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function' || typeof this.actions.dig !== 'function') return false;
    const column = this.shaftColumn(), spot = column.spot, here = bot.entity.position.floored();
    if (column.resting) return false;
    const { start = null, bottom = null } = column;
    if (!bottom) { setAside(this, 'shaft_pocket', spot, 'no dry rock straight down within four blocks', 600000); return false; }
    return this.digShaft(task, goal, save, { start, bottom, spot, here });
  }

  // The dry column a shaft pocket would go down, found without digging:
  // { start, bottom } or { none: why }. Asked when the shelter question is
  // built too, so the shaft is offered with the depth found or the reason
  // there is none (the decision audit, 2026-09-25).
  shaftColumn({ radius = 4 } = {}) {
    const bot = this.bot;
    // No pickaxe (respawned with nothing, at night, beside the mobs that
    // killed it: the clean run died there a second time gathering dirt for
    // a shelter): the shaft still goes down where every block in it digs by
    // hand in a second, dirt and the like, and the dug dirt is the cap.
    const pick = bot.inventory.items().some(i => /_pickaxe$/.test(i.name));
    const handSoft = b => !!b && (typeof b.digTime === 'function' ? b.digTime(null, false, false, false, [], {}) <= 1000 : /^(dirt|grass_block|podzol|mycelium|coarse_dirt|rooted_dirt|mud|clay|moss_block)$/.test(b.name));
    // Set aside by the column stood on, not for the whole world.
    const spot = `${bot.entity.position.floored().x},${bot.entity.position.floored().z}`;
    if (isSetAside(this, 'shaft_pocket', spot)) return { none: 'a shaft failed on this spot a short while ago', resting: true, spot };
    const wet = c => /water|lava/.test(bot.blockAt(c)?.name || '');
    const sides = c => [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)].map(d => c.plus(d));
    // The shelter's own test, but for the one cell over the head, which the
    // shaft opens and the cap closes.
    const walled = feet => shelter.missingShell(bot, { origin: feet }).every(p => p.equals(feet.offset(0, 2, 0)));
    // Look before digging: the whole column must be dry, or none of it is
    // dug. The bottom of the first column that works, or null.
    const columnBottom = top => {
      const first = top.offset(0, -1, 0);
      if (!bot.blockAt(first) || bot.blockAt(first).boundingBox !== 'block' || wet(first) || sides(first).some(wet)) return null;
      if (!pick && !handSoft(bot.blockAt(first))) return null;
      for (let depth = 2; depth <= 12; depth++) {
        const cell = top.offset(0, -depth, 0);
        const b = bot.blockAt(cell), under = bot.blockAt(cell.offset(0, -1, 0));
        if (!b || !under || b.name === 'bedrock' || wet(cell) || wet(cell.offset(0, -1, 0)) || /lava|magma/.test(under.name)) return null;
        if (!pick && b.boundingBox === 'block' && !handSoft(b)) return null;
        if (sides(cell).some(wet) || sides(cell.offset(0, 1, 0)).some(wet)) return null;
        if (walled(cell)) return cell;
      }
      return null;
    };
    // The column underfoot, or the nearest one within four blocks on the
    // same ground: on the island's edge the first block down had the sea
    // beside it, and the middle of the island did not.
    const here = bot.entity.position.floored();
    const columns = [here];
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) if (dx || dz) columns.push(here.offset(dx, 0, dz));
    columns.sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
    for (const top of columns) {
      if (!shelter.replaceable(bot.blockAt(top)) || !shelter.replaceable(bot.blockAt(top.offset(0, 1, 0)))) continue;
      const found = columnBottom(top);
      if (found) return { start: top, bottom: found, spot };
    }
    return { none: `no dry column here: every one within four blocks meets water, lava or bedrock${pick ? '' : ', or rock too hard to dig by hand,'} before it is walled in, twelve blocks down at most`, spot };
  }

  async digShaft(task, goal, save, { start, bottom, spot, here }) {
    const bot = this.bot;
    if (!start.equals(here)) {
      try { await this.actions.navigate(bot, task, new goals.GoalBlock(start.x, start.y, start.z), { timeoutMs: 8000, stallMs: 3000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      if (!bot.entity.position.floored().equals(start)) { setAside(this, 'shaft_pocket', spot, 'could not stand on the dry column', 120000); return false; }
    }
    // A creeper that reaches the open shaft before the cap follows the bot
    // into it: counted as the seal counts it, before every block (note 226).
    // mid-231-g dug down with one eight blocks off; it came down on top of
    // the bot five blocks down and went off, twelve health to none
    // (2026-09-27).
    // Priced as the dig it is: each block's dig with the tool it takes and
    // the drop into its cell, and the cap, not as blocks placed.
    const digSecs = c => { const b = bot.blockAt(c); if (!b || b.boundingBox !== 'block') return 0; if (typeof b.digTime !== 'function') return 1.3; const tool = require('./skills').cheapestTool(bot, b); return b.digTime(tool?.type ?? null, false, false, false, [], {}) / 1000 + 0.3; };
    const racing = y => { let secs = BLOCK_SECONDS; for (let yy = y; yy >= bottom.y; yy--) secs += digSecs(new Vec3(start.x, yy, start.z)); return creeperRace(bot, secs / BLOCK_SECONDS); };
    // Nor with a biter at arm's length: it follows the bot down the open
    // shaft. mid-229-e dug on for ten seconds with two zombies in the shaft
    // with it, a hit a second, eighteen health to five (2026-09-27).
    const biting = () => threats(bot, 4).some(t => t.distance <= 3 && !shooter(t.entity) && t.entity.name !== 'creeper');
    const raced = (why = 'a creeper would reach the open shaft before the cap') => { setAside(this, 'shaft_pocket', spot, why, 30000); save(); return false; };
    if (biting()) return raced('a mob at arm\'s length would follow the bot down the open shaft');
    if (racing(start.y - 1)) return raced();
    this.report(goal, save, { action: 'shaft_pocket', from: { ...start }, to: { ...bottom } });
    for (let y = start.y - 1; y >= bottom.y; y--) {
      task.check(); checkAir(bot);
      if (racing(y)) return raced();
      if (biting()) return raced('a mob at arm\'s length would follow the bot down the open shaft');
      const c = new Vec3(start.x, y, start.z);
      if (bot.blockAt(c)?.boundingBox === 'block') await this.actions.dig(bot, task, c, { requireDrops: false, dropInto: true });
      for (let i = 0; i < 20 && bot.entity.position.y > y + 0.1; i++) { task.check(); await sleep(50); }
    }
    // One block over the head: whatever solid block the pockets hold now,
    // cobblestone from the dig among them. Sand or gravel would fall on it.
    const roof = bottom.offset(0, 2, 0);
    const cap = bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name));
    if (!cap) { setAside(this, 'shaft_pocket', spot, 'nothing solid to close the shaft with', 600000); return false; }
    if (!shelter.solid(bot.blockAt(roof))) {
      try { await this.actions.place(bot, task, roof, cap.name); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    if (!shelter.solid(bot.blockAt(roof))) { setAside(this, 'shaft_pocket', spot, 'the cap would not go on', 600000); return false; }
    const refuge = { origin: { ...bottom }, dimension: bot.game.dimension, createdAt: new Date().toISOString(), emergency: true, shaft: true };
    if (shelter.inside(bot, refuge) && shelter.sealed(bot, refuge)) refuge.verifiedAt = new Date().toISOString();
    this.state.shelters.push(refuge); save();
    return true;
  }

  // The ladder's next item, when it can be made from the pockets by smelting
  // and crafting alone.
  benchWork(goal) {
    if (typeof this.actions.planFor !== 'function' || typeof this.actions.acquireStep !== 'function') return null;
    let stage;
    try { stage = require('./game-progress').nextGameStage(this.bot, goal); } catch (_) { return null; }
    if (!stage || !['acquire', 'acquire_set'].includes(stage.action)) return null;
    const items = stage.items || (stage.item ? [stage.item] : []);
    for (const item of items) {
      const count = stage.action === 'acquire_set' ? 1 : (stage.count || 1);
      let plan;
      try { plan = this.actions.planFor(this.bot, item, count, goal); } catch (_) { continue; }
      if (plan?.length && plan.every(st => st.action === 'smelt' || st.action === 'craft')) return { item, count, plan };
    }
    return null;
  }

  // Chosen by Jev, the creeper, health and the other mobs about were its to
  // weigh; reach, a blade and digging are what make it possible.
  async openOnWatcher(task, goal, save, refuge, watcher, { chosen = false } = {}) {
    const bot = this.bot;
    if (watcher.distance > 4.5 || typeof this.actions.dig !== 'function') return false;
    if (!/_(sword|axe)$/.test(defenseWeapon(bot)?.name || '')) return false;
    if (!chosen && (watcher.entity.name === 'creeper' || (bot.health ?? 20) < 16 || threats(bot, 16).filter(t => t.entity !== watcher.entity).length > 1)) return false;
    const feet = bot.entity.position.floored(), at = watcher.entity.position;
    const dx = at.x - (feet.x + 0.5), dz = at.z - (feet.z + 0.5);
    const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
    const cells = [feet.plus(step).offset(0, 1, 0), feet.plus(step)].filter(c => bot.blockAt(c)?.boundingBox === 'block' && bot.blockAt(c).diggable);
    if (!cells.length) return false;
    this.report(goal, save, { action: 'open_on_watcher', target: watcher.entity.name, distance: Number(watcher.distance.toFixed(1)), health: bot.health });
    for (const c of cells) {
      try { await this.actions.dig(bot, task, c, { requireDrops: false }); }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
    }
    return true;
  }

  async digIn(task, goal, save, danger) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function') return false;
    const material = bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name) && i.count >= 4)?.name;
    if (!material) return false;
    const feet = bot.entity.position.floored();
    const cells = [];
    for (const d of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) for (const dy of [0, 1]) {
      const p = feet.plus(d).offset(0, dy, 0);
      if (shelter.replaceable(bot.blockAt(p)) && !danger.some(t => t.entity.position.floored().equals(p))) cells.push(p);
    }
    if (shelter.replaceable(bot.blockAt(feet.offset(0, 2, 0)))) cells.push(feet.offset(0, 2, 0));
    if (!cells.length || creeperRace(bot, cells.length)) return false;
    this.report(goal, save, { action: 'dig_in', threats: danger.map(t => t.entity.name), cells: cells.length });
    let placed = 0;
    const stay = dropWithin(bot, feet, 2);
    for (const p of cells) {
      task.check();
      try { await this.actions.place(bot, task, p, material, { stay }); placed++; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; }
    }
    return placed > 0;
  }

  // One mob, closed on so the fight rule can swing. Out of the sword's reach
  // is the test, not "beyond 3.2": between the two the bot neither swung
  // nor charged.
  // Chosen by Jev (the fight stance), health and the pack were its to weigh.
  async charge(task, goal, save, nearest, pack, { chosen = false } = {}) {
    const bot = this.bot;
    if ((!chosen && (pack || bot.health < 12)) || nearest.distance > 8 || canStrike(bot, nearest.entity) || lavaBeside(bot, nearest.entity.position.floored())) return false;
    // Never at a creeper: a run at one ends beside it as its fuse lights,
    // and a creeper is struck where it comes (the dance). mid-242-e's fight,
    // held, ran at the nearest mob, a creeper eight blocks off, twice: twenty
    // to one, and then from seven to dead (2026-09-27).
    if (nearest.entity.name === 'creeper') return false;
    // Level ground only, and not from an edge: charging a wither skeleton
    // four blocks up a Nether fortress, the dream run's floor went from
    // under it and it fell thirty blocks (2026-09-24 01:39). The charge
    // neither digs, towers nor drops more than two on its way.
    const feet = bot.entity.position.floored(), t = nearest.entity.position;
    if (Math.abs(t.y - bot.entity.position.y) > 2 || besideDrop(bot, feet)) return false;
    this.report(goal, save, { action: 'charge', target: nearest.entity.name, distance: Number(nearest.distance.toFixed(1)) });
    const movements = bot.pathfinder?.movements;
    const kept = movements && { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, maxDropDown: movements.maxDropDown };
    if (movements) Object.assign(movements, { canDig: false, allow1by1towers: false, maxDropDown: Math.min(2, movements.maxDropDown ?? 2) });
    const from = bot.entity.position.clone();
    let failed = false;
    try { await this.actions.navigate(bot, task, new goals.GoalNear(t.x, t.y, t.z, 1), { timeoutMs: 4000, stallMs: 2000 }); }
    catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; failed = true; }
    finally { if (movements) Object.assign(movements, kept); }
    // A charge that went nowhere is not a charge: trial 66 "went for" a
    // zombie in a mineshaft twenty times a second for two and a half
    // minutes, the way to it failing at once each time, neither of them
    // able to reach the other. The mob is out of reach for twenty seconds
    // (danger.js), and the caller takes its next answer.
    // How the run went, said with the next question: mid-230-b ran at a
    // witch three times, each run ending as far off as it began, and was
    // offered the fight each time priced as if the witch stood still to be
    // struck; its potions took twenty health (2026-09-26).
    const after = nearest.entity.position?.distanceTo?.(bot.entity.position);
    if (Number.isFinite(after)) (bot._charges ||= {})[nearest.entity.id] = { at: Date.now(), from: nearest.distance, to: after, name: nearest.entity.name };
    if (failed && bot.entity.position.distanceTo(from) < 1 && !canStrike(bot, nearest.entity)) {
      bot._unreachable = { ids: [...new Set([...(bot._unreachable?.until > Date.now() ? bot._unreachable.ids : []), nearest.entity.id])], until: Date.now() + 20000 };
      return false;
    }
    await defendNearby(bot, task, goal, save);
    return true;
  }

  async wallOff(task, goal, save, danger) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function') return false;
    const material = bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name) && i.count >= 2)?.name;
    if (!material) return false;
    const feet = bot.entity.position.floored();
    const walls = [];
    for (const t of danger) {
      if (t.distance > 6) continue;
      const dx = t.entity.position.x - bot.entity.position.x, dz = t.entity.position.z - bot.entity.position.z;
      const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
      if (!step.x && !step.z) continue;
      const cell = feet.plus(step);
      if (walls.some(w => w.equals(cell))) continue;
      // Empty cell, and the mob not standing in it.
      if (![cell, cell.offset(0, 1, 0)].every(p => shelter.replaceable(bot.blockAt(p)))) continue;
      if (t.entity.position.floored().equals(cell) || t.entity.position.distanceTo(cell.offset(0.5, 0, 0.5)) < 0.9) continue;
      walls.push(cell);
    }
    if (!walls.length) return false;
    this.report(goal, save, { action: 'wall_off', threats: danger.map(t => t.entity.name), cells: walls.map(p => ({ ...p })) });
    for (const cell of walls) {
      for (const p of [cell, cell.offset(0, 1, 0)]) {
        task.check();
        try { await this.actions.place(bot, task, p, material); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; return walls.length > 0 && p !== cell; }
      }
    }
    return true;
  }

  async leave(task, goal, save, refuge, reason, { past = false } = {}) {
    const bot = this.bot;
    // "Morning. Back to it." only when it is morning; a shelter left at
    // night for the bed, or with mobs outwaited, says so.
    reason ||= shelterNeeded(bot) ? 'Moving on.' : undefined;
    // Mobs that can see in, or are at the wall; the rest are behind rock.
    // Not the quarry, for a bot fit to fight it: the exit had to be twenty
    // blocks from every blaze, beside a spawner that is never true, so the
    // bot decided to leave and then refused every door for twenty minutes.
    // Going out for the mobs (a hunt) or past them (to the chest): no exit
    // is refused for them.
    // Going past them, the door farthest from them: mid-110-n chose to leave
    // its pocket past a zombie and a skeleton fifteen times, and was held
    // behind the lid for twenty minutes because every door was within
    // twenty blocks of one (2026-09-26).
    const near = threats(bot).filter(t => (t.visible || t.distance < 6) && !claimed(bot, t.entity));
    // Past them, but never out beside a creeper: mid-72-g, chosen to leave
    // with one three blocks off behind the wall, opened the pocket on it
    // and was blown up from twenty health (2026-09-26). A door within six
    // blocks of a creeper stays shut, and the pocket waits as before.
    const creepers = threats(bot, 16).filter(t => t.entity.name === 'creeper');
    const danger = past ? creepers.map(t => ({ ...t, reach: 6 })) : near;
    const clearance = p => Math.min(Infinity, ...near.map(t => t.entity.position.distanceTo(p)));
    const farthest = list => past ? [...list].sort((a, b) => clearance(b.outside || b) - clearance(a.outside || a)) : list;
    const formal = farthest(shelter.exits(bot, refuge).filter(exit => danger.every(t => t.entity.position.distanceTo(exit.outside) > (t.reach ?? 20))));
    // A pocket sealed in a staircase has no two-block exit: its door is the
    // closure the bot placed, and the way on is dug from there.
    const pocket = !formal.length && farthest(shelter.closures(bot, refuge).filter(door => danger.every(t => t.entity.position.distanceTo(door) > (t.reach ?? 20))));
    const exit = formal[0] || (pocket.length ? { door: pocket[0], outside: null } : null);
    if (!exit) { await this.wait(task, goal, save, 'Nearby threats still block the shelter exits'); return; }
    this.report(goal, save, { action: 'leave_shelter', origin: refuge.origin, reason });
    // Opening our temporary closure is necessary even if the last pick broke.
    // Bare-handed stone clearing loses its drop but must not imprison the bot
    // inside a one-cell shelter with no room to place a crafting table.
    // A pocket is one night's stop, not a home: every closure comes down so
    // the staircase continues in both directions, and the pocket is
    // forgotten so its shell no longer stands reserved against the climb.
    const doors = exit.outside ? [exit.door] : pocket;
    for (const door of doors) {
      await this.actions.dig(bot, task, door.offset(0, 1, 0), { requireDrops: false });
      await this.actions.dig(bot, task, door, { requireDrops: false });
    }
    // Any dug-in shelter is one night's stop: left behind, it is forgotten,
    // so its shell no longer stands reserved against the next staircase.
    // Only a house persists. The bot bounced between the two floor cells of
    // a pocket it had just left, every other cell around it reserved.
    if (refuge.kind !== 'house') { this.state.shelters = this.state.shelters.filter(s => s !== refuge); save(); }
    // At the base, the whole pocket comes down in the morning. One left
    // standing beside the bed put a block on the bed and one on the stash
    // chest and walled the path to the wheat: no sleep, no food from the
    // chest, no harvest, and a bot with nothing left to try.
    const home = homeOf(bot, goal);
    if (refuge.kind !== 'house' && !shelterNeeded(bot) && home?.origin && home.dimension === bot.game.dimension &&
        pos(refuge.origin).distanceTo(pos(home.origin)) <= 12) {
      const placed = shelter.shell(refuge.origin).filter(p => POCKET_BLOCKS.has(bot.blockAt(p)?.name));
      if (placed.length) this.report(goal, save, { action: 'clear_pocket_at_base', cells: placed.length });
      for (const p of placed) { try { await this.actions.dig(bot, task, p, { requireDrops: false }); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; } }
    }
    if (exit.outside) await this.actions.navigate(bot, task, new goals.GoalBlock(exit.outside.x, exit.outside.y, exit.outside.z), { timeoutMs: 10000 });
  }

  // One Jev decision over a tree the code built: the question is defined in
  // decisions/survival.js and asked the one way every question is.
  decide(task, goal, save, { id, state, tree, context, isFresh = () => true, interrupt = () => {} }) {
    return decide(id, { client: this.client, bot: this.bot, task, goal, save, tree, state, context, isFresh, interrupt });
  }

  // The carried bed goes down where the night caught us and comes back up
  // at dawn. A sleep the server refuses (a mob within eight blocks, another
  // survival player awake) hands the night to the shelter path instead.
  // With `site` (a bed nook, dug), the carried bed goes there.
  async sleepStep(task, goal, save, { site: nook = null } = {}) {
    const bot = this.bot, item = bedCarried(bot), placed = nook ? null : bedToSleepIn(bot, goal), site = nook || placed || (item && bedSite(bot));
    if (!site) throw new Error('No level ground beside me for the bed');
    if (nook && !item) throw new Error('No bed carried for the nook');
    this.report(goal, save, { action: 'sleep', at: { ...site.foot }, home: !!placed });
    if (placed) {
      // A walk that fails is a route problem, not a bed problem: the shelter
      // path takes this night's next two minutes, and the bed stays in play.
      // The stand cell first (it is laid out to be reachable), then two and
      // three blocks from the foot: a single goal failed from twenty blocks.
      const approaches = [[site.stand, 1], [site.foot, 2], [site.foot, 3]];
      let reached = false, lastError = null;
      // Watching on the way: hurt, or a mob in view close by, and the walk
      // stops so the next tick's threat rules have the bot, not the bed.
      const setOut = bot.health ?? 20;
      const trouble = () => (bot.health ?? 20) <= setOut - 3 || threats(bot, 6).some(t => t.visible);
      for (const [p, range] of approaches) {
        try { await this.actions.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, range), { timeoutMs: 45000, stallMs: 8000, stopWhen: trouble }); reached = site.foot.distanceTo(bot.entity.position) <= 3.5; }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; lastError = err; }
        if (!reached && trouble()) { this.report(goal, save, { action: 'sleep_interrupted', health: bot.health }); throw new Error('Trouble on the way to bed'); }
        if (reached) break;
      }
      if (!reached) { setAside(this, 'bed_route', 'home', lastError || 'not close enough', 120000); this.report(goal, save, { action: 'sleep_failed', reason: `no way to the bed: ${lastError?.message || 'not close enough'}` }); throw lastError || new Error('No way to the bed'); }
      if (!isBed(bot.blockAt(site.foot))) throw new Error(site.observed ? 'The bed I saw is gone' : 'The bed at the base is not where it was left');
      // A bed needs air above it. A night shelter built around the bed put
      // a block on top of it, and every sleep after that was refused as
      // obstructed while the bot waited in the dark beside it. The cell
      // above each half is cleared first; a roof one higher still covers.
      await clearAboveBed(bot, task, this.actions, site);
    }
    else await placeOriented(bot, task, this.actions, site.stand, site.foot, item, () => isBed(bot.blockAt(site.foot)) && isBed(bot.blockAt(site.head)));
    let slept = false;
    try {
      // The server confirms the sleep a moment after the click, and refuses
      // it with a message. The first bedtime read the flag before either
      // arrived and built a shelter beside the bed.
      let refused = null;
      const onMessage = message => { const key = message?.json?.translate || message?.translate || String(message || ''); if (/bed\.(not_safe|too_far_away|obstructed|occupied|no_sleep)/.test(key)) refused = key; };
      bot.on?.('message', onMessage);
      try {
        const before = bot.time?.timeOfDay;
        // Mineflayer gives up after three seconds without its sleep event and
        // throws "bot is not sleeping". That threw past the clock check below
        // and past any refusal the server sent, so a night was written off as
        // a failed sleep, unexplained, and the bot stood by its bed until
        // dawn. Its own checks (not night, monsters near) are real refusals.
        try { await bot.sleep(bot.blockAt(site.foot)); }
        catch (err) { if (!/not sleeping/.test(err.message)) throw err; }
        // The ground truth is the clock: with the only survival player in
        // bed the server jumps to morning within a hundred ticks. The
        // sleeping flag is a hint, and a refusal is only final once the
        // clock has had its chance.
        const started = Date.now(), jumped = () => !sleepable(bot) || bot.time?.timeOfDay < before;
        while (Date.now() - started < 15000 && !jumped() && !(refused && Date.now() - started > 6000)) { task.check(); await sleep(200); }
        slept = jumped();
        if (bot.isSleeping) { try { await bot.wake(); } catch (_) {} }
        if (!slept && refused) throw new Error(`The server refused the sleep: ${refused}`);
        if (!slept) throw new Error('The night did not pass in bed');
      } finally { bot.removeListener?.('message', onMessage); }
    } catch (err) {
      task.check();
      // A refusal the server named (monsters near, not safe) waits out ten
      // minutes; a sleep that simply did not take is tried again in two.
      setAside(this, 'sleep', 'bed', err, /refused|monsters|not night|can only sleep/i.test(err.message) ? 600000 : 120000);
      this.state.lastSleepError = err.message; this.report(goal, save, { action: 'sleep_failed', reason: err.message });
    }
    finally {
      // The carried bed comes back up; the base's bed stays where it is.
      if (!placed) {
        for (const p of [site.foot, site.head]) if (isBed(bot.blockAt(p))) { try { await this.actions.dig(bot, task, p, { requireDrops: false }); } catch (_) { task.check(); } }
        await sleep(800);
        if (!bedCarried(bot)) { try { await this.actions.navigate(bot, task, new goals.GoalNear(site.foot.x, site.foot.y, site.foot.z, 0.5), { timeoutMs: 4000, stallMs: 2000 }); await sleep(600); } catch (_) { task.check(); } }
      }
      save();
    }
    if (!slept) throw new Error(this.state.lastSleepError || 'The night did not pass in bed');
    attemptsFor(this).clear('sleep', 'bed'); delete this.state.nightPlan;
    this.state.sleptAtAge = worldAge(bot);
    // A night in the home's bed sets the respawn point there; a carried bed
    // is picked up again, and the respawn goes back to the world's spawn.
    this.state.respawn = placed ? { x: site.foot.x, y: site.foot.y, z: site.foot.z, dimension: 'overworld' } : null;
    this.report(goal, save, { action: 'leave_shelter', reason: 'Morning. Back to it.' });
  }

  // The carried bed where no level cells lie beside the feet: a nook dug
  // for it (bedNook), the bed put in and slept in, and picked back up by
  // sleepStep as ever. From a sealed pocket the cells dug out of its wall go
  // back in after, whether the night passed or the sleep was refused, so
  // the pocket is shut again and the morning leaves it the usual way. A
  // nook that would not open rests three minutes.
  async nookSleep(task, goal, save, { pocket = null } = {}) {
    const bot = this.bot;
    if (!bedCarried(bot)) throw new Error('No bed carried for the nook');
    const nook = bedNook(bot, goal, { sealed: !!pocket });
    if (!nook) throw new Error('No room beside me for a bed nook');
    const wall = pocket ? nook.dig.filter(p => shelter.shell(pos(pocket.origin)).some(s => s.equals(p))) : [];
    this.report(goal, save, { action: 'bed_nook', at: { ...nook.foot }, dig: nook.dig.length, enclosed: nook.enclosed });
    try {
      for (const p of nook.dig) { task.check(); await this.actions.dig(bot, task, p, { requireDrops: false }); }
      const blocked = [nook.foot, nook.foot.offset(0, 1, 0), nook.head, nook.head.offset(0, 1, 0)].find(p => bot.blockAt(p)?.boundingBox !== 'empty');
      if (blocked) throw new Error(`The bed nook would not open at ${blocked}`);
      await this.sleepStep(task, goal, save, { site: nook });
    } catch (err) {
      task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      // A refused sleep is already waited out (sleepStep); anything else
      // that failed here rests the nook, so it is not offered again at once.
      if (!sleepWaiting(this)) { setAside(this, 'bed_nook', 'here', err, 180000); save(); }
      throw err;
    } finally {
      if (wall.length) await this.closeNook(task, nook, wall);
    }
  }

  // The pocket's wall put back where the nook was dug out of it.
  async closeNook(task, nook, wall) {
    const bot = this.bot;
    try {
      if (!bot.entity.position.floored().equals(nook.stand)) await this.actions.navigate(bot, task, new goals.GoalBlock(nook.stand.x, nook.stand.y, nook.stand.z), { timeoutMs: 8000, stallMs: 3000 });
      for (const p of [...wall].sort((a, b) => a.y - b.y)) {
        if (bot.blockAt(p)?.boundingBox !== 'empty' || isBed(bot.blockAt(p))) continue;
        const material = bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name))?.name;
        if (!material) break;
        await this.actions.place(bot, task, p, material);
      }
    } catch (err) { if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
  }

  // Ticks awake since the last sleep, counted from the first time the bot
  // looked if it has never slept. Two in-game days is the limit.
  // The night's hunt: one option for each kind of mob about whose drops are
  // worth something, with what it drops, what that is for, what one costs
  // to kill with this weapon and armour, and what a death would drop. Jev's
  // to weigh against a pocket, a mine or the bed.
  huntOptions(goal) {
    const bot = this.bot;
    if (bot.game?.dimension !== 'overworld' && !/overworld/.test(String(bot.game?.dimension || ''))) return {};
    const { MOB_DROPS } = require('./mob-drops');
    const here = bot.entity.position;
    const kinds = new Map();
    for (const e of Object.values(bot.entities || {})) {
      if (!MOB_DROPS[e.name] || e.isValid === false || !e.position) continue;
      const distance = e.position.distanceTo(here);
      if (distance > 32 || isSetAside(this, 'night_hunt', e.name)) continue;
      const kind = kinds.get(e.name) || { count: 0, nearest: null };
      kind.count++;
      if (!kind.nearest || distance < kind.nearest.distance) kind.nearest = { entity: e, distance };
      kinds.set(e.name, kind);
    }
    const weapon = defenseWeapon(bot)?.name || null, armour = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
    const risk = this.atRisk(goal);
    const options = {};
    for (const [name, kind] of kinds) {
      const drops = MOB_DROPS[name], label = name.replaceAll('_', ' ');
      const one = fightEstimate({ threats: [{ name, distance: kind.nearest.distance, shoots: shooter(kind.nearest.entity), ...(kind.nearest.entity.heldItem?.name ? { held: kind.nearest.entity.heldItem.name } : {}), visible: true }], armour, weapon, health: bot.health, shield: bot.inventory?.slots?.[45]?.name === 'shield' }).fightHere;
      // What else is out there, where it is, and whether health comes back
      // (the decision audit, 2026-09-25): mid-110-c took the spider hunt
      // into a cave with a witch, three skeletons and three creepers, told
      // only "others met on the way fought as they come".
      const others = threats(bot, 32).filter(t => t.entity.name !== name);
      const crowd = others.length ? ` Also within thirty-two blocks: ${others.length} other hostile mob${others.length === 1 ? '' : 's'} (${[...new Set(others.map(t => t.entity.name.replaceAll('_', ' ')))].slice(0, 5).join(', ')}${others.some(t => t.entity.name === 'creeper') ? '; creepers among them' : ''}${others.some(t => shooter(t.entity)) ? '; shooters among them' : ''}).` : '';
      const dy = Math.round(kind.nearest.entity.position.y - here.y);
      const where = Math.abs(dy) >= 6 ? ` The nearest is ${Math.abs(dy)} blocks ${dy > 0 ? 'up' : 'down'}.` : '';
      const healing = (bot.food ?? 20) >= 18 ? '' : ` Health does not come back meanwhile: hunger ${bot.food}, below eighteen.`;
      const blast = name === 'creeper' ? ` Not counted there: its blast, ${require('./combat-estimate').creeperBlastSays(require('./combat-estimate').armourOf(armour))} after the armour worn.` : '';
      options[`hunt_${name}`] = {
        description: `Go out and hunt the ${label}${kind.count > 1 ? `s (${kind.count} within thirty-two blocks, nearest ${Math.round(kind.nearest.distance)})` : ` ${Math.round(kind.nearest.distance)} blocks off`} for two minutes, others met on the way fought as they come, and pick up what they drop: ${drops.drops} (${drops.for}), and experience. One ${label} with ${weapon ? `the ${weapon.replaceAll('_', ' ')}` : 'bare hands'}${armour.length ? ` and ${armour.length} piece${armour.length === 1 ? "" : "s"} of armour` : ' and no armour'}: about ${one.seconds} seconds and ${one.damageTaken} damage, from ${Math.round(bot.health)} health. ${risk}${blast}${crowd}${where}${healing}`,
        kind: name };
    }
    return options;
  }

  // What a death now would cost, for every choice that risks one: the gear
  // and valuables that would drop where the bot falls, the walk back to
  // them from where it would respawn before they vanish, and the levels.
  deathCost(goal) { return require('./risk').deathCost(this.bot, goal, this.state); }
  // The same, said in a sentence with an option.
  atRisk(goal) {
    const cost = this.deathCost(goal);
    const listed = [...cost.dropsWorn, ...cost.dropsGear, ...Object.entries(cost.dropsValuables).map(([n, c]) => `${c} ${n}`)].join(', ');
    return `A death drops everything carried where it happens${listed ? ` (${listed})` : ''}, ${cost.walkBackBlocks != null ? `${cost.walkBackBlocks} blocks from where the bot would respawn` : 'far from where the bot would respawn'}, and it vanishes in five minutes${cost.stashChestBlocks != null ? `; the stash chest is ${cost.stashChestBlocks} blocks off` : '; there is no stash chest'}.`;
  }

  // The valuables into the stash chest first, when there is one and
  // something worth putting in it.
  // Out of reach of home, a chest put down here instead (field-cache.js).
  cacheOption(goal) {
    const bot = this.bot;
    if (typeof this.actions.cacheHere !== 'function') return null;
    const offer = require('./field-cache').cacheOffer(bot, goal);
    if (!offer) return null;
    return { description: `Put ${offer.chest} down here and leave the valuables in it (${offer.what}): home's chest is out of reach, and a death tonight would drop them. They are taken back passing by.${require('./strategy').pickaxeLeft(bot, offer.spends)}`,
      run: async (task, goal, save) => { await this.actions.cacheHere(bot, task, goal, save, 'the night'); return true; } };
  }

  stashOption(goal) {
    const bot = this.bot;
    const stash = homeOf(bot, goal)?.stash?.position;
    if (!stash || typeof this.actions.stashTrip !== 'function' || isSetAside(this, 'night_stash', 'chest')) return null;
    const { VALUABLES } = require('./home-stash');
    const carried = bot.inventory.items().filter(i => Object.hasOwn(VALUABLES, i.name));
    if (!carried.length) return null;
    const far = Math.round(pos(stash).distanceTo(bot.entity.position));
    if (far > 128) return null;
    // The walk's time and the dark on the way (the decision audit,
    // 2026-09-25).
    const dark = require('./day').dark(bot) ? ' It is dark: mobs spawn along the way.' : '';
    return { description: `Walk ${far} blocks to the stash chest and put the valuables carried in it (${carried.map(i => `${i.count} ${i.name.replaceAll('_', ' ')}`).join(', ')}), so a death later tonight does not drop them. About ${Math.round(far / 4.3)} seconds each way at a walk.${dark}`,
      run: async (task, goal, save) => {
        try { await this.actions.stashTrip(bot, task, goal, save); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(this, 'night_stash', 'chest', err, 300000); }
        return true;
      } };
  }

  // A hunt for food Jev chose, carried out as the night hunt is (huntStep):
  // the nearest of the kind closed on and struck, its drops picked up, for
  // two minutes or six health. The Nether's hoglins (nether-travel.js):
  // mid-211-c, short of food 250 blocks from its portal, was never offered
  // them (note 241, 2026-09-26).
  foodHunt(goal, save, kind) {
    this.state.nightPlan = { plan: 'hunt', kind, food: true, until: Date.now() + 120000, startHealth: this.bot.health };
    this.report(goal, save, { action: 'food_hunt_chosen', kind });
  }

  // Food off the Overworld: back through the portal, or, in the Nether,
  // its hoglins, in view or seen earlier. The trip back is left out for the
  // time Jev chose to go on without it (nether-travel.js keep_on).
  offWorldFood(task, goal, save) {
    const bot = this.bot, children = {};
    if (!isSetAside(goal, 'nether_return', 'food')) children.return_for_food = { description: 'Go back through the portal to the Overworld, where food can be hunted and cooked.' + (/nether/.test(String(bot.game?.dimension || '')) ? ' In the Nether hoglins are the only meat.' : ' Nothing here is safe to eat.'),
      run: async () => { goal.survivalAction = { action: 'return_for_food', at: new Date().toISOString() }; save(); await this.actions.returnOverworld(bot, task, goal, save); } };
    if (/nether/.test(String(bot.game?.dimension || ''))) {
      const { hoglinsKnown, hoglinSays } = require('./nether-travel');
      const known = hoglinsKnown(bot, goal);
      if (known.inView.length || known.seen.length) children.hoglin_food = { description: hoglinSays(bot, known),
        run: async () => {
          if (!known.inView.length) await require('./sightings').walkToSighting(bot, task, goal, save, 'hoglin', known.seen[0], this.actions.navigate);
          this.foodHunt(goal, save, 'hoglin');
        } };
    }
    return children;
  }

  // One step of the night hunt Jev chose: the nearest of the kind, closed
  // on over level ground and struck; its drops picked up once it is down.
  // Two minutes, then Jev is asked again with the night as it is by then;
  // six health lost hands back sooner.
  async huntStep(task, goal, save) {
    const bot = this.bot, plan = this.state.nightPlan;
    const { MOB_DROPS } = require('./mob-drops');
    const drops = MOB_DROPS[plan.kind];
    const end = why => { this.report(goal, save, { action: 'hunt_over', kind: plan.kind, kills: plan.kills || 0, why }); delete this.state.nightPlan; delete bot._nightHunt; save(); return false; };
    if (!drops) return end('nothing known of it');
    if ((bot.health ?? 20) <= (plan.startHealth ?? 20) - 6) return end('six health lost');
    // The last one is down: what it dropped, before the next.
    const last = plan.targetId != null && bot.entities[plan.targetId];
    if (plan.targetId != null && (!last || last.isValid === false)) {
      plan.kills = (plan.kills || 0) + 1;
      const origin = plan.lastAt ? pos(plan.lastAt) : bot.entity.position.clone();
      delete plan.targetId;
      const { collectNearbyDrops } = require('./drop-collection');
      for (const item of drops.items) {
        try { await collectNearbyDrops(bot, task, item, { origin, radius: 8, timeoutMs: 4000, move: this.actions.navigate }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      }
      save(); return true;
    }
    const here = bot.entity.position;
    const target = Object.values(bot.entities).filter(e => e.name === plan.kind && e.isValid !== false && e.position && e.position.distanceTo(here) <= 32 && !(plan.skip || []).includes(e.id))
      .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))[0];
    if (!target) return end(`no ${plan.kind.replaceAll('_', ' ')} within thirty-two blocks`);
    bot._nightHunt = { name: plan.kind, until: plan.until };
    plan.targetId = target.id; plan.lastAt = { x: target.position.x, y: target.position.y, z: target.position.z };
    this.report(goal, save, { action: 'night_hunt', target: plan.kind, distance: Number(target.position.distanceTo(here).toFixed(1)), kills: plan.kills || 0, health: bot.health });
    if (canStrike(bot, target)) {
      // Not turned to on a one-wide span over a drop (terrain.js onSpan).
      if (require('./terrain').onSpan(bot)) { await sleep(100); return true; }
      await bot.lookAt(target.position.offset(0, (target.height || 1.8) / 2, 0), true);
      if (!(await defendNearby(bot, task, goal, save))) await sleep(100);
      return true;
    }
    // Closed on without digging or towering: a mob that cannot be walked to
    // is left for another after three tries.
    const movements = bot.pathfinder?.movements;
    const kept = movements && { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers };
    if (movements) Object.assign(movements, { canDig: false, allow1by1towers: false });
    const before = target.position.distanceTo(here);
    try { await this.actions.navigate(bot, task, new goals.GoalFollow(target, 1.5), { timeoutMs: 4000, stallMs: 2000, stopWhen: () => canStrike(bot, target) || target.isValid === false }); }
    catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
    finally { if (movements) Object.assign(movements, kept); }
    if (target.isValid !== false && target.position.distanceTo(bot.entity.position) >= before - 0.5 && !canStrike(bot, target)) {
      plan.misses = { ...(plan.misses || {}), [target.id]: (plan.misses?.[target.id] || 0) + 1 };
      if (plan.misses[target.id] >= 3) { plan.skip = [...(plan.skip || []), target.id]; delete plan.targetId; }
    }
    return true;
  }

  sleepDebt() {
    const age = worldAge(this.bot);
    if (!Number.isFinite(age)) return false;
    this.state.sleptAtAge ??= age;
    return age - this.state.sleptAtAge > SLEEP_DEBT_TICKS;
  }

  // A night in a pocket was a night standing still: eleven minutes behind a
  // wall, every night nothing better was on offer. It is spent the way a
  // player spends it, digging a mine out of the shelter: toward ore in
  // view of the rock, or down and along a branch, one staircase step a
  // tick. Rock around a tunnel is the shelter's wall. A bed that can be
  // slept in comes first, a mob that shows is the survival layer's as
  // ever, and at dawn the mine is left for the day's work.
  canNightMine(goal) {
    const bot = this.bot;
    if (bot.game?.dimension !== 'overworld' || !shelterNeeded(bot) || bot.game.difficulty === 'peaceful') return false;
    // Health is Jev's to weigh (riskNow, deathWouldCost), not a floor here:
    // trial 34 sat a night in a pocket at seven health with nothing to eat,
    // Jev choosing the mine every five seconds and this refusing it.
    if (immediateThreat(bot)) return false;
    // Not with anything watching: the same test the pocket uses to stay shut.
    if (threats(bot).some(t => t.distance < 20 && (t.visible || t.distance < 6) && !claimed(bot, t.entity))) return false;
    if (!bot.inventory.items().some(i => /_pickaxe$/.test(i.name)) && !pickaxeCraftable(bot)) return false;
    // A bed defers the mine only when the night is to be slept: with the
    // plan made for a shelter (the bed in view out of reach, or none
    // carried), a bed within sight kept the mine shut and the bot waited
    // eleven minutes of the second audited night.
    const sleeping = this.state.nightPlan?.until > Date.now() ? this.state.nightPlan.plan !== 'shelter' : true;
    if (sleeping && sleepable(bot) && !sleepWaiting(this) && (bedCarried(bot) || bedToSleepIn(bot, goal))) return false;
    return true;
  }

  // Which ore the night mine goes for, or a branch deeper: Jev's, with each
  // kind's distance, what is carried and what it is for. Without Jev, the
  // nearest of the kinds the ladder uses.
  async nightTarget(task, goal, save, feet) {
    const bot = this.bot;
    const choices = nightOreChoices(bot, feet, attemptsFor(this));
    // The tunnel behind, dark enough for monsters: a torch is Jev's option
    // (never the rule's; without Jev the mine goes on as it did).
    const dark = this.client && countOf(bot, 'torch') ? darkCells(bot, groundCells(bot, feet, 3)).filter(c => !c.equals(feet)) : [];
    if (!choices.length && !dark.length) return null;
    if (!this.client) return nightOre(bot, feet, attemptsFor(this));
    // Where each ore lies and what is beside it, and where a branch goes
    // (the decision audit, 2026-09-25): an ore in a cave wall opens the
    // tunnel onto the cave's mobs, and lava two blocks off is one misstep.
    // Ore touching water or lava is not in the list: the staircase will not
    // open a cell onto a liquid, so it cannot be reached at all.
    const around = (q, r, re) => { for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) if (re.test(bot.blockAt(q.offset(dx, dy, dz))?.name || '')) return true; return false; };
    const oreFacts = q => {
      const dy = q.y - feet.y;
      const open = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]].some(([x, y, z]) => /^(air|cave_air)$/.test(bot.blockAt(q.offset(x, y, z))?.name || ''));
      return ` ${dy ? `${Math.abs(dy)} block${Math.abs(dy) === 1 ? '' : 's'} ${dy > 0 ? 'up' : 'down'}` : 'level with the feet'}.${open ? ' It is in the wall of an open space: digging to it opens the tunnel onto whatever is in there.' : ''}${around(q, 2, /^lava$/) ? ' Lava within two blocks of it.' : ''}${around(q, 2, /^water$/) ? ' Water within two blocks of it.' : ''}`;
    };
    const tree = Object.fromEntries(choices.map((c, i) => { const [item, use] = ORE_YIELD[c.kind];
      return [`ore_${i}`, { description: `Dig to the ${c.name.replaceAll('_', ' ')} ${Math.round(c.position.distanceTo(feet))} blocks off (${countOf(bot, item)} ${item.replaceAll('_', ' ')} carried; ${use}).${oreFacts(c.position)}` }]; }));
    const branchY = Math.max(feet.y - 10, 16);
    tree.branch = { description: `Dig a branch down to a working depth and along it, looking for ore on the way: ${branchY < feet.y ? `down to y ${branchY}, ${feet.y - branchY} blocks below here` : branchY > feet.y ? `up to y ${branchY}, ${branchY - feet.y} blocks above here` : `level, at y ${branchY}`}, then twenty-four blocks along.` };
    if (dark.length) tree.light_tunnel = { description: `Put a torch in the tunnel here: ${dark.length} cells around the bot are dark enough for monsters to spawn in, and light stops them (${countOf(bot, 'torch')} torches carried).` };
    const decision = await this.decide(task, goal, save, { id: 'night_mine_target', tree, context: {},
      state: { timeOfDay: bot.time?.timeOfDay, feetY: feet.y, riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal), recentPositions: require('./stillness').recentPositions(bot), stillNeeded: require('./game-progress').rungsAhead(bot, goal, this.actions.planFor), pickaxe: bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).map(i => `${i.name} (${remainingUses(bot, i)} uses)`), freeSlots: bot.inventory.emptySlotCount?.() ?? null } });
    if (decision.stale) return null;
    if (decision.fallback) return nightOre(bot, feet, attemptsFor(this));
    const pick = decision.path.at(-1);
    if (pick === 'light_tunnel') {
      const placed = await placeTorches(bot, task, this.actions, [dark.sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))[0]], { max: 1 });
      this.report(goal, save, { action: 'light_tunnel', placed, torches: countOf(bot, 'torch') });
      return { lit: true };
    }
    return pick === 'branch' ? null : choices[Number(pick.slice(4))] || null;
  }

  async nightMine(task, goal, save) {
    const bot = this.bot;
    if (!this.canNightMine(goal)) return false;
    // Ore dug with no free slot stays on the floor of the tunnel.
    if (bot.game?.gameMode !== 'creative' && !((bot.inventory.emptySlotCount?.() ?? 1) > 0) && !await makeRoom(bot, task, 'raw_iron', { goal })) return false;
    // A pickaxe about to go is replaced from the pockets before the next
    // step: the daytime spare rule never runs inside the mine, and the dream
    // run wore an iron pickaxe from twenty-two uses to none in eighteen
    // seconds with seventeen ingots and a crafting table carried, then
    // sealed itself in for the night with nothing to dig with.
    const best = Math.max(0, ...bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).map(i => remainingUses(bot, i)));
    if (best < usesToClimbOut(bot) && this.actions.acquireStep) {
      const make = pickaxeCraftable(bot);
      if (make && !isSetAside(this, 'night_pickaxe', make)) {
        this.report(goal, save, { action: 'craft_pickaxe', item: make, remaining: best });
        try { await this.actions.acquireStep(bot, task, make, countOf(bot, make) + 1, goal, save); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(this, 'night_pickaxe', make, err, 600000); }
        return true;
      }
      // No spare to be made: the last uses are kept for the way out and for
      // the morning, not spent on the night's ore. Trial 20 mined its only
      // stone pickaxe to nothing and could not dig out of its own shaft.
      return false;
    }
    const feet = bot.entity.position.floored();
    const mine = this.state.nightMine ||= { startedAt: Date.now(), origin: { ...feet }, heading: Math.floor(Math.random() * 4), failures: 0, mined: 0 };
    // Boxed in: every heading refused (water or lava behind the rock on all
    // four sides) turned the mine in place fourteen hundred times at a
    // pocket among lava pools. The night is waited out instead.
    if (mine.boxedInUntil > Date.now()) return false;
    let target = mine.target && pos(mine.target);
    if (target && NIGHT_ORES.has(mine.targetOre) && bot.blockAt(target)?.name !== mine.targetOre) { target = null; delete mine.target; }
    if (target && !NIGHT_ORES.has(mine.targetOre) && target.distanceTo(bot.entity.position) < 2.5) target = null;
    if (!target) {
      // From a pocket on the surface, down into the rock first: an ore off to
      // the side was reached through the hillside, the pocket opened at every
      // step and was sealed again, three times, and the night was waited out.
      const atSurface = surfaceObserver(bot)(bot.entity.position);
      // Better still, the pocket itself goes down: a shaft into the rock and
      // a block over the head (shaftPocket), and the mine starts from there.
      // Every direction looks solid from inside a pocket (its own walls), so
      // no heading check tells the hillside from the hill.
      if (atSurface && !mine.sunkAt && await this.shaftPocket(task, goal, save)) { mine.sunkAt = Date.now(); save(); return true; }
      const ore = !atSurface && await this.nightTarget(task, goal, save, feet);
      if (ore?.lit) return true;
      if (ore) { target = ore.position; mine.targetOre = ore.name; }
      else {
        // No ore in reach of the eye: a branch, down to a working depth
        // and then along, in the mine's heading, and from the surface the
        // heading whose first steps are into solid ground.
        if (atSurface) {
          const solidAhead = h => { const [x, z] = [[1, 0], [0, 1], [-1, 0], [0, -1]][h % 4]; return [0, 1].every(dy => bot.blockAt(feet.offset(x, dy, z))?.boundingBox === 'block'); };
          for (let i = 0; i < 4 && !solidAhead(mine.heading); i++) mine.heading++;
        }
        const [dx, dz] = [[1, 0], [0, 1], [-1, 0], [0, -1]][mine.heading % 4];
        target = feet.offset(dx * 24, Math.max(-10, 16 - feet.y), dz * 24);
        if (target.y < feet.y - 10) target.y = feet.y - 10;
        mine.targetOre = 'branch';
      }
      mine.target = { x: target.x, y: target.y, z: target.z };
    }
    this.report(goal, save, { action: 'night_mine', target: { ...mine.target }, ore: mine.targetOre, mined: mine.mined });
    try {
      if (NIGHT_ORES.has(mine.targetOre) && target.distanceTo(bot.entity.position.offset(0, 1.6, 0)) <= 4.5) {
        const before = bot.inventory.items().length;
        await this.actions.dig(bot, task, target, { requireDrops: false });
        mine.mined++; delete mine.target; mine.failures = 0;
        // What fell is picked up on the next step into the cell.
        await sleep(300);
        if (bot.inventory.items().length === before) {
          const drop = Object.values(bot.entities).find(e => e.getDroppedItem?.() && e.position.distanceTo(target) < 2.5);
          if (drop) { try { await this.actions.navigate(bot, task, new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0.5), { timeoutMs: 3000, stallMs: 1500 }); } catch (_) { task.check(); } }
        }
      } else {
        await tunnelStep(bot, task, mine, save, target, { dig: this.actions.dig, navigate: this.actions.navigate, strict: true });
        mine.failures = 0;
        // Steps that do not move the bot at all: the server kept putting the
        // blocks back (a client and server that disagree), every step wore
        // the pickaxe by two, and twelve looks was more than the pickaxe had.
        const at = bot.entity.position.floored();
        const key = `${at.x},${at.y},${at.z}`;
        mine.still = mine.still?.key === key ? { key, steps: mine.still.steps + 1 } : { key, steps: 0 };
        // Rested like any other failure: marked recorded when nothing was,
        // the same ore was offered straight back and chosen fifteen times in
        // five seconds (trial 29).
        if (mine.still.steps >= 4) { mine.still = null; this.abandonTarget(mine, 'four steps without moving'); save(); return true; }
        // Steps that succeed without getting closer are a failure too: the
        // mine paced four blocks back and forth under a copper it could not
        // reach, every step a success, and never set it aside.
        const toward = watch(this, 'night_mine', target, bot.entity.position.distanceTo(target), { stallLooks: 12, restMs: 600000, why: 'twelve steps without getting closer' });
        if (toward.stalled) this.abandonTarget(mine, toward.reason, { recorded: true });
      }
    } catch (err) {
      task.check();
      if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      mine.failures++; mine.lastError = err.message;
      // A filter that rules out every step toward the ore says so at once.
      if (err.name === 'NoSafeWay' || mine.failures >= 3 || /not gaining/.test(err.message)) this.abandonTarget(mine, err.message);
    }
    save();
    return true;
  }

  // Set an ore aside for ten minutes and turn. Forgetting the target alone
  // chose the same nearest ore again, and the mine turned eighty times in
  // one place.
  abandonTarget(mine, why, { recorded = false } = {}) {
    if (NIGHT_ORES.has(mine.targetOre) && mine.target && !recorded) attemptsFor(this).fail('night_mine', mine.target, why, { restMs: 600000 });
    if (mine.target) unwatch(this, 'night_mine', mine.target);
    mine.lastAbandoned = { target: mine.target, why, at: new Date().toISOString() };
    // Boxed in is every heading refused, not every block of one vein: four
    // copper ores beside a lush cave were refused in a second, and the mine
    // sealed itself in for the night with a pickaxe and a stack of stone.
    // An unreachable ore is set aside above and the next look takes a
    // branch; only refused branches count toward boxed in.
    const branch = mine.targetOre === 'branch';
    if (branch) mine.heading++;
    delete mine.target; delete mine.tunnel; mine.failures = 0;
    if (!branch) return;
    const now = Date.now();
    mine.refusals = [...(mine.refusals || []).filter(r => now - r.at < 60000 && r.mined === mine.mined), { at: now, mined: mine.mined }];
    if (mine.refusals.length >= 4) { mine.boxedInUntil = now + 600000; mine.refusals = []; }
  }

  async wait(task, goal, save, reason = 'Waiting for daylight inside the verified shelter') {
    this.report(goal, save, { action: 'wait_in_shelter', reason });
    for (let i = 0; i < 50; i++) { task.check(); await sleep(100); }
  }

  // A survival action that fails is answered as a stall is: it rests three
  // minutes and the tick goes to the work. Thrown on into the loop it became
  // a persist, and the same branch ran again: trial 11's shaft pocket on a
  // sand island, five times (2026-09-24), as trial 9's shelter search before
  // it. Air, danger, cancellation and stalls go on up as always.
  async step(task, goal, save, onStep = () => {}) {
    try { return await this.stepOnce(task, goal, save, onStep); }
    catch (err) {
      if (err.name === 'SetAside') return false;
      if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err;
      const recent = goal.survivalAction, name = recent?.action;
      if (!name || EMERGENCIES.has(name) || Date.now() - Date.parse(recent.at || 0) > 60000) throw err;
      setAside(this, 'act', `survival:${name}`, err.message, 180000); save();
      console.log(`[survival] ${name} failed and rests three minutes: ${err.message}`);
      return false;
    }
  }

  async stepOnce(task, goal, save, onStep) {
    const bot = this.bot;
    // The survival layer has the turn: what the watchdogs held for it is met.
    bot._airAbort = false; bot._threatAbort = false;
    goal.survival = this.state;
    task.interruptCheck = undefined;
    // A shield raised to cover the last shot comes down at the next look:
    // every branch below may walk, and a raised shield is sneaking speed.
    lowerShield(bot);
    if (bot.game.gameMode === 'creative') {
      await recoverItems(bot, task, this.state.recovery, save, this.actions.navigate);
      return false;
    }
    if (this.rememberHouse(goal.blueprint)) save();
    if (inLava(bot)) {
      const exit = lavaExit(bot, 6, { water: true });
      this.report(goal, save, { action: 'leave_lava', to: exit && { ...exit }, health: bot.health });
      // No dry cell in sight: swim up and back toward the last dry footing,
      // never stand. The step with nothing to do returned at once, a
      // thousand times in four seconds, while the bot burned.
      const toward = exit ? exit.offset(0.5, 1, 0.5) : this.state.lastDry ? pos(this.state.lastDry).offset(0.5, 1, 0.5) : null;
      // Out of reach of a jump: up on blocks placed underfoot, where the
      // lava is, as a player pillars out of a pit.
      const feetY = bot.entity.position.floored().y;
      if (exit && exit.y > feetY + 1) {
        const { pillarUp, SCAFFOLD } = require('./pillar-recovery');
        if (bot.inventory.items().some(i => SCAFFOLD.includes(i.name))) {
          bot._leavingLava = true;
          try { await pillarUp(bot, task, exit.y, { dig: this.actions.dig, maxBlocks: exit.y - feetY, threats: false }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
          finally { bot._leavingLava = false; }
          if (!inLava(bot)) { onStep(goal); return true; }
        }
      }
      bot._leavingLava = true;
      try {
        await move(bot, task, { label: 'out_of_lava', keys: toward ? ['forward', 'jump'] : ['jump'], sneak: false,
          why: exit ? 'in lava: the nearest dry cell, whatever the ground' : 'in lava with no dry cell in sight: up, and back the way the bot came',
          look: toward || undefined, maxMs: 2500, tick: 50,
          // Out of the lava and over the cell chosen is out: the keys held
          // after that carried mid-235-a on past it, upright, and off the
          // ledge it stood on (2026-09-26).
          until: () => !inLava(bot) && (bot.entity.onGround || (exit && bot.entity.position.floored().x === exit.x && bot.entity.position.floored().z === exit.z)) });
      } finally { bot._leavingLava = false; }
      onStep(goal); return true;
    }
    // The last dry footing, for the way back out of lava.
    if (bot.entity.onGround && !bot.entity.isInWater) {
      const f = bot.entity.position.floored();
      const last = this.state.lastDry;
      if (!last || last.x !== f.x || last.y !== f.y || last.z !== f.z) this.state.lastDry = { x: f.x, y: f.y, z: f.z, dimension: String(bot.game?.dimension || '') };
    }
    // A ghast in sight and a drop that ends the bot beside it: off the edge
    // first. Its fireball's blast throws a player, and mid-87-l, on a ledge
    // at y 74 over the lava sea on a fortress leg, was hit from thirty
    // blocks and thrown forty down into the lava (2026-09-26).
    // Any mob in sight among the threats about, as well: a magma cube came
    // down from eighteen blocks over mid-227-a, stood still on a ledge at
    // y 77 over the lava sea while its tunnel stalled, and the bot went over
    // the edge with it and fifty blocks into the lava (2026-09-26).
    const inReach = new Set(threats(bot).map(t => t.entity.id));
    const pusher = t => t.visible && (t.entity.name === 'ghast' || inReach.has(t.entity.id));
    // A fireball on its way pushes as its ghast does, the ghast in view or not.
    const fireball = () => require('./projectile-guard').incoming(bot, { reach: 24 }).some(e => /fireball/.test(e.name || ''));
    // Not off a stance that moves, nor off the bot's own pillar: flee's
    // copy of this rule has both guards (notes 218, 250), and this one had
    // neither (the decision review, 2026-09-26).
    const heldStance = stanceHeld(bot), feetHere = bot.entity.position.floored(), ownPillar = this.state.pillar;
    const guarded = (heldStance && MOVING_STANCES.has(heldStance.choice)) ||
      (ownPillar && Math.hypot(feetHere.x - ownPillar.x, feetHere.z - ownPillar.z) < 1 && feetHere.y >= ownPillar.y + 1);
    if (!guarded && !(this.state.edgeTriedAt > Date.now() - 10000) && (threats(bot, 64).some(pusher) || fireball())) {
      const { dropNear } = require('./terrain');
      const deep = dropNear(bot, bot.entity.position.floored(), 2);
      if ((deep && (deep.into === 'lava' || deep.damage >= (bot.health ?? 20) / 2)) || lavaBeside(bot, bot.entity.position.floored())) {
        this.state.edgeTriedAt = Date.now();
        const cell = firmGround(bot, 8, { margin: 3 });
        if (cell) {
          this.report(goal, save, { action: 'off_the_edge', to: { ...cell }, from: threats(bot, 64).find(pusher)?.entity.name, drop: deep });
          require('./terrain').holdOffEdge(bot, bot.entity.position.floored(), threats(bot, 64).map(t => t.entity));
          // A shot on its way stops the walk for the shield: at the edge its
          // knockback is the fall the walk is getting away from. mid-243-e's
          // walk from a forty-block edge had gone half a block in a second
          // and a half when a skeleton's arrow put it over (2026-09-27).
          const { incoming, deflect } = require('./projectile-guard');
          const shot = () => bot.inventory.slots?.[45]?.name === 'shield' && incoming(bot).length > 0;
          try { await this.actions.navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 6000, stallMs: 2000, stopWhen: shot }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
          if (shot()) { this.state.edgeTriedAt = 0; await deflect(bot, task); }
          onStep(goal); return true;
        }
      }
    }
    await maintainVitals(bot, task, action => this.report(goal, save, action));
    // Still in a block: nothing else this turn, the dig out comes again at
    // once. mid-79-c went on to craft its spare pickaxe under the gravel.
    if (require('./vitals').headInBlock(bot)) { onStep(goal); return true; }
    // The mob hitting the bot comes first, before a bed, a pocket, a chore
    // or anything else: trial 7's bot lay down to sleep beside a zombie
    // villager and was hit five times trying, then walled itself in with it
    // (2026-09-24). A mob that does not shoot, at arm's length and in sight
    // or in reach of the sword, is the fight-or-flee rules' before anything.
    const atArm = threats(bot).filter(t => t.distance <= 3 && !shooter(t.entity) && (t.visible || canStrike(bot, t.entity)) && !nightHunted(bot, t.entity));
    if (atArm.length && !claimed(bot, atArm[0].entity)) { await this.flee(task, goal, save); onStep(goal); return true; }
    const refuge = this.currentShelter();
    if (refuge && shelter.inside(bot, refuge) && shelter.sealed(bot, refuge)) {
      delete this.state.trappedSince;
      // A mob behind twenty blocks of rock is not a reason to stay sealed in
      // past dawn: underground there is always one somewhere. Wait for the
      // ones that can see in, or are at the wall.
      // Cave mobs do not burn off at dawn. A mob that can see in keeps the
      // bot inside for a few minutes, not the whole day: after that it leaves
      // armed and lets the fight-or-flee rules take over.
      // Not the mob the hunt came for, once the bot is fit to fight it. At a
      // spawner the watchers never leave, so a pocket that waits for them
      // waits forever: healed and armed beside the blaze room, the bot sat
      // sealed in for ten minutes because the blazes were still there, which
      // was the reason it came.
      const watched = !shelterNeeded(bot) && threats(bot).some(t => t.distance < 20 && (t.visible || t.distance < 6) && !claimed(bot, t.entity));
      if (watched) this.state.watchedSince ||= Date.now(); else delete this.state.watchedSince;
      // Out after three minutes of it, but not hurt: at three health the
      // dream run left its pocket past a skeleton and was shot on the stairs
      // (2026-09-24). Below ten the pocket is where it heals, eating behind
      // the wall.
      const outwaited = watched && Date.now() - this.state.watchedSince > 180000 && (bot.health ?? 20) >= 10;
      // A sealed pocket within a walk of the base's bed is left for it: the
      // night passes in the bed, not behind the wall.
      // Only from a pocket on the surface: a walk to the bed from a pocket
      // down a shaft fails, and the night is better spent behind the wall.
      // From the surface, or from a pocket within ten blocks of the bed's
      // level (the stairs' last stretch): open the pocket and let the
      // go-home rule climb and walk. From deep down, the night is better
      // spent behind the wall.
      // Leaving a pocket for a bed the bot just failed to reach is the start
      // of a loop: out, a two-minute walk in the dark, a new pocket, and two
      // minutes later out again, all night. From a pocket, a failed route
      // waits ten minutes like a failed sleep does.
      const homeBed = sleepable(bot) && !sleepWaiting(this) && !failedWithin(this, 'bed_route', 'home', 600000) && bedToSleepIn(bot, goal);
      const bedNear = homeBed && (surfaceObserver(bot)(bot.entity.position) || Math.abs(homeBed.foot.y - bot.entity.position.y) <= 10) ||
        // A bed in the pack is a bed too. A fight pocket dug at dusk held the
        // bot until dawn, eleven minutes behind a wall, with a bed on its back.
        (!homeBed && bot.game?.dimension === 'overworld' && sleepable(bot) && !sleepWaiting(this) && bedCarried(bot) && surfaceObserver(bot)(bot.entity.position));
      // Say who is keeping the bot in, and whether the hunt had claimed it:
      // a wait with no named reason cost an hour of guessing.
      const watcher = threats(bot).find(t => t.distance < 20 && (t.visible || t.distance < 6) && !claimed(bot, t.entity));
      const hunt = bot._huntingEntity;
      // Inside the pocket with the bot, or at arm's length through a gap:
      // fought, not waited out (a reflex). The clean run sealed itself in
      // with a skeleton at 0.3 blocks and "waited for it to leave" for
      // eighteen minutes, arrows piling up at its feet (2026-09-24).
      if (watcher && (watcher.distance < 2.5 || canStrike(bot, watcher.entity))) {
        this.report(goal, save, { action: 'fight_in_pocket', target: watcher.entity.name, distance: Number(watcher.distance.toFixed(1)), health: bot.health });
        await defendNearby(bot, task, goal, save);
        for (let n = 0; n < 5; n++) { task.check(); await sleep(100); }
        onStep(goal); return true;
      }
      // What next in the pocket is Jev's: stay, leave, go to bed, open the
      // wall on a watcher, or mine the night away. Held ninety seconds for
      // the same watcher and the same night.
      const night = shelterNeeded(bot);
      // And what is about that the wall hides: inside a sealed pocket nothing
      // is in sight, and mid-110-e opened its pocket for the bed with a
      // creeper ten blocks off it had not been told of, and was blown up
      // from twenty health in iron (2026-09-25).
      const about = threats(bot, 16).filter(t => t.entity !== watcher?.entity).slice(0, 4);
      const hidden = about.length ? `${about.map(t => `a ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`).join(', ')}${about.some(t => !t.visible) ? ' (heard, not seen: the wall is between)' : ''}` : '';
      const who = watcher ? `the ${watcher.entity.name.replaceAll('_', ' ')} ${Math.round(watcher.distance)} blocks off${watcher.visible ? ', in sight' : ''}${hidden ? `, and ${hidden}` : ''}` : hidden || null;
      const options = {};
      const outside = who ? ` Outside is ${who}.` : '';
      // Sleep is refused with a monster within eight blocks of the bed, seen
      // or not (the decision audit): said, with the walk.
      const byBed = homeBed ? monstersByBed(bot, homeBed.foot, 32) : 0;
      const bedWalk = homeBed ? ` ${Math.round(homeBed.foot.distanceTo(bot.entity.position))} blocks away (about ${Math.round(homeBed.foot.distanceTo(bot.entity.position) / 4.3)} seconds at a walk${Math.abs(homeBed.foot.y - bot.entity.position.y) > 2 ? `, ${Math.round(homeBed.foot.y - bot.entity.position.y)} blocks up or down` : ''})` : ' in the pack';
      if (bedNear) options.go_to_bed = { description: `Open the pocket and go to the bed${bedWalk}; the night passes in seconds.${byBed ? ` ${byBed} monster${byBed === 1 ? '' : 's'} within eight blocks of the bed now: sleep is refused while any are.` : ''}${who ? ` Outside is ${who}.` : ''}`,
        run: async () => { delete this.state.watchedSince; await this.leave(task, goal, save, refuge, 'Off to bed.'); return true; } };
      // The carried bed in a nook dug out of the pocket's wall, the pocket
      // staying shut: the one bot of the six midgame trials of 2026-09-26
      // that carried a bed sat its nights out in pockets like this one.
      // Before bedtime the nook is said with the stay.
      const carried = night && bedCarried(bot) && bot.game?.dimension === 'overworld' && !sleepWaiting(this) && !isSetAside(this, 'bed_nook', 'here') && typeof this.actions.dig === 'function';
      const nook = carried && bedNook(bot, goal, { sealed: true });
      if (nook && sleepable(bot)) options.sleep_in_nook = { description: `Stay sealed in and ${nookSays(bot, nook, { pocket: true })}${outside}`,
        run: async () => {
          try { await this.nookSleep(task, goal, save, { pocket: refuge }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
          delete this.state.bedNookPlan; return true;
        } };
      if (watcher && watcher.distance <= 4.5 && /_(sword|axe)$/.test(defenseWeapon(bot)?.name || '') && typeof this.actions.dig === 'function')
        options.open_on_watcher = { description: `Open the wall toward ${who} and fight it at the gap.${watcher.entity.name === 'creeper' ? ' A creeper at the gap goes off.' : ''}`,
          run: () => this.openOnWatcher(task, goal, save, refuge, watcher, { chosen: true }) };
      if (night && !watcher && !refused(this, 'survival:night_mine') && this.canNightMine(goal))
        options.night_mine = { description: `Mine from the pocket through the night: toward ore in the rock, or down and along a branch. Rock around a tunnel is shelter too. ${rockHolds(bot, bot.entity.position.floored(), attemptsFor(this))}${outside}`, run: () => this.nightMine(task, goal, save) };
      // Work that needs no walking: the ladder's next item made from what is
      // carried. Trial 30 sat out its second night in a pocket with 29 raw
      // iron, coal and a furnace in its pack, the armour the one thing left.
      const bench = !watcher && goal.kind === 'win' && this.benchWork(goal);
      if (bench) options.work_here = { description: `Stay in the pocket and make the ${bench.item.replaceAll('_', ' ')} here: everything it needs is carried (${bench.plan.map(st => `${st.action} ${st.count || 1} ${String(st.item || '').replaceAll('_', ' ')}`).join(', then ')}). The furnace and the table go into the wall; the pocket stays shut.${(() => {
        // How long it takes against the night left (the decision audit,
        // 2026-09-25): ten seconds a smelt.
        const smelts = bench.plan.filter(st => st.action === 'smelt').reduce((n, st) => n + (st.count || 1), 0);
        return `${smelts ? ` About ${Math.round(smelts * 10 / 60 * 10) / 10} minutes of smelting (${smelts} at ten seconds each).` : ' Crafting only: a few seconds.'}${night ? ` About ${minutesToDawn(bot)} real minutes to dawn.` : ''}${require('./strategy').pickaxeLeft(bot, require('./strategy').planSpends(bench.plan))}`;
      })()}`,
        run: async () => { this.report(goal, save, { action: 'work_in_pocket', item: bench.item }); await this.actions.acquireStep(bot, task, bench.item, bench.count, goal, save); return true; } };
      // Out to hunt, or the valuables to the chest first (a death drops
      // everything carried): at night with nothing watching.
      if (night && !watcher) for (const [key, o] of Object.entries(this.huntOptions(goal))) options[key] = { description: o.description + outside,
        run: async () => { this.state.nightPlan = { plan: 'hunt', kind: o.kind, until: Date.now() + 120000, startHealth: bot.health }; await this.leave(task, goal, save, refuge, `Out to hunt ${o.kind.replaceAll('_', ' ')}s.`, { past: true }); return true; } };
      const stash = night && !watcher && this.stashOption(goal);
      if (stash) options.stash_valuables = { description: stash.description + outside, run: async () => { await this.leave(task, goal, save, refuge, 'To the chest.', { past: true }); return stash.run(task, goal, save); } };
      const cache = night && !watcher && !stash && this.cacheOption(goal);
      if (cache) options.cache_valuables = { description: `Open the pocket and ${cache.description.charAt(0).toLowerCase()}${cache.description.slice(1)}${outside}`, run: async () => { await this.leave(task, goal, save, refuge, 'Leaving my valuables in a chest.', { past: true }); return cache.run(task, goal, save); } };
      const bedLater = nook && !sleepable(bot) ? ` The carried bed can go down in a nook dug out of the wall, the pocket staying shut, from bedtime (${SLEEP_FROM}), about ${Math.max(0, Math.round((SLEEP_FROM - bot.time.timeOfDay) / 20))} seconds off.` : '';
      // Health and whether it comes back, at night too, and on the way out:
      // mid-92-o, at eight health and twelve hunger, chose to leave its
      // pocket in the dark told only that mobs spawn there, looked for food,
      // and died among them in a minute (2026-09-26).
      const hp = Math.round((bot.health ?? 20) * 10) / 10;
      const healthNow = hp >= 20 ? '' : (bot.food ?? 20) >= 18 ? `, healing from ${hp} health` : `, not healing: ${hp} health and hunger ${bot.food}, and health comes back only at eighteen or more`;
      options.stay = { description: night ? `Stay in the pocket until daylight, about ${minutesToDawn(bot)} real minutes with nothing gained${healthNow}${who ? `; ${who} is outside` : ''}.${bedLater}` : `Stay in the pocket${who ? ` while ${who} is outside` : ', though nothing is watching it'}${healthNow}.`,
        run: async () => { await this.wait(task, goal, save, watcher
          ? `${watcher.entity.name} at ${watcher.distance.toFixed(1)} is watching (claim ${hunt ? `${hunt.name}, ${Math.round((hunt.until - Date.now()) / 1000)}s left` : 'none'}, hp ${Math.round(bot.health)}, food ${bot.food})`
          : 'Waiting for daylight inside the verified shelter'); return true; } };
      // What going out among them costs, as the stances say it: mid-92-k
      // left a pocket at twenty health past skeletons it was told only the
      // distances of, and was shot down in twenty seconds (2026-09-26).
      const outsideAll = threats(bot, 16).slice(0, 8);
      const outCost = outsideAll.length ? fightEstimate({ threats: outsideAll.map(t => ({ name: t.entity.name, distance: t.distance, shoots: shooter(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: true })),
        armour: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean), weapon: defenseWeapon(bot)?.name || null, health: bot.health, shield: bot.inventory?.slots?.[45]?.name === 'shield' }).fightHere : null;
      // The creepers too: mid-83-i left past three creepers and two
      // skeletons told "2.5 damage", the creepers left out of the sum, and
      // was shot down among them in half a minute (2026-09-26).
      const creeperCount = outsideAll.filter(t => t.entity.name === 'creeper').length;
      const outSays = outCost ? ` Out among them, fighting them all is estimated at about ${outCost.seconds} seconds and ${outCost.damageTaken} damage, from ${outCost.healthNow} health${outCost.healthAfter <= 0 ? ' (more than the bot has)' : ''}${creeperCount ? `, the ${creeperCount === 1 ? 'creeper' : `${creeperCount} creepers`} not counted in it: each that reaches the bot goes off for about ${outCost.creeper?.match(/about ([\d.]+)/)?.[1] || 18} health` : ''}.` : '';
      const ce = require('./combat-estimate');
      const worn = ce.armourOf([5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean));
      const hitsOf = name => Math.max(1, Math.ceil(hp / Math.max(0.5, ce.afterArmour(ce.MOBS[name].hit, worn))));
      const outHealth = hp >= 20 ? '' : ` It goes out at ${hp} health${(bot.food ?? 20) < 18 ? `, not healing at hunger ${bot.food}` : ''}: about ${hitsOf('zombie')} zombie hits or ${hitsOf('skeleton')} arrows end it${ce.afterArmour(ce.MOBS.creeper.hit, worn) >= hp ? ', or one creeper\'s blast' : ''}.`;
      options.leave = { description: `Open the pocket and go back to work${night ? ' in the dark, where mobs spawn' : ''}${who ? `, past ${who}` : ''}.${outSays}${outHealth}`,
        run: async () => {
          delete this.state.watchedSince;
          // Out at night is a plan for a while, not a moment: without it the
          // next tick saw the night and no shelter and sealed the bot back
          // in, and the work opened the lid again, every two seconds for a
          // minute (mid-92-f, 2026-09-26). Held as staying up for two minutes.
          if (night) this.state.nightPlan = { plan: 'stay_up', until: Date.now() + 120000, from: 'leave' };
          await this.leave(task, goal, save, refuge, undefined, { past: true }); return true;
        } };
      // Without Jev, the old order.
      const rule = bedNear && !watched ? 'go_to_bed' : (night || watched) && !outwaited
        ? (options.open_on_watcher && (bot.health ?? 20) >= 16 && watcher.entity.name !== 'creeper' && threats(bot, 16).filter(t => t.entity !== watcher.entity).length <= 1 ? 'open_on_watcher' : options.night_mine && !watched ? 'night_mine' : 'stay')
        : 'leave';
      const key = `${watcher?.entity.name || ''}|${night}|${!!bedNear}|${Object.keys(options).sort().join(',')}`;
      const held = this.state.pocketPlan?.key === key && this.state.pocketPlan.until > Date.now() && options[this.state.pocketPlan.choice] ? this.state.pocketPlan.choice : null;
      // The nook Jev chose for tonight when the pocket was sealed (shelter
      // method bed_nook) is carried out at bedtime, not asked again.
      let choice = held || (this.state.bedNookPlan?.until > Date.now() && options.sleep_in_nook ? 'sleep_in_nook' : null);
      if (!choice) {
        const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description }]));
        const decision = await this.decide(task, goal, save, { id: 'pocket_next', tree, context: { rule },
          state: { timeOfDay: bot.time?.timeOfDay, night, daylight: night ? 'night' : (bot.time?.timeOfDay ?? 0) >= 22000 ? 'dawn: zombies and skeletons in the open burn once the sun is up' : 'day',
            workWaiting: goal.rungTime?.phase || goal.step?.item || goal.step?.block || goal.request || null,
            stillNeeded: require('./game-progress').rungsAhead(bot, goal, this.actions.planFor),
            inventory: Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])),
            riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal), recentPositions: require('./stillness').recentPositions(bot),
            health: bot.health, food: bot.food, armedAndArmoured: kitReady(bot), armourWorn: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean), weapon: defenseWeapon(bot)?.name || null, watchedForSeconds: this.state.watchedSince ? Math.round((Date.now() - this.state.watchedSince) / 1000) : 0,
            threats: threats(bot).filter(t => t.distance < 20).slice(0, 6).map(t => ({ name: t.entity.name, distance: Math.round(t.distance * 10) / 10, visible: t.visible, shoots: shooter(t.entity) })) } });
        if (decision.stale) { onStep(goal); return true; }
        choice = decision.path.at(-1);
        this.state.pocketPlan = { choice, key, until: Date.now() + 90000 };
      }
      if (!(await options[choice].run())) { delete this.state.pocketPlan; await options.stay.run(); }
      onStep(goal); return true;
    }
    // The hunt Jev chose for the night, while it holds.
    const hunt = this.state.nightPlan?.plan === 'hunt' ? this.state.nightPlan : null;
    // A hunt for food (foodHunt) is not a night's: day or Nether, it runs its time.
    if (hunt && (hunt.until < Date.now() || (!hunt.food && !shelterNeeded(bot)))) { delete this.state.nightPlan; delete bot._nightHunt; }
    else if (hunt && await this.huntStep(task, goal, save)) { onStep(goal); return true; }
    if (!shelterNeeded(bot)) delete this.state.nightMine;
    else if (this.state.nightMine && !immediateThreat(bot) && !surfaceObserver(bot)(bot.entity.position.offset(0, 1, 0)) &&
        await this.nightMine(task, goal, save)) { onStep(goal); return true; }
    const emergency = immediateThreat(bot);
    if (emergency) {
      // Sealing a nearby prepared site is faster than a long retreat. Otherwise
      // get clear first; ordinary digging must never continue under fire.
      // With a mob already at arm's length there is no sealing it out: the
      // third death was six zombies in the shell cells and a bot placing
      // blocks against them until its health ran out.
      const adjacent = threats(bot).some(t => t.visible && t.distance <= 2.2);
      if (!adjacent && refuge && pos(refuge.origin).distanceTo(bot.entity.position) < 3 && shelter.materialStock(bot) >= shelter.missingShell(bot, refuge).length) await this.refugeStep(task, goal, save, { method: 'saved_shelter' });
      else await this.flee(task, goal, save);
      onStep(goal); return true;
    }
    delete this.state.trappedSince;
    // A bed in the pockets moves the whole question to bedtime: no site to
    // reserve at 9500, no blocks to gather, and at 12541 the choice is
    // sleep, or stay up armed because the dark is what the request needs.
    const bed = bedCarried(bot), homeBed = bedToSleepIn(bot, goal);
    const routeBlocked = failedWithin(this, 'bed_route', 'home', 120000);
    const underground = bot.game.dimension === 'overworld' && !surfaceObserver(bot)(bot.entity.position);
    const bedReady = (!!bed || (!!homeBed && !routeBlocked)) && bot.game.dimension === 'overworld' && !sleepWaiting(this);
    // Dusk with a bed at home: head there before bedtime rather than start
    // the walk from the bottom of a shaft at 12541. The second run chose the
    // bed thirty blocks down its mine and the walk failed at once.
    // A failed direct walk pauses the walk, not the climb: the stairs out
    // of a shaft are a different route from a path search to the bed.
    // Home before bedtime: wait by the bed rather than hand the minute back
    // to the work loop, which dived to the lava site and was climbed out of
    // again every ten seconds until 12541.
    if (homeBed && shelterNeeded(bot) && bot.time.timeOfDay >= DAY.WALK_HOME && bot.time.timeOfDay < SLEEP_FROM && homeBed.foot.distanceTo(bot.entity.position) <= 6 && !immediateThreat(bot)) {
      // The minute before bedtime is a chore, not a wait: the stash, the
      // wheat, the cows; and once, the plot grows a column for the next day.
      // A chore that failed waits two minutes. Its error was swallowed and
      // the next tick ran it again: a harvest failing at one cell ran
      // twenty times a second through a whole evening, and nobody could
      // see why.
      const attempts = attemptsFor(this);
      const chores = Object.fromEntries(Object.entries(homeChores(bot, goal)).filter(([key]) => !attempts.resting('chore', key)));
      const home = homeOf(bot, goal);
      // Which chore, or none, is Jev's; without Jev, the old order.
      // A chore whose walk runs past dark says so (the decision audit,
      // 2026-09-25): the cows fetched at dusk come back in the dark.
      const late = chore => chore.walkSeconds && bot.time.timeOfDay + chore.walkSeconds * 20 >= DAY.DARK ? ` Back after dark (${DAY.DARK}): mobs spawn on the way back.` : '';
      const tree = Object.fromEntries(Object.entries(chores).map(([key, chore]) => [key, { description: chore.description + late(chore), run: async () => {
        this.report(goal, save, { action: 'evening_chore', chore: key });
        const started = Date.now();
        try {
          await chore.run(bot, task, goal, save, this.actions);
          // Back in a blink with nothing done is the same loop without an error.
          if (Date.now() - started < 300) throw new Error('The chore returned at once without doing anything');
          attempts.clear('chore', key);
        }
        catch (err) {
          task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
          attempts.fail('chore', key, err, { restMs: 120000 }); save();
          console.log(`[chore] ${key} failed: ${err.message}`);
        }
      } }]));
      if (home?.completedAt && !home.plotWide) tree.grow_plot = { description: 'Mark the home plot to grow by a column tomorrow: more wheat, more bread.', run: async () => { home.plotWide = true; save(); this.report(goal, save, { action: 'grow_plot' }); } };
      tree.wait_for_bedtime = { description: `Wait by the bed for bedtime, ${Math.max(0, SLEEP_FROM - bot.time.timeOfDay)} ticks off (about ${Math.round(Math.max(0, SLEEP_FROM - bot.time.timeOfDay) / 20)} seconds).`,
        run: async () => { this.report(goal, save, { action: 'wait_for_bedtime', ticks: SLEEP_FROM - bot.time.timeOfDay }); for (let i = 0; i < 10; i++) { task.check(); await sleep(100); } } };
      const keys = Object.keys(tree);
      // Waiting chosen is held until bedtime or a new chore appears.
      const waiting = this.state.eveningWait?.keys === keys.join(',') && this.state.eveningWait.day === Math.floor((bot.time?.age ?? 0) / 24000);
      if (keys.length === 1 || waiting) await tree.wait_for_bedtime.run();
      else {
        const decision = await this.decide(task, goal, save, { id: 'evening_chore', tree, state: { timeOfDay: bot.time.timeOfDay, sleepPossibleFrom: SLEEP_FROM, health: bot.health, food: bot.food,
          riskNow: require('./risk').riskNow(bot), threats: threats(bot, 32).slice(0, 6).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), visible: t.visible })) } });
        if (!decision.stale) {
          if (decision.path.at(-1) === 'wait_for_bedtime') this.state.eveningWait = { keys: keys.join(','), day: Math.floor((bot.time?.age ?? 0) / 24000) };
          await decision.action.run();
        }
      }
      onStep(goal); return true;
    }
    // The walk home for the night is Jev's to choose (go_home_for_night
    // below); once chosen it is held, not asked again every tick.
    // Underground, night is not a question: the dark down there is the same
    // at noon, and its mobs neither spawn more nor burn at dawn. The shelter,
    // the walk home and staying up were asked at y -50 mid-dig all night,
    // every two minutes, and the climbs out for them were 110 of 408
    // pre-Nether minutes (the decision review, 2026-09-26). The night comes
    // up when the work does, or after two nights awake, when the phantoms
    // waiting on the third are a reason to find a bed.
    const nightFree = underground && !this.sleepDebt();
    const nightNow = shelterNeeded(bot) && !nightFree;
    const homeWalk = homeBed && nightNow && homeBed.foot.distanceTo(bot.entity.position) > 6 && (underground || !routeBlocked) &&
      !sleepWaiting(this) && !isSetAside(this, 'surface_home', 'here');
    const heldPlan = this.state.nightPlan?.until > Date.now() ? this.state.nightPlan : null;
    if (homeWalk && heldPlan?.plan === 'home') { heldPlan.until = Date.now() + 120000; await this.goHomeForNight(task, goal, save, homeBed, underground); onStep(goal); return true; }
    const plan = this.state.nightPlan?.until > Date.now() ? this.state.nightPlan : null;
    const stayingUp = plan?.plan === 'stay_up';
    // Before bedtime, a bed anywhere in reach (a walk that just failed
    // included) means no sealing in yet: the walk is retried in two minutes
    // and the shelter thirty blocks from the bed was the worse night.
    const needsShelter = nightNow && !stayingUp && plan?.plan !== 'hunt';
    // A shelter once chosen is a plan, not a question for every tick: the
    // second run climbed its shaft for a shelter, was asked again at the
    // top, went back down to the mine, and was asked again at the bottom.
    // Renewed while it is being carried out: a plan that lapsed after two
    // minutes of gathering blocks put the question again, and "carry on"
    // left the half-built shell standing in the dark.
    if (needsShelter && plan?.plan === 'shelter' && !(bedReady && sleepable(bot))) {
      plan.until = Date.now() + 120000;
      if (await this.refugeStep(task, goal, save) !== false) { onStep(goal); return true; }
    }
    if (!needsShelter && this.state.recovery?.status === 'pending') {
      this.report(goal, save, { action: 'recover_items', origin: this.state.recovery.position });
      if (await recoverItems(bot, task, this.state.recovery, save, this.actions.navigate)) { onStep(goal); return true; }
    }
    // The game ladder's early expedition kit is tools and wood; its food is
    // stocked before the Nether (preparingNether) and the End. Driven by the
    // kit, the search walked trial 20's first five minutes looking for an
    // animal at full hunger (2026-09-24).
    const expeditionFood = ((goal.preparingExpedition && goal.kind !== 'win') || goal.preparingEnd || goal.preparingNether) && bot.game.difficulty !== 'peaceful';
    // One reserve for the crossing, kept with the stash that fills it: it was
    // written out here, in the Nether gate and in the stash, three times.
    const desiredFood = goal.preparingEnd ? 64 : goal.preparingNether ? NETHER_FOOD_POINTS : KIT_FOOD_POINTS;
    // A missing reserve is worth a hunt while the bot is already on the
    // surface, where the animals are. Underground it is worth the climb only
    // once hunger is real: the dream run was leaving its iron shaft at 18 of
    // 20 to walk the surface for a chicken.
    // Off the Overworld there is nothing to hunt and nowhere to climb to:
    // food is a reason to go back through the portal, and only real hunger.
    const offWorld = !/overworld/.test(String(bot.game.dimension || 'overworld'));
    const hungerTrigger = offWorld ? 8 : surfaceObserver(bot)(bot.entity.position) ? 18 : 12;
    // A reserve is worth a few minutes of looking, not the whole day: a
    // stock-driven search that finds nothing in five minutes is set aside for
    // twenty, and only real hunger forages meanwhile. The seventh climb spent
    // half an hour on a bare mountain searching for a chicken at full hunger.
    // Hurt with hunger under eighteen and nothing to eat is hungry too: the
    // health does not come back until something is eaten. mid-87-f waited
    // six minutes at three health and sixteen hunger with no food carried,
    // "recovering before combat", and a zombie ended it (2026-09-26).
    const cannotHeal = !offWorld && (bot.health ?? 20) < 14 && bot.food < 18 && !chooseFood(bot);
    const hungry = bot.food <= hungerTrigger || cannotHeal;
    const stockDriven = !offWorld && (goal.stockFood || expeditionFood || (goal.kind === 'survive' && bot.game.difficulty !== 'peaceful'));
    const now = Date.now();
    // Stocked is stocked: the flag that asked for a reserve was never taken
    // down, so the stock-driven search ran for the rest of the goal.
    if (foodSupply(bot) >= desiredFood) { unwatch(this, 'food_search', 'stock'); delete goal.stockFood; }
    // The supervisor: five minutes of searching with no more food carried
    // sets the search aside for twenty. The clock used to run from the
    // first look whatever was found meanwhile.
    if (!hungry && stockDriven && foodSupply(bot) < desiredFood && !isSetAside(this, 'food_search', 'stock', now) &&
        watch(this, 'food_search', 'stock', foodSupply(bot), { better: 'higher', epsilon: 0.5, stallMs: 300000, restMs: 1200000, why: 'five minutes of searching brought no food', now }).stalled) save();
    const stockPaused = isSetAside(this, 'food_search', 'stock', now);
    const needsFood = foodSupply(bot) < desiredFood && (hungry || (stockDriven && !stockPaused));
    if (!needsShelter && !needsFood) return false;
    // "Carry on" is an answer too, held as a food trip is: on the surface
    // at hunger eighteen the question came back every pass while Jev said
    // carry on, each asking with its route surveys, until one pass said
    // food (the decision review, 2026-09-26). Held for five minutes, until
    // hunger falls two or health four from when it was chosen, or the night
    // comes; then asked again with what changed.
    const carryOn = this.state.carryOnPlan;
    if (carryOn && (carryOn.until < now || needsShelter || bot.food <= carryOn.food - 2 || (bot.health ?? 20) <= carryOn.health - 4)) delete this.state.carryOnPlan;
    if (this.state.carryOnPlan) return false;
    const state = { playerRequest: goal.request, retainedGoal: goal.kind, timeOfDay: bot.time.timeOfDay, riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal), recentPositions: require('./stillness').recentPositions(bot),
      ...(require('./exploration').biomeView(bot) || {}),
      playerUrgency: goal.urgency ? { level: goal.urgency.level, meaning: 'How much the wording of the request pressed for speed: relaxed, ordinary or pressed. Pressure is a reason to keep working while it is still safe, never a reason to skip shelter once night is close.' } : undefined,
      health: bot.health, food: bot.food, safeFoodCarried: !!chooseFood(bot),
      survivalFacts: { difficulty: bot.game.difficulty, hostileMobsSpawnAtNight: true,
        nightStartsAt: DAY.NIGHT, dawnAt: DAY.DAWN, daylightTicksRemaining: Math.max(0, DAY.NIGHT - bot.time.timeOfDay),
        bedCarried: !!bed, homeBedNearby: !!homeBed, homeBedDistance: homeBed ? Math.round(homeBed.foot.distanceTo(bot.entity.position)) : null, underground,
        sleepPossibleFrom: SLEEP_FROM, armedAndArmoured: kitReady(bot), armourWorn: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean), weapon: defenseWeapon(bot)?.name || null, nightsWithoutSleepTooMany: !!this.sleepDebt(),
        shelterReady: !!refuge?.verifiedAt, shelterDistance: refuge ? Math.round(pos(refuge.origin).distanceTo(bot.entity.position)) : null },
      recentSurvivalAction: goal.survivalAction, carriedBuildingBlocks: shelter.materialStock(bot),
      foodReserve: { foodPoints: foodSupply(bot), desiredMinimum: desiredFood, hungerMaximum: 20, starvationAt: 0,
        requiredBeforeExpedition: !!expeditionFood } };
    const armed = kitReady(bot);
    // Phantoms come for a player who has not slept in three nights. After
    // two nights awake (sealed in, night mining, staying up), staying up is
    // off the table while a bed is on offer.
    // At night carrying on is staying up, two minutes at a time; whether the
    // kit, the bed and the nights without sleep make that wise is Jev's to
    // weigh from the facts.
    const stayUp = night(bot) && needsShelter;
    // The mobs about now, seen or not, and whether health comes back,
    // beside staying up (the decision audit, 2026-09-25).
    const about = state.riskNow.hostilesWithin;
    const nowAbout = about.count ? ` Within ${about.blocks} blocks now: ${about.count} hostile mob${about.count === 1 ? '' : 's'}${about.count > about.inSight ? `, ${about.count - about.inSight} of them out of sight` : ''}${about.kinds.includes('creeper') ? ', creepers among them' : ''}.` : '';
    const healing = (bot.food ?? 20) >= 18 ? '' : ` Health does not come back meanwhile: hunger ${bot.food}, below eighteen.`;
    const tree = {
      continue_request: { description: stayUp
        ? `Stay up and keep working the request ${underground ? 'underground' : 'outside in the dark'}, two minutes at a time. ${underground ? 'Underground the night is no darker, but the surface it comes back up to is full of mobs until dawn' : 'Hostile mobs spawn around the bot all night'}; it is ${armed ? 'armed and armoured' : 'not armed and armoured'}${bedReady ? ', and the bed is one action away' : ', and there is no bed to fall back on'}.${this.sleepDebt() ? ' It has not slept for two nights: phantoms come for a player on the third.' : ''}${nowAbout}${healing}`
        : goal.kind === 'survive' ? 'Wait nearby between player requests when survival preparations are already sufficient.' : 'Spend the next action on the player request while outside. Suitable when hunger and the remaining daylight leave time for survival preparations afterwards, or when a verified shelter is already close enough to reach.',
        run: async () => { if (stayUp) { this.state.nightPlan = { plan: 'stay_up', until: Date.now() + 120000 }; this.report(goal, save, { action: 'stay_up', armed }); } } },
    };
    if (stayUp) {
      for (const [key, o] of Object.entries(this.huntOptions(goal))) tree[key] = { description: o.description,
        run: async () => { this.state.nightPlan = { plan: 'hunt', kind: o.kind, until: Date.now() + 120000, startHealth: bot.health }; this.report(goal, save, { action: 'night_hunt_chosen', kind: o.kind }); } };
      const stash = this.stashOption(goal);
      if (stash) tree.stash_valuables = { description: stash.description, run: () => stash.run(task, goal, save) };
      const cache = !stash && this.cacheOption(goal);
      if (cache) tree.cache_valuables = { description: cache.description, run: () => cache.run(task, goal, save) };
    }
    if (homeWalk) {
      const distance = Math.round(homeBed.foot.distanceTo(bot.entity.position));
      // The climb out and when the walk arrives against nightfall (the
      // decision audit, 2026-09-25).
      const { climbToSurface, climbMinutes } = require('./surface');
      const climb = underground ? climbToSurface(bot, bot.entity.position) : 0;
      const seconds = Math.round(distance / 4.3) + (climb || 0) * 3;
      const arrives = Math.round(bot.time.timeOfDay + seconds * 20);
      const arrival = arrives >= DAY.NIGHT ? `arriving about ${arrives % 24000}, after nightfall at ${DAY.NIGHT}` : `arriving about ${arrives}, before nightfall at ${DAY.NIGHT}`;
      tree.go_home_for_night = { description: `Walk home to the bed ${distance} blocks away${underground ? `, climbing out of the mine first (${climb != null ? `about ${climb} blocks up, roughly ${climbMinutes(climb)} minutes` : 'how far up is not known'})` : ''}, about ${Math.round(distance / 4.3)} seconds at a walk, ${arrival}, and wait there for bedtime (sleep is possible from ${SLEEP_FROM}; it is ${Math.round(bot.time.timeOfDay)} now). Held until the bot is there.`,
        run: async () => { this.state.nightPlan = { plan: 'home', until: Date.now() + 120000 }; await this.goHomeForNight(task, goal, save, homeBed, underground); } };
    }
    // Sleep is an option where the bed fits: two level cells beside the
    // feet. In a one-wide shaft it is not, and the shelter path digs in.
    if (needsShelter && bedReady && sleepable(bot) && ((homeBed && !underground) || bedSite(bot))) {
      // The walk to the bed and the monsters about it, seen or not: sleep is
      // refused while any is within eight blocks (the decision audit).
      const walk = homeBed ? Math.round(homeBed.foot.distanceTo(bot.entity.position)) : 0;
      // Offered with them counted, not hidden while any mob is within ten
      // (the decision review, 2026-09-26): one may be killed first, or be
      // outside the eight and five that refuse a sleep.
      const byBed = monstersByBed(bot, homeBed && !bed ? homeBed.foot : bot.entity.position);
      const refused = byBed ? ` ${byBed} monster${byBed === 1 ? ' is' : 's are'} within eight blocks sideways and five up or down of the bed now, seen or not: sleep is refused while any are.` : '';
      tree.sleep_in_bed = { description: homeBed && !bed ? `Walk to the bed ${walk} blocks away (about ${Math.round(walk / 4.3)} seconds) and sleep in it. The night passes in seconds, nothing is built or spent, and the request resumes at dawn.${refused}` : `Put the carried bed down here and sleep. The night passes in seconds, nothing is built or spent, and the request resumes at dawn.${refused}`, run: () => this.sleepStep(task, goal, save) };
    }
    // Where the carried bed does not fit (a staircase, a shaft), a nook dug
    // for it beside the bot: the bed that went down in the midgame trials
    // of 2026-09-26 was offered only on two level cells, and the bot sealed
    // itself in eleven times with it on its back.
    const nook = needsShelter && bed && bedReady && sleepable(bot) && !bedSite(bot) && !isSetAside(this, 'bed_nook', 'here') && bedNook(bot, goal);
    if (nook) tree.sleep_in_nook = { description: `Where the bed does not fit as the ground lies, ${nookSays(bot, nook)} Nothing is built or spent, and the request resumes at dawn.`, run: () => this.nookSleep(task, goal, save) };
    // Beside a bed a shelter is the worse answer, and the option says so
    // rather than being hidden.
    // A creeper about, and how soon it could go off beside the bot, said on
    // the shelter as on every stance: first-days-222 chose the shelter with
    // a creeper five blocks off, told only of sealing a room before night,
    // and was blown up three seconds later (2026-09-26).
    const creeperRaceSays = creeperSays(bot);
    if (needsShelter) tree.secure_shelter = { description: `Prepare and enter a sealed shelter before hostile mobs spawn at night. Reserve a nearby site, obtain missing blocks, then seal the room; keep the player request saved. Dawn is about ${minutesToDawn(bot)} real minutes off; in the shelter it can mine or wait.${creeperRaceSays}` + (bedReady ? ` A bed is in reach: sleeping in it (possible from ${SLEEP_FROM}) passes the night in seconds, and a shelter spends the night awake.` : ''),
      run: async () => { this.state.nightPlan = { plan: 'shelter', until: Date.now() + 120000 }; await this.refugeStep(task, goal, save); } };
    // At night too, with what it risks said, not hidden (the decision
    // audit, 2026-09-25): hungry in the dark, the food was never offered.
    if (needsFood) tree.obtain_food = { description: 'Obtain safe food to restore hunger and maintain a reserve for healing and the coming night. Keep the player request saved.' + (night(bot) && needsShelter ? ` Night: mobs spawn on the way; hunger ${bot.food}, starvation at 0.` : ''),
      children: offWorld && this.actions.returnOverworld ? this.offWorldFood(task, goal, save) : await forageChoices(bot, task, goal, save, this.actions, this.state) };
    if (tree.obtain_food && !Object.keys(tree.obtain_food.children).length) delete tree.obtain_food;
    // Without Jev, shelter comes before food and food before the request
    // (the survival_priority question's fallback, in decisions/survival.js).
    // A reserve top-up once chosen is held, not asked again: at full health
    // and hunger "get food or carry on" went to Jev every five seconds,
    // thirty times in two bursts, obtain_food each time at 0.96 to 0.98.
    // Held for five minutes, while food is still wanted and nothing needs
    // shelter; the source is still Jev's to choose each time.
    const foodPlan = this.state.foodPlan;
    if (foodPlan && (foodPlan.until < Date.now() || !needsFood || needsShelter || stockPaused)) delete this.state.foodPlan;
    if (this.state.foodPlan && tree.obtain_food) delete tree.continue_request;
    // A choice whose way is resting is not a choice now: first-days-213
    // chose secure_shelter thirty times in five seconds, its sealing resting
    // after "Shelter verification failed", each run refused at once and the
    // question asked again (2026-09-26). It rests as long as what it ran
    // into, and Jev is told why.
    const notNow = {};
    for (const [key, entry] of Object.entries(attemptsFor(this).of('priority_option'))) {
      if (!tree[key]) continue;
      delete tree[key];
      notNow[key] = `${entry.why}; back in about ${Math.max(1, Math.round((entry.until - Date.now()) / 1000))} seconds`;
    }
    if (Object.keys(notNow).length) state.notNow = notNow;
    if (!Object.keys(tree).length) return false;
    const runChosen = async (key, option) => {
      try { await option.run(); }
      catch (err) {
        if (err.name !== 'SetAside') throw err;
        setAside(this, 'priority_option', key, err.message, Math.max(1000, (err.until || Date.now() + 60000) - Date.now())); save();
        return false;
      }
      return true;
    };
    // One option is not a question. Jev was asked to pick the only shelter
    // on offer every night the bot could not stay up.
    if (Object.keys(tree).length === 1 && !Object.values(tree)[0].children) { const [key, only] = Object.entries(tree)[0]; await runChosen(key, only); onStep(goal); return true; }
    const decision = await this.decide(task, goal, save, { id: 'survival_priority', state, tree, interrupt: () => checkThreats(bot),
      isFresh: () => bot.health === state.health && bot.food === state.food && !immediateThreat(bot) });
    onStep(goal);
    if (decision.stale) return true;
    if (decision.path[0] === 'obtain_food' && !hungry && !this.state.foodPlan) this.state.foodPlan = { until: Date.now() + 300000, at: new Date().toISOString() };
    if (decision.path[0] === 'continue_request') {
      delete this.state.foodPlan;
      if (!needsShelter) this.state.carryOnPlan = { until: Date.now() + 300000, food: bot.food, health: bot.health ?? 20 };
    } else delete this.state.carryOnPlan;
    if (!await runChosen(decision.path[0], { run: () => decision.action.run() })) return false;
    return decision.path[0] !== 'continue_request';
  }
}

module.exports = { chargeSays, creeperSays, costSays, openCells, eatSays, mealHelps, EAT_AFTER, PILLAR_SECONDS, BLOCK_SECONDS, EAT_SECONDS, CLIMBERS, MOVING_STANCES, chargeStopsAt, usesToClimbOut, SLEEP_DEBT_TICKS, Survival, inLava, inWater, lavaExit, besideDrop, firmGround, night, shelterNeeded, lavaBeside, bedSite, bedNook, monstersByBed, nearbyHomeBed, observedBed, sleepable, SLEEP_FROM };
