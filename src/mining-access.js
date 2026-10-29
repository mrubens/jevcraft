'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { surveyRoute } = require('./skills');
const { safeFromHostiles } = require('./danger');
const { dryPassable: clear, dryLeaf, dryBodySpace, supportCell, damagingTerrain, hotFloor } = require('./terrain');

const wet = new Set(['water', 'lava', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant']);
const solid = block => block?.boundingBox === 'block' && !['magma_block', 'cactus'].includes(block.name);

// Creative flight holds a position with no floor beneath it, and parks the body
// a fraction above the block it arrived at, so supportCell names the air the feet
// occupy rather than the block below. A hovering worker needs no footing: require
// a clear body and let flight supply the rest, or this rejects every arrival.
function dryStanding(bot, point) {
  if (!dryBodySpace(bot, point)) return false;
  if (require('./flight').canFly(bot)) return true;
  return solid(bot.blockAt(supportCell(point)));
}

// Shallow water stood in to dig, as a player stands at a river's edge to chop the tree in it (note 2530): the feet in a
// water cell over solid ground, the head in the air. full-107 (25589, 2026-10-29 17:2xZ) walked 113 blocks looking for
// wood past oaks at (96 to 99, 63 to 66, 640) by the water, 'No reachable dry standing position' at each; the user,
// watching: 'There are trees'.
function wadingStanding(bot, point) {
  const feet = point.floored(), at = n => bot.blockAt(feet.offset(0, n, 0));
  return ['water', 'bubble_column'].includes(at(0)?.name) && solid(at(-1)) && clear(at(1));
}
const standingOk = (bot, point) => dryStanding(bot, point) || wadingStanding(bot, point);
function miningReach(bot, point, blockPosition) {
  const feet = point.floored();
  // Underfoot is reachable only as a one-block drop onto something solid.
  if (feet.x === blockPosition.x && feet.z === blockPosition.z && blockPosition.y < point.y) {
    const under = bot.blockAt(blockPosition.offset(0, -1, 0));
    return blockPosition.y === feet.y - 1 && under?.boundingBox === 'block' && !['lava', 'sand', 'gravel'].includes(under.name) && !hotFloor(under);
  }
  const eye = point.offset(0, 1.62, 0), aim = blockPosition.offset(0.5, 0.5, 0.5), direction = aim.minus(eye);
  if (direction.norm() > 4.5) return false;
  const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
  return !hit || hit.position?.equals(blockPosition) || eye.distanceTo(hit.intersect || hit.position) >= direction.norm() - 0.25;
}

function dryMiningPositions(bot, blockPosition, limit = 12) {
  const positions = [], seen = new Set(), current = bot.entity.position;
  const add = point => {
    const p = point.floored(), key = `${p}`;
    if (seen.has(key)) return;
    seen.add(key);
    const standing = p.offset(0.5, 0, 0.5);
    if (standingOk(bot, p) && miningReach(bot, standing, blockPosition) && safeFromHostiles(bot, standing)) positions.push(p);
  };
  add(current);
  for (let distance = 1; distance <= 3 && positions.length < limit; distance++) {
    for (const [dx, dz] of [[distance, 0], [-distance, 0], [0, distance], [0, -distance]]) {
      for (const dy of [0, 1, -1, 2, 3]) {
        add(blockPosition.offset(dx, dy, dz));
        if (positions.length >= limit) break;
      }
      if (positions.length >= limit) break;
    }
  }
  return positions.sort((a, b) => a.distanceTo(current) - b.distanceTo(current));
}

function miningMovement(bot) {
  const movement = bot.pathfinder.movements;
  const previous = { canDig: movement.canDig, allowedPosition: movement.allowedPosition };
  const start = bot.entity.position.floored(), wetStart = wet.has(bot.blockAt(start.offset(0, 1, 0))?.name);
  const allowed = point => {
    const feet = new Vec3(point.x, point.y, point.z), head = feet.offset(0, 1, 0);
    const wading = ['water', 'bubble_column'].includes(bot.blockAt(feet)?.name);
    const breathable = dryBodySpace(bot, feet) || (wading && clear(bot.blockAt(head)));
    const exitingWater = wetStart && feet.y >= start.y && feet.distanceTo(start) <= 8 &&
      [feet, head].every(q => clear(bot.blockAt(q)) || ['water', 'bubble_column'].includes(bot.blockAt(q)?.name));
    return (breathable || exitingWater) && (!previous.allowedPosition || previous.allowedPosition(point));
  };
  Object.assign(movement, { canDig: false, allowedPosition: allowed });
  return { allowed, restore: () => Object.assign(movement, previous) };
}

// Whether a dry stand for mining p can be walked to now, without digging or swimming: the approach's own route check,
// run without the walk (note 2291). -> true/false
async function dryRouteNow(bot, task, p, { budgetMs = 400 } = {}) {
  if (dryStanding(bot, bot.entity.position) && miningReach(bot, bot.entity.position, p)) return true;
  const movement = bot.pathfinder?.movements;
  if (!movement) return false;
  const policy = miningMovement(bot), deadline = Date.now() + budgetMs;
  try {
    for (const target of dryMiningPositions(bot, p).slice(0, 3)) {
      if (Date.now() >= deadline) break;
      task.check();
      const route = await surveyRoute(bot, task, movement, new goals.GoalBlock(target.x, target.y, target.z), Math.max(50, Math.min(200, deadline - Date.now())));
      if (route.status === 'success' && (route.path || []).every(policy.allowed)) return true;
    }
  } finally { policy.restore(); }
  return false;
}
// The stand reached is judged as it was chosen, from its cell's middle, as well as from where the body stopped in it
// (note 2550): the walk ends anywhere in the cell, a few tenths off the middle, and the reach from there came short or
// its line grazed an edge. 130 'Dry mining access changed during the approach' on the day's full runs (2026-10-29), and
// each turned the mine step and the pickup or tunnel beside it into a flip: full-134 (25592, 23:2xZ) traded mine and
// collect nearby resource four times in six seconds at iron ore five blocks off; full-131 (25586) the same.
function reachedAt(bot, stand, p) {
  const here = bot.entity.position;
  if (miningReach(bot, here, p)) return true;
  const f = here.floored();
  return !!stand && f.x === stand.x && f.y === stand.y && f.z === stand.z && miningReach(bot, stand.offset(0.5, 0, 0.5), p);
}
async function approachDryMining(bot, task, p, { navigate, dig }) {
  if (standingOk(bot, bot.entity.position) && miningReach(bot, bot.entity.position, p) && bot.canDigBlock(bot.blockAt(p))) return;
  const movement = bot.pathfinder.movements, policy = miningMovement(bot);
  // Each stand looked at and why it was not taken, said with the failure (note 2534): full-105 (25587, 2026-10-29
  // 18:1xZ) failed nine crimson stems 2 to 7 blocks off, 'No reachable dry standing position', and the same blocks
  // replayed in the arena's Nether (scripts/stem-drill.js) were reached from the same stand every time.
  const tried = [], stands = dryMiningPositions(bot, p);
  try {
    // The stands searched together first, given time by how far off they are (note 2537): each searched alone for 300
    // ms, every stand 20 and 30 blocks off came to 'timeout' and the block was given up. full-112 (25590, 2026-10-29
    // 18:4xZ) gave up four coal ores so, 'stands looked at: (-4, 23, -25): timeout; ...', and full-105 its crimson stems.
    const far = bot.entity.position.distanceTo(p);
    if (stands.length && far > 6) {
      const any = new goals.GoalCompositeAny(stands.slice(0, 8).map(t => new goals.GoalBlock(t.x, t.y, t.z)));
      const route = await surveyRoute(bot, task, movement, any, Math.min(3000, 300 + 60 * far));
      const end = (route.path || []).at(-1), at = end && stands.find(t => t.x === Math.floor(end.x) && t.y === Math.floor(end.y) && t.z === Math.floor(end.z));
      if (route.status === 'success' && at && (route.path || []).every(policy.allowed)) {
        await navigate(bot, task, new goals.GoalBlock(at.x, at.y, at.z), { timeoutMs: Math.max(15000, far * 1500), stallMs: 4000 });
        if (!standingOk(bot, bot.entity.position) || !reachedAt(bot, at, p)) throw new Error('Dry mining access changed during the approach');
        return;
      }
      tried.push(`all ${Math.min(8, stands.length)} together: ${route.status !== 'success' ? route.status : !at ? 'the way ends elsewhere' : 'the way wades or digs'}`);
    }
    for (const target of stands.slice(0, 8)) {
      task.check();
      const destination = new goals.GoalBlock(target.x, target.y, target.z);
      const route = await surveyRoute(bot, task, movement, destination, 300);
      if (route.status !== 'success' || !(route.path || []).every(policy.allowed)) { tried.push(`${target}: ${route.status !== 'success' ? route.status : 'the way wades or digs'}`); continue; }
      await navigate(bot, task, destination, { timeoutMs: 15000, stallMs: 4000 });
      if (!standingOk(bot, bot.entity.position) || !reachedAt(bot, target, p)) throw new Error('Dry mining access changed during the approach');
      return;
    }
  } finally { policy.restore(); }
  if (await approachFoliageMining(bot, task, p, navigate, dig)) return;
  if (await require('./mining-passage').openMiningPassage(bot, task, dryMiningPositions(bot, p), { navigate, protect: [p] })) {
    if (!dryStanding(bot, bot.entity.position) || !miningReach(bot, bot.entity.position, p))
      throw new Error('Mining passage access changed during the approach');
    return;
  }
  let unsafe = 0;
  try { const { safeFromHostiles } = require('./danger'); unsafe = stands.length ? 0 : [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].filter(([dx, dy, dz]) => !safeFromHostiles(bot, p.offset(dx + 0.5, dy, dz + 0.5))).length; } catch (_) { unsafe = 0; }
  throw new Error(`No reachable dry standing position for mining at ${p} (${stands.length ? `stands looked at: ${tried.join('; ') || 'none walked'}` : `no stand within 3 blocks${unsafe ? `, ${unsafe} of its four sides too near a hostile` : ''}`})`);
}

// A covered resource can have no already-clear mining stance. Keep nearby
// observed candidates for a bounded leaf-only survey instead of discarding
// them before approachDryMining has a chance to open that stance.
function foliageMiningCandidate(bot, p) {
  const movement = bot.pathfinder.movements;
  if (movement.canDig !== true || p.distanceTo(bot.entity.position) > 12 || p.equals(supportCell(bot.entity.position))) return false;
  return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(d => {
    const leaf = bot.blockAt(p.offset(...d));
    return dryLeaf(leaf) && !movement.blocksCantBreak?.has(leaf.type) &&
      (movement.exclusionAreasBreak || []).reduce((cost, rule) => cost + rule(leaf), 0) < 100;
  });
}

async function approachFoliageMining(bot, task, p, navigate, dig) {
  task.check();
  if (!foliageMiningCandidate(bot, p)) return false;
  const movement = bot.pathfinder.movements, origin = bot.entity.position.clone();
  const previous = Object.fromEntries(['allowedPosition', 'exclusionAreasBreak', 'scafoldingBlocks', 'allow1by1towers', 'allowParkour']
    .map(key => [key, movement[key]]));
  const allowed = point => {
    const feet = new Vec3(point.x, point.y, point.z), support = supportCell(feet);
    if (feet.distanceTo(origin) > 12 || support.equals(p) || !solid(bot.blockAt(support)) ||
        previous.allowedPosition && !previous.allowedPosition(point)) return false;
    if (dryBodySpace(bot, feet)) return true;
    for (let y = Math.floor(feet.y); y < feet.y + 1.8; y++) {
      const block = bot.blockAt(new Vec3(Math.floor(feet.x), y, Math.floor(feet.z)));
      if (!clear(block) && !dryLeaf(block)) return false;
    }
    return true;
  };
  Object.assign(movement, { allowedPosition: allowed, scafoldingBlocks: [], allow1by1towers: false, allowParkour: false,
    exclusionAreasBreak: [...(previous.exclusionAreasBreak || []), block => dryLeaf(block) ? 0 : 100] });
  try {
    const destination = new goals.GoalGetToBlock(p.x, p.y, p.z);
    const route = await surveyRoute(bot, task, movement, destination, 700), path = route.path || [];
    if (route.status !== 'success' || path.length > 16 || !path.every(q => allowed(q) && !q.toPlace?.length)) return false;
    const breaks = path.flatMap(q => q.toBreak || []);
    if (new Set(breaks.map(q => `${q.x},${q.y},${q.z}`)).size > 8 ||
        !breaks.every(q => dryLeaf(bot.blockAt(new Vec3(q.x, q.y, q.z))))) return false;
    await navigate(bot, task, destination, { timeoutMs: 15000, stallMs: 4000 });
    // Arrival can be at the near edge of a stance, leaving the eye ray behind
    // an overhanging leaf even after body space is clear. Clear only those
    // observed leaf obstructions, never the requested block or our footing.
    for (let cleared = 0; dig && cleared < 3 && dryStanding(bot, bot.entity.position) &&
        !miningReach(bot, bot.entity.position, p); cleared++) {
      task.check();
      const eye = bot.entity.position.offset(0, 1.62, 0), direction = p.offset(.5, .5, .5).minus(eye);
      if (direction.norm() > 4.5) break;
      const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
      const leaf = hit?.position && bot.blockAt(hit.position);
      if (!dryLeaf(leaf) || leaf.position.equals(supportCell(bot.entity.position)) || !bot.canDigBlock(leaf) ||
          !movement.safeToBreak?.(leaf)) break;
      await dig(bot, task, leaf.position, { requireDrops: false });
    }
    if (!dryStanding(bot, bot.entity.position) || !miningReach(bot, bot.entity.position, p))
      throw new Error('Foliage mining access changed during the approach');
    // The drop can land toward the far side of this cell. Open its leaf
    // headroom while we can see it, so pickup can enter the mined cell without
    // relaxing the collector's no-excavation policy or relying on drop jitter.
    const floor = bot.blockAt(p.offset(0, -1, 0)), head = bot.blockAt(p.offset(0, 1, 0));
    if (dig && solid(floor) && !damagingTerrain.has(floor.name) && dryLeaf(head) &&
        miningReach(bot, bot.entity.position, head.position) && bot.canDigBlock(head) && movement.safeToBreak?.(head)) {
      task.check(); await dig(bot, task, head.position, { requireDrops: false });
    }
    return true;
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete movement[key]; else movement[key] = value;
  }
}

// Ore depth is a search hint, not the depth of a block already observed nearby.
// A short dry walk does not need the supplies for an underground expedition.
async function reachableLocalMine(bot, task, candidates) {
  task.check();
  if (candidates.some(p => dryStanding(bot, bot.entity.position) && miningReach(bot, bot.entity.position, p) && bot.canDigBlock(bot.blockAt(p)))) return true;
  const movement = bot.pathfinder.movements, policy = miningMovement(bot);
  const previous = { allow1by1towers: movement.allow1by1towers, scafoldingBlocks: movement.scafoldingBlocks };
  Object.assign(movement, { allow1by1towers: false, scafoldingBlocks: [] });
  const origin = bot.entity.position.clone(), minimumY = origin.y - 8, deadline = Date.now() + 1500;
  try {
    for (const p of candidates.filter(p => p.distanceTo(origin) <= 16 && p.y >= minimumY).slice(0, 4)) {
      for (const target of dryMiningPositions(bot, p).slice(0, 3)) {
        task.check();
        if (Date.now() >= deadline) return false;
        const route = await surveyRoute(bot, task, movement, new goals.GoalBlock(target.x, target.y, target.z), Math.min(250, deadline - Date.now()));
        if (route.status === 'success' && (route.path || []).length <= 32 &&
            (route.path || []).every(q => q.y >= minimumY && policy.allowed(q) && !q.toBreak?.length && !q.toPlace?.length)) return true;
      }
    }
    return false;
  } finally {
    policy.restore();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete movement[key]; else movement[key] = value;
  }
}

module.exports = { dryRouteNow, dryStanding, miningReach, dryMiningPositions, foliageMiningCandidate, approachDryMining, miningMovement, reachableLocalMine };
