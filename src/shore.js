'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, surveyRoute } = require('./skills');
const { surfaceMovement } = require('./surface');
const { dryPassable, swimmableWater, damagingTerrain, supportCell } = require('./terrain');
const { dryStanding } = require('./mining-access');
const { safeFromHostiles, checkThreats } = require('./danger');
const { checkAir } = require('./vitals');
const { floatAfterBoat, clearOwnedBoatAtFeet, leaveBoat } = require('./boats');
const { move: motion } = require('./motion');

// Shelter construction needs dry ground before it can choose a local site.
// A failed crossing may leave that ground farther away than the shelter scan.
async function reachShore(bot, task, goal, save, { move = navigate, surface = floatAfterBoat } = {}) {
  task.check();
  if (dryStanding(bot, bot.entity.position) || !swimmableWater(bot.blockAt(bot.entity.position.floored()))) return false;
  if (bot.vehicle) await leaveBoat(bot);
  if (bot._ownedBoats?.size) await clearOwnedBoatAtFeet(bot, task);
  const start = bot.entity.position.floored();
  let waterY = start.y;
  while (waterY < start.y + 16 && swimmableWater(bot.blockAt(new Vec3(start.x, waterY + 1, start.z)))) waterY++;
  // No open surface above: the water fills to a roof. Nothing to float up
  // to, so straight to digging out (it spun on this error 783 times in two
  // minutes of the drill).
  if (!dryPassable(bot.blockAt(new Vec3(start.x, waterY + 1, start.z)))) {
    const movement = bot.pathfinder.movements, saved = { canDig: movement.canDig, dontCreateFlow: movement.dontCreateFlow, allowedPosition: movement.allowedPosition };
    try { if (await digToShore(bot, task, goal, save, movement, move, goal.shoreRecovery?.failures || {})) return true; }
    finally { Object.assign(movement, saved); bot.pathfinder.setGoal(null); bot.clearControlStates(); }
    throw new Error('No open water surface observed while seeking shore');
  }
  // Floating up first, where it can be done: under a roof it cannot, and a
  // failed float ended the search before the dig-out had its turn.
  let floated = true;
  try { await surface(bot, task, waterY); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; floated = false; }
  task.check(); checkAir(bot); checkThreats(bot);
  const movement = bot.pathfinder.movements;
  const previous = { canDig: movement.canDig, scafoldingBlocks: movement.scafoldingBlocks, allowParkour: movement.allowParkour };
  const policy = surfaceMovement(bot);
  Object.assign(movement, { canDig: false, scafoldingBlocks: [], allowParkour: false });
  const state = goal.shoreRecovery ||= { failures: {} };
  state.failures = Object.fromEntries(Object.entries(state.failures || {}).filter(([, at]) => at > Date.now() - 60000));
  const safe = p => dryStanding(bot, p) && !damagingTerrain.has(bot.blockAt(supportCell(p))?.name) &&
    policy.isSurface(p) && movement.allowedPosition(p) && safeFromHostiles(bot, p);
  try {
    const ids = bot.registry.blocksArray.filter(b => b.boundingBox === 'block' && !/_leaves$|_log$/.test(b.name)).map(b => b.id);
    const land = bot.findBlocks({ matching: ids, maxDistance: 64, count: 256,
      useExtraInfo: block => safe(block.position.offset(0, 1, 0)),
    }).map(p => p.offset(0, 1, 0)).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    const checked = new Set();
    let attempts = 0;
    for (const p of land) {
      task.check(); checkAir(bot); checkThreats(bot);
      const area = `${Math.floor(p.x / 4)},${p.y},${Math.floor(p.z / 4)}`;
      if (checked.has(area) || state.failures[`${p}`] > Date.now() - 60000) continue;
      checked.add(area); if (checked.size > 24) break;
      const destination = new goals.GoalBlock(p.x, p.y, p.z);
      const route = await surveyRoute(bot, task, movement, destination, 300);
      if (route.status !== 'success' || (route.path || []).some(q => !movement.allowedPosition(q) || q.toBreak?.length || q.toPlace?.length) || !safe(p)) continue;
      goal.step = { action: 'reach_shore', from: { ...bot.entity.position }, destination: { ...p } };
      goal.survivalAction = { action: 'reach_shore', at: new Date().toISOString() }; save();
      try {
        await move(bot, task, destination, { timeoutMs: 30000, stallMs: 5000 });
        task.check(); checkAir(bot); checkThreats(bot);
        if (!safe(bot.entity.position) || bot.entity.onGround === false || !bot.entity.position.floored().equals(p)) throw new Error('Shore travel did not reach its dry landing');
        state.landed = { position: { ...bot.entity.position }, at: new Date().toISOString() }; delete state.lastError; save();
        return true;
      } catch (error) {
        task.check();
        if (['NeedsAir', 'NeedsSafety'].includes(error.name)) throw error;
        state.failures[`${p}`] = Date.now(); state.lastError = error.message; save();
        if (++attempts >= 3) break;
      }
    }
    // Under a roof no landing is "surface", and the base's own flooded pit,
    // with its dry floor one block away, had no shore at all: the bot bobbed
    // in it through an evening. With no landing even tried, the nearest dry
    // cell with a floor and air for the body is climbed onto, as out of lava.
    const { lavaExit, inWater } = require('./survival');
    const exit = lavaExit(bot);
    if (!attempts && exit && exit.offset(0.5, 0, 0.5).distanceTo(bot.entity.position) <= 3.5) {
      goal.step = { action: 'reach_shore', from: { ...bot.entity.position }, destination: { ...exit }, climb: true };
      goal.survivalAction = { action: 'reach_shore', at: new Date().toISOString() }; save();
      await motion(bot, task, { label: 'climb_out_of_water', keys: ['forward', 'jump'], sneak: false, why: 'out of the water onto the nearest dry cell',
        look: exit.offset(0.5, 1, 0.5), maxMs: 2500, tick: 50, until: () => bot.entity.onGround && !inWater(bot) });
      if (!inWater(bot)) { state.landed = { position: { ...bot.entity.position }, at: new Date().toISOString(), climbed: true }; save(); return true; }
    }
    // Walled in: a flooded cave whose dry side is behind stone. The replay
    // run swam in one for forty-five minutes, dry air three blocks east
    // through a wall the swimming route could not cross. The pickaxe makes
    // the shore: the nearest dry cell within ten blocks, dug to, water
    // allowed to flow (the pathfinder otherwise will not break a block
    // beside it), never lava.
    // After landings that failed too: the replay run's pool offered a swim to
    // a landing it never reached, every time, and that alone kept the pickaxe
    // out of it.
    // Out from under the surface rules first: they add a cost of a hundred to
    // breaking anything but leaves, and every dig route came back "noPath"
    // with dry cells a block away (the drill's probe found it).
    policy.restore();
    if (await stepOut(bot, task, goal, save)) return true;
    if (await notchOut(bot, task, goal, save)) return true;
    if (await digToShore(bot, task, goal, save, movement, move, state.failures)) return true;
    throw new Error('No reachable dry shore found in the observed water area');
  } finally {
    policy.restore(); Object.assign(movement, previous);
    bot.pathfinder.setGoal(null); bot.clearControlStates();
  }
}

