'use strict';
// Straight down to something below. A fortress roof lay under a netherrack
// shelf with a cave between: no staircase could step off the ledge and the
// pathfinder found no route, so every tick tried the same drop. Digging the
// block underfoot is the way down when the landing is close and solid; the
// helper refuses over lava, over a long fall, and when hurt.
const { equipBestTool } = require('./skills');

// Fall damage starts at four blocks; five costs a heart.
const MAX_DROP = 5;
const passable = b => !b || b.boundingBox === 'empty';
const molten = b => b && ['lava', 'water', 'fire', 'magma_block', 'powder_snow'].includes(b.name);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The block the bot would land on if the one underfoot went, and how far it
// would fall; null when the drop is unsafe.
function landing(bot, feet) {
  for (let k = 2; k <= MAX_DROP + 2; k++) {
    const block = bot.blockAt(feet.offset(0, -k, 0));
    if (!block || molten(block)) return null;
    if (!passable(block)) return k - 1 <= MAX_DROP ? { block, fall: k - 1 } : null;
  }
  return null;
}

async function descendTo(bot, task, target, { hpFloor = 12, maxSteps = 24 } = {}) {
  let steps = 0;
  const start = bot.entity.position.y;
  while (bot.entity.position.y > target.y + 1.5) {
    task.check();
    if (steps++ >= maxSteps) break;
    if ((bot.health ?? 20) < hpFloor) throw new Error('Too hurt to drop down further');
    const feet = bot.entity.position.floored();
    const under = feet.offset(0, -1, 0);
    const block = bot.blockAt(under);
    // Mid-air after the last dig: let the fall finish.
    if (passable(block)) { await sleep(250); continue; }
    if (molten(block) || !block.diggable) throw new Error(`Cannot dig down through ${block.name}`);
    const below = landing(bot, feet);
    if (!below) throw new Error('The drop below is too deep or ends in lava');
    await equipBestTool(bot, block);
    task.check();
    await bot.dig(block, true);
    const started = Date.now();
    while (Date.now() - started < 3000 && bot.entity.position.y > below.block.position.y + 1.05) { task.check(); await sleep(50); }
  }
  return start - bot.entity.position.y;
}

module.exports = { descendTo, landing, MAX_DROP };
