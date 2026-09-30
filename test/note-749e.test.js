'use strict';
// Note 749e (artifacts/critic ~18:23Z item 1; the queue's 25588 and 25597).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const worldBot = (items, pos = new Vec3(0.5, 64, 0.5)) => Object.assign(new EventEmitter(), { registry, inventory: Object.assign(new EventEmitter(), { items: () => items, slots: [] }),
  game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entity: { id: 1, position: pos, onGround: true }, health: 20, food: 20, entities: {}, time: { timeOfDay: 3000 },
  findBlocks: () => [], blockAt: p => { const f = p.floored(); const name = f.y < 64 ? 'stone' : 'air'; return { name, boundingBox: name === 'air' ? 'empty' : 'block', position: f, skyLight: 15 }; },
  pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, chat() {}, emit() {} });

test('a mine step for flint with gravel carried offers putting it down and digging it, with the odds (25590, 18:08 to 18:23Z)', async () => {
  const { answerStall } = require('../src/work');
  const item = (name, count) => ({ name, count, type: registry.itemsByName[name].id });
  const bot = worldBot([item('gravel', 8), item('iron_pickaxe', 1), item('iron_shovel', 1)]);
  const goal = { kind: 'win', request: 'beat the game', survival: {}, step: { action: 'mine', block: 'gravel', sources: ['gravel'], drops: 'flint', count: 1 } };
  let offered = null;
  const task = new Task('stall');
  const client = { model: 'jev', systemOne: async ({ questions }) => { offered = offered || Object.values(questions)[0].criteria; task.cancel(); const k = Object.keys(Object.values(questions)[0].criteria)[0]; return { answers: Object.fromEntries(Object.keys(questions).map(b => [b, { choice: k, confidence: 0.6 }])) }; } };
  const stall = { key: 'step:mine', work: 'step:mine', layer: 'work', strikes: 1, until: Date.now() + 23000 };
  await answerStall(bot, task, goal, () => {}, stall, { client }).catch(() => {});
  assert.ok(offered?.dig_own, Object.keys(offered || {}).join(', '));
  assert.match(offered.dig_own, /^Put down the 8 gravel carried, one at a time beside the bot, and dig each for its flint: no walk and no search, 1 wanted\. Each dug gives flint about one time in 10: with 8, about 57 in 100 that one comes/);
});

test('a detour chosen for this same stall twice or more and come to nothing is listed after the ones not tried (25590\'s mine_nearby and differently)', async () => {
  const { breakStillness } = require('../src/work');
  const ore = new Vec3(3, 37, 0);
  const stacks = [{ name: 'stone_pickaxe', count: 1, type: registry.itemsByName.stone_pickaxe.id }, { name: 'stone_axe', count: 1, type: registry.itemsByName.stone_axe.id }, { name: 'stone_sword', count: 1, type: registry.itemsByName.stone_sword.id }];
  const bot = Object.assign(new EventEmitter(), { registry, inventory: Object.assign(new EventEmitter(), { items: () => stacks }), game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 40, 0.5) }, health: 20, food: 20, entities: {}, time: { timeOfDay: 3000 },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.iron_ore.id) ? [ore] : [],
    blockAt: p => { const f = p.floored(); const name = f.equals(ore) ? 'iron_ore' : f.equals(ore.offset(0, 1, 0)) || (f.x === 0 && f.z === 0 && f.y >= 40 && f.y <= 41) ? 'cave_air' : 'stone'; return { name, boundingBox: /air/.test(name) ? 'empty' : 'block', position: f, skyLight: 0 }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat() {} });
  const goal = { kind: 'win', step: { action: 'mine' }, survival: {} };
  let offered;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; throw Object.assign(new Error('seen what was offered'), { name: 'Cancelled' }); } };
  await breakStillness(bot, new Task('still'), goal, () => {}, { client, survival: { state: goal.survival, canNightMine: () => false }, reason: 'step:mine' }).catch(() => {});
  const first = Object.keys(offered);
  assert.ok(first.includes('mine_nearby') && first.length >= 2, first.join(', '));
  const lead = first[0];
  goal.survival.detourLog = { 'step:mine': [1, 2, 3].map(i => ({ choice: lead, at: Date.now() - i * 30000 })) };
  await breakStillness(bot, new Task('still'), goal, () => {}, { client, survival: { state: goal.survival, canNightMine: () => false }, reason: 'step:mine' }).catch(() => {});
  const second = Object.keys(offered);
  assert.equal(second.at(-1), lead, `${lead}, tried three times for this stall, comes last: ${second.join(', ')}`);
  assert.match(offered[lead], /Chosen for this same stall 3 times in the last 30 minutes, and the work stood still again after each: listed after the ways not tried for it\./);
});

