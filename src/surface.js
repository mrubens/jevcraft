'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { surveyRoute, navigate } = require('./skills');
const { safeFromHostiles } = require('./danger');
const { tunnelStep } = require('./tunneling');
const { dryPassable, dryLeaf, dryBodySpace, supportCell, swimmableWater } = require('./terrain');

// Inspect loaded columns, ignoring tree canopies but not terrain, roofs or
// water. Two clear cave blocks are not evidence of a surface destination.
function surfaceObserver(bot) {
  const heights = new Map();
  const minimum = bot.game.minY ?? -64;
  const maximum = minimum + (bot.game.height ?? 384);
  return point => {
    const x = Math.floor(point.x), z = Math.floor(point.z), key = `${x},${z}`;
    if (!heights.has(key)) {
      let top = minimum - 1;
      for (let y = maximum - 1; y >= minimum; y--) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) { top = Infinity; break; }
        if (/_leaves$|_log$|_wood$/.test(block.name)) continue;
        if (block.boundingBox === 'block' || swimmableWater(block) || ['lava', 'bubble_column', 'powder_snow'].includes(block.name)) { top = y; break; }
      }
      heights.set(key, top);
    }
    return point.y > heights.get(key);
  };
}

function surfaceMovement(bot) {
  const movements = bot.pathfinder.movements;
  const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers,
    allowSprinting: movements.allowSprinting, scafoldingBlocks: movements.scafoldingBlocks,
    allowedPosition: movements.allowedPosition, exclusionAreasBreak: movements.exclusionAreasBreak };
  const isSurface = surfaceObserver(bot);
  const start = bot.entity.position.floored();
  // Permit leaving a house or a tree's immediate cover without allowing a
  // downhill cave route. Every subsequent surface step remains constrained.
  const surfaceSwimming = p => {
    const feet = new Vec3(p.x, p.y, p.z), head = feet.offset(0, 1, 0);
    return swimmableWater(bot.blockAt(feet)) && dryPassable(bot.blockAt(head)) && isSurface(head);
  };
  // A river's upper water cell is a surface route when the head remains in
  // open air. Requiring the feet to be above the water stranded explorers on
  // riverbanks even when the pathfinder had a safe swimming route across.
  const allowed = p => isSurface(p) || surfaceSwimming(p) ||
    (Math.abs(p.x - start.x) <= 4 && Math.abs(p.z - start.z) <= 4 && p.y >= start.y);
  // Carried scaffolding can bridge a gap, but searching for trees must not
  // build vertical pillars that strand the bot above the available ground.
  // Clear leaf body-space when a canopy blocks an otherwise supported route.
  // Trunks, terrain and buildings still cannot be excavated by surface travel;
  // stricter inherited no-dig and construction restrictions remain in force.
  Object.assign(movements, { canDig: previous.canDig === true, allowSprinting: false, allow1by1towers: false,
    exclusionAreasBreak: [...(previous.exclusionAreasBreak || []), block => dryLeaf(block) ? 0 : 100],
    allowedPosition: p => allowed(p) && (!previous.allowedPosition || previous.allowedPosition(p)) });
  return { isSurface, allowed, restore: () => Object.assign(movements, previous) };
}

