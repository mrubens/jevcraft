'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('events'), { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('26.1');
const { Task } = require('../src/skills');
const { fightEndStep } = require('../src/end-combat');
const unchanged = require('../src/decisions/unchanged');

function fixture() {
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), registry,
    health: 20, food: 20, oxygenLevel: 20, isAlive: true, game: { gameMode: 'survival', dimension: 'the_end' },
    entity: { position: new Vec3(.5, 64, .5) }, entities: {},
    inventory: { items: () => [{ name: 'bow', count: 1 }, { name: 'arrow', count: 64 }], slots: [] },
    blockAt: p => ({ name: p.y < 64 ? 'end_stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    findBlocks: () => [], world: { raycast: () => null }, clearControlStates() {},
    pathfinder: { movements: { blocksCantBreak: new Set([registry.blocksByName.end_stone.id]), scafoldingBlocks: [], canDig: false }, setGoal() {}, getPathTo: () => ({ status: 'success', path: [] }) },
  });
  const goal = { kind: 'win', request: 'Jev beat Minecraft', gameProgress: { milestones: {} } }, task = new Task('End');
  return { bot, goal, task };
}
function entity(bot, id, name, position, values = {}) {
  const e = { id, name, position, yaw: 0, metadata: {}, isValid: true, width: 2, height: 2 };
  for (const [key, value] of Object.entries(values)) e.metadata[registry.entitiesByName[name].metadataKeys.indexOf(key)] = value;
  bot.entities[id] = e; return e;
}
// The dragon circling forty blocks off and thirty up, seen moving.
function circling(bot) {
  const dragon = entity(bot, 20, 'ender_dragon', new Vec3(40, 94, .5), { phase: 0, health: 166.5 });
  const timer = setInterval(() => { dragon.position = dragon.position.offset(.2, 0, 0); bot.emit('entityMoved', dragon); }, 50);
  return { dragon, stop: () => clearInterval(timer) };
}

test('in the water poured at its feet, a turned enderman ten blocks off does not stop the shot at the dragon (note 1136)', async () => {
  const { bot, goal, task } = fixture();
  const blockAt = bot.blockAt;
  bot.blockAt = p => `${p.floored()}` === `${new Vec3(0, 64, 0)}` ? { name: 'water', boundingBox: 'empty' } : blockAt(p);
  entity(bot, 8, 'enderman', new Vec3(10, 64, .5), { creepy: true });
  bot._hurtBy = { enderman: Date.now() };
  goal.endCombat = { steps: 0, shots: [], destroyedCrystals: [], visits: {}, noProgress: 0, water: { at: { x: 0, y: 64, z: 0 }, poured: Date.now() } };
  const { stop } = circling(bot);
  let shots = 0, options = null, said = null;
  const client = { systemOne: async ({ questions }) => { said = questions.branch_0.criteria.shoot_dragon; return { answers: { branch_0: { choice: 'shoot_dragon' } } }; } };
  try {
    await fightEndStep(bot, task, goal, () => {}, {}, client, { shot: async (b, t, target, opts) => { shots++; options = opts; return { ticks: 0, targetId: target.id }; } });
  } finally { stop(); }
  assert.equal(shots, 1, JSON.stringify(goal.step));
  assert.match(said.fromItsWater, /stands in the water it poured at its feet, 1 turned enderman within twenty blocks, the nearest 10 off/);
  assert.deepEqual(goal.step.selected, ['shoot_dragon']);
  assert.equal(options.standing(), true, 'drawn standing in the water');
  assert.doesNotThrow(() => options.threatCheck(bot), 'the enderman ten off is not what stops it');
});

test('on dry ground the same enderman leaves the place unsafe and no shot is offered', async () => {
  const { bot, goal, task } = fixture();
  bot.lookAt = async () => {};
  entity(bot, 8, 'enderman', new Vec3(10, 64, .5), { creepy: true });
  bot._hurtBy = { enderman: Date.now() };
  const { stop } = circling(bot);
  let shots = 0;
  try { await fightEndStep(bot, task, goal, () => {}, {}, {}, { shot: async () => { shots++; return { ticks: 0 }; } }); } finally { stop(); }
  assert.equal(shots, 0);
  assert.equal(goal.step.action, 'end_hold');
});

test('a step that was the dragon\'s turn does not count against the fight\'s budget; the budget thrown starts over', async () => {
  const { bot, goal, task } = fixture();
  bot.lookAt = async () => {};
  entity(bot, 8, 'enderman', new Vec3(10, 64, .5), { creepy: true });
  bot._hurtBy = { enderman: Date.now() };
  goal.endCombat = { steps: 0, shots: [], destroyedCrystals: [], visits: {}, noProgress: 7 };
  await fightEndStep(bot, task, goal, () => {}, {}, {});
  assert.equal(goal.step.action, 'end_hold');
  assert.equal(goal.endCombat.noProgress, 7, 'a hold for an enderman is no choice that came to nothing');
  goal.endCombat.noProgress = 80;
  await assert.rejects(fightEndStep(bot, task, goal, () => {}, {}, {}), /bounded action budget/);
  assert.equal(goal.endCombat.noProgress, 0);
  assert.equal(goal.endCombat.steps, 0);
});

