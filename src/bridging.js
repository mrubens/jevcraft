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
const NATURAL = /^(netherrack|crimson_nylium|warped_nylium|soul_sand|soul_soil|basalt|blackstone|magma_block|nether_wart_block|warped_wart_block|shroomlight|crimson_stem|warped_stem|crimson_hyphae|warped_hyphae|nether_sprouts|crimson_roots|warped_roots|crimson_fungus|warped_fungus|weeping_vines|twisting_vines|glowstone|gravel|stone|dirt|grass_block|sand|sandstone|andesite|diorite|granite|tuff|deepslate|cobblestone|cobbled_deepslate)/;
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

// Never into lava: a body cell that is lava or fire is not walked into,
// and rock is dug only where nothing flows in behind it, as the staircase
// digs (tunneling.js safeExcavation). The span dug through the wall of the
// lava sea otherwise.
const BURNS = /lava|fire/;
async function clear(bot, task, p) {
  const block = bot.blockAt(p);
  if (block && BURNS.test(block.name)) throw new Error(`Lava in the way at ${p}`);
  if (passable(block)) return;
  if (!block.diggable || !NATURAL.test(block.name)) throw new Error(`The span is blocked by ${block.name}`);
  if (!require('./tunneling').safeExcavation(bot, p)) throw new Error(`Lava or water behind the ${block.name.replaceAll('_', ' ')} at ${p}`);
  await equipBestTool(bot, block); task.check();
  await bot.dig(block, true);
}

// The next cell of a straight crossing: along whichever axis has farther to
// go, one block. The survey and the span take the same cells.
function stepToward(here, target) {
  const dx = target.x - here.x, dz = target.z - here.z;
  if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) return null;
  return Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
}

// What a straight crossing at the feet's height toward `target` meets, cell
// by cell, before it is walked: rock to dig (what is natural, with nothing
// flowing behind it), open air or lava to lay a block over, and where it has
// to stop (lava in the body's way, a block that is not dug, the blocks
// carried running out). Up to `cells` cells.
function surveyCrossing(bot, target, { cells = 32, blocks = null } = {}) {
  const carried = blocks ?? blocksCarried(bot);
  const start = bot.entity.position.floored();
  const flat = p => Math.hypot(target.x - p.x, target.z - p.z);
  const out = { cells: 0, dig: 0, bridge: 0, overLava: 0, carried, stoppedBy: null, from: flat(start), end: start, gain: 0, digSeconds: 0 };
  let here = start, digMs = 0;
  for (let n = 0; n < cells; n++) {
    const step = stepToward(here, target);
    if (!step) { out.stoppedBy = null; break; }
    const next = here.plus(step);
    let why = null, dig = 0; const before = digMs;
    for (const p of [next, next.offset(0, 1, 0)]) {
      const b = bot.blockAt(p);
      if (!b) { why = 'unloaded ground ahead'; break; }
      if (BURNS.test(b.name)) { why = 'lava in the way'; break; }
      if (passable(b)) continue;
      if (!b.diggable || !NATURAL.test(b.name)) { why = `${b.name.replaceAll('_', ' ')} in the way`; break; }
      if (!require('./tunneling').safeExcavation(bot, p)) { why = `lava or water behind the ${b.name.replaceAll('_', ' ')}`; break; }
      dig++;
      // With the tool the dig would take (skills.js cheapestTool).
      if (typeof b.digTime === 'function' && bot.inventory?.items) { const tool = require('./skills').cheapestTool(bot, b); digMs += b.digTime(tool?.type ?? null, false, false, false, [], {}); }
    }
    const floor = bot.blockAt(next.offset(0, -1, 0));
    const lay = !solid(floor);
    if (!why && lay && out.bridge + 1 > carried) why = `out of blocks (${carried} carried)`;
    if (why) { out.stoppedBy = why; digMs = before; break; }
    out.cells++; out.dig += dig;
    if (lay) { out.bridge++; if (lavaBelow(bot, next.offset(0, -1, 0))) out.overLava++; }
    here = next;
  }
  out.end = here; out.digSeconds = Math.round(digMs / 100) / 10;
  out.gain = Math.round((out.from - flat(here)) * 10) / 10;
  return out;
}
// Lava is what lies under a laid block, below the open air: the lava sea.
function lavaBelow(bot, p, deepest = 48) {
  for (let dy = 0; dy <= deepest; dy++) {
    const b = bot.blockAt(p.offset(0, -dy, 0));
    if (!b) return false;
    if (/lava/.test(b.name)) return true;
    if (!passable(b)) return false;
  }
  return false;
}
const blocksCarried = bot => (bot.inventory?.items?.() || []).filter(i => MATERIALS.includes(i.name)).reduce((n, i) => n + i.count, 0);

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
// `maxSteps` cells at most: a crossing laid a stretch at a time, as far as
// its survey saw.
// While it is laid the bot is on the span (terrain.js onSpan): no reflex
// swings at a mob or turns to one until it is done.
async function bridgeTo(bot, task, target, { maxBlocks = 64, maxSteps = maxBlocks * 2 } = {}) {
  const spanning = { target: { x: target.x, y: target.y, z: target.z }, since: Date.now() };
  bot._spanning = spanning;
  bot.setControlState('sneak', true);
  try { return await span(bot, task, target, maxBlocks, maxSteps); }
  finally {
    // The crouch let go only once the body has stopped: let go with the
    // walk, the step's way on carried mid-227-h off the end of its span, no
    // key held, fifteen blocks down among magma cubes (2026-09-27).
    bot.setControlState('forward', false);
    for (let n = 0; n < 10; n++) { const v = bot.entity?.velocity; if (!v || Math.hypot(v.x, v.z) < 0.01) break; await sleep(50); }
    bot.setControlState('sneak', false);
    if (bot._spanning === spanning) bot._spanning = null;
  }
}
async function span(bot, task, target, maxBlocks, maxSteps) {
  let placed = 0;
  for (let steps = 0; steps < maxSteps; steps++) {
    task.check();
    const fire = underFire(bot);
    if (fire) throw new Error(`Not bridging with a ${fire.entity.name} ${Math.round(fire.distance)} blocks off able to see me`);
    const here = bot.entity.position.floored();
    const step = stepToward(here, target);
    if (!step) return placed;
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

module.exports = { bridgeTo, underFire, surveyCrossing, stepToward, blocksCarried, MATERIALS };
