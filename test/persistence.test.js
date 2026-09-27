'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task, shakeLoose } = require('../src/skills');
const { runGoal, runIdle } = require('../src/work');
const registry = require('minecraft-data')('26.1');

function fixture() {
  const bot = { registry, inventory: { items: () => [] }, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5), onGround: true }, health: 20, food: 20, entities: {}, time: { timeOfDay: 1000 },
    pathfinder: { movements: { blocksCantBreak: new Set(), exclusionAreasBreak: [] }, setGoal() {} }, clearControlStates() {},
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }), chat(line) { this.said.push(line); }, said: [], emit() {}, buildRegistry: null };
  const goal = { kind: 'obtain', item: 'pumpkin', count: 1, request: 'get a pumpkin', from: 'Player', survival: {} };
  return { bot, goal, task: new Task('persist', 'get a pumpkin') };
}
const blocked = message => Object.assign(new Error(message), { name: 'Blocked' });

test('a request that keeps failing is never marked blocked; the bot says so once, shakes loose and goes again', async () => {
  const { bot, goal, task } = fixture();
  let attempts = 0;
  const survival = { state: goal.survival, step: async () => { attempts++; throw blocked('No feasible house action remains'); } };
  const result = await runGoal(bot, task, goal, { save() {} }, { survival, maxSteps: 9, backoffMs: 1 });
  assert.equal(result.ok, false); assert.equal(result.reason, 'Action budget reached', 'only the test budget ended it');
  assert(goal.struggles >= 3, `struggled ${goal.struggles} times`);
  const said = bot.said.filter(l => /keep trying/.test(l)).length;
  assert(said >= 1 && said < goal.struggles, `said ${said} times over ${goal.struggles} rounds: once, then every fifth`);
  assert.equal(attempts, 9);
});

test('a request that is impossible by definition is explained once and parked', async () => {
  const { bot, goal, task } = fixture();
  const survival = { state: goal.survival, step: async () => { throw blocked('No supported survival acquisition method for bedrock'); } };
  const result = await runGoal(bot, task, goal, { save() {} }, { survival, maxSteps: 9, backoffMs: 1 });
  assert.equal(result.ok, false); assert.equal(goal.status, 'blocked'); assert.match(bot.said.at(-1), /resume/);
});

test('idle survival persists through repeated failures instead of declaring it needs help', async () => {
  const { bot, goal, task } = fixture();
  let calls = 0;
  const survival = { state: {}, step: async () => { if (++calls > 7) return false; throw new Error('Cannot excavate a surface exit'); } };
  const idle = { version: 1, kind: 'survive', request: 'Stay alive', survival: survival.state };
  const result = await runIdle(bot, task, idle, { save() {} }, { survival, backoffMs: 1, until: () => calls > 7 });
  assert(result.ok); assert(idle.struggles >= 1);
});

test('shake loose escalates: soft blocks and a step, then natural walls, then the floor, never a build or a hazard', async () => {
  const world = new Map(), key = p => `${p.x},${p.y},${p.z}`;
  const set = (x, y, z, name) => world.set(`${x},${y},${z}`, name);
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, dug: [], looked: null, pathfinder: { setGoal() {} },
    blockAt: p => { const name = world.get(key(p)) || (p.y < 64 ? 'stone' : 'air'); return { name, position: p.clone?.() || p, boundingBox: name === 'air' ? 'empty' : 'block', diggable: name !== 'bedrock' }; },
    canDigBlock: () => true, dig: async block => { bot.dug.push(block.name); world.set(key(block.position), 'air'); if (block.position.y === 63) bot.entity.position = bot.entity.position.offset(0, -1, 0); },
    lookAt: async p => { bot.looked = p; }, setControlState(name, on) { if (name === 'forward' && on && bot.free) bot.entity.position = bot.entity.position.offset(bot.free[0], 0, bot.free[1]); },
    clearControlStates() {}, emit(name, detail) { bot.last = detail; } };
  const task = new Task('shake', 'shake');
  // Boxed in: stone walls on three sides, oak planks (someone's wall) on the fourth, leaves on the head.
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1]]) for (const y of [64, 65]) set(dx, y, dz, 'stone');
  for (const y of [64, 65]) set(0, y, -1, 'oak_planks');
  set(0, 65, 0, 'oak_leaves');
  bot.free = null;
  assert.equal(await shakeLoose(bot, task, Date.now() + 5000, { random: () => 0.5, settleMs: 1 }), true);
  assert.equal(bot.dug[0], 'oak_leaves', 'the leaves on the head went first');
  assert(bot.dug.includes('stone') && !bot.dug.includes('oak_planks'), 'a natural wall was opened, the planks were not');
  assert.equal(bot.last.stage, 3, 'walls opened but nothing moved, so it went through the floor');
  assert.equal(world.get('0,63,0'), 'air', 'the floor block was dug');
  assert.equal(bot.last.moved, true);
});

