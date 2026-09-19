'use strict';
// Controlled construction/entry test with granted portal materials and mixed
// stone supports. This does not establish natural resource acquisition.
require('../src/env').loadEnv();
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder'), { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility'), { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills'), { runGoal, waitFor, inventory } = require('../src/work');
const { GoalStore } = require('../src/objectives');
const site = Number(process.env.PORTAL_TEST_SITE || 3400);
if (!Number.isInteger(site)) throw new Error('PORTAL_TEST_SITE must be an integer');
const id = Date.now().toString(36), username = `Portal${id}`, directory = path.join(__dirname, '..', 'artifacts', `portal-support-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25567, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('portal support test'), timer = setTimeout(() => task.cancel(), 240000);
bot.on('error', err => log({ error: err.message }));
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const commands = [`gamemode survival ${username}`, `tp ${username} ${site + 0.5} 64 ${site + 0.5}`,
      `give ${username} minecraft:obsidian 10`, `give ${username} minecraft:flint_and_steel 1`,
      `give ${username} minecraft:andesite 1`, `give ${username} minecraft:diorite 1`, `give ${username} minecraft:granite 1`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ scenario: 'controlled mixed stone anchors and actual Nether entry', directory, commands });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'setup-ready')), 180000);
    await waitFor(task, () => countOf(bot, 'obsidian') === 10 && countOf(bot, 'granite') === 1 && Math.abs(bot.entity.position.x - (site + 0.5)) < 0.2);
    await bot.waitForChunksToLoad(); assert.equal(bot.game.gameMode, 'survival'); assert.equal(countOf(bot, 'dirt'), 0);
    const goal = { kind: 'nether', request: 'find a way to the Nether', expeditionReady: true, scenario: 'controlled construction with granted materials', initialInventory: inventory(bot) };
    let verifiedFrame = false;
    const activate = bot.activateBlock.bind(bot);
    bot.activateBlock = async (...args) => {
      const o = new Vec3(goal.portalFrame.origin.x, goal.portalFrame.origin.y, goal.portalFrame.origin.z);
      const anchors = [o, o.offset(3, 0, 0), o.offset(0, 4, 0)].map(p => ({ position: p, block: bot.blockAt(p)?.name }));
      assert(goal.portalFrame.blocks.every(p => bot.blockAt(new Vec3(p.x, p.y, p.z))?.name === 'obsidian'));
      assert.deepEqual(anchors.map(a => a.block).sort(), ['andesite', 'diorite', 'granite']);
      assert.equal(countOf(bot, 'dirt'), 0); verifiedFrame = true; log({ verifiedFrame: true, anchors, frame: goal.portalFrame });
      return activate(...args);
    };
    const result = await runGoal(bot, task, goal, new GoalStore(path.join(directory, 'goal.json')), { maxSteps: 12,
      onStep: g => log({ step: g.step, error: g.lastError, position: bot.entity.position, inventory: inventory(bot) }) });
    assert(result.ok, result.reason); assert(verifiedFrame); assert(String(bot.game.dimension).includes('nether'));
    log({ result: 'PASS', dimension: bot.game.dimension, position: bot.entity.position, inventory: inventory(bot), directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
