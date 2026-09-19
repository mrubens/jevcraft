'use strict';
// Controlled ore field and granted tools. The executor mines/crafts/smelts in
// Survival; a second client verifies deliveries. This is not fresh acceptance.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills');
const { GoalStore } = require('../src/objectives');
const { runGoal, waitFor, inventory } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Select an explicit isolated MC_PORT');
require('../src/env').loadEnv();
const id = Date.now().toString(36), directory = path.join(__dirname, '..', 'artifacts', `batch-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
function connect(prefix) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port, username: `${prefix}${id}`, version: '26.1', auth: 'offline' });
  bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder); return bot;
}
const bot = connect('Batch'), receiver = connect('Take');
let task = new Task('batch'), deaths = 0, initialArmorDiamonds, furnaceCancelled = false;
const timer = setTimeout(() => task.cancel(), 12 * 60000), inputBatches = [];
for (const player of [bot, receiver]) { player.on('death', () => { deaths++; task.cancel(); }); player.on('error', error => log({ error: error.message })); }
function instrument() {
const nativeCraft = bot.craft.bind(bot);
bot.craft = async (recipe, ...args) => {
  const item = bot.registry.items[recipe.result.id].name;
  if (/^diamond_(helmet|chestplate|leggings|boots)$/.test(item) && initialArmorDiamonds === undefined) {
    initialArmorDiamonds = countOf(bot, 'diamond'); log({ firstArmorCraft: item, diamonds: initialArmorDiamonds });
    assert.equal(initialArmorDiamonds, 24, 'must gather the whole set before the first armor craft');
  }
  return nativeCraft(recipe, ...args);
};
const nativeOpen = bot.openFurnace.bind(bot);
bot.openFurnace = async block => {
  const furnace = await nativeOpen(block), nativePut = furnace.putInput.bind(furnace);
  furnace.putInput = async (type, metadata, count) => { inputBatches.push(count); log({ furnaceInput: count }); return nativePut(type, metadata, count); };
  furnace.on('update', () => {
    if (!furnaceCancelled && furnace.outputItem()?.name === 'iron_ingot') {
      furnaceCancelled = true; log({ cancelFurnaceWithInput: furnace.inputItem()?.count, output: furnace.outputItem()?.count }); task.cancel();
    }
  });
  return furnace;
};
}
async function ready(b) { await new Promise(resolve => b.once('spawn', resolve)); await b.waitForChunksToLoad(); configureMovements(b); }
const survival = { state: {}, step: async () => false };
function makeGoal(material, bed = false) {
  return { version: 1, kind: 'bundle', request: `Jev give me full ${material} armor${bed ? ' and a bed' : ''}`, from: receiver.username,
    requesterPosition: { ...receiver.entity.position }, tasks: [...['helmet', 'chestplate', 'leggings', 'boots'].map(piece => `${material}_${piece}`), ...(bed ? ['white_bed'] : [])]
      .map(item => ({ kind: 'obtain', item, count: 1, deliver: true })) };
}
(async () => {
  try {
    await Promise.all([ready(bot), ready(receiver)]);
    instrument();
    const commands = ['gamerule minecraft:spawn_mobs false', 'forceload add 384 -16 447 31',
      'fill 400 81 -10 435 88 15 air', 'fill 400 80 -10 435 80 15 stone',
      'fill 405 81 2 410 81 5 diamond_ore', 'fill 415 81 2 420 81 5 iron_ore',
      'kill @e[type=minecraft:item,x=400,y=80,z=-10,dx=35,dy=12,dz=25]',
      `give ${bot.username} iron_pickaxe 1`, `give ${bot.username} crafting_table 1`, `give ${bot.username} furnace 1`,
      `give ${bot.username} oak_planks 32`, `give ${bot.username} white_wool 3`,
      `give ${bot.username} bread 16`, `give ${bot.username} oak_log 4`,
      `tp ${bot.username} 403.5 81 .5`, `tp ${receiver.username} 402.5 81 .5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands, null, 2));
    log({ phase: 'setup', directory, commands: path.join(directory, 'setup.json'), ready: path.join(directory, 'ready') });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(bot, 'oak_planks') === 32 && bot.entity.position.distanceTo(new Vec3(403.5, 81, .5)) < 1, 10000);
    await bot.waitForChunksToLoad();
    for (const material of ['diamond', 'iron']) {
      let goal = makeGoal(material, material === 'diamond'), cancelledGather = false;
      const store = new GoalStore(path.join(directory, `${material}.json`));
      task = new Task(`batch ${material}`);
      const onStep = goal => {
        log({ step: goal.step, batch: goal.batch, inventory: inventory(bot), error: goal.lastError });
        if (material === 'diamond' && !cancelledGather && countOf(bot, 'diamond') >= 12 && initialArmorDiamonds === undefined) {
          cancelledGather = true; task.cancel();
        }
      };
      try { await runGoal(bot, task, goal, store, { survival, maxSteps: 160, onStep }); }
      catch (error) { if (error.name !== 'Cancelled') throw error; }
      assert(material === 'diamond' ? cancelledGather : furnaceCancelled, 'expected controlled interruption');
      goal = store.read(); task = new Task(`resume ${material}`);
      const result = await runGoal(bot, task, goal, store, { survival, maxSteps: 160, onStep });
      assert(result.ok, result.reason);
      for (const child of goal.tasks) assert.equal(countOf(receiver, child.item), 1, child.item);
      log({ phase: material, result: 'PASS', receiverInventory: inventory(receiver), resumed: true });
    }
    assert.deepEqual(inputBatches, [24], 'all24 iron enter one furnace load, retained across cancellation');
    assert.equal(deaths, 0); assert.equal(bot.health, 20);
    log({ result: 'PASS', initialArmorDiamonds, inputBatches, health: bot.health, deaths, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, inventory: inventory(bot), position: bot.entity?.position, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.quit(); receiver.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