test('an ore option says what the next rung still wants of it against what is carried (25588: coal at 52 while an iron pickaxe was next)', async () => {
  const { Survival } = require('../src/survival');
  const ores = { '3,39,0': 'coal_ore', '6,39,0': 'iron_ore' };
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 40, 0.5) },
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'coal', count: 52 }, { name: 'raw_iron', count: 1 }], emptySlotCount: () => 10, slots: [] },
    findBlocks: ({ matching }) => Object.keys(ores).filter(k => [].concat(matching).includes(registry.blocksByName[ores[k]].id)).map(k => new Vec3(...k.split(',').map(Number))),
    blockAt: p => ({ name: ores[`${p.x},${p.y},${p.z}`] || 'stone', boundingBox: 'block', position: p }) });
  const gp = require('../src/game-progress');
  const real = gp.openRungs;
  gp.openRungs = () => [{ phase: 'iron_pickaxe', item: 'iron_pickaxe', count: 1 }];
  try {
    const survival = new Survival(bot, { planFor: () => [{ action: 'mine', item: 'iron_ore', produces: { raw_iron: 2 } }, { action: 'smelt', item: 'iron_ingot', consumes: { raw_iron: 3, coal: 1 }, produces: { iron_ingot: 3 } }, { action: 'craft', item: 'iron_pickaxe', produces: { iron_pickaxe: 1 } }] }, {});
    survival.client = { systemOne: async () => ({}) };
    let tree;
    survival.decide = async (task, goal, save, q) => { tree = q.tree; return { path: ['branch'], stale: false }; };
    // As a detour asks it: a scratch goal that carries the ladder's goal.
    const scratch = { kind: 'survive' };
    Object.defineProperty(scratch, 'mainGoal', { value: { kind: 'win' }, enumerable: false });
    await survival.nightTarget(new Task('night'), scratch, () => {}, new Vec3(0, 40, 0));
    const coal = Object.values(tree).find(o => /coal ore/.test(o.description)), iron = Object.values(tree).find(o => /iron ore/.test(o.description));
    assert.match(coal.description, /The next rung, the iron pickaxe, wants no more coal: the 52 carried cover it\./);
    assert.match(iron.description, /The next rung, the iron pickaxe, still wants 2 more raw iron \(1 carried\)\./);
  } finally { gp.openRungs = real; }
});

test('the log fetch keeps the kind it last went for while trees of it are within reach (25598, oak and acacia by turns from 18:37 to 18:43Z)', () => {
  const { logInView } = require('../src/work');
  const trees = { oak_log: [new Vec3(20, 64, 0)], acacia_log: [new Vec3(-20, 64, 0)] };
  const bot = { registry, findBlocks: ({ matching }) => Object.entries(trees).filter(([n]) => [].concat(matching).includes(registry.blocksByName[n].id)).flatMap(([, ps]) => ps),
    blockAt: p => ({ name: Object.entries(trees).find(([, ps]) => ps.some(q => q.equals(p.floored())))?.[0] || 'air', position: p }), entity: { position: new Vec3(0, 64, 0) } };
  const oak = { action: 'mine', block: 'oak_log', sources: ['oak_log'], drops: 'oak_log', count: 4 };
  const acacia = { ...oak, block: 'acacia_log', sources: ['acacia_log'], drops: 'acacia_log' };
  // The plan names acacia; acacia is in reach: acacia, kept.
  assert.equal(logInView(bot, acacia).block, 'acacia_log');
  // The plan names oak next, oak in reach too: the acacia being walked to is kept.
  const next = logInView(bot, oak);
  assert.equal(next.block, 'acacia_log'); assert.equal(next.insteadOf, 'oak_log');
  // No acacia within reach any more: the plan's own oak.
  trees.acacia_log = [];
  assert.equal(logInView(bot, oak).block, 'oak_log');
});

test('a walk to animals seen is held while that herd is still on offer, not asked again every few seconds (25592, 18:43:39 to 18:44:02Z)', async () => {
  const { Survival } = require('../src/survival');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 3000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 17, oxygenLevel: 20, registry,
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null, pathfinder: { movements: {}, setGoal() {} },
    blockAt: p => ({ name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }), findBlocks: () => [], world: { raycast: () => null }, chat() {} });
  let walks = 0;
  const survival = new Survival(bot, { navigate: async () => { walks++; }, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => ({}) } });
  let asked = 0;
  survival.decide = async (task, goal, save, { tree }) => { asked++; const k = Object.keys(tree.obtain_food.children).find(x => /^seen_food_/.test(x)); return { path: ['obtain_food', k], action: tree.obtain_food.children[k], stale: false }; };
  const herd = () => ({ x: 70, y: 64, z: 0, count: 2, at: Date.now(), dimension: 'overworld' });
  const goal = { kind: 'win', request: 'beat the game', stockFood: true, sightings: { sheep: [herd()] } };
  for (let i = 0; i < 3; i++) {
    await survival.step(new Task('test', 'food'), goal, () => {}).catch(() => {});
    // Still in view from here, as noteSightings keeps it: "2 sheep seen just now".
    goal.sightings.sheep = [herd()];
  }
  assert.equal(asked, 1, `asked once, the walk to the same herd held after: asked ${asked} times`);
  assert.ok(walks >= 2, `walked on toward it: ${walks}`);
});