// A block into the water beside the bot, at the waterline, as a player
// does: stood on, the bank is a block up and hopped onto. Blocks carried
// and a water cell beside with room over it; the step cut into the bank
// (notchOut) is the way without blocks.
async function stepOut(bot, task, goal, save) {
  const { inWater } = require('./survival');
  const shelter = require('./shelter');
  if (!inWater(bot) || typeof bot.placeBlock !== 'function') return false;
  const block = bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name));
  if (!block) return false;
  const feet = bot.entity.position.floored();
  const water = /water/.test(bot.blockAt(feet)?.name || '') ? feet : feet.offset(0, -1, 0);
  const wet = b => /water/.test(b?.name || '');
  const open = b => b && (b.boundingBox === 'empty');
  const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
  for (const d of dirs) {
    const cell = water.plus(d), under = cell.offset(0, -1, 0);
    if (!wet(bot.blockAt(cell)) || !open(bot.blockAt(cell.offset(0, 1, 0))) || !open(bot.blockAt(cell.offset(0, 2, 0)))) continue;
    // Something solid to place against: the floor under it, or a side.
    const faces = [[under, new Vec3(0, 1, 0)], ...dirs.map(f => [cell.plus(f), f.scaled(-1)])];
    const anchor = faces.find(([p]) => bot.blockAt(p)?.boundingBox === 'block');
    if (!anchor) continue;
    goal.step = { action: 'step_out_of_water', at: { ...cell } };
    goal.survivalAction = { action: 'step_out_of_water', at: new Date().toISOString() }; save();
    try {
      await bot.equip(block, 'hand');
      await bot.placeBlock(bot.blockAt(anchor[0]), anchor[1]);
    } catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; continue; }
    if (bot.blockAt(cell)?.boundingBox !== 'block') continue;
    await motion(bot, task, { label: 'climb_out_of_water', keys: ['forward', 'jump'], sneak: false, why: 'onto the block placed at the waterline',
      look: cell.offset(0.5, 1.2, 0.5), maxMs: 2000, tick: 50, until: () => bot.entity.onGround && !inWater(bot) });
    (goal.shoreRecovery ||= {}).stepped = { at: new Date().toISOString(), at_cell: { ...cell } }; save();
    return !inWater(bot);
  }
  return false;
}

