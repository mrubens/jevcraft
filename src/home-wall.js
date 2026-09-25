'use strict';
// A wall round home, with a door: Jev's option once the bed and the chest
// are down (the user, 2026-09-25: "add wall as an option", after a creeper
// walked up to trial 98's chest on a dark mountainside and blew it up).
// Two blocks high on the home's ground level, one block outside the levelled
// footprint and the water beside it, so the bed, the chest, the plot and the
// pen are all inside. Zombies cannot break a door on Normal, a creeper has
// to blow a way through from outside, and nothing walks up to the bed.
// Ground outside the footprint is not levelled: each column is built up
// from its own ground; a column already high enough is left, and a cliff
// more than four below is a wall of its own.
const { Vec3 } = require('vec3');
const WALL_BLOCKS = ['cobblestone', 'cobbled_deepslate', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'deepslate', 'stone_bricks', 'mossy_cobblestone', 'blackstone', 'dirt', 'netherrack'];
const DOORS = ['oak_door', 'spruce_door', 'birch_door', 'jungle_door', 'acacia_door', 'dark_oak_door', 'mangrove_door', 'cherry_door', 'pale_oak_door', 'bamboo_door'];
const FACING = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' };
const MAX_FILL = 5;

const solid = b => b && b.boundingBox === 'block';
const open = b => b && (b.boundingBox === 'empty');

// The ring of columns, each with its outward direction.
function ring(home) {
  const o = home.origin, d = home.direction, a = { x: -d.z, z: d.x };
  const at = (u, v) => ({ x: o.x + d.x * u + a.x * v, z: o.z + d.z * u + a.z * v });
  const cols = [];
  const U0 = -2, U1 = 9, V0 = -4, V1 = 4;
  for (let u = U0; u <= U1; u++) for (let v = V0; v <= V1; v++) {
    if (u !== U0 && u !== U1 && v !== V0 && v !== V1) continue;
    const out = v === V0 ? { x: -a.x, z: -a.z } : v === V1 ? { x: a.x, z: a.z } : u === U0 ? { x: -d.x, z: -d.z } : { x: d.x, z: d.z };
    cols.push({ ...at(u, v), u, v, out });
  }
  return cols;
}

// What the wall still needs, read off the world: the cells to fill, bottom
// up in each column, the door's place, and the columns left as they are.
function wallPlan(bot, home) {
  const top = home.origin.y + 2;
  const fill = [], door = [];
  let unloaded = 0, cliffs = 0;
  const cols = ring(home);
  const ground = c => {
    for (let y = top; y >= top - 2 - MAX_FILL; y--) {
      const b = bot.blockAt(new Vec3(c.x, y, c.z));
      if (!b) return undefined;
      if (solid(b) && !/_leaves$/.test(b.name)) return y;
    }
    return null;
  };
  // The door beside the bed's side, on ground at the home's level.
  const floor = home.origin.y;
  const doorCol = cols.filter(c => c.v === -4 && c.u >= 1 && c.u <= 7).map(c => ({ c, g: ground(c) }))
    .filter(({ g }) => g != null && g <= floor && floor - g <= 2).sort((p, q) => Math.abs(p.c.u - 3) - Math.abs(q.c.u - 3))[0];
  for (const c of cols) {
    const g = ground(c);
    if (g === undefined) { unloaded++; continue; }
    if (g === null) { cliffs++; continue; }
    const isDoor = doorCol && c.x === doorCol.c.x && c.z === doorCol.c.z;
    for (let y = g + 1; y <= (isDoor ? floor : top); y++) {
      const p = new Vec3(c.x, y, c.z), b = bot.blockAt(p);
      if (!solid(b)) fill.push(p);
    }
  }
  if (doorCol) {
    const p = new Vec3(doorCol.c.x, floor + 1, doorCol.c.z);
    const b = bot.blockAt(p);
    if (!/_door$/.test(b?.name || '')) door.push({ at: p, facing: FACING[`${doorCol.c.out.x},${doorCol.c.out.z}`] });
  }
  return { fill, door: door[0] || null, hasDoorSpot: !!doorCol, unloaded, cliffs, columns: cols.length };
}

