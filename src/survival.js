'use strict';
const { move } = require('./motion');
const { makeRoom } = require('./inventory-tidy');
const { attemptsFor, setAside, isSetAside, failedWithin, watch, unwatch } = require('./progress');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { threats, immediateThreat, checkThreats, hunted, claimed, hostileEntities } = require('./danger');
const shelter = require('./shelter');
const { decide } = require('./decisions');
const { maintainVitals, chooseFood, checkAir } = require('./vitals');
const { foodSupply, forageChoices } = require('./foraging');
const { bedCarried, placeOriented, isBed, homeOf, layout, homeChores } = require('./home-base');
const { kitReady } = require('./mob-policy');
const { verifyHouse } = require('./objectives');
const { recoverItems } = require('./recovery');
const { surveyRoute, countOf } = require('./skills');
const { defendNearby, defenseWeapon, shooter, shotTargets, shoot, lowerShield, canStrike } = require('./combat');
const { digBunker, bunkerSide, wallStands, nearWall, centroid } = require('./bunker');
const { deflect } = require('./projectile-guard');
const { reservedForConstruction } = require('./build-sites');
const { reachShore } = require('./shore');
const { surfaceObserver } = require('./surface');
const { tunnelStep } = require('./tunneling');
const { thinking } = require('./speech');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pos = p => new Vec3(p.x, p.y, p.z);
const { DAY, night } = require('./day');
const { NETHER_FOOD_POINTS, KIT_FOOD_POINTS } = require('./home-stash');
// Lava within two blocks sideways or one below: a knockback lands in it.
// A cell the bot can step into without falling or burning: solid under it,
// room for its body, and no lava beside.
function firmStep(bot, p) {
  if (!p) return false;
  const floor = bot.blockAt(p.offset(0, -1, 0)), body = [bot.blockAt(p), bot.blockAt(p.offset(0, 1, 0))];
  return floor?.boundingBox === 'block' && !/lava|magma|fire/.test(floor.name) && body.every(b => b && b.boundingBox === 'empty' && !/lava|fire/.test(b.name)) && !lavaBeside(bot, p);
}
// Ore worth a night's digging, nearest first, below the bot or level with
// it: a tunnel up toward an ore in the roof is a tunnel toward the surface.
const NIGHT_ORES = new Set(['coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore',
  'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_copper_ore', 'deepslate_gold_ore', 'deepslate_redstone_ore', 'deepslate_lapis_ore', 'deepslate_diamond_ore', 'deepslate_emerald_ore']);
function nightOre(bot, feet, attempts) {
  const ids = [...NIGHT_ORES].map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
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

const inLava = bot => !!bot.entity?.isInLava || [0, 1].some(dy => bot.blockAt(bot.entity.position.floored().offset(0, dy, 0))?.name === 'lava');
const inWater = bot => !!bot.entity?.isInWater || bot.blockAt(bot.entity.position.floored())?.name === 'water';
function lavaExit(bot) {
  const feet = bot.entity.position.floored(), cells = [];
  const dry = c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'empty' && !/lava|fire|water/.test(b.name); };
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -1; dy <= 2; dy++) {
    const c = feet.offset(dx, dy, dz);
    if (bot.blockAt(c.offset(0, -1, 0))?.boundingBox !== 'block' || bot.blockAt(c.offset(0, -1, 0))?.name === 'magma_block' || !dry(c) || !dry(c.offset(0, 1, 0))) continue;
    cells.push(c);
  }
  const far = c => c.offset(0.5, 0, 0.5).distanceTo(bot.entity.position);
  return cells.sort((a, b) => far(a) - far(b))[0] || null;
}

