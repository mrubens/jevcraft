'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { reservedForConstruction } = require('./build-sites');
const { safeFromHostiles } = require('./danger');

const directions = [new Vec3(1, 0, 0), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(0, 0, -1)];
const faces = [...directions, new Vec3(0, 1, 0), new Vec3(0, -1, 0)];
const air = block => block && ['air', 'cave_air', 'void_air'].includes(block.name);
const natural = /^(stone|deepslate|granite|diorite|andesite|tuff|dirt|grass_block|gravel|sand)$|_ore$/;
const dangerous = block => !block || ['lava', 'water', 'fire', 'magma_block', 'powder_snow'].includes(block.name);

function stairOptions(bot, goal, target) {
  const feet = bot.entity.position.floored();
  const dy = Math.sign(target.y - feet.y);
  const heights = dy ? [dy, 0] : [0];
  const choices = [];
  for (const d of directions) for (const height of heights) {
    const destination = feet.plus(d).offset(0, height, 0);
    if (!safeFromHostiles(bot, destination.offset(0.5, 0, 0.5))) continue;
    const floor = bot.blockAt(destination.offset(0, -1, 0));
    if (dangerous(floor) || floor.boundingBox !== 'block') continue;
    const clear = [];
    for (let y = Math.max(feet.y + 1, destination.y + 1); y >= destination.y; y--) clear.push(new Vec3(destination.x, y, destination.z));
    if (height > 0 && !air(bot.blockAt(feet.offset(0, 2, 0)))) continue;
    const safe = clear.every(p => {
      const block = bot.blockAt(p);
      if (dangerous(block)) return false;
      if (air(block)) return true;
      if (!natural.test(block.name) || !block.diggable || reservedForConstruction(goal, p)) return false;
      if (faces.some(f => dangerous(bot.blockAt(p.plus(f))))) return false;
      return !block.harvestTools || bot.inventory.items().some(i => block.harvestTools[i.type]);
    });
    if (!safe) continue;
    const visits = goal.tunnel?.visited?.[`${destination}`] || 0;
    choices.push({ destination, clear, score: destination.distanceTo(target) + visits * 16 });
  }
  return choices.sort((a, b) => a.score - b.score);
}

async function tunnelStep(bot, task, goal, save, target, { dig, navigate }) {
  goal.tunnel ||= { entrance: { ...bot.entity.position.floored() }, steps: 0, visited: {} };
  const tunnel = goal.tunnel;
  if (tunnel.steps >= 512) {
    const err = new Error('Underground search budget exhausted after 512 staircase steps'); err.name = 'Blocked'; throw err;
  }
  const choice = stairOptions(bot, goal, target)[0];
  if (!choice) throw new Error('No safe staircase step: need solid footing, a suitable tool, and a dry route');
  tunnel.target = { ...target };
  tunnel.visited[`${choice.destination}`] = (tunnel.visited[`${choice.destination}`] || 0) + 1;
  tunnel.steps++;
  goal.step = { action: 'tunnel', target: { ...target }, destination: { ...choice.destination }, steps: tunnel.steps };
  save();
  for (const p of choice.clear) {
    // Gravel can fall into a cleared headspace. Recheck it before entering.
    for (let tries = 0; !air(bot.blockAt(p)); tries++) {
      task.check();
      if (tries >= 5) throw new Error('Falling blocks keep obstructing the staircase');
      if (faces.some(f => dangerous(bot.blockAt(p.plus(f))))) throw new Error('Staircase excavation exposed a liquid or unloaded boundary');
      await dig(bot, task, p);
    }
  }
  const floor = bot.blockAt(choice.destination.offset(0, -1, 0));
  if (dangerous(floor) || floor.boundingBox !== 'block') throw new Error('Staircase footing changed during excavation');
  await navigate(bot, task, new goals.GoalBlock(choice.destination.x, choice.destination.y, choice.destination.z));
  save();
}

module.exports = { stairOptions, tunnelStep };
