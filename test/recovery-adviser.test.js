'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { RecoveryAdviser, askFable, validateAdvice, LIMITS } = require('../src/recovery-adviser');
const { runGoal } = require('../src/work');
const registry = require('minecraft-data')('26.1');
const option = { id: 'option_1', kind: 'acquire', item: 'dirt', count: 12, description: 'Gather footing blocks' };
const observation = { context: { request: 'get a pumpkin', failure: 'No safe path', inventory: {}, terrain: [] }, options: [option] };
function fixture() {
  const items = [{ name: 'pumpkin', count: 1, type: registry.itemsByName.pumpkin.id }];
  const bot = { registry, inventory: { items: () => items }, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'peaceful' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, entities: {},
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {} }, clearControlStates() {},
    blockAt: () => ({ name: 'air' }), chat() {}, emit() {} };
  const goal = { kind: 'obtain', item: 'pumpkin', count: 1, request: 'get a pumpkin', from: 'Player', lastError: 'No safe path', survival: {} };
  return { bot, goal, task: new Task('recovery', 'get a pumpkin') };
}
const advice = async () => ({ diagnosis: 'Change approach', steps: [option], model: 'fable', usage: { prompt_tokens: 12 } });
const config = { apiKey: 'test-secret', observe: async () => structuredClone(observation), ask: advice };

test('Fable receives the observed state and dynamic enum; credentials are not persisted', async () => {
  const { bot, task } = fixture();
  let body;
  const result = await askFable(bot, task, observation, { apiKey: 'test-secret', fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-secret'); body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ diagnosis: 'Use footing blocks', steps: ['option_1'] }) } }], usage: { prompt_tokens: 12 } }) };
  } });
  assert.equal(body.model, 'anthropic/claude-fable-5.1');
  assert.deepEqual(body.response_format.json_schema.schema.properties.steps.items.enum, ['option_1']);
  assert.deepEqual(JSON.parse(body.messages[1].content), observation);
  assert.equal(result.steps[0].count, 12);
  assert(!JSON.stringify(result).includes('test-secret'));
});

test('advice cannot introduce commands, items, quantities, repeated actions or extra fields', () => {
  for (const value of [
    { diagnosis: 'Cheat', steps: ['/give @s diamond'] },
    { diagnosis: 'Cheat', steps: [{ id: 'option_1', command: '/tp' }] },
    { diagnosis: 'Cheat', steps: ['option_1'], command: '/give' },
    { diagnosis: 'Repeat', steps: ['option_1', 'option_1'] },
    { diagnosis: 'Too long', steps: ['option_1', 'a', 'b', 'c'] },
  ]) assert.throws(() => validateAdvice(value, observation.options));
  assert.deepEqual(validateAdvice({ diagnosis: 'No supported escape', steps: [] }, observation.options).steps, []);
});

test('stop, newly observed danger, and request timeout abort an in-flight LLM call', async () => {
  for (const mode of ['stop', 'threat', 'timeout']) {
    const { bot, task } = fixture();
    let aborted = false;
    const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); });
    });
    const timer = setTimeout(() => {
      if (mode === 'stop') task.cancel();
      if (mode === 'threat') bot.entities.zombie = { name: 'zombie', position: bot.entity.position.offset(2, 0, 0) };
    }, 10);
    await assert.rejects(askFable(bot, task, observation, { apiKey: 'test-secret', fetchImpl, timeoutMs: mode === 'timeout' ? 30 : 500 }),
      mode === 'stop' ? /cancelled/ : mode === 'threat' ? /Threat/ : /timed out/);
    clearTimeout(timer); assert(aborted);
  }
});

test('persistent plan resumes bounded actions without changing the original request or declaring it complete', async () => {
  const { bot, goal, task } = fixture();
  let executed = 0;
  const adviser = new RecoveryAdviser(bot, {}, { ...config, execute: async (_b, _t, g, _s, action) => {
    executed++; assert.equal(g.item, 'pumpkin'); assert.equal(action.count, 12); return executed >= 2;
  } });
  assert(await adviser.suggest(task, goal, () => {}));
  const restored = JSON.parse(JSON.stringify(goal));
  assert(await adviser.step(task, restored, () => {}));
  assert.equal(restored.recoveryAdvice.active.cursor, 0);
  assert(await adviser.step(task, restored, () => {}));
  assert.equal(restored.recoveryAdvice.active, undefined);
  assert.equal(restored.item, 'pumpkin'); assert.equal(restored.count, 1); assert.notEqual(restored.status, 'complete');
  assert.match(restored.recoveryAdvice.history[0].outcome, /retrying original objective/);
  assert(!JSON.stringify(restored).includes('test-secret'));
});

test('stale plans are discarded after death, dimension change, changed request, expiry, or displacement', async () => {
  for (const change of [g => { g.survival.deaths = [{ at: 'new-death' }]; }, (_g, b) => { b.game.dimension = 'the_nether'; },
    g => { g.request = 'follow me'; }, g => { g.recoveryAdvice.active.expiresAt = 1; }, (_g, b) => { b.entity.position.x += 64; }]) {
    const { bot, goal, task } = fixture(); let executed = false;
    const adviser = new RecoveryAdviser(bot, {}, { ...config, execute: async () => { executed = true; } });
    await adviser.suggest(task, goal, () => {}); change(goal, bot);
    assert.equal(await adviser.step(task, goal, () => {}), false);
    assert(!executed); assert.equal(goal.recoveryAdvice.active, undefined);
  }
});

