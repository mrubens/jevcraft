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

test('deep surface recovery survives restart and continues beyond twelve inspected steps, with a hard limit', async () => {
  const { bot, goal, task } = fixture();
  bot.entity.position.y = -50;
  const surface = { id: 'option_1', kind: 'surface', description: 'Return to the surface' };
  const adviser = new RecoveryAdviser(bot, {}, { ...config, ask: async () => ({ diagnosis: 'Leave this blocked shaft', steps: [surface] }),
    execute: async () => { bot.entity.position.y++; return bot.entity.position.y >= 64; } });
  await adviser.suggest(task, goal, () => {});
  let restored = goal;
  for (let i = 0; i < 114; i++) {
    if (i === 13) restored = JSON.parse(JSON.stringify(restored));
    assert(await adviser.step(task, restored, () => {}));
  }
  assert.equal(bot.entity.position.y, 64); assert.equal(restored.recoveryAdvice.active, undefined);
  assert.match(restored.recoveryAdvice.history[0].outcome, /Recovery actions completed/);
  assert.equal(restored.recoveryAdvice.calls, 1);

  const stalled = fixture();
  const stuck = new RecoveryAdviser(stalled.bot, {}, { ...config, ask: async () => ({ diagnosis: 'Try returning', steps: [surface] }), execute: async () => false });
  await stuck.suggest(stalled.task, stalled.goal, () => {});
  stalled.goal.recoveryAdvice.active.attempts = LIMITS.surfaceSteps;
  await assert.rejects(stuck.step(stalled.task, stalled.goal, () => {}), /budget exhausted/);
  assert.equal(stalled.goal.recoveryAdvice.active, undefined);
});