// A fight is not taken with a drop beside the bot: one hit's knockback on
// a Nether ledge was a thirty-block fall, twice in ten minutes. Beside a
// drop means a neighbouring cell the body could be pushed into with no
// floor for three blocks under it, or lava under it.
const { besideDrop } = require('./terrain');
function firmGround(bot, radius = 4) {
  const feet = bot.entity.position.floored(), cells = [];
  const open = c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'empty' && !/lava|fire|water/.test(b.name); };
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -1; dy <= 1; dy++) {
    const c = feet.offset(dx, dy, dz);
    const floor = bot.blockAt(c.offset(0, -1, 0));
    if (floor?.boundingBox !== 'block' || /magma/.test(floor.name) || !open(c) || !open(c.offset(0, 1, 0)) || besideDrop(bot, c) || lavaBeside(bot, c)) continue;
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
const HOME_BED_WALK = 160;
function nearbyHomeBed(bot, goal) {
  const home = homeOf(bot, goal);
  if (!home?.bed?.claimedAt) return null;
  const { bed } = layout(home);
  const foot = pos(bed.foot), block = bot.blockAt(foot);
  if (foot.distanceTo(bot.entity.position) > HOME_BED_WALK || (block && !isBed(block))) return null;
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
const emptySite = (bot, refuge) => refuge.kind !== 'house' && !refuge.verifiedAt &&
  shelter.shell(refuge.origin).every(p => shelter.replaceable(bot.blockAt(p)));

// Minecraft actions are injected to avoid a dependency cycle with the work
// executor. The state lives on the retained goal and can also be shared by an
// idle companion session. No survival interruption replaces the player request.
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
    goal.survivalAction = { ...action, at: new Date().toISOString() }; save();
  }

  async flee(task, goal, save) {
    const bot = this.bot;
    // Off the edge before anything else is done about the mob. Only when
    // one is close enough to hit, and only to a cell a few blocks off.
    const close = threats(bot).filter(t => t.distance <= 8);
    if (close.length && besideDrop(bot, bot.entity.position.floored()) && !isSetAside(this, 'firm_ground', 'here')) {
      const cell = firmGround(bot);
      if (cell) {
        this.report(goal, save, { action: 'off_the_edge', to: { ...cell }, threats: close.map(t => t.entity.name) });
        try { await this.actions.navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 3000, stallMs: 1500 }); return; }
        catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; setAside(this, 'firm_ground', 'here', err, 5000); }
      }
    }
    // A swing can buy room, but it must not consume the escape action. Ending
    // the turn after every hit trapped an unarmed bot in a losing melee loop.
    const swung = await defendNearby(bot, task, goal, save);
    const danger = threats(bot).filter(t => t.visible);
    if (!danger.length) { lowerShield(bot); return; }
    // Something already in the air is answered before anything is decided:
    // the decision takes longer than the flight.
    if (!swung && await deflect(bot, task)) {
      this.report(goal, save, { action: 'block_shot', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health });
      return;
    }
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
    const hoglins = danger.filter(t => ['hoglin', 'zoglin'].includes(t.entity.name) && t.distance <= 10);
    if (hoglins.length >= 2 && await this.pillarFrom(task, goal, save, hoglins)) return;
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
    for (const t of targets) tree[`shoot_${t.entity.id}`] = { description: { action: 'Shoot this mob with the bow from where the bot stands. It is in clear view at bow range and shoots back; each arrow takes about a second to draw, standing still.',
      entity: t.entity.name, distance: Math.round(t.distance), arrowsCarried: countOf(bot, 'arrow') }, run: () => this.shootAt(task, goal, save, t) };
    tree.retreat = { description: 'Run for footing out of its range and out of its sight; the mob keeps shooting while the bot runs.', run: () => this.escape(task, goal, save, danger, armed) };
    if (shelter.materialStock(bot) >= 12) tree.dig_in = { description: 'Seal a two-block pocket where the bot stands and wait for it to lose interest.', run: () => this.sealHere(task, goal, save, danger) };
    const state = { health: bot.health, food: bot.food, arrowsCarried: countOf(bot, 'arrow'), recentSurvivalAction: goal.survivalAction,
      threats: danger.map(t => ({ name: t.entity.name, distance: Math.round(t.distance), shoots: shooter(t.entity) })) };
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

  async escape(task, goal, save, danger, armed) {
    const bot = this.bot;
    lowerShield(bot);
    this.report(goal, save, { action: 'escape_threat', threats: danger.map(t => ({ name: t.entity.name, distance: t.distance })) });
    const movements = bot.pathfinder.movements;
    const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, allowSprinting: movements.allowSprinting };
    Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: true });
    try {
      const ids = ESCAPE_FOOTING.map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
      // Away from every hostile about, not only the ones in view this
      // instant: at two health the bot ran from a blaze, then from a piglin
      // twenty blocks the other way, straight back to the blaze, which had
      // dropped out of sight for the second look.
      const about = [...new Set([...danger.map(t => t.entity), ...hostileEntities(bot, 32)])];
      const distance = p => Math.min(...about.map(e => e.position.distanceTo(p)));
      // A creeper does not burn off at dawn and follows to about sixteen
      // blocks. A six-block hop from one only buys a minute before it is back
      // at the same tree; the escape from a mob that persists has to reach
      // past its follow range, or the same creeper interrupts all morning.
      const persistent = danger.some(t => PERSISTENT_THREATS.has(t.entity.name));
      const footing = bot.findBlocks({ matching: ids, maxDistance: persistent ? 40 : 20, count: 512,
        useExtraInfo: b => shelter.solid(b) && shelter.replaceable(bot.blockAt(b.position.offset(0, 1, 0))) && shelter.replaceable(bot.blockAt(b.position.offset(0, 2, 0))),
      }).map(p => p.offset(0, 1, 0)).filter(p => !isSetAside(this, 'escape', p) && !lavaBeside(bot, p));
      const gaining = p => distance(p) >= distance(bot.entity.position) + 4;
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
          return;
        }
      }
      // The far spots first when the chaser persists; the ordinary hop is the
      // fallback, because standing still beside a creeper is never the answer.
      const far = persistent ? footing.filter(p => p.distanceTo(bot.entity.position) >= 20 && distance(p) >= 20).sort((a, b) => distance(b) - distance(a)) : [];
      const near = footing.filter(p => p.distanceTo(bot.entity.position) >= 6 && gaining(p)).sort((a, b) => distance(b) - distance(a));
      const candidates = [...far.slice(0, 12), ...near.slice(0, 12)];
      for (const p of candidates) {
        const destination = new goals.GoalBlock(p.x, p.y, p.z);
        const route = await surveyRoute(bot, task, movements, destination, 150);
        if (route.status !== 'success') continue;
        // Do not run through another hostile to escape the closest one.
        if (route.path.some(point => about.some(e => e.position.distanceTo(pos(point)) < Math.min(4, e.position.distanceTo(bot.entity.position) - 1)))) continue;
        try { await this.actions.navigate(bot, task, destination, { timeoutMs: persistent ? 14000 : 7000, stallMs: 3000 }); delete this.state.trappedSince; return; }
        catch (err) {
          task.check(); if (err.name === 'NeedsAir') throw err;
          setAside(this, 'escape', p, err, 60000); save();
          // Reobserve positions after a partial escape instead of running the
          // next stale route against the old mob positions.
          return;
        }
      }
      // Cornered with stone in hand: a wall between us and the mob beats a
      // hold. Only the cell one step toward it, and only while that cell is
      // still empty; a mob already in it is fought, not walled.
      // A wall on one side is not cover: a skeleton shot the bot while it
      // hid from a piglin. With a ranged mob in view and no way out, close
      // every open side into a two-block pocket and let it pass. Against a
      // melee mob alone, the single wall toward it is enough.
      const nearest = danger[0];
      // A herd is sealed out like a shooter: one wall toward one hoglin
      // leaves the other four, and the bot held a "defensive position" at
      // five health in the middle of seven of them.
      //
      // Counted at two ranges, because the arena's herd drill died three
      // times out of three: the nearest hoglin was eleven blocks off, so
      // nothing was a crowd, the bot charged it, and met four at three
      // blocks. A pack seen coming is a pack. Seal while there is still
      // time to place the blocks, and never charge into one.
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
      if (pack && !holding && bot.health >= 10 && nearWall(bot, centroid(danger))) {
        this.report(goal, save, { action: 'dig_in_bunker', threats: danger.map(t => t.entity.name).slice(0, 6), health: bot.health,
          held: Math.round((Date.now() - this.state.bunkerSince) / 1000) });
        try { await digBunker(bot, task, goal, save, { from: centroid(danger), navigate: this.actions.navigate }); delete this.state.trappedSince; return; }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
      }
      if ((crowd || danger.some(shoots)) && await this.sealHere(task, goal, save, danger)) { delete this.state.trappedSince; return; }
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
      for (let n = 0; n < 2; n++) { task.check(); checkAir(bot); await sleep(100); }
    } finally { Object.assign(movements, previous); bot.clearControlStates(); }
  }

  // Two blocks straight up, where the head room allows and blocks are
  // carried; true once the feet are clear of what was beneath them.
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

  async refugeStep(task, goal, save) {
    const bot = this.bot;
    if (await reachShore(bot, task, goal, save, { move: this.actions.navigate })) return;
    let refuge = await this.reachableRefuge(task, goal, save, this.currentShelter());
    if (!refuge) {
      // Beside a lava lake nothing within twelve blocks has a safe shell;
      // look further before giving the night up as unsafe.
      let sites = shelter.shelterSites(bot, goal);
      if (!sites.length) sites = shelter.shelterSites(bot, goal, 32);
      // Six sites, a little over half a second each: at a hundred and fifty
      // milliseconds every survey from a hollow eleven blocks under the
      // surface timed out, and the dream run retried the whole list for
      // seven attempts at dusk.
      let site;
      for (const p of sites.slice(0, 6)) {
        if ((await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalBlock(p.x, p.y, p.z), 600)).status === 'success') { site = p; break; }
      }
      // No site to walk to: the night is spent sealed in where the bot
      // stands, as the unreachable-shelter rule above intends.
      if (!site && await this.sealHere(task, goal, save, threats(bot).filter(t => t.visible))) return;
      if (!site) throw new Error('No reachable, supported 3 by 3 shelter site observed');
      refuge = { origin: { ...site }, dimension: bot.game.dimension, createdAt: new Date().toISOString() };
      this.state.shelters.push(refuge); save();
    }
    const missing = shelter.missingShell(bot, refuge);
    const stock = shelter.materialStock(bot);
    // Navigation can consume scaffold blocks or clear natural walls. Keep a
    // small travel reserve, then recheck the actual shell after entering.
    const required = missing.length + (shelter.inside(bot, refuge) ? 0 : 4);
    if (stock < required) {
      // A site selected above a mining pocket can reserve every block needed
      // to escape it. Reach that still-empty site before searching for supplies;
      // approachRefuge relaxes only this reservation and restores it afterwards.
      if (bot.entity.position.y < refuge.origin.y && emptySite(bot, refuge)) {
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
    for (const p of blocks) {
      task.check(); checkAir(bot);
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
    let refuge = this.state.shelters.find(s => s.origin.x === origin.x && s.origin.y === origin.y && s.origin.z === origin.z && s.dimension === bot.game.dimension);
    if (!refuge) { refuge = { origin: { ...origin }, dimension: bot.game.dimension, createdAt: new Date().toISOString(), emergency: true }; this.state.shelters.push(refuge); save(); }
    this.report(goal, save, { action: 'dig_in', threats: danger.map(t => t.entity.name), cells: shelter.missingShell(bot, refuge).length });
    // The nearest cells first: the ones a mob could step into.
    const material = () => bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name))?.name;
    const cells = shelter.missingShell(bot, refuge).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    for (const p of cells) {
      task.check();
      const name = material(); if (!name) break;
      if (danger.some(t => t.entity.position.floored().equals(p))) continue;
      try { await this.actions.place(bot, task, p, name); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; }
    }
    if (shelter.inside(bot, refuge) && shelter.sealed(bot, refuge)) { refuge.verifiedAt = new Date().toISOString(); save(); }
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
    if (!cells.length) return false;
    this.report(goal, save, { action: 'dig_in', threats: danger.map(t => t.entity.name), cells: cells.length });
    let placed = 0;
    for (const p of cells) {
      task.check();
      try { await this.actions.place(bot, task, p, material); placed++; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; }
    }
    return placed > 0;
  }

  // One mob, closed on so the fight rule can swing. Out of the sword's reach
  // is the test, not "beyond 3.2": between the two the bot neither swung
  // nor charged.
  async charge(task, goal, save, nearest, pack) {
    const bot = this.bot;
    if (pack || bot.health < 12 || nearest.distance > 8 || canStrike(bot, nearest.entity) || lavaBeside(bot, nearest.entity.position.floored())) return false;
    this.report(goal, save, { action: 'charge', target: nearest.entity.name, distance: Number(nearest.distance.toFixed(1)) });
    const t = nearest.entity.position;
    try { await this.actions.navigate(bot, task, new goals.GoalNear(t.x, t.y, t.z, 1), { timeoutMs: 4000, stallMs: 2000 }); }
    catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; }
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

  async leave(task, goal, save, refuge, reason) {
    const bot = this.bot;
    // "Morning. Back to it." only when it is morning; a shelter left at
    // night for the bed, or with mobs outwaited, says so.
    reason ||= shelterNeeded(bot) ? 'Moving on.' : undefined;
    // Mobs that can see in, or are at the wall; the rest are behind rock.
    // Not the quarry, for a bot fit to fight it: the exit had to be twenty
    // blocks from every blaze, beside a spawner that is never true, so the
    // bot decided to leave and then refused every door for twenty minutes.
    const danger = threats(bot).filter(t => (t.visible || t.distance < 6) && !claimed(bot, t.entity));
    const formal = shelter.exits(bot, refuge).filter(exit => danger.every(t => t.entity.position.distanceTo(exit.outside) > 20));
    // A pocket sealed in a staircase has no two-block exit: its door is the
    // closure the bot placed, and the way on is dug from there.
    const pocket = !formal.length && shelter.closures(bot, refuge).filter(door => danger.every(t => t.entity.position.distanceTo(door) > 20));
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
  async sleepStep(task, goal, save) {
    const bot = this.bot, item = bedCarried(bot), placed = bedToSleepIn(bot, goal), site = placed || (item && bedSite(bot));
    if (!site) throw new Error('No level ground beside me for the bed');
    this.report(goal, save, { action: 'sleep', at: { ...site.foot }, home: !!placed });
    if (placed) {
      // A walk that fails is a route problem, not a bed problem: the shelter
      // path takes this night's next two minutes, and the bed stays in play.
      // The stand cell first (it is laid out to be reachable), then two and
      // three blocks from the foot: a single goal failed from twenty blocks.
      const approaches = [[site.stand, 1], [site.foot, 2], [site.foot, 3]];
      let reached = false, lastError = null;
      for (const [p, range] of approaches) {
        try { await this.actions.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, range), { timeoutMs: 45000, stallMs: 8000 }); reached = site.foot.distanceTo(bot.entity.position) <= 3.5; }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; lastError = err; }
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
    this.report(goal, save, { action: 'leave_shelter', reason: 'Morning. Back to it.' });
  }

  // Ticks awake since the last sleep, counted from the first time the bot
  // looked if it has never slept. Two in-game days is the limit.
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
    if ((bot.health ?? 20) < 10 || immediateThreat(bot)) return false;
    // Not with anything watching: the same test the pocket uses to stay shut.
    if (threats(bot).some(t => t.distance < 20 && (t.visible || t.distance < 6) && !claimed(bot, t.entity))) return false;
    if (!bot.inventory.items().some(i => /_pickaxe$/.test(i.name))) return false;
    if (sleepable(bot) && !sleepWaiting(this) && (bedCarried(bot) || bedToSleepIn(bot, goal))) return false;
    return true;
  }

  async nightMine(task, goal, save) {
    const bot = this.bot;
    if (!this.canNightMine(goal)) return false;
    // Ore dug with no free slot stays on the floor of the tunnel.
    if (bot.game?.gameMode !== 'creative' && !((bot.inventory.emptySlotCount?.() ?? 1) > 0) && !await makeRoom(bot, task, 'raw_iron')) return false;
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
      const ore = nightOre(bot, feet, attemptsFor(this));
      if (ore) { target = ore.position; mine.targetOre = ore.name; }
      else {
        // No ore in reach of the eye: a branch, down to a working depth
        // and then along, in the mine's heading.
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
    mine.heading++; delete mine.target; delete mine.tunnel; mine.failures = 0;
    const now = Date.now();
    mine.refusals = [...(mine.refusals || []).filter(r => now - r.at < 60000 && r.mined === mine.mined), { at: now, mined: mine.mined }];
    if (mine.refusals.length >= 4) { mine.boxedInUntil = now + 600000; mine.refusals = []; }
  }

  async wait(task, goal, save, reason = 'Waiting for daylight inside the verified shelter') {
    this.report(goal, save, { action: 'wait_in_shelter', reason });
    for (let i = 0; i < 50; i++) { task.check(); await sleep(100); }
  }

  async step(task, goal, save, onStep = () => {}) {
    const bot = this.bot;
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
      const exit = lavaExit(bot);
      this.report(goal, save, { action: 'leave_lava', to: exit && { ...exit }, health: bot.health });
      if (exit) {
        await move(bot, task, { label: 'out_of_lava', keys: ['forward', 'jump'], sneak: false, why: 'in lava: the nearest dry cell, whatever the ground',
          look: exit.offset(0.5, 1, 0.5), maxMs: 2500, tick: 50, until: () => !inLava(bot) && bot.entity.onGround });
      }
      onStep(goal); return true;
    }
    await maintainVitals(bot, task, action => this.report(goal, save, action));
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
      const outwaited = watched && Date.now() - this.state.watchedSince > 180000;
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
      const homeBed = sleepable(bot) && !watched && !sleepWaiting(this) && !failedWithin(this, 'bed_route', 'home', 600000) && bedToSleepIn(bot, goal);
      const shallow = homeBed && (surfaceObserver(bot)(bot.entity.position) || Math.abs(homeBed.foot.y - bot.entity.position.y) <= 10) ||
        // A bed in the pack is a bed too. A fight pocket dug at dusk held the
        // bot until dawn, eleven minutes behind a wall, with a bed on its back.
        (!homeBed && bot.game?.dimension === 'overworld' && sleepable(bot) && !watched && !sleepWaiting(this) && bedCarried(bot) && surfaceObserver(bot)(bot.entity.position));
      if (shallow) { delete this.state.watchedSince; await this.leave(task, goal, save, refuge, 'Off to bed.'); }
      else if ((shelterNeeded(bot) || watched) && !outwaited) {
        // Say who is keeping the bot in, and whether the hunt had claimed it:
        // a wait with no named reason cost an hour of guessing.
        const watcher = threats(bot).find(t => t.distance < 20 && (t.visible || t.distance < 6) && !claimed(bot, t.entity));
        const hunt = bot._huntingEntity;
        // Nothing watching: the night is spent working, not waiting. The
        // pocket is the mouth of a mine, and a tunnel in rock is as closed
        // as the pocket was.
        // Mined out of and sealed again three times in two minutes is a
        // pocket the mine cannot leave: on a hillside the first step is
        // into the open, the shelter fills it, and the mine digs it again,
        // every two seconds. That pocket is waited in tonight instead.
        const here = `${refuge.origin.x},${refuge.origin.y},${refuge.origin.z}`;
        const starts = (this.state.pocketStarts || []).filter(s => s.at > Date.now() - 120000 && s.pocket === here);
        if (starts.length >= 3 && !isSetAside(this, 'night_mine', here)) setAside(this, 'night_mine', here, 'the pocket was dug out of and resealed three times in two minutes', 600000);
        // Counted only when the mine dug: a try the mine declined (no room,
        // nothing in reach) is not a dig-out, and counting those set the mine
        // aside at y 23 under solid rock, where nothing ever resealed.
        if (!watcher && !watched && !isSetAside(this, 'night_mine', here)) {
          if (await this.nightMine(task, goal, save)) {
            this.state.pocketStarts = [...starts, { pocket: here, at: Date.now() }];
            onStep(goal); return true;
          }
        }
        await this.wait(task, goal, save, watcher
          ? `${watcher.entity.name} at ${watcher.distance.toFixed(1)} is watching (claim ${hunt ? `${hunt.name}, ${Math.round((hunt.until - Date.now()) / 1000)}s left` : 'none'}, hp ${Math.round(bot.health)}, food ${bot.food})`
          : 'Waiting for daylight inside the verified shelter');
      }
      else { delete this.state.watchedSince; await this.leave(task, goal, save, refuge); }
      onStep(goal); return true;
    }
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
      if (!adjacent && refuge && pos(refuge.origin).distanceTo(bot.entity.position) < 3 && shelter.materialStock(bot) >= shelter.missingShell(bot, refuge).length) await this.refugeStep(task, goal, save);
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
      const chore = ['stock_stash', 'harvest_and_bake', 'tend_farm', 'breed_cows'].map(k => chores[k]).find(Boolean) || Object.values(chores)[0];
      const home = homeOf(bot, goal);
      if (chore) {
        const key = Object.keys(chores).find(k => chores[k] === chore);
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
      } else if (home?.completedAt && !home.plotWide) {
        home.plotWide = true; save();
        this.report(goal, save, { action: 'grow_plot' });
      } else {
        this.report(goal, save, { action: 'wait_for_bedtime', ticks: SLEEP_FROM - bot.time.timeOfDay });
        for (let i = 0; i < 10; i++) { task.check(); await sleep(100); }
      }
      onStep(goal); return true;
    }
    const homeWalk = homeBed && shelterNeeded(bot) && homeBed.foot.distanceTo(bot.entity.position) > 6 && !immediateThreat(bot) && (underground || !routeBlocked);
    const walkStart = homeBed && homeBed.foot.distanceTo(bot.entity.position) > 96 ? DAY.WALK_HOME_FAR : DAY.WALK_HOME;
    if (homeWalk && (bot.time.timeOfDay >= walkStart || underground) && !sleepWaiting(this)) {
      this.report(goal, save, { action: 'go_home_for_night', distance: Math.round(homeBed.foot.distanceTo(bot.entity.position)), underground });
      // Out of the shaft by the stairs it dug, then home over the ground:
      // a path search from the bottom of a mine to a bed timed out. A
      // stumble on the stairs is retried next tick; only the walk itself
      // failing sets the bed aside, and only for two minutes.
      if (underground && this.actions.surfaceStep) {
        try { await this.actions.surfaceStep(bot, task, goal, save); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      } else if (bot.time.timeOfDay < SLEEP_FROM) {
        try { await this.actions.navigate(bot, task, new goals.GoalNear(homeBed.foot.x, homeBed.foot.y, homeBed.foot.z, 3), { timeoutMs: 60000, stallMs: 8000, sprint: true }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(this, 'bed_route', 'home', err, 120000); }
      }
      if (underground || bot.time.timeOfDay < SLEEP_FROM) { onStep(goal); return true; }
    }
    const plan = this.state.nightPlan?.until > Date.now() ? this.state.nightPlan : null;
    const stayingUp = plan?.plan === 'stay_up';
    // Before bedtime, a bed anywhere in reach (a walk that just failed
    // included) means no sealing in yet: the walk is retried in two minutes
    // and the shelter thirty blocks from the bed was the worse night.
    const bedInReach = (!!bed || !!homeBed) && bot.game.dimension === 'overworld';
    const needsShelter = shelterNeeded(bot) && !(bedInReach && bot.time.timeOfDay < SLEEP_FROM) && !stayingUp;
    // A shelter once chosen is a plan, not a question for every tick: the
    // second run climbed its shaft for a shelter, was asked again at the
    // top, went back down to the mine, and was asked again at the bottom.
    // Renewed while it is being carried out: a plan that lapsed after two
    // minutes of gathering blocks put the question again, and "carry on"
    // left the half-built shell standing in the dark.
    if (needsShelter && plan?.plan === 'shelter' && !(bedReady && sleepable(bot))) {
      plan.until = Date.now() + 120000;
      await this.refugeStep(task, goal, save); onStep(goal); return true;
    }
    if (!needsShelter && this.state.recovery?.status === 'pending') {
      this.report(goal, save, { action: 'recover_items', origin: this.state.recovery.position });
      if (await recoverItems(bot, task, this.state.recovery, save, this.actions.navigate)) { onStep(goal); return true; }
    }
    const expeditionFood = (goal.preparingExpedition || goal.preparingEnd || goal.preparingNether) && bot.game.difficulty !== 'peaceful';
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
    const hungry = bot.food <= hungerTrigger;
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
    const state = { playerRequest: goal.request, retainedGoal: goal.kind, timeOfDay: bot.time.timeOfDay,
      playerUrgency: goal.urgency ? { level: goal.urgency.level, meaning: 'How much the wording of the request pressed for speed: relaxed, ordinary or pressed. Pressure is a reason to keep working while it is still safe, never a reason to skip shelter once night is close.' } : undefined,
      health: bot.health, food: bot.food, safeFoodCarried: !!chooseFood(bot),
      survivalFacts: { difficulty: bot.game.difficulty, hostileMobsSpawnAtNight: true,
        nightStartsAt: DAY.NIGHT, dawnAt: DAY.DAWN, daylightTicksRemaining: Math.max(0, DAY.NIGHT - bot.time.timeOfDay),
        bedCarried: !!bed, homeBedNearby: !!homeBed, sleepPossibleFrom: SLEEP_FROM, armedAndArmoured: kitReady(bot),
        shelterReady: !!refuge?.verifiedAt, shelterDistance: refuge ? Math.round(pos(refuge.origin).distanceTo(bot.entity.position)) : null },
      recentSurvivalAction: goal.survivalAction, carriedBuildingBlocks: shelter.materialStock(bot),
      foodReserve: { foodPoints: foodSupply(bot), desiredMinimum: desiredFood, hungerMaximum: 20, starvationAt: 0,
        requiredBeforeExpedition: !!expeditionFood } };
    const armed = kitReady(bot);
    // Phantoms come for a player who has not slept in three nights. After
    // two nights awake (sealed in, night mining, staying up), staying up is
    // off the table while a bed is on offer.
    const canStayUp = night(bot) && needsShelter && bedReady && armed && !this.sleepDebt();
    const tree = (night(bot) && needsShelter && !canStayUp) || (expeditionFood && needsFood) ? {} : {
      continue_request: { description: canStayUp ? 'Stay up tonight, armed and armoured, and keep working the request outside: spiders and the other night mobs are what a hunt for string needs, and the bed is one action away whenever the night has nothing more to give. Two minutes at a time, then this question again.'
        : goal.kind === 'survive' ? 'Wait nearby between player requests when survival preparations are already sufficient.' : 'Spend the next action on the player request while outside. Suitable when hunger and the remaining daylight leave time for survival preparations afterwards, or when a verified shelter is already close enough to reach.',
        run: async () => { if (canStayUp) { this.state.nightPlan = { plan: 'stay_up', until: Date.now() + 120000 }; this.report(goal, save, { action: 'stay_up' }); } } },
    };
    // Sleep is an option where the bed fits: two level cells beside the
    // feet. In a one-wide shaft it is not, and the shelter path digs in.
    if (needsShelter && bedReady && sleepable(bot) && ((homeBed && !underground) || bedSite(bot)) && !threats(bot).some(t => t.distance < 10)) tree.sleep_in_bed = { description: homeBed?.observed && !bed ? `Walk to the bed ${Math.round(homeBed.foot.distanceTo(bot.entity.position))} blocks away and sleep in it. The night passes in seconds, nothing is built or spent, and the request resumes at dawn.` : 'Put the carried bed down here and sleep. The night passes in seconds, nothing is built or spent, and the request resumes at dawn.', run: () => this.sleepStep(task, goal, save) };
    // A bed within reach makes a shelter the worse answer in every case, so
    // it is not offered beside one: the question that remains at night is
    // sleep or stay up, which is the one worth asking.
    if (needsShelter && !tree.sleep_in_bed) tree.secure_shelter = { description: 'Prepare and enter a sealed shelter before hostile mobs spawn at night. Reserve a nearby site, obtain missing blocks, then seal the room; keep the player request saved.',
      run: async () => { this.state.nightPlan = { plan: 'shelter', until: Date.now() + 120000 }; await this.refugeStep(task, goal, save); } };
    if (needsFood && !(night(bot) && needsShelter)) tree.obtain_food = { description: 'Obtain safe food to restore hunger and maintain a reserve for healing and the coming night. Keep the player request saved.',
      children: offWorld && this.actions.returnOverworld ? { return_for_food: { description: 'Go back through the portal to the Overworld, where food can be hunted and cooked; nothing here is safe to eat.',
        run: async () => { goal.survivalAction = { action: 'return_for_food', at: new Date().toISOString() }; save(); await this.actions.returnOverworld(bot, task, goal, save); } } }
        : await forageChoices(bot, task, goal, save, this.actions, this.state) };
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
    // One option is not a question. Jev was asked to pick the only shelter
    // on offer every night the bot could not stay up.
    if (Object.keys(tree).length === 1 && !Object.values(tree)[0].children) { await Object.values(tree)[0].run(); onStep(goal); return true; }
    const decision = await this.decide(task, goal, save, { id: 'survival_priority', state, tree, interrupt: () => checkThreats(bot),
      isFresh: () => bot.health === state.health && bot.food === state.food && !immediateThreat(bot) });
    onStep(goal);
    if (decision.stale) return true;
    if (decision.path[0] === 'obtain_food' && !hungry && !this.state.foodPlan) this.state.foodPlan = { until: Date.now() + 300000, at: new Date().toISOString() };
    if (decision.path[0] === 'continue_request') delete this.state.foodPlan;
    await decision.action.run();
    return decision.path[0] !== 'continue_request';
  }
}

module.exports = { SLEEP_DEBT_TICKS, Survival, inLava, inWater, lavaExit, besideDrop, firmGround, night, shelterNeeded, lavaBeside, bedSite, nearbyHomeBed, observedBed, sleepable, SLEEP_FROM };
