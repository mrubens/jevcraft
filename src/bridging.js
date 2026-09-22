'use strict';
const { move } = require('./motion');
// A straight span over open ground. Fortresses stand over the lava sea and
// the pathfinder bridged toward one a block a minute, its search lost in
// the open air, while the bot stood on the span under blaze fire. This
// lays the span itself: one block ahead at a time, sneaking, digging what
// is in the way when it is natural rock, and stops beside the target.
const { Vec3 } = require('vec3');
const { equipBestTool } = require('./skills');

const MATERIALS = ['netherrack', 'cobblestone', 'cobbled_deepslate', 'stone', 'dirt', 'andesite', 'diorite', 'granite', 'blackstone', 'basalt'];
const NATURAL = /^(netherrack|soul_sand|soul_soil|basalt|blackstone|magma_block|nether_wart_block|warped_wart_block|shroomlight|crimson_stem|warped_stem|crimson_hyphae|warped_hyphae|nether_sprouts|crimson_roots|warped_roots|crimson_fungus|warped_fungus|weeping_vines|twisting_vines|glowstone|gravel|stone|dirt|grass_block|sand|sandstone|andesite|diorite|granite|tuff|deepslate|cobblestone|cobbled_deepslate)/;
const passable = b => !b || b.boundingBox === 'empty';
const solid = b => b?.boundingBox === 'block';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const material = bot => MATERIALS.map(n => bot.inventory.items().find(i => i.name === n)).find(Boolean);

// Sneak to the middle of the next cell: a walk at full speed overshoots a
// one-block span. The sneak itself is held by bridgeTo for the whole span.
async function creepTo(bot, task, cell, ms = 2500) {
  const centre = cell.offset(0.5, 0, 0.5);
  return move(bot, task, { label: 'bridge_step', keys: ['forward'], sneak: true, look: centre.offset(0, 1.6, 0), maxMs: ms, tick: 40,
    until: () => { const p = bot.entity.position; return Math.hypot(p.x - centre.x, p.z - centre.z) < 0.35 && p.y < cell.y + 0.6 && p.y > cell.y - 0.6; } });
}

async function clear(bot, task, p) {
  const block = bot.blockAt(p);
  if (passable(block)) return;
  if (!block.diggable || !NATURAL.test(block.name)) throw new Error(`The span is blocked by ${block.name}`);
  await equipBestTool(bot, block); task.check();
  await bot.dig(block, true);
}

// Lay a level span toward `target` from where the bot stands, until beside
// or above it, out of blocks, or `maxBlocks` placed. Returns the blocks laid.
// The span is one block wide over whatever is below it, and the bot fell
// off one: it sneaked only while stepping onto each new block and stood
// upright at the end of the span while it dug ahead, turned and placed.
// Now it crouches from the first block to the last, and a sneaking player
// cannot walk off an edge. Nor is a span laid under fire: with a shooter
// that can see it, the bot stops rather than stand in the open on one
// block, and the approach finds another way.
const SHOOTER_RANGE = 24;
function underFire(bot) {
  const { threats } = require('./danger'), { shooter } = require('./mob-policy');
  return threats(bot, SHOOTER_RANGE).find(t => t.visible && shooter(t.entity));
}
async function bridgeTo(bot, task, target, { maxBlocks = 64 } = {}) {
  bot.setControlState('sneak', true);
  try { return await span(bot, task, target, maxBlocks); }
  finally { bot.setControlState('forward', false); bot.setControlState('sneak', false); }
}
async function span(bot, task, target, maxBlocks) {
  let placed = 0;
  for (let steps = 0; steps < maxBlocks * 2; steps++) {
    task.check();
    const fire = underFire(bot);
    if (fire) throw new Error(`Not bridging with a ${fire.entity.name} ${Math.round(fire.distance)} blocks off able to see me`);
    const here = bot.entity.position.floored();
    const dx = target.x - here.x, dz = target.z - here.z;
    if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) return placed;
    const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
    const next = here.plus(step);
    // Standing squarely on the support block first: a placement from the
    // edge misses the face.
    const support = bot.blockAt(here.offset(0, -1, 0));
    if (!solid(support)) throw new Error('Nothing solid underfoot to bridge from');
    await clear(bot, task, next); await clear(bot, task, next.offset(0, 1, 0));
    if (!solid(bot.blockAt(next.offset(0, -1, 0)))) {
      if (placed >= maxBlocks) return placed;
      const item = material(bot);
      if (!item) throw new Error('No blocks to bridge with');
      const centre = here.offset(0.5, 0, 0.5), p = bot.entity.position;
      if (Math.hypot(p.x - centre.x, p.z - centre.z) > 0.3) await creepTo(bot, task, here, 1200);
      await bot.equip(item, 'hand'); task.check();
      await bot.lookAt(support.position.offset(0.5 + step.x * 0.5, 0.5, 0.5 + step.z * 0.5), true);
      await bot.placeBlock(support, step);
      if (!solid(bot.blockAt(next.offset(0, -1, 0)))) throw new Error('The span block did not land');
      placed++;
    }
    if (!await creepTo(bot, task, next)) throw new Error('Could not step onto the span');
    if (bot.entity.position.y < here.y - 0.5) throw new Error('Fell off the span');
  }
  return placed;
}

module.exports = { bridgeTo, underFire, MATERIALS };