test('supply recovery budgets include gathering and the final inventory verification', async () => {
  const { bot, goal, task } = fixture(); let steps = 0;
  const supplies = { ...option, dependencies: [{ action: 'mine', block: 'dirt', count: 12 }] };
  const adviser = new RecoveryAdviser(bot, {}, { ...config, ask: async () => ({ diagnosis: 'Gather footing', steps: [supplies] }), execute: async () => ++steps >= 13 });
  await adviser.suggest(task, goal, () => {});
  for (let i = 0; i < 13; i++) assert(await adviser.step(task, goal, () => {}));
  assert.equal(goal.recoveryAdvice.active, undefined);
  assert.match(goal.recoveryAdvice.history[0].outcome, /Recovery actions completed/);
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

test('Jev names each thing it will try once, however many steps say the same', async () => {
  const { bot, goal, task } = fixture();
  const said = [];
  bot.chat = message => said.push(String(message));
  const relocate = n => ({ id: `option_${n}`, kind: 'relocate', position: { x: n, y: 64, z: 0 }, description: 'Move somewhere else' });
  const adviser = new RecoveryAdviser(bot, {}, { ...config,
    observe: async () => ({ context: observation.context, options: [relocate(1), relocate(2)] }),
    ask: async () => ({ diagnosis: 'Try elsewhere', steps: [relocate(1), relocate(2)], model: 'fable', usage: {} }) });
  await adviser.suggest(task, goal, () => {});
  const idea = said.find(m => m.startsWith('I have an idea'));
  assert(idea, `Jev says what it intends to try: ${JSON.stringify(said)}`);
  assert.equal(idea, "I have an idea. I'll try a different approach.",
    'two relocations are one intention, not a stutter');

  // Genuinely different steps are still listed in order.
  said.length = 0;
  const mixed = [relocate(1), { id: 'option_3', kind: 'surface', description: 'Head up' }];
  const second = new RecoveryAdviser(bot, {}, { ...config,
    observe: async () => ({ context: observation.context, options: mixed }),
    ask: async () => ({ diagnosis: 'Up and over', steps: mixed, model: 'fable', usage: {} }) });
  await second.suggest(task, { ...goal, recoveryAdvice: undefined }, () => {});
  assert.equal(said.find(m => m.startsWith('I have an idea')),
    "I have an idea. I'll try a different approach, then getting back to the surface.");
});

test('Jev gets the first look at a failure; the generative model is asked only when Jev is unsure or has had its turn', async () => {
  const { askJev } = require('../src/recovery-adviser');
  const { bot, goal, task } = fixture();
  let fableCalls = 0, jevConfidence = 0.9;
  const client = { model: 'jev-test', systemOne: async ({ questions }) => {
    assert(questions.recovery.criteria.option_1); assert(questions.recovery.criteria.none);
    return { answers: { recovery: { choice: 'option_1', confidence: jevConfidence, probabilities: { option_1: jevConfidence, none: 1 - jevConfidence } } }, usage: { input_tokens: 90 } };
  } };
  const adviser = new RecoveryAdviser(bot, {}, { ...config, client, ask: async (...args) => { fableCalls++; return advice(...args); }, execute: async () => true });
  assert(await adviser.suggest(task, goal, () => {}));
  assert.equal(fableCalls, 0);
  assert.equal(goal.recoveryAdvice.history[0].source, 'jev');
  assert.equal(goal.recoveryAdvice.history[0].jev.judgment.choice, 'option_1');
  assert.match(goal.recoveryAdvice.history[0].diagnosis, /Jev chose/);
  // The same failure again: Jev had its turn, so the reasoning model looks.
  goal.recoveryAdvice.lastAskedAt = 0; delete goal.recoveryAdvice.active;
  assert(await adviser.suggest(task, goal, () => {}));
  assert.equal(fableCalls, 1);
  assert.equal(goal.recoveryAdvice.history[1].source, 'fable');
  // A new failure Jev is unsure about escalates straight away.
  const unsure = fixture(); jevConfidence = 0.3;
  const cautious = new RecoveryAdviser(unsure.bot, {}, { ...config, client, ask: async (...args) => { fableCalls++; return advice(...args); }, execute: async () => true });
  assert(await cautious.suggest(unsure.task, unsure.goal, () => {}));
  assert.equal(fableCalls, 2);
  assert.equal(unsure.goal.recoveryAdvice.history[0].source, 'fable');
  assert.equal(unsure.goal.recoveryAdvice.history[0].jev.judgment.confidence, 0.3);
  // Jev alone, with no generative key, still recovers; an unsure Jev alone records no plan.
  const alone = fixture();
  const solo = new RecoveryAdviser(alone.bot, {}, { ...config, apiKey: '', client, ask: async () => assert.fail('no key'), execute: async () => true });
  assert.equal(await solo.suggest(alone.task, alone.goal, () => {}), false);
  assert.equal(alone.goal.recoveryAdvice.history[0].status, 'no_plan');
  jevConfidence = 0.95;
  const recovered = fixture();
  assert(await new RecoveryAdviser(recovered.bot, {}, { ...config, apiKey: '', client, ask: async () => assert.fail('no key'), execute: async () => true }).suggest(recovered.task, recovered.goal, () => {}));
  await assert.rejects(askJev({ model: 'jev', systemOne: async () => ({ answers: { recovery: { choice: 'invented', confidence: 1 } } }) }, bot, task, observation), /unavailable/);
});

test('a failing mining step always offers leaving for another source, and taking it sets the nearby blocks aside', async () => {
  const { recoveryOptions, executeRecoveryOption } = require('../src/recovery-options');
  const { catalogPlan, planningInventory } = require('../src/work');
  const { bot, goal, task } = fixture();
  goal.step = { action: 'mine', block: 'oak_log', drops: 'oak_log', count: 8 };
  goal.item = 'oak_log'; goal.count = 8;
  const logs = [new Vec3(3, 65, 0), new Vec3(3, 66, 0)];
  bot.blockAt = p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' });
  bot.findBlocks = ({ matching }) => (Array.isArray(matching) ? matching : [matching]).includes(registry.blocksByName.oak_log.id) ? logs : [];
  bot.pathfinder.getPathTo = () => ({ status: 'noPath', path: [] });
  let explored = null;
  const actions = { catalogPlan, planningInventory, navigate: async () => {}, find: () => logs,
    explore: async (_b, _t, g, _s, block) => { explored = block; bot.entity.position.x += 20; } };
  const observed = await recoveryOptions(bot, task, goal, actions);
  const leave = observed.options.find(o => o.kind === 'explore');
  assert(leave, 'leaving is offered'); assert.match(leave.description, /2 oak log blocks within 16 blocks/);
  assert.equal(await executeRecoveryOption(bot, task, goal, () => {}, leave, actions), true);
  assert.equal(explored, 'oak_log');
  assert.deepEqual(Object.keys(goal.unreachable).sort(), ['(3, 65, 0)', '(3, 66, 0)']);
});