// Tree supports are useful intermediate landings, even when ordinary ground
// is too far below. Each successful step loses height; no shaft digging,
// invented landing or scaffold construction is needed for this recovery.
async function descendCanopy(bot, task, goal, save, { move = navigate } = {}) {
  task.check();
  const start = bot.entity.position.clone(), footing = bot.blockAt(supportCell(start));
  const tree = b => b?.boundingBox === 'block' && (dryLeaf(b) || /_log$/.test(b.name));
  if (bot.entity.onGround === false || !tree(footing) || !dryBodySpace(bot, start)) return false;
  const movement = bot.pathfinder.movements, policy = surfaceMovement(bot);
  const previous = { scafoldingBlocks: movement.scafoldingBlocks, allowParkour: movement.allowParkour };
  const inherited = movement.allowedPosition;
  const allowed = p => p.y >= start.y - 3 && p.y <= start.y + 1 &&
    Math.hypot(p.x - start.x, p.z - start.z) <= 8 && inherited(p);
  Object.assign(movement, { scafoldingBlocks: [], allowParkour: false, allowedPosition: allowed });
  const clearableLeaf = b => dryLeaf(b) && movement.canDig === true && !movement.blocksCantBreak?.has(b.type) &&
    (movement.exclusionAreasBreak || []).reduce((cost, rule) => cost + rule(b), 0) < 100;
  const landingSafe = (p, allowClearing = false) => p.y < start.y - .5 && allowed(p) && tree(bot.blockAt(p.offset(0, -1, 0))) &&
    (dryBodySpace(bot, p) || allowClearing && [p, p.offset(0, 1, 0)].every(q => {
      const block = bot.blockAt(q); return dryPassable(block) || clearableLeaf(block);
    })) && safeFromHostiles(bot, p.offset(.5, 0, .5));
  try {
    const ids = bot.registry.blocksArray.filter(b => /_leaves$|_log$/.test(b.name)).map(b => b.id);
    const candidates = bot.findBlocks({ matching: ids, maxDistance: 8, count: 48,
      // A thick crown can hide the only lower trunk behind two leaf blocks.
      // Survey that clearance; requiring air here discarded it before routing.
      useExtraInfo: b => landingSafe(b.position.offset(0, 1, 0), true),
    }).map(p => p.offset(0, 1, 0)).sort((a, b) => a.distanceTo(start) - b.distanceTo(start));
    for (const p of candidates.slice(0, 8)) {
      task.check();
      const destination = new goals.GoalBlock(p.x, p.y, p.z);
      const route = await surveyRoute(bot, task, movement, destination, 300);
      const breaks = (route.path || []).flatMap(q => q.toBreak || []);
      if (route.status !== 'success' || (route.path || []).length > 16 ||
          new Set(breaks.map(b => `${b.x},${b.y},${b.z}`)).size > 8 ||
          !(route.path || []).every(q => allowed(q) && !q.toPlace?.length &&
            (q.toBreak || []).every(b => clearableLeaf(bot.blockAt(new Vec3(b.x, b.y, b.z))))) || !landingSafe(p, true)) continue;
      task.check();
      goal.step = { action: 'descend_canopy', from: { ...start }, destination: { ...p } }; save();
      await move(bot, task, destination, { timeoutMs: 12000, stallMs: 4000 });
      task.check();
      if (!landingSafe(p) || !dryBodySpace(bot, bot.entity.position) || bot.entity.onGround === false ||
          !bot.entity.position.floored().equals(p)) throw new Error('Canopy descent did not reach the inspected landing');
      goal.step.landed = { ...bot.entity.position }; save(); return true;
    }
    return false;
  } finally {
    policy.restore();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete movement[key]; else movement[key] = value;
  }
}

// Open sky is not an exit from a ravine. After ordinary surface routes fail,
// retain a nearby observed higher landing as the minimum escape elevation.
// This is only proposed from actual dry surface candidates, never a guessed Y.
function beginSurfaceAscent(bot, goal, candidates) {
  const start = bot.entity.position;
  const target = candidates.filter(p => p.y >= start.y + 4 && p.y <= start.y + 32 &&
    Math.hypot(p.x - start.x, p.z - start.z) <= 24 && safeFromHostiles(bot, p))
    .sort((a, b) => a.y - b.y || a.distanceTo(start) - b.distanceTo(start))[0];
  if (!target) return false;
  goal.surfaceReturn ||= { attempts: 0, visited: {} };
  Object.assign(goal.surfaceReturn, { minimumY: target.y, target: { ...target }, reason: 'No progress through surface routes below observed higher ground' });
  return true;
}

function surfaceReturnComplete(bot, goal, isSurface = surfaceObserver(bot)) {
  return isSurface(bot.entity.position) && bot.entity.position.y >= (goal.surfaceReturn?.minimumY ?? -Infinity);
}