test('shake loose will not dig down over lava or step toward it', async () => {
  const world = new Map(), key = p => `${p.x},${p.y},${p.z}`;
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, dug: [], pathfinder: { setGoal() {} },
    blockAt: p => { const name = world.get(key(p)) || (p.y < 64 ? 'stone' : 'air'); return { name, position: p, boundingBox: ['air', 'lava'].includes(name) ? 'empty' : 'block', diggable: true }; },
    canDigBlock: () => true, dig: async block => { bot.dug.push(block.name); }, lookAt: async () => {}, setControlState() {}, clearControlStates() {}, emit() {} };
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const y of [64, 65]) world.set(`${dx},${y},${dz}`, 'obsidian');
  world.set('0,62,0', 'lava');
  assert.equal(await shakeLoose(bot, new Task('shake', 'shake'), Date.now() + 3000, { random: () => 0.5, settleMs: 1 }), false);
  assert.deepEqual(bot.dug, [], 'nothing was dug: obsidian is not natural and the floor sits over lava');
});

test('a handler that fails inside the loop, moving on or recovering, cannot end the request', async () => {
  const { bot, goal, task } = fixture();
  goal.step = { action: 'mine', block: 'oak_log', drops: 'oak_log', count: 1 };
  bot.findBlocks = () => { throw new Error('No existing dry route away from the blocked staircase'); };
  const survival = { state: goal.survival, step: async () => { throw new Error('Tree out of reach'); } };
  const result = await runGoal(bot, task, goal, { save() {} }, { survival, maxSteps: 8, backoffMs: 1 });
  assert.equal(result.ok, false); assert.equal(result.reason, 'Action budget reached', 'the loop ran to its test budget rather than throwing');
  assert.equal(goal.status, 'blocked'); assert.match(goal.lastError, /budget|dry route|out of reach/);
});

test('shake loose never digs while submerged: it swims up and returns', async () => {
  const digs = [], controls = [];
  const bot = { entity: { position: new Vec3(0.5, 50, 0.5) }, oxygenLevel: 15, inventory: { items: () => [] }, registry,
    blockAt: p => ({ name: p.y <= 61 ? 'water' : 'air', boundingBox: 'empty', position: p, diggable: true }),
    dig: async b => { digs.push(b); }, setControlState: (name, on) => controls.push([name, on]), clearControlStates() {},
    pathfinder: { movements: { blocksCantBreak: new Set(), exclusionAreasBreak: [] }, setGoal() {} }, stopDigging() {} };
  const result = await shakeLoose(bot, new Task('wet'), Date.now() + 400, { budgetMs: 300 });
  assert.equal(result.stage, 'surface');
  assert.deepEqual(digs, []);
  assert(controls.some(([n, on]) => n === 'jump' && on), 'swims up');
  assert(controls.some(([n, on]) => n === 'jump' && !on), 'and lets go of the key');
});

test('a watchdog\'s threat signal, still held when the step\'s error is caught, hands the turn to the survival layer and does not end the goal', async () => {
  // Trial 32, 01:19: hit twice in four seconds at four health, the hurt
  // watchdog set its flag; the step threw, and the check at the top of the
  // loop's catch threw the held signal again, out of the loop. The goal
  // ended "stuck" and the bot stood still until the trial was over.
  const { checkStall } = require('../src/stillness');
  const { NeedsSafety } = require('../src/danger');
  const { bot, goal, task } = fixture();
  task.stallCheck = () => checkStall(bot);
  let calls = 0;
  const survival = { state: goal.survival, step: async () => {
    calls++;
    if (calls === 1) { bot._threatAbort = true; bot._threatAbortAt = Date.now(); throw new NeedsSafety({ entity: { name: 'zombie' }, distance: 2 }); }
    // The survival layer's turn clears what the watchdogs held (stepOnce).
    bot._threatAbort = false;
    return true;
  } };
  const result = await runGoal(bot, task, goal, { save() {} }, { survival, maxSteps: 4, backoffMs: 1 });
  assert.equal(result.reason, 'Action budget reached', `ended: ${result.reason || JSON.stringify(result)}`);
  assert(calls >= 2, 'the survival layer had its turn after the signal');
});

test('a step for another dimension planned again and again sets the stage it came from aside', async () => {
  // mid-218-l, in the Nether, was asked for oak logs some 3700 times in ten minutes, standing still (2026-09-27).
  const { isSetAside } = require('../src/progress');
  const { bot, goal, task } = fixture();
  Object.assign(bot, { on() {}, once() {}, removeListener() {}, off() {}, _client: { on() {}, removeListener() {} } });
  goal.kind = 'win'; goal.request = 'beat the game'; goal.gameProgress = { phase: 'iron_pickaxe', milestones: {} }; goal.strategy = { choice: 'rung_iron_pickaxe' };
  const survival = { state: goal.survival, step: async () => { throw Object.assign(new Error('No oak log in the nether: it is only found in the overworld'), { name: 'WrongDimension' }); } };
  await runGoal(bot, task, goal, { save() {} }, { survival, maxSteps: 4, backoffMs: 1 });
  assert.equal(isSetAside(goal, 'rung', 'iron_pickaxe'), true);
  assert.equal(goal.strategy, undefined);
  assert.match(goal.wrongDimension.error, /oak log/);
});