const carried = (bot, names) => bot.inventory.items().filter(i => names.includes(i.name)).reduce((n, i) => n + i.count, 0);

function wallOption(bot, goal, home, actions) {
  if (!home?.origin || home.walledAt) return null;
  const plan = wallPlan(bot, home);
  if (plan.unloaded || !plan.hasDoorSpot) return null;
  if (!plan.fill.length && !plan.door) return null;
  const blocks = carried(bot, WALL_BLOCKS), doors = carried(bot, DOORS);
  const short = Math.max(0, plan.fill.length - blocks);
  const seconds = Math.round(plan.fill.length * 1.2 + (short ? short * 1.5 : 0) + (doors ? 0 : 20));
  return {
    description: `Wall home in: a ring two blocks high round the bed, the chest, the plot and the pen, with a door by the bed. ` +
      `About ${plan.fill.length} blocks (${blocks} building blocks carried${short ? `; ${short} more to dig first` : ''}) and ${doors ? 'a door carried' : 'a door to make from six planks'}, some ${Math.max(1, Math.round(seconds / 60))} minute${seconds >= 90 ? 's' : ''} of work. ` +
      `Inside, nothing walks up to the bed or the chest: zombies cannot break a door on Normal, a creeper has to blow its way in from outside, and a skeleton has to come round to the door. Spiders can still climb it.`,
    says: "I'll put a wall round home",
    run: async (b, t, g, s, a = actions) => buildWall(b, t, g, s, home, a),
  };
}

async function buildWall(bot, task, goal, save, home, actions) {
  let plan = wallPlan(bot, home);
  const need = plan.fill.length - carried(bot, WALL_BLOCKS);
  if (need > 0) await actions.acquireStep(bot, task, 'cobblestone', carried(bot, ['cobblestone']) + need, goal, save);
  if (plan.door && !carried(bot, DOORS)) await actions.acquireStep(bot, task, 'oak_door', 1, goal, save);
  goal.step = { action: 'wall_home', blocks: plan.fill.length }; save();
  plan = wallPlan(bot, home);
  // Nearest first, bottom up within reach: each cell sits on the one below
  // or on the ground.
  const here = () => bot.entity.position;
  const cells = [...plan.fill].sort((p, q) => (p.y - q.y) || (p.distanceTo(here()) - q.distanceTo(here())));
  let placed = 0;
  while (cells.length) {
    task.check();
    cells.sort((p, q) => (p.y - q.y) * 4 + (p.distanceTo(here()) - q.distanceTo(here())));
    const next = cells.findIndex(p => { const under = bot.blockAt(p.offset(0, -1, 0)); return solid(under); });
    const p = cells.splice(next >= 0 ? next : 0, 1)[0];
    if (solid(bot.blockAt(p))) continue;
    const item = bot.inventory.items().find(i => WALL_BLOCKS.includes(i.name));
    if (!item) throw new Error('Out of blocks for the wall');
    try { await actions.place(bot, task, p, item.name); placed++; }
    catch (err) { if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
  const after = wallPlan(bot, home);
  if (after.door) {
    const door = bot.inventory.items().find(i => DOORS.includes(i.name));
    if (door) await actions.place(bot, task, after.door.at, door.name, { properties: { facing: after.door.facing, half: 'lower' } });
  }
  const left = wallPlan(bot, home);
  if (!left.fill.length && !left.door) { home.walledAt = new Date().toISOString(); save(); return true; }
  if (!placed) throw new Error(`The wall did not grow: ${left.fill.length} cells left`);
  return false;
}

module.exports = { wallPlan, wallOption, buildWall, ring, WALL_BLOCKS };
