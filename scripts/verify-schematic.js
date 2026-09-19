'use strict';
// Independent client census and walking check of a completed fixture build.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const { pathfinder, goals } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate } = require('../src/skills');
if (!process.env.DESIGN_GOAL || !process.env.MC_USERNAME) throw new Error('Set DESIGN_GOAL and the completed fixture bot MC_USERNAME');
const goal = JSON.parse(fs.readFileSync(process.env.DESIGN_GOAL, 'utf8'));
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT || 25567), username: process.env.MC_USERNAME, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('verify', 'Inspect the constructed schematic and walk both floors');
const timer = setTimeout(() => task.cancel(), 120000);
bot.on('error', err => console.error(err.message));
bot.once('spawn', async () => {
  let result;
  try {
    const movements = configureMovements(bot);
    Object.assign(movements, { canDig: false, allow1by1towers: false, scafoldingBlocks: [] });
    await bot.waitForChunksToLoad();
    const block = p => bot.blockAt(new Vec3(p.x, p.y, p.z));
    const missing = goal.blueprint.blocks.filter(p => block(p)?.name !== p.material);
    const obstructed = goal.blueprint.empty.filter(p => !['air', 'cave_air', 'void_air'].includes(block(p)?.name));
    assert.equal(missing.length, 0, 'Every specified block must match on a fresh connection');
    assert.equal(obstructed.length, 0, 'Every specified opening must be clear on a fresh connection');
    const e = goal.blueprint.entrance;
    await navigate(bot, task, new goals.GoalBlock(e.x, e.y, e.z), { timeoutMs: 30000 });
    const air = p => ['air', 'cave_air', 'void_air'].includes(block(p)?.name);
    const levels = {};
    for (const p of goal.blueprint.blocks) {
      const feet = new Vec3(p.x, p.y + 1, p.z), b = goal.blueprint.bounds;
      if (p.x <= b.min.x || p.x >= b.max.x || p.z <= b.min.z || p.z >= b.max.z || feet.y + 1 > b.max.y) continue;
      if (air(feet) && air(feet.offset(0, 1, 0))) (levels[feet.y] ||= []).push(feet);
    }
    const o = goal.blueprint.origin, size = goal.design.source.size;
    const center = new Vec3(o.x + Math.floor(size[0] / 2), 0, o.z + Math.floor(size[2] / 2));
    const visited = [];
    for (const [level, candidates] of Object.entries(levels)) {
      if (candidates.length < 9) continue;
      candidates.sort((a, b) => Math.hypot(a.x - center.x, a.z - center.z) - Math.hypot(b.x - center.x, b.z - center.z));
      const target = candidates[0];
      await navigate(bot, task, new goals.GoalBlock(target.x, target.y, target.z), { timeoutMs: 30000 });
      visited.push({ floorY: Number(level), position: { ...bot.entity.position } });
    }
    result = { result: 'PASS', blocks: goal.blueprint.blocks.length, openings: goal.blueprint.empty.length, visited,
      walkingOnly: true, miningAndScaffoldingDisabled: true, noCommands: true };
  } catch (err) { result = { result: 'FAIL', error: err.stack, position: bot.entity.position }; process.exitCode = 1; }
  finally {
    console.log(JSON.stringify(result));
    fs.writeFileSync(path.join(path.dirname(process.env.DESIGN_GOAL), `independent-verification-${Date.now()}.json`), JSON.stringify(result, null, 2));
    clearTimeout(timer); bot.pathfinder.setGoal(null); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
});