const NOTCH_DIG_MS = 4000;
// A pool whose banks stand too high to climb from the water: a step cut
// into the bank at the waterline, the two blocks over it dug out, and the
// bot climbs onto it. The live run swam in a one-wide pool with its banks
// two above the water and dived to dig a route, again and again.
async function notchOut(bot, task, goal, save) {
  const { inWater } = require('./survival');
  if (!inWater(bot) || typeof bot.dig !== 'function') return false;
  const feet = bot.entity.position.floored();
  const water = /water/.test(bot.blockAt(feet)?.name || '') ? feet : feet.offset(0, -1, 0);
  const solid = b => b?.boundingBox === 'block' && !/lava|magma/.test(b.name);
  const soft = b => b && (b.boundingBox === 'empty' ? !/water|lava/.test(b.name) : b.diggable && !/bedrock|obsidian|chest|furnace|bed$/.test(b.name));
  const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
  const lavaNear = c => [c, c.offset(1, 0, 0), c.offset(-1, 0, 0), c.offset(0, 0, 1), c.offset(0, 0, -1), c.offset(0, 1, 0)].some(q => /lava/.test(bot.blockAt(q)?.name || ''));
  // The bank beside the bot, or the nearest within four blocks swum to: a
  // lake under stone cliffs had no bank beside the spot the bot floated in.
  const options = [];
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
    const from = water.offset(dx, 0, dz);
    if (!/water/.test(bot.blockAt(from)?.name || '') || !bot.blockAt(from.offset(0, 1, 0)) || bot.blockAt(from.offset(0, 1, 0)).boundingBox === 'block') continue;
    for (const d of dirs) {
      const step = from.plus(d), body = step.offset(0, 1, 0), head = step.offset(0, 2, 0);
      if (!solid(bot.blockAt(step)) || !soft(bot.blockAt(body)) || !soft(bot.blockAt(head)) || lavaNear(body) || lavaNear(head)) continue;
      // Only a quick dig: in water and off the ground a block takes about
      // twenty-five times as long, and two of stone drowned the live bot
      // sinking while it dug. The game's own dig time says how long.
      const toDig = [body, head].map(c => bot.blockAt(c)).filter(b => b?.boundingBox === 'block');
      const ms = toDig.reduce((n, b) => n + (typeof bot.digTime === 'function' ? bot.digTime(b) : 500), 0);
      if (ms > NOTCH_DIG_MS) continue;
      options.push({ from, step, body, head, cost: Math.abs(dx) + Math.abs(dz) + toDig.length });
    }
  }
  options.sort((a, b) => a.cost - b.cost);
  for (const { from, step, body, head } of options.slice(0, 3)) {
    if (!from.equals(water)) {
      await motion(bot, task, { label: 'swim_to_bank', keys: ['forward', 'jump'], sneak: false, why: 'swimming to the bank a step can be cut into',
        look: from.offset(0.5, 0.8, 0.5), maxMs: 4000, tick: 50, until: () => bot.entity.position.floored().x === from.x && bot.entity.position.floored().z === from.z });
      if (bot.entity.position.floored().x !== from.x || bot.entity.position.floored().z !== from.z) continue;
    }
    goal.step = { action: 'notch_out_of_water', step: { ...step } };
    goal.survivalAction = { action: 'notch_out_of_water', at: new Date().toISOString() }; save();
    const { equipBestTool } = require('./skills');
    // At the surface while digging (jump held), and never past the air:
    // the air rule surfaces the bot and the next step tries again.
    const { digWithAirGuard } = require('./vitals');
    for (const c of [head, body]) {
      const b = bot.blockAt(c);
      if (b?.boundingBox !== 'block') continue;
      task.check();
      try { await equipBestTool(bot, b); } catch (_) { /* the hand, then */ }
      bot.setControlState?.('jump', true);
      try { await digWithAirGuard(bot, task, b); }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
      finally { bot.setControlState?.('jump', false); }
    }
    await motion(bot, task, { label: 'climb_out_of_water', keys: ['forward', 'jump'], sneak: false, why: 'onto the step cut into the bank',
      look: body.offset(0.5, 0.5, 0.5), maxMs: 2500, tick: 50, until: () => bot.entity.onGround && !inWater(bot) });
    if (!inWater(bot)) { (goal.shoreRecovery ||= {}).notched = { at: new Date().toISOString(), step: { ...step } }; save(); return true; }
  }
  return false;
}

