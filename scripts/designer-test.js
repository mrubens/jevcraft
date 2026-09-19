'use strict';
// Real designer call and an optional controlled Creative execution trial.
const testPort = Number(process.env.MC_PORT || 25567);
require('../src/env').loadEnv();
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { designBuilding } = require('../src/designer');
const { TypeSafe } = require('../src/typesafe');
const { GoalStore, interpret, verifyHouse } = require('../src/objectives');
const { Task } = require('../src/skills');
const { runGoal, inventory, waitFor } = require('../src/work');
const resumed = process.env.DESIGN_RESUME ? JSON.parse(fs.readFileSync(path.join(process.env.DESIGN_RESUME, 'goal.json'), 'utf8')) : null;
const id = Date.now().toString(36), username = process.env.DESIGN_USERNAME || (resumed ? `Design${path.basename(process.env.DESIGN_RESUME).replace('designer-', '')}` : `Design${id}`);
const directory = path.join(__dirname, '..', 'artifacts', `designer-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = data => { const line = JSON.stringify({ at: new Date().toISOString(), ...data }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const request = process.env.DESIGN_REQUEST || 'Jev build a compact cherry mansion, with two floors, big windows, a grand entrance and a decorative roof. Keep it within 13 by 10 by 13 blocks, using at most 60 cuboid regions.';
const task = new Task('designer', request);
const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: testPort, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
bot.on('error', err => log({ error: err.message }));
const timer = setTimeout(() => task.cancel(), 1800000);
bot.once('spawn', async () => {
  try {
    configureMovements(bot); await bot.waitForChunksToLoad();
    if (process.env.DESIGN_BUILD === '1' && !resumed) {
      const commands = [`tp ${username} 2000.5 64 2000.5`, `gamemode creative ${username}`];
      fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(commands));
      log({ scenario: 'controlled-creative', commands, setupFile: path.join(directory, 'ready'), directory });
      await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
      await waitFor(task, () => bot.game.gameMode === 'creative');
      await bot.waitForChunksToLoad();
    }
    const spec = resumed || await interpret(new TypeSafe(), request, 'TestPlayer', username, { registry: bot.registry });
    assert.equal(spec.kind, 'build');
    let design = resumed?.design || (process.env.DESIGN_FILE ? JSON.parse(fs.readFileSync(process.env.DESIGN_FILE, 'utf8')) : null);
    let previousDraft = process.env.DESIGN_REPAIR_FILE ? JSON.parse(fs.readFileSync(process.env.DESIGN_REPAIR_FILE, 'utf8')).source : undefined;
    let feedback = process.env.DESIGN_REPAIR_FEEDBACK;
    for (let attempt = 1; !design && attempt <= 2; attempt++) {
      log({ phase: 'designing', attempt, directory });
      try { design = await designBuilding(bot, task, request, { previousDraft, feedback }); }
      catch (err) {
        fs.writeFileSync(path.join(directory, `failed-design-${attempt}.json`), JSON.stringify({ error: err.message, draft: err.draft }, null, 2));
        if (attempt === 2) throw err;
        previousDraft = err.draft; feedback = err.message;
        log({ phase: 'repair', error: err.message });
      }
    }
    fs.writeFileSync(path.join(directory, 'design.json'), JSON.stringify(design, null, 2));
    log({ phase: 'designed', model: design.model, name: design.source.name, dimensions: design.source.size, blocks: design.blocks.length, materials: design.materials });
    if (process.env.DESIGN_BUILD === '1') {
      assert.equal(bot.game.gameMode, 'creative');
      const goal = resumed || { ...spec, version: 1, design, scenario: 'controlled-creative', initialInventory: inventory(bot) };
      const store = new GoalStore(path.join(directory, 'goal.json'));
      let steps = 0;
      const result = await runGoal(bot, task, goal, store, { decisionClient: new TypeSafe(), onStep: g => {
        if (++steps % 10 === 0 || g.lastError) log({ step: g.step, steps, error: g.lastError, position: bot.entity.position });
      } });
      assert(result.ok, result.reason);
      assert(verifyHouse(bot, goal.blueprint).ok);
      log({ phase: 'built', verifiedBlocks: goal.blueprint.blocks.length, origin: goal.blueprint.origin });
    }
    log({ result: 'PASS', scenario: process.env.DESIGN_BUILD === '1' ? 'controlled-creative-build' : 'real-designer-only', directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); bot.pathfinder.setGoal(null); bot.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
