'use strict';
const { Vec3 } = require('vec3');
const isDoor = name => typeof name === 'string' && name.endsWith('_door');
const isWoodenDoor = (registry, name) => isDoor(name) && !!registry.blocksByName[name.replace(/_door$/, '_planks')];

function doorPairMatches(lower, upper) {
  if (!lower || !upper || !isDoor(lower.name) || lower.name !== upper.name) return false;
  const a = lower.getProperties?.() || {}, b = upper.getProperties?.() || {};
  return a.half === 'lower' && b.half === 'upper' && ['facing', 'hinge', 'open', 'powered'].every(k => String(a[k]) === String(b[k]));
}

function doorAt(bot, p) {
  const lower = bot.blockAt?.(new Vec3(p.x, p.y, p.z));
  if (!isWoodenDoor(bot.registry, lower?.name)) return null;
  const upper = bot.blockAt(new Vec3(p.x, p.y + 1, p.z));
  return doorPairMatches(lower, upper) ? lower : null;
}

function doorAllowsDirection(block, direction) {
  const facing = block.getProperties().facing;
  return ['north', 'south'].includes(facing) ? direction.x === 0 && Math.abs(direction.z) === 1 : direction.z === 0 && Math.abs(direction.x) === 1;
}

function guardNavigationDoors(bot, task, goal, dynamic = false) {
  const original = bot.activateBlock, guard = { error: null, restore: () => {} };
  if (!original) return guard;
  const refresh = () => {
    task.check();
    // Upstream leaves its placement state active after useOne and would try
    // to equip scaffolding for an undefined placement. Replan the same goal
    // against the acknowledged open door instead of entering that branch.
    if (goal && bot.pathfinder?.goal === goal) bot.pathfinder.setGoal(goal, dynamic);
  };
  const normalize = result => {
    // Upstream postprocessing targets the top of every nonempty collision
    // shape, including a door panel. A doorway waypoint is on its floor.
    for (const move of result.path || []) if (move.doorway) Object.assign(move, { x: move.doorway.x + .5, y: move.doorway.y, z: move.doorway.z + .5 });
  };
  bot.on?.('path_update', normalize);
  const activate = async function (block, ...args) {
    if (!isWoodenDoor(bot.registry, block?.name)) return original.call(bot, block, ...args);
    try {
      task.check();
      const p = block.getProperties().half === 'upper' ? block.position.offset(0, -1, 0) : block.position;
      let door = doorAt(bot, p);
      if (!door) throw new Error('The doorway changed while I was walking to it');
      if (door.getProperties().open) { refresh(); return; }
      await bot.lookAt(p.offset(.5, .5, .5), false);
      task.check();
      // Another player may have opened it while we approached or turned.
      door = doorAt(bot, p);
      if (!door) throw new Error('The doorway changed while I was walking to it');
      if (door.getProperties().open) { refresh(); return; }
      await original.call(bot, door, ...args);
      const deadline = Date.now() + 1500;
      while (!doorAt(bot, p)?.getProperties().open) {
        task.check();
        if (Date.now() >= deadline) throw new Error('The door did not open');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      refresh();
    } catch (err) { guard.error = err; throw err; }
  };
  bot.activateBlock = activate;
  guard.restore = () => { if (bot.activateBlock === activate) bot.activateBlock = original; bot.removeListener?.('path_update', normalize); };
  return guard;
}

module.exports = { isDoor, isWoodenDoor, doorPairMatches, doorAt, doorAllowsDirection, guardNavigationDoors };