async function digToShore(bot, task, goal, save, movement, move, failed = {}) {
  const ids = bot.registry.blocksArray.filter(b => b.boundingBox === 'block').map(b => b.id);
  const dry = p => dryStanding(bot, p) && !damagingTerrain.has(bot.blockAt(supportCell(p))?.name);
  const lavaNear = p => [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, 2, 0], [0, -1, 0]]
    .some(([dx, dy, dz]) => /lava/.test(bot.blockAt(p.offset(dx, dy, dz))?.name || ''));
  const cells = bot.findBlocks({ matching: ids, maxDistance: 10, count: 128, useExtraInfo: block => dry(block.position.offset(0, 1, 0)) })
    .map(p => p.offset(0, 1, 0))
    // A landing the swim just failed to reach is not tried again by digging.
    .filter(p => !(failed[`${p}`] > Date.now() - 60000))
    .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
  // Without the shore search's surface-only rule too: under a roof nothing
  // is surface, and every dig route came back "noPath" with dry cells a
  // block away.
  const saved = { canDig: movement.canDig, dontCreateFlow: movement.dontCreateFlow, allowedPosition: movement.allowedPosition };
  Object.assign(movement, { canDig: true, dontCreateFlow: false, allowedPosition: undefined });
  // What the dig looked at, for the record when it finds nothing.
  const record = (goal.shoreRecovery ||= {}).dig = { at: new Date().toISOString(), cells: cells.length, tried: [] };
  try {
    for (const p of cells.slice(0, 4)) {
      task.check(); checkAir(bot);
      const destination = new goals.GoalBlock(p.x, p.y, p.z);
      const route = await surveyRoute(bot, task, movement, destination, 800);
      const lava = (route.path || []).some(q => lavaNear(new Vec3(q.x, q.y, q.z)));
      record.tried.push({ to: `${p}`, status: route.status, lava }); save();
      // Never down: a route that dives to dig sank the bot three blocks, the
      // air rule brought it up, and it dived again every ten seconds.
      const dives = (route.path || []).some(q => q.y < Math.floor(bot.entity.position.y) - 1);
      if (route.status !== 'success' || lava || dives) continue;
      goal.step = { action: 'dig_to_shore', from: { ...bot.entity.position }, destination: { ...p } };
      goal.survivalAction = { action: 'dig_to_shore', at: new Date().toISOString() }; save();
      try { await move(bot, task, destination, { timeoutMs: 45000, stallMs: 8000 }); }
      catch (error) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(error.name)) throw error; continue; }
      if (dryStanding(bot, bot.entity.position)) return true;
    }
    return false;
  } finally { Object.assign(movement, saved); }
}

// Open sea with no ground in sight. The dream run's night tunnel came up
// under a cold ocean, and the bot stood on its own pillar searching for oak
// logs 233 times: every survey found only the sea floor, and the taiga it
// had walked the day before lay a hundred blocks west. A player swims for
// the land they remember. The nearest explored area of a land biome (home
// if there is none), swum to at the surface until ground comes into view;
// the search then walks onto it like any other.
const SEA_BIOME = /ocean|river/;
const SWIM_MS = 180000, SEGMENT_MS = 2000, LAND_IDS = ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'moss_block', 'stone',
  'granite', 'diorite', 'andesite', 'sand', 'red_sand', 'gravel', 'sandstone', 'snow_block', 'clay', 'mud'];

