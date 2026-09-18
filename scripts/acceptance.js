'use strict';
// Survival acceptance runner: no console commands, grants, teleports or creative mode.
// Every run uses a new player identity and rejects a nonempty initial inventory.
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { configureMovements } = require('../src/movement');
require('../src/env').loadEnv();
const { TypeSafe } = require('../src/typesafe');
const { interpret, GoalStore, verifyHouse } = require('../src/objectives');
const { runGoal, inventory } = require('../src/work');
const { Task } = require('../src/skills');
const request = process.argv.slice(2).join(' ') || 'build a house';
const resumeId = process.env.ACCEPT_RESUME;
if (resumeId && !/^[a-z0-9]+$/.test(resumeId)) throw new Error('Invalid resume run id');
const id = resumeId || Date.now().toString(36);
const username = `Trial${id}`;
const directory = path.join(__dirname, '..', 'artifacts', id);
fs.mkdirSync(directory, { recursive: true });
const log = entry => { console.log(JSON.stringify(entry)); fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify(entry) + '\n'); };
const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25565),
  username, auth: 'offline', version: process.env.MC_VERSION || false,
});
bot.loadPlugin(pathfinder);
let receiver;
const task = new Task('acceptance', request);
const timer = setTimeout(() => { task.cancel(); bot.pathfinder.setGoal(null); bot.stopDigging(); }, Number(process.env.ACCEPT_TIMEOUT_MS || 1800000));
bot.on('chat', (from, message) => { if (from === username) log({ chat: message }); });
bot.on('death', () => task.cancel());
bot.on('error', err => log({ error: err.message }));
bot.on('kicked', reason => log({ kicked: reason }));
bot.once('spawn', async () => {
  try {
    configureMovements(bot);
    await bot.waitForChunksToLoad();
    const initial = inventory(bot);
    if (!resumeId && Object.keys(initial).length) throw new Error('Acceptance requires empty inventory');
    if (bot.game.gameMode !== 'survival') throw new Error(`Acceptance requires survival; got ${bot.game.gameMode}`);
    const saved = resumeId ? new GoalStore(path.join(directory, 'goal.json')).read() : null;
    if (resumeId && (!saved || Object.keys(saved.initialInventory || {}).length)) throw new Error('Missing original empty-inventory evidence');
    const spec = saved || await interpret(new TypeSafe(), `${username}, ${request}`, 'TestPlayer', username);
    if (!spec || !['house', 'concrete', 'nether'].includes(spec.kind)) throw new Error('Jev did not recognize acceptance request');
    if (spec.kind === 'concrete') {
      receiver = mineflayer.createBot({ host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25565),
        username: saved?.from || `Receive${id}`, auth: 'offline', version: process.env.MC_VERSION || false });
      await new Promise((resolve, reject) => { receiver.once('spawn', resolve); receiver.once('error', reject); });
      await receiver.waitForChunksToLoad();
    }
    const goal = saved || { ...spec, version: 1, initialInventory: initial, initialPosition: { ...bot.entity.position }, createdAt: new Date().toISOString(), scenario: process.env.ACCEPT_SCENARIO || 'natural' };
    if (receiver) {
      goal.from = receiver.username;
      goal.requesterPosition = { ...receiver.entity.position };
      goal.receiverInitialConcrete ??= inventory(receiver).purple_concrete || 0;
    }
    if (resumeId) log({ resumed: resumeId, inventory: initial, originalCreatedAt: goal.createdAt });
    log({ start: { kind: goal.kind, count: goal.count, request: goal.request, from: goal.from, initialInventory: goal.initialInventory, initialPosition: goal.initialPosition, createdAt: goal.createdAt, scenario: goal.scenario }, username, server: `${process.env.MC_HOST}:${process.env.MC_PORT}`, gameMode: bot.game.gameMode });
    const result = await runGoal(bot, task, goal, new GoalStore(path.join(directory, 'goal.json')), {
      onStep: g => log({ step: g.step, position: bot.entity.position, inventory: inventory(bot), error: g.lastError }),
    });
    const verified = result.ok && (goal.kind === 'house' ? verifyHouse(bot, goal.blueprint).ok :
      goal.kind === 'concrete' ? (goal.delivered >= goal.count && (inventory(receiver).purple_concrete || 0) >= goal.receiverInitialConcrete + goal.count) : String(bot.game.dimension).includes('nether'));
    log({ acceptance: verified ? 'PASS' : 'FAIL', reason: result.reason, inventory: inventory(bot), dimension: bot.game.dimension, receiverInventory: receiver ? inventory(receiver) : undefined });
    process.exitCode = verified ? 0 : 1;
  } catch (err) { log({ acceptance: 'FAIL', error: err.message }); process.exitCode = 1; }
  finally { clearTimeout(timer); receiver?.quit(); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
