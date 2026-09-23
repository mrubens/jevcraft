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
  if (!dryPassable(bot.blockAt(new Vec3(start.x, waterY + 1, start.z)))) throw new Error('No open water surface observed while seeking shore');
  await surface(bot, task, waterY);
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
    throw new Error('No reachable dry shore found in the observed water area');
  } finally {
    policy.restore(); Object.assign(movement, previous);
    bot.pathfinder.setGoal(null); bot.clearControlStates();
  }
}

module.exports = { reachShore };
