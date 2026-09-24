'use strict';
// A pocket against endermen in the End. They stand three blocks tall and
// cannot follow into a space two high: three blocks dug straight down into
// end stone, a block over the head from the shaft's own walls, and a wait
// until none angry is near. In the fresh-End rehearsal (2026-09-24) the
// dragon's sweep turned several at once, the sword and the water held for a
// minute, and the bot died with the dragon at 190.
const { Vec3 } = require('vec3');
const DEPTH = 3, WAIT_MS = 30000, CALM = 16;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const solid = b => b?.boundingBox === 'block';
const CAPS = ['cobblestone', 'end_stone', 'cobbled_deepslate', 'stone', 'dirt', 'netherrack'];

function angryEndermen(bot, reach, hostileEntities) {
  return hostileEntities(bot, reach).filter(e => e.name === 'enderman' && e.isValid !== false);
}

// Three cells straight down that can be dug, standing on solid under
// them, walls round the top cell to cap against, and something to cap with.
function pocketPlan(bot) {
  const feet = bot.entity.position.floored();
  if (!bot.inventory.items().some(i => CAPS.includes(i.name))) return null;
  const cells = [1, 2, 3].map(d => feet.offset(0, -d, 0));
  if (!cells.every(c => /^(end_stone|cobblestone|stone|dirt|netherrack)$/.test(bot.blockAt(c)?.name || ''))) return null;
  if (!solid(bot.blockAt(feet.offset(0, -DEPTH - 1, 0)))) return null;
  // The cap goes in the top cell, placed against its side walls.
  const top = cells[0];
  const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => top.offset(dx, 0, dz)).filter(p => solid(bot.blockAt(p)));
  if (!walls.length) return null;
  return { feet, cells, top, wall: walls[0] };
}

async function endPocket(bot, task, { dig, check = () => task.check(), hostileEntities, waitMs = WAIT_MS, report = () => {} }) {
  const plan = pocketPlan(bot);
  if (!plan) return false;
  report({ action: 'end_pocket', endermen: angryEndermen(bot, 12, hostileEntities).length, health: bot.health });
  for (const cell of plan.cells) {
    check();
    await dig(bot, task, cell, { requireDrops: false });
    for (let i = 0; i < 20 && bot.entity.position.y > cell.y + 0.1; i++) { check(); await sleep(50); }
  }
  if (bot.entity.position.y > plan.cells.at(-1).y + 0.5) throw new Error('Did not drop into the pocket');
  const cap = bot.inventory.items().find(i => CAPS.includes(i.name));
  await bot.equip(cap, 'hand');
  const wall = bot.blockAt(plan.wall);
  await bot.placeBlock(wall, plan.top.minus(plan.wall));
  if (!solid(bot.blockAt(plan.top))) throw new Error('The pocket would not close');
  const started = Date.now();
  while (Date.now() - started < waitMs && angryEndermen(bot, CALM, hostileEntities).length) { check(); await sleep(500); }
  report({ action: 'end_pocket_leave', waited: Math.round((Date.now() - started) / 1000), health: bot.health });
  // Out: the cap dug, and up the shaft on placed blocks.
  await dig(bot, task, plan.top, { requireDrops: false });
  const { pillarUp } = require('./pillar-recovery');
  await pillarUp(bot, task, plan.feet.y, { dig, maxBlocks: DEPTH + 1, threats: false });
  return true;
}

module.exports = { endPocket, pocketPlan, angryEndermen };