// Gathering stone or cooking can leave us under terrain. Surface-only travel
// intentionally cannot leave a deep alcove, so first route to an inspected
// surface landing using ordinary mining/scaffolding capabilities. Keep the
// lower bound local to prevent this recovery from becoming a deeper cave trip.
async function returnToSurface(bot, task, goal, save, actions = {}) {
  const isSurface = surfaceObserver(bot), start = bot.entity.position.floored();
  if (surfaceReturnComplete(bot, goal, isSurface)) { if (goal.surfaceReturn) { delete goal.surfaceReturn; save(); } return; }
  const movements = bot.pathfinder.movements, previous = movements.allowedPosition;
  const ordinary = { canDig: movements.canDig, scafoldingBlocks: movements.scafoldingBlocks, allow1by1towers: movements.allow1by1towers };
  // First try existing exits without spending the very ingredients needed to
  // replace a tool. Explicit staircase recovery owns any necessary excavation.
  Object.assign(movements, { canDig: false, scafoldingBlocks: [], allow1by1towers: false });
  movements.allowedPosition = p => p.y >= start.y - 3 && (!previous || previous(p));
  const state = goal.surfaceReturn ||= { attempts: 0, visited: {} };
  try {
    task.check();
    // A spent budget is a reason to start the search over with a clean map
    // of visited cells, not a reason to stop: the bot is still underground.
    if (++state.attempts > 192) {
      goal.surfaceReturn = { attempts: 0, visited: {}, byHand: state.byHand, rounds: (state.rounds || 0) + 1 };
      save();
      throw new Error(`Could not return to the surface after 192 recovery steps; starting round ${goal.surfaceReturn.rounds + 1} of the search`);
    }
    const clear = p => dryPassable(bot.blockAt(p));
    const candidates = bot.findBlocks({ matching: ['grass_block', 'dirt', 'stone', 'sand', 'gravel', 'deepslate'].map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined),
      maxDistance: 48, count: 128, useExtraInfo: block => {
        const p = block.position.offset(0, 1, 0);
        return p.y >= Math.max(start.y - 3, state.minimumY ?? -Infinity) && clear(p) && clear(p.offset(0, 1, 0)) && isSurface(p) && safeFromHostiles(bot, p);
      },
    }).map(p => p.offset(0, 1, 0));
    const key = p => `${Math.floor(p.x / 4)},${Math.floor(p.y / 4)},${Math.floor(p.z / 4)}`;
    candidates.sort((a, b) => a.distanceTo(start) + (state.visited[key(a)] || 0) * 16 - b.distanceTo(start) - (state.visited[key(b)] || 0) * 16);
    const checked = new Set();
    // Retry complete exit routes periodically as the staircase opens up.
    // Repeating twelve expensive searches at every one-block step stalls work.
    for (const target of !state.ascent || state.ascent.steps % 8 === 0 ? candidates : []) {
      if (checked.has(key(target))) continue;
      checked.add(key(target));
      if (checked.size > 12) break;
      const destination = new goals.GoalBlock(target.x, target.y, target.z);
      const route = await surveyRoute(bot, task, movements, destination, 700);
      if (route.status !== 'success') continue;
      state.visited[key(target)] = (state.visited[key(target)] || 0) + 1;
      goal.survivalAction = { action: 'return_to_surface', from: { ...start }, target: { ...target }, at: new Date().toISOString() };
      save();
      await (actions.navigate || navigate)(bot, task, destination, { timeoutMs: 20000, stallMs: 5000 });
      if (!surfaceReturnComplete(bot, goal)) throw new Error('Surface destination changed while returning from underground');
      delete goal.surfaceReturn; save();
      return;
    }
    if (actions.dig) {
      Object.assign(movements, ordinary);
      if (actions.prepareTool && !await actions.prepareTool()) { save(); return; }
      const target = candidates[0]?.clone() || (state.target ? new Vec3(state.target.x, state.target.y, state.target.z) : start.offset(24, 32, 0));
      target.y = Math.max(target.y, start.y + 1);
      state.ascent ||= { entrance: { ...start }, steps: 0, visited: {} };
      // Keep the exit staircase separate from the suspended mining worksite.
      const ascentGoal = { ...goal, tunnel: state.ascent };
      const record = () => {
        goal.step = { ...ascentGoal.step, action: 'ascend_to_surface' };
        goal.survivalAction = { action: 'return_to_surface', from: { ...start }, target: { ...target }, at: new Date().toISOString() };
        save();
      };
      // Stair choices already rise or stay level. Keep the three-block local
      // retreat allowance so an obstructed step can back out along the stairs
      // we just excavated, rather than forbidding its only dry escape.
      await tunnelStep(bot, task, ascentGoal, record, target, { dig: actions.dig, navigate: actions.navigate || navigate });
      if (surfaceReturnComplete(bot, goal)) { delete goal.surfaceReturn; save(); }
      return;
    }
    save();
    throw new Error(`No safe route from underground to an observed surface landing (${Math.min(checked.size, 12)} areas checked)`);
  } finally { movements.allowedPosition = previous; Object.assign(movements, ordinary); }
}

// Whether the way up from here can be dug without a tool. A shore under a
// two-block gravel lip is "underground" to the surface observer, and the
// second fresh trial died there asking for a pickaxe that needs wood it
// could not reach. Gravel, dirt and sand come away in the hand.
const HAND_DIGGABLE = new Set(['dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol', 'mycelium', 'gravel', 'sand', 'red_sand',
  'clay', 'snow', 'snow_block', 'moss_block', 'mud', 'soul_sand', 'soul_soil', 'leaf_litter']);
function handDiggableExit(bot, { origin = bot.entity.position.floored(), maxHeight = 12 } = {}) {
  const x = origin.x, z = origin.z;
  let solids = 0;
  for (let y = origin.y + 2; y <= origin.y + 2 + maxHeight; y++) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block) return false;
    if (/_leaves$/.test(block.name) || block.boundingBox !== 'block') continue;
    if (!HAND_DIGGABLE.has(block.name)) return false;
    solids++;
  }
  // Nothing solid overhead means the observer's "underground" came from
  // further up than we can see; leave that to the ordinary route search.
  return solids > 0 && surfaceObserver(bot)(new Vec3(x + .5, origin.y + 2 + maxHeight + 1, z + .5));
}

module.exports = { surfaceObserver, surfaceMovement, descendCanopy, returnToSurface, beginSurfaceAscent, surfaceReturnComplete, handDiggableExit, HAND_DIGGABLE };
