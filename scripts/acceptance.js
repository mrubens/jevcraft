'use strict';
// Survival acceptance runner: no console commands, grants, teleports or creative mode.
// Every run uses a new player identity and rejects a nonempty initial inventory.
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { configureMovements } = require('../src/movement');
const { compatibilityPlugin } = require('../src/compatibility');
require('../src/env').loadEnv();
const { TypeSafe } = require('../src/typesafe');
const { interpret, GoalStore, verifyHouse } = require('../src/objectives');
const { runGoal, runIdle, createSurvival, inventory } = require('../src/work');
const { Task } = require('../src/skills');
const client = new TypeSafe();
const request = process.argv.slice(2).join(' ') || 'build a house';
const resumeId = process.env.ACCEPT_RESUME;
const cycles = Number(process.env.ACCEPT_CYCLES || 0);
if (!Number.isInteger(cycles) || cycles < 0 || cycles > 10) throw new Error('ACCEPT_CYCLES must be an integer from 0 to 10');
if (cycles && resumeId) throw new Error('Cycle acceptance requires an uninterrupted new run');
if (resumeId && !/^[a-z0-9]+$/.test(resumeId)) throw new Error('Invalid resume run id');
const id = resumeId || Date.now().toString(36);
const username = `Trial${id}`;
const directory = path.join(__dirname, '..', 'artifacts', id);
fs.mkdirSync(directory, { recursive: true });
const goalStore = new GoalStore(path.join(directory, 'goal.json'));
const log = entry => { console.log(JSON.stringify(entry)); fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify(entry) + '\n'); };
const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25565),
  username, auth: 'offline', version: process.env.MC_VERSION || false,
});
bot.loadPlugin(compatibilityPlugin);
bot.loadPlugin(pathfinder);
let receiver;
const task = new Task('acceptance', request);
const timer = setTimeout(() => { task.cancel(); bot.pathfinder.setGoal(null); bot.stopDigging(); }, Number(process.env.ACCEPT_TIMEOUT_MS || (cycles ? (cycles * 20 + 15) * 60000 : 1800000)));
bot.on('chat', (from, message) => { if (from === username) log({ chat: message }); });
bot.on('death', () => {
  log({ death: true, position: bot.entity.position, dimension: bot.game.dimension, inventory: inventory(bot) });
  const saved = goalStore.read();
  if (saved) {
    saved.status = 'failed'; saved.lastError = 'Death during acceptance';
    saved.death = { at: new Date().toISOString(), position: { ...bot.entity.position }, dimension: bot.game.dimension };
    goalStore.save(saved);
  }
  task.cancel(); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.stopDigging();
});
bot.on('health', () => log({ health: bot.health, food: bot.food, oxygen: bot.oxygenLevel, position: bot.entity?.position }));
bot.on('navigation_stall', details => log({ navigationStall: details }));
bot.on('navigation_recovery', details => log({ navigationRecovery: details }));
bot.on('handover', details => log({ handover: details }));
let lastUnsafeRouteLog = 0;
bot.on('path_update', route => {
  const points = [bot.entity.position, ...(route.path || [])];
  const maxDrop = Math.max(0, ...points.slice(1).map((p, i) => points[i].y - p.y));
  if (maxDrop > 3 && Date.now() - lastUnsafeRouteLog > 5000) {
    lastUnsafeRouteLog = Date.now();
    log({ unsafePlannedDrop: maxDrop, path: points.slice(0, 16).map(p => ({ x: p.x, y: p.y, z: p.z })) });
  }
});
bot.on('error', err => log({ error: err.message }));
bot.on('kicked', reason => log({ kicked: reason }));
bot.once('spawn', async () => {
  try {
    configureMovements(bot);
    await bot.waitForChunksToLoad();
    const initial = inventory(bot);
    if (!resumeId && Object.keys(initial).length) throw new Error('Acceptance requires empty inventory');
    if (bot.game.gameMode !== 'survival') throw new Error(`Acceptance requires survival; got ${bot.game.gameMode}`);
    if (process.env.ACCEPT_DIFFICULTY && bot.game.difficulty !== process.env.ACCEPT_DIFFICULTY) throw new Error(`Expected ${process.env.ACCEPT_DIFFICULTY} difficulty; got ${bot.game.difficulty}`);
    const saved = resumeId ? goalStore.read() : null;
    if (resumeId && (!saved || Object.keys(saved.initialInventory || {}).length)) throw new Error('Missing original empty-inventory evidence');
    const spec = saved || await interpret(client, `${username}, ${request}`, 'TestPlayer', username);
    if (!spec || !['house', 'concrete', 'nether', 'obtain', 'craft'].includes(spec.kind)) throw new Error('Jev did not recognize acceptance request');
    if (spec.kind === 'concrete' || spec.deliver) {
      receiver = mineflayer.createBot({ host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25565),
        username: saved?.from || `Receive${id}`, auth: 'offline', version: process.env.MC_VERSION || false });
      await new Promise((resolve, reject) => { receiver.once('spawn', resolve); receiver.once('error', reject); });
      await receiver.waitForChunksToLoad();
    }
    const goal = saved || { ...spec, version: 1, initialInventory: initial, initialPosition: { ...bot.entity.position }, createdAt: new Date().toISOString(), scenario: process.env.ACCEPT_SCENARIO || 'natural' };
    const initialWorldAge = bot.time.age;
    if (cycles && (!Number.isFinite(initialWorldAge) || !bot.time.doDaylightCycle)) throw new Error('Cycle acceptance requires a running world clock');
    const survival = createSurvival(bot, { state: goal.survival, client });
    if (receiver) {
      goal.from = receiver.username;
      goal.requesterPosition = { ...receiver.entity.position };
      goal.receiverInitialItem ??= goal.receiverInitialConcrete ?? inventory(receiver)[goal.item || 'purple_concrete'] ?? 0;
    }
    if (resumeId) log({ resumed: resumeId, inventory: initial, originalCreatedAt: goal.createdAt });
    log({ start: { kind: goal.kind, count: goal.count, request: goal.request, from: goal.from, initialInventory: goal.initialInventory, initialPosition: goal.initialPosition, createdAt: goal.createdAt, scenario: goal.scenario }, username, server: `${process.env.MC_HOST}:${process.env.MC_PORT}`, gameMode: bot.game.gameMode, difficulty: bot.game.difficulty, timeOfDay: bot.time.timeOfDay });
    const result = await runGoal(bot, task, goal, goalStore, {
      decisionClient: client, survival,
      onStep: g => log({ step: g.step, decision: g.decisions?.at(-1), survivalAction: g.survivalAction, position: bot.entity.position, inventory: inventory(bot), health: bot.health, food: bot.food, oxygen: bot.oxygenLevel, error: g.lastError }),
    });
    const verified = result.ok && (goal.kind === 'house' ? verifyHouse(bot, goal.blueprint).ok :
      ['concrete', 'obtain', 'craft'].includes(goal.kind) ? (receiver
        ? goal.delivered >= goal.count && (inventory(receiver)[goal.item || 'purple_concrete'] || 0) >= goal.receiverInitialItem + goal.count
        : (inventory(bot)[goal.item] || 0) >= goal.count) : String(bot.game.dimension).includes('nether'));
    if (verified && cycles) {
      log({ usefulRequestVerified: goal.kind, phase: 'survival-between-requests', targetCycles: cycles, initialWorldAge });
      const idleGoal = { version: 1, kind: 'survive', request: 'Stay alive between player requests',
        blueprint: goal.blueprint, portalFrame: goal.portalFrame, survival: survival.state };
      const idleStore = new GoalStore(path.join(directory, 'idle.json'));
      let lastLogged = 0;
      await runIdle(bot, task, idleGoal, idleStore, { decisionClient: client, survival,
        until: () => bot.time.age - initialWorldAge >= cycles * 24000,
        onStep: g => {
          if (Date.now() - lastLogged < 10000 && !g.lastError) return;
          lastLogged = Date.now();
          log({ endurance: { elapsedTicks: bot.time.age - initialWorldAge, targetTicks: cycles * 24000,
            timeOfDay: bot.time.timeOfDay, action: g.survivalAction, decision: g.decisions?.at(-1)?.path },
          position: bot.entity.position, inventory: inventory(bot), health: bot.health, food: bot.food, error: g.lastError });
        },
      });
      log({ cyclesSurvived: cycles, elapsedTicks: bot.time.age - initialWorldAge });
    }
    log({ acceptance: verified ? 'PASS' : 'FAIL', reason: result.reason, inventory: inventory(bot), dimension: bot.game.dimension, receiverInventory: receiver ? inventory(receiver) : undefined });
    process.exitCode = verified ? 0 : 1;
  } catch (err) { log({ acceptance: 'FAIL', error: err.message }); process.exitCode = 1; }
  finally { clearTimeout(timer); receiver?.quit(); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
