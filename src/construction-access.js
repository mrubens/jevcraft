'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { surveyRoute, navigate } = require('./skills');
const { checkAir } = require('./vitals');
const key = p => `${p.x},${p.y},${p.z}`;
const vec = p => new Vec3(p.x, p.y, p.z);
const directions = [new Vec3(0, 1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, -1, 0)];

// A work destination is a visible face within arm's reach, not an adjacent
// walkable cell. In particular the worker can clear a high bank from below.
class ConstructionGoal extends goals.Goal {
  constructor(bot, point, operation) {
    super(); this.bot = bot; this.pos = vec(point); this.operation = operation;
    if (operation === 'place') this.placement = new goals.GoalPlaceBlock(this.pos, bot.world, { range: 4.25 });
  }
  heuristic(node) { return Math.max(0, node.distanceTo(this.pos) - 3); }
  isEnd(node) {
    const center = new Vec3(node.x + .5, node.y, node.z + .5);
    // Visibility exactly along a block edge can flip with a millimeter of
    // movement. Require a small standing area with a visible face, not one
    // mathematically perfect ray through a corner.
    return [[0, 0], [.18, .18], [-.18, -.18], [.18, -.18], [-.18, .18]]
      .every(([dx, dz]) => this.reachable(center.offset(dx, 0, dz), .2));
  }
  reachable(feet, margin = 0) {
    const p = this.pos, cell = feet.floored();
    if (cell.x === p.x && cell.z === p.z && p.y <= cell.y + 1 && (this.operation === 'dig' || p.y >= cell.y - 1)) return false;
    const eye = feet.offset(0, 1.62, 0);
    if (this.placement) {
      this.placement.options.range = 4.25 - margin;
      try { return !!this.placement.getFaceAndRef(eye); }
      finally { this.placement.options.range = 4.25; }
    }
    return directions.some(face => {
      const aim = p.offset(.5 + .5 * face.x, .5 + .5 * face.y, .5 + .5 * face.z), ray = aim.minus(eye);
      if (ray.norm() > 4.25 - margin || ray.norm() < .01) return false;
      return this.bot.world.raycast(eye, ray.unit(), ray.norm() + .05)?.position?.equals(p);
    });
  }
}

function constructionMovement(bot, goal) {
  const m = bot.pathfinder.movements;
  const previous = { canDig: m.canDig, scafoldingBlocks: m.scafoldingBlocks, exclusionAreasPlace: m.exclusionAreasPlace, countScaffoldingItems: m.countScaffoldingItems, getScaffoldingItem: m.getScaffoldingItem };
  const reserved = {};
  for (const p of goal.blueprint?.blocks || []) if (bot.blockAt(vec(p))?.name !== p.material) reserved[p.material] = (reserved[p.material] || 0) + 1;
  const spare = name => goal.buildPhase === 'cleanup' ? 0 : Math.max(0, (bot.inventory?.items() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0) - (reserved[name] || 0));
  const planned = new Set((goal.blueprint?.blocks || []).map(key));
  // Access must not demolish the building or consume reserved materials. Use
  // surplus ordinary blocks already carried before making a new gathering trip.
  m.canDig = false;
  m.scafoldingBlocks = ['dirt', 'cobblestone'].map(name => bot.registry.itemsByName[name].id);
  m.countScaffoldingItems = () => spare('dirt') + spare('cobblestone');
  m.getScaffoldingItem = () => (bot.inventory?.items() || []).find(i => ['dirt', 'cobblestone'].includes(i.name) && spare(i.name) > 0) || null;
  m.exclusionAreasPlace = [...(m.exclusionAreasPlace || []), block => planned.has(key(block.position)) ? 100 : 0];
  return () => {
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete m[name]; else m[name] = value;
  };
}

async function steadyConstructionSwim(bot, task) {
  const feet = bot.entity.position.floored();
  if (bot.blockAt(feet)?.name !== 'water') return;
  let surface = feet.y;
  for (; surface < feet.y + 6 && bot.blockAt(new Vec3(feet.x, surface + 1, feet.z))?.name === 'water'; surface++);
  const above = bot.blockAt(new Vec3(feet.x, surface + 1, feet.z));
  if (!above || !['air', 'cave_air', 'void_air'].includes(above.name) || bot.entity.position.y >= surface + .05) return;
  // Filling a shallow pool changes submerged steps under the swimmer. Stay at
  // its surface before evaluating walking nodes, rather than sinking into a
  // one-cell pocket and treating that momentary footing as a missing resource.
  const deadline = Date.now() + 2500;
  try {
    bot.setControlState('jump', true);
    while (bot.entity.position.y < surface + .1 && Date.now() < deadline) {
      task.check(); checkAir(bot);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } finally { bot.setControlState('jump', false); }
}

async function chooseConstructionWork(bot, task, goal, candidates) {
  await steadyConstructionSwim(bot, task);
  const restore = constructionMovement(bot, goal);
  try {
    const ordered = candidates.map(candidate => ({ ...candidate, destination: new ConstructionGoal(bot, candidate.position, candidate.operation) }))
      .sort((a, b) => (a.priority || 0) - (b.priority || 0) || vec(a.position).distanceTo(bot.entity.position) - vec(b.position).distanceTo(bot.entity.position));
    const orderedCleanup = ['cleanup', 'cleanup_access'].includes(goal.buildPhase);
    const ready = !orderedCleanup && ordered.find(c => c.destination.reachable(bot.entity.position));
    if (ready) return ready;
    // Inspect several possible work faces before asking recovery to help with
    // access. One unreachable nearest block must not block the entire site.
    for (const candidate of ordered.slice(0, 16)) {
      task.check();
      if (candidate.destination.reachable(bot.entity.position)) return candidate;
      const route = await surveyRoute(bot, task, bot.pathfinder.movements, candidate.destination, 350);
      if (route.status === 'success') return candidate;
    }
    return null;
  } finally { restore(); }
}

async function approachConstruction(bot, task, goal, point, operation) {
  await steadyConstructionSwim(bot, task);
  const restore = constructionMovement(bot, goal);
  try {
    const destination = new ConstructionGoal(bot, point, operation);
    if (!destination.reachable(bot.entity.position)) await navigate(bot, task, destination, { timeoutMs: 20000, stallMs: 5000 });
    task.check();
    // Pathfinder accepts a small distance from a cell center. At a wall corner
    // those last centimeters can still hide the selected face. Align inside
    // the same standing cell, without starting a new path or altering blocks.
    if (!destination.reachable(bot.entity.position)) {
      const cell = bot.entity.position.floored(), center = cell.offset(.5, 0, .5), deadline = Date.now() + 1500;
      try {
        while (!destination.reachable(bot.entity.position) && Date.now() < deadline &&
          bot.entity.position.floored().equals(cell) && bot.entity.position.distanceTo(center) > .04) {
          task.check();
          await bot.lookAt(center.offset(0, 1.62, 0), true);
          bot.setControlState('sneak', true); bot.setControlState('forward', true);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } finally { bot.clearControlStates(); }
    }
    if (!destination.reachable(bot.entity.position)) throw new Error(`Cannot reach a clear ${operation} face at ${vec(point)} from ${bot.entity.position}; centered=${destination.isEnd(bot.entity.position.floored())}`);
    return destination.placement?.getFaceAndRef(bot.entity.position.offset(0, 1.62, 0));
  } finally { restore(); }
}
module.exports = { ConstructionGoal, constructionMovement, chooseConstructionWork, approachConstruction };