test('the dragon fight is said, never held, when its last answer changed nothing', () => {
  assert.ok(unchanged.NOT_HELD.has('dragon_fight'));
});

test('walled in on every side and over the head, the way out is offered and dug: the cap and the wall toward the arena', async () => {
  const { bot, goal, task } = fixture();
  const dug = new Set(), blockAt = bot.blockAt;
  const wall = p => { const f = p.floored(); return !dug.has(`${f}`) && f.y >= 64 && f.y <= 66 && Math.abs(f.x) <= 1 && Math.abs(f.z) <= 1 && !(f.x === 0 && f.z === 0 && f.y < 66); };
  bot.blockAt = p => wall(p) ? { name: 'cobblestone', boundingBox: 'block' } : blockAt(p);
  bot.world.raycast = () => ({ name: 'cobblestone' });
  const { enclosed } = require('../src/end-combat');
  assert.deepEqual(enclosed(bot), { of: 'cobblestone' });
  entity(bot, 20, 'ender_dragon', new Vec3(30, 80, .5), { phase: 0, health: 166.5 });
  let said = null;
  const client = { systemOne: async ({ questions }) => { said = questions.branch_0.criteria.open_walls; return { answers: { branch_0: { choice: 'open_walls' } } }; } };
  await fightEndStep(bot, task, goal, () => {}, { dig: async (b, t, cell) => { dug.add(`${cell.floored()}`); } }, client);
  assert.match(said.action, /walled in, blocks on every side of it and over its head \(cobblestone\): no arrow leaves it and no walk/);
  assert.deepEqual([...dug].sort(), [`${new Vec3(0, 66, 0)}`, `${new Vec3(1, 64, 0)}`, `${new Vec3(1, 65, 0)}`].sort());
  assert.equal(enclosed(bot), null);
  assert.equal(goal.endCombat.noProgress, 0);
});

test('in the End no wall-in is offered beside a question at low health', () => {
  const lowHealth = require('../src/low-health');
  const bot = { health: 4, food: 20, game: { dimension: 'the_end' }, entity: { position: new Vec3(.5, 64, .5) }, entities: {}, inventory: { items: () => [], slots: [] }, _shotSurvival: { sealHere: async () => true } };
  const w = lowHealth.ways(bot, { task: {}, goal: {} });
  assert.ok(w && !w.tree.wall_in_first);
});

test('a drawn bow holds for a line that closed to open again, where without the hold the draw is dropped', async () => {
  const { shootBow } = require('../src/projectiles');
  const make = () => {
    const arrows = { name: 'arrow', count: 16 }, bow = { name: 'bow', count: 1, durabilityUsed: 0 };
    const target = { id: 8, name: 'ender_dragon', width: 2, height: 2, position: new Vec3(24, 70, 0) };
    let abandoned = false, releases = 0;
    const bot = Object.assign(new EventEmitter(), { registry, health: 20, oxygenLevel: 20, quickBarSlot: 0,
      game: { gameMode: 'survival', dimension: 'the_end', difficulty: 'normal' }, entity: { position: new Vec3(.5, 64, .5) },
      entities: { 8: target }, inventory: { items: () => [bow, arrows] },
      blockAt: p => ({ name: p.y < 64 ? 'end_stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
      world: { raycast: () => null }, pathfinder: { setGoal() {} }, clearControlStates() {},
      equip: async i => { bot.heldItem = i; }, look: async (yaw, pitch) => { bot.lastSentRotation = { yaw: (Math.PI - yaw) * 180 / Math.PI, pitch: -pitch * 180 / Math.PI }; },
      activateItem: () => { bot.world.raycast = () => ({ position: new Vec3(10, 68, 0) }); setTimeout(() => { bot.world.raycast = () => null; }, 300); },
      setQuickBarSlot: slot => { abandoned = true; bot.quickBarSlot = slot; },
      deactivateItem: () => { if (abandoned) return; releases++; arrows.count--; bot.emit('entitySpawn', { id: 9, name: 'arrow', position: bot.entity.position.offset(0, 1.52, 0), velocity: new Vec3(3, 0, 0) }); },
    });
    return { bot, target, releases: () => releases };
  };
  const dropped = make();
  await assert.rejects(shootBow(dropped.bot, new Task('shot'), dropped.target, { chargeMs: 0, threatCheck: () => {} }), /became obstructed before release/);
  assert.equal(dropped.releases(), 0);
  const held = make();
  const result = await shootBow(held.bot, new Task('shot'), held.target, { chargeMs: 0, threatCheck: () => {}, holdMs: 2000 });
  assert.equal(held.releases(), 1);
  assert.equal(result.consumed, 1);
});