function atSea(bot) {
  const feet = bot.entity.position.floored();
  let water = 0;
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
    if (/water/.test(bot.blockAt(feet.offset(dx, 0, dz))?.name || '') || /water/.test(bot.blockAt(feet.offset(dx, -1, dz))?.name || '')) water++;
  }
  return water >= 40;
}

// The dry ground the bot stands on, as columns: its pillar, and the sand
// bar eleven blocks long it was on in the live run, whose far end a
// distance rule counted as land in sight. Columns whose topmost block (four
// above to four below the start) is solid and not under water, joined side
// to side. Null when there is more of it than an islet has.
const ISLET = 600;
function ownGround(bot, from) {
  const start = from.floored();
  const dry = (x, z) => {
    for (let y = start.y + 4; y >= start.y - 4; y--) {
      const b = bot.blockAt(new Vec3(x, y, z));
      if (!b) return false;
      if (/water|kelp|seagrass|lava|bubble|ice/.test(b.name)) return false;
      if (b.boundingBox === 'block') return true;
    }
    return false;
  };
  // Every column under the body: standing at a bank's edge, the centre is
  // over the water and the feet are on the bank (the live run declined for
  // that, its own bar three blocks off counted as land in sight).
  const seen = new Set(), queue = [];
  for (const dx of [-0.3, 0.3]) for (const dz of [-0.3, 0.3]) {
    const x = Math.floor(from.x + dx), z = Math.floor(from.z + dz), k = `${x},${z}`;
    if (!seen.has(k) && dry(x, z)) { seen.add(k); queue.push([x, z]); }
  }
  while (queue.length) {
    const [x, z] = queue.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${z + dz}`;
      if (seen.has(k) || !dry(x + dx, z + dz)) continue;
      seen.add(k); if (seen.size > ISLET) return null;
      queue.push([x + dx, z + dz]);
    }
  }
  return seen;
}

// Land in view: dry ground to stand on that is more than an islet. The
// live run's sand bar was two, a block of water between them, and from one
// the other was "ground in view" every time. Other islets are skipped, the
// bot's own among them.
// Only ground at the sea's level or above: a cave floor at y 30 under the
// sea bed is dry standing too, and the live run declined for one.
function landInView(bot, reach, own = new Set()) {
  const ids = LAND_IDS.map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  const islets = new Set(own), level = Math.floor(bot.entity.position.y) - 2;
  const cells = bot.findBlocks({ matching: ids, maxDistance: reach, count: 64,
    useExtraInfo: b => { const p = b.position.offset(0, 1, 0); return p.y >= level && !own.has(`${p.x},${p.z}`) && dryStanding(bot, p); } })
    .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
  for (const c of cells) {
    if (islets.has(`${c.x},${c.z}`)) continue;
    const ground = ownGround(bot, c.offset(0.5, 1, 0.5));
    if (!ground) return c;
    for (const k of ground) islets.add(k);
  }
  return null;
}

function knownLand(bot, goal) {
  const { isSetAside } = require('./progress');
  const here = bot.entity.position;
  const AREA = 64, found = [];
  for (const [key, area] of Object.entries(goal.explored || {})) {
    const [where, cell] = key.split(':');
    if (where !== 'overworld' || !area.biome || SEA_BIOME.test(area.biome) || isSetAside(goal, 'cross_sea', key)) continue;
    const [ax, az] = cell.split(',').map(Number);
    found.push({ key, biome: area.biome.replace(/_/g, ' '), x: ax * AREA + AREA / 2, z: az * AREA + AREA / 2 });
  }
  const home = goal.survival?.home;
  if (home?.origin && /overworld/.test(home.dimension || 'overworld') && !isSetAside(goal, 'cross_sea', 'home')) found.push({ key: 'home', biome: 'home', x: home.origin.x, z: home.origin.z });
  const flat = p => Math.hypot(p.x - here.x, p.z - here.z);
  // Not the area the bot is floating in: its biome was read on the beach.
  return found.filter(p => flat(p) > 24).sort((a, b) => flat(a) - flat(b))[0] || null;
}

async function crossSea(bot, task, goal, save, { segmentMs = SEGMENT_MS, swimMs = SWIM_MS, move = navigate, toward = null } = {}) {
  const { inWater } = require('./survival');
  const { setAside } = require('./progress');
  // Why a crossing was not made, for the audit: the reason it declined.
  const decline = why => { goal.seaCrossing = { declined: why, at: new Date().toISOString(), from: { ...bot.entity.position.floored() } }; save(); return false; };
  if (!/overworld/.test(String(bot.game?.dimension || 'overworld'))) return decline('not the Overworld');
  if (!atSea(bot)) return false;
  const start = bot.entity.position.clone();
  const own = ownGround(bot, start);
  if (!own) return decline('standing on more ground than an islet');
  const seen = landInView(bot, 48, own);
  if (seen) return decline(`ground in view at ${seen}`);
  const { isSetAside } = require('./progress');
  const target = (toward && !isSetAside(goal, 'cross_sea', toward.key) && Math.hypot(toward.x - start.x, toward.z - start.z) > 12 ? toward : null) || knownLand(bot, goal);
  if (!target) return decline('no land remembered');
  const flat = () => Math.hypot(target.x - bot.entity.position.x, target.z - bot.entity.position.z);
  goal.step = { action: 'cross_sea', toward: { x: target.x, z: target.z }, land: target.biome, from: { ...start.floored() } }; save();
  const heading = Math.abs(target.x - start.x) > Math.abs(target.z - start.z) ? (target.x < start.x ? 'west' : 'east') : (target.z < start.z ? 'north' : 'south');
  bot.chat?.(target.key === 'home' ? `No land in sight. Swimming for home, ${Math.round(flat())} blocks ${heading}.`
    : target === toward ? `No land in sight. Swimming for the ${target.biome} I saw, ${Math.round(flat())} blocks ${heading}.`
      : `No land in sight. Swimming for the ${target.biome} I walked, ${Math.round(flat())} blocks ${heading}.`);
  // Off the pillar and into the sea: the nearest open water toward the land.
  if (!inWater(bot)) {
    const feet = start.floored(), cells = [];
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) for (const dy of [0, -1]) {
      const c = feet.offset(dx, dy, dz);
      if (/water/.test(bot.blockAt(c)?.name || '') && bot.blockAt(c.offset(0, 1, 0))?.boundingBox === 'empty' && !/water/.test(bot.blockAt(c.offset(0, 1, 0))?.name || '')) cells.push(c);
    }
    cells.sort((a, b) => (Math.hypot(a.x - target.x, a.z - target.z) + a.distanceTo(feet)) - (Math.hypot(b.x - target.x, b.z - target.z) + b.distanceTo(feet)));
    if (!cells.length) { setAside(goal, 'cross_sea', target.key, 'no open water to swim from', 10 * 60000); save(); return false; }
    try { await move(bot, task, new goals.GoalNear(cells[0].x, cells[0].y, cells[0].z, 1), { timeoutMs: 20000, stallMs: 6000, stopWhen: () => inWater(bot) }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    if (!inWater(bot)) { setAside(goal, 'cross_sea', target.key, 'could not get into the water', 10 * 60000); save(); return false; }
  }
  const began = Date.now(), before = flat();
  let stuck = 0;
  while (Date.now() - began < swimMs) {
    task.check(); checkAir(bot);
    if (landInView(bot, 24, own)) break;
    if (flat() < 8) { setAside(goal, 'cross_sea', target.key, 'swum there and found only water', 60 * 60000); save(); break; }
    const was = bot.entity.position.clone();
    await motion(bot, task, { label: 'swim_for_land', keys: ['forward', 'jump'], sneak: false, why: 'swimming for the land remembered',
      look: new Vec3(target.x, bot.entity.position.y + 1.6, target.z), maxMs: segmentMs, tick: 50 });
    const moved = Math.hypot(bot.entity.position.x - was.x, bot.entity.position.z - was.z);
    // Ice over the sea, a wall of rock: three segments without a block of
    // headway and the swim is over for now.
    if (moved < 1 && ++stuck >= 3) { setAside(goal, 'cross_sea', target.key, 'no headway swimming', 10 * 60000); save(); break; }
    if (moved >= 1) stuck = 0;
  }
  goal.step = { ...goal.step, swum: Math.round(before - flat()), landInView: !!landInView(bot, 24, own) }; save();
  return before - flat() >= 4 || !!goal.step.landInView;
}

module.exports = { reachShore, digToShore, notchOut, stepOut, crossSea, atSea, knownLand, landInView, ownGround };