test('no key/off retain normal behavior; failed service calls and repeated failures are budgeted', async () => {
  const { bot, goal, task } = fixture(); let calls = 0;
  const ask = async () => { calls++; throw new Error('Service unavailable'); };
  for (const override of [{ apiKey: '' }, { enabled: false }]) {
    assert.equal(await new RecoveryAdviser(bot, {}, { ...config, ask, ...override }).suggest(task, goal, () => {}), false);
  }
  assert.equal(calls, 0);
  const adviser = new RecoveryAdviser(bot, {}, { ...config, ask });
  await adviser.suggest(task, goal, () => {});
  await adviser.suggest(task, goal, () => {});
  assert.equal(calls, 1); // cooldown
  goal.recoveryAdvice.lastAskedAt = 0;
  await adviser.suggest(task, goal, () => {});
  goal.recoveryAdvice.lastAskedAt = 0;
  await adviser.suggest(task, goal, () => {});
  assert.equal(calls, 2); // same-failure limit
  goal.recoveryAdvice.calls = LIMITS.calls; goal.lastError = 'Different failure';
  await adviser.suggest(task, goal, () => {}); assert.equal(calls, 2);
});

test('a recovery action that never completes is bounded and records its failure', async () => {
  const { bot, goal, task } = fixture();
  const adviser = new RecoveryAdviser(bot, {}, { ...config, execute: async () => false });
  await adviser.suggest(task, goal, () => {});
  for (let i = 0; i < LIMITS.actionSteps; i++) assert(await adviser.step(task, goal, () => {}));
  await assert.rejects(adviser.step(task, goal, () => {}), /budget exhausted/);
  assert.equal(goal.recoveryAdvice.active, undefined);
});

test('runGoal escalates repeated survival failures, executes the plan, then verifies the retained objective', async () => {
  const { bot, goal, task } = fixture(); let recovered = false, asks = 0, failures = 0;
  const adviser = new RecoveryAdviser(bot, {}, { ...config, ask: async (...args) => { asks++; return advice(...args); },
    execute: async () => { recovered = true; return true; } });
  const survival = { state: goal.survival, step: async () => {
    if (!recovered) { failures++; throw new Error('Cannot reach shelter'); }
    return false;
  } };
  const result = await runGoal(bot, task, goal, { save() {} }, { survival, recoveryAdviser: adviser, maxSteps: 8 });
  assert(result.ok); assert.equal(failures, 3); assert.equal(asks, 1);
  assert.equal(goal.item, 'pumpkin'); assert.equal(goal.count, 1); assert.equal(goal.status, 'complete');
});

test('recovery catalog derives recipe alternatives and rechecks routes before moving', async () => {
  const { recoveryOptions, executeRecoveryOption } = require('../src/recovery-options');
  const { catalogPlan, planningInventory } = require('../src/work');
  const { bot, goal, task } = fixture();
  goal.item = 'purple_concrete'; goal.count = 8;
  let routeOpen = true, moved = false;
  bot.blockAt = p => {
    const name = p.y < 64 ? 'stone' : p.x === 9 && p.y === 64 ? 'poppy' : 'air';
    return { name, position: p, boundingBox: p.y < 64 ? 'block' : 'empty' };
  };
  bot.findBlocks = ({ matching, useExtraInfo }) => {
    const ids = Array.isArray(matching) ? matching : [matching];
    const choices = [];
    if (ids.includes(registry.blocksByName.stone.id)) choices.push(new Vec3(3, 63, 0));
    if (ids.includes(registry.blocksByName.poppy.id)) choices.push(new Vec3(9, 64, 0));
    return choices.filter(p => !useExtraInfo || useExtraInfo(bot.blockAt(p)));
  };
  bot.pathfinder.getPathTo = () => ({ status: routeOpen ? 'success' : 'noPath', path: [new Vec3(3, 64, 0)] });
  const actions = { catalogPlan, planningInventory, navigate: async () => { moved = true; } };
  const before = { ...bot.pathfinder.movements };
  const observed = await recoveryOptions(bot, task, goal, actions);
  assert(observed.context.recipeAlternatives.red_dye.includes('poppy'));
  assert(observed.options.some(o => o.kind === 'acquire' && o.item === 'poppy'));
  const move = observed.options.find(o => o.kind === 'relocate'); assert(move);
  assert.equal(bot.pathfinder.movements.canDig, before.canDig);
  routeOpen = false;
  await assert.rejects(executeRecoveryOption(bot, task, goal, () => {}, move, actions), /route is no longer/);
  assert(!moved); assert.equal(bot.pathfinder.movements.canDig, before.canDig);
});

test('pending recovery defers to immediate safety and failed actions do not replace the player objective', async () => {
  const { bot, goal, task } = fixture(); let executions = 0;
  const adviser = new RecoveryAdviser(bot, {}, { ...config, execute: async () => { executions++; throw new Error('Route changed'); } });
  await adviser.suggest(task, goal, () => {});
  bot.entities.zombie = { name: 'zombie', position: bot.entity.position.offset(2, 0, 0) };
  assert.equal(await adviser.step(task, goal, () => {}), false); assert.equal(executions, 0);
  delete bot.entities.zombie;
  await assert.rejects(adviser.step(task, goal, () => {}), /Route changed/);
  assert.equal(goal.recoveryAdvice.active, undefined); assert.equal(goal.item, 'pumpkin'); assert.equal(goal.count, 1);
  assert.match(goal.recoveryAdvice.history[0].outcome, /failed: Route changed/);
});
