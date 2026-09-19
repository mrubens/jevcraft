'use strict';
// Resumed diagnostic on a COPY of a retained natural failure. No game commands
// or inventory changes: reconnect the original identity and exercise foraging's
// normal recovery entry point. This is never a fresh acceptance run.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, pickaxeTier } = require('../src/skills');
const { inventory, explore } = require('../src/work');
const { checkThreats } = require('../src/danger');
const { surfaceReturnComplete } = require('../src/surface');
const id = Date.now().toString(36), directory = path.join(__dirname, '..', 'artifacts', `surface-recovery-${id}`);
if (!process.env.RECOVER_USERNAME || !process.env.RECOVER_GOAL) throw new Error('Set RECOVER_USERNAME and RECOVER_GOAL for the copied failed world');
fs.mkdirSync(directory, { recursive: true });
const original = JSON.parse(fs.readFileSync(process.env.RECOVER_GOAL));
const goal = { ...original, status: 'diagnostic', search: {} };
delete goal.surfaceReturn;
const save = () => fs.writeFileSync(path.join(directory, 'goal.json'), JSON.stringify(goal, null, 2));
fs.writeFileSync(path.join(directory, 'original-goal.json'), JSON.stringify(original, null, 2));
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT || 25578), username: process.env.RECOVER_USERNAME, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('resumed surface recovery'), timer = setTimeout(() => task.cancel(), 360000);
let interval, deaths = 0, minimumHealth = 20, finishing = false;
const tools = () => bot.inventory.items().filter(i => i.name.endsWith('_pickaxe')).map(i => ({ name: i.name,
  remaining: bot.registry.itemsByName[i.name].maxDurability - (i.durabilityUsed || 0) }));
bot.on('death', () => { deaths++; task.cancel(); });
bot.on('health', () => { minimumHealth = Math.min(minimumHealth, bot.health); log({ health: bot.health, food: bot.food }); });
bot.on('error', err => log({ error: err.message }));
bot.on('end', reason => { if (!finishing) { log({ result: 'FAIL', reason: `Disconnected: ${reason}` }); clearTimeout(timer); clearInterval(interval); process.exitCode = 1; } });
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); configureMovements(bot);
    const start = bot.entity.position.clone();
    assert.equal(bot.game.gameMode, 'survival'); assert.equal(bot.game.difficulty, 'normal');
    log({ scenario: 'resumed copied natural failure, fresh diagnostic search budget, no gameplay commands', directory,
      username: bot.username, initialPosition: start, initialInventory: inventory(bot), tools: tools(), health: bot.health, food: bot.food });
    assert.equal(pickaxeTier(bot), 0, 'This diagnostic requires the retained exhausted-tool state');
    task.interruptCheck = () => checkThreats(bot);
    interval = setInterval(() => log({ position: bot.entity.position, inventory: inventory(bot), tools: tools(),
      step: goal.step, surfaceReturn: goal.surfaceReturn, toolRecovery: goal.toolRecovery }), 3000);
    for (let step = 0; step < 192; step++) {
      task.check();
      await explore(bot, task, goal, save, 'food animals', { surfaceOnly: true });
      if (goal.toolRecovery && pickaxeTier(bot) >= 2 && bot.entity.position.y >= start.y + 4 && surfaceReturnComplete(bot, goal)) break;
    }
    assert(goal.toolRecovery, 'Actual last-use ingredient pickup must be recorded');
    assert(pickaxeTier(bot) >= 2, 'A usable replacement pickaxe must be in inventory');
    assert(bot.entity.position.y >= start.y + 4 && surfaceReturnComplete(bot, goal), 'A higher exposed exit must actually be reached');
    assert.equal(deaths, 0);
    log({ result: 'PASS', position: bot.entity.position, inventory: inventory(bot), tools: tools(), minimumHealth, deaths, directory });
  } catch (err) { save(); log({ result: 'FAIL', error: err.stack, position: bot.entity?.position, tools: tools(), minimumHealth, deaths, directory }); process.exitCode = 1; }
  finally { finishing = true; clearTimeout(timer); clearInterval(interval); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
