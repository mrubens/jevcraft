'use strict';
// Controlled Creative mechanics test; never counts as survival acceptance.
require('../src/env').loadEnv();
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { takeCreativeItem } = require('../src/creative');
const { TypeSafe } = require('../src/typesafe');
const { interpret, GoalStore } = require('../src/objectives');
const { runGoal, inventory } = require('../src/work');
const { Task } = require('../src/skills');
const id = Date.now().toString(36);
const directory = path.join(__dirname, '..', 'artifacts', `creative-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { console.log(JSON.stringify(value)); fs.appendFileSync(path.join(directory, 'checks.jsonl'), JSON.stringify(value) + '\n'); };
const config = { host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25567), version: '26.1', auth: 'offline' };
const bot = mineflayer.createBot({ ...config, username: `Cr${id}` });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('test', 'Creative inventory and delivery');
let receiver;
const deadline = setTimeout(() => task.cancel(), 90000);
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    log({ awaitingCreativeMode: bot.username, server: `${config.host}:${config.port}` });
    while (bot.game.gameMode !== 'creative') { task.check(); await new Promise(r => setTimeout(r, 100)); }
    await takeCreativeItem(bot, task, 'purple_concrete', 96);
    if (inventory(bot).purple_concrete !== 96) throw new Error('Incorrect multi-stack inventory');
    log({ check: 'Creative inventory obtains 96 concrete with server synchronization', pass: true });
    receiver = mineflayer.createBot({ ...config, username: `Rc${id}` });
    await new Promise((resolve, reject) => { receiver.once('spawn', resolve); receiver.once('error', reject); });
    await receiver.waitForChunksToLoad();
    const client = new TypeSafe();
    const spec = await interpret(client, 'Jev get me three grass blocks', receiver.username, bot.username, { registry: bot.registry });
    fs.writeFileSync(path.join(directory, 'interpretation.json'), JSON.stringify(spec, null, 2));
    if (spec.item !== 'grass_block' || spec.count !== 3) throw new Error('Unexpected catalog interpretation');
    const goal = { ...spec, version: 1, requesterPosition: { ...receiver.entity.position } };
    const result = await runGoal(bot, task, goal, new GoalStore(path.join(directory, 'goal.json')), { decisionClient: client });
    if (!result.ok || inventory(receiver).grass_block !== 3 || inventory(bot).purple_concrete !== 96) throw new Error('Creative delivery or inventory preservation failed');
    log({ check: 'Catalog request delivers exactly three grass blocks without survival prerequisites', pass: true });
    log({ result: 'PASS', inventory: inventory(bot), receiverInventory: inventory(receiver) });
  } catch (err) { log({ result: 'FAIL', error: err.message }); process.exitCode = 1; }
  finally { clearTimeout(deadline); bot.quit(); receiver?.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
bot.on('error', err => log({ error: err.message }));
