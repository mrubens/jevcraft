'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('events'), { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('26.1');
const { Task } = require('../src/skills');
const { fightEndStep } = require('../src/end-combat');

function fixture(at, arrows) {
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), registry,
    health: 20, food: 20, oxygenLevel: 20, isAlive: true, game: { gameMode: 'survival', dimension: 'the_end' },
    entity: { position: at, onGround: true }, entities: {},
    inventory: { items: () => [{ name: 'bow', count: 1 }, { name: 'arrow', count: arrows }, { name: 'diamond_sword', count: 1, type: registry.itemsByName.diamond_sword.id, durabilityUsed: 0 }], slots: [] },
    blockAt: p => ({ name: p.y < 64 ? 'end_stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    findBlocks: () => [new Vec3(8, 63, 0), new Vec3(30, 63, 0), new Vec3(-8, 63, 0)], world: { raycast: () => ({ name: 'obsidian' }) }, clearControlStates() {},
    pathfinder: { movements: { blocksCantBreak: new Set([registry.blocksByName.end_stone.id]), scafoldingBlocks: [], canDig: false }, setGoal() {}, getPathTo: () => ({ status: 'success', path: [] }) },
  });
  const dragon = { id: 20, name: 'ender_dragon', position: new Vec3(60, 90, 40), yaw: 0, metadata: {}, isValid: true, width: 2, height: 2 };
  dragon.metadata[registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase')] = 0;
  dragon.metadata[registry.entitiesByName.ender_dragon.metadataKeys.indexOf('health')] = 150;
  bot.entities[20] = dragon;
  return { bot, goal: { kind: 'win', request: 'Jev beat Minecraft', gameProgress: { milestones: {} } }, task: new Task('End') };
}

test('with every crystal down and few arrows, the move offered is to the fountain the dragon perches on, said with the arrows left (note 1155)', async () => {
  const { bot, goal, task } = fixture(new Vec3(40.5, 64, 0.5), 20);
  let said = null, went = null;
  const client = { systemOne: async ({ questions }) => { said = questions.branch_0.criteria; return { answers: { branch_0: { choice: Object.keys(said).find(k => k.startsWith('move_')) } } }; } };
  await fightEndStep(bot, task, goal, () => {}, { navigate: async (b, t, dest) => { went = dest; bot.entity.position = new Vec3(dest.x + .5, dest.y, dest.z + .5); } }, client);
  const moves = Object.entries(said).filter(([k]) => k.startsWith('move_'));
  assert.ok(moves.length >= 1, Object.keys(said).join(','));
  assert.match(moves[0][1].action, /Go to stand about 16 blocks from the fountain the dragon perches on, and wait there for the sword at its head when it lands: 20 arrows are left, the sword reaches the dragon only at its perch, and at its perch arrows do nothing to it/);
  assert.equal(moves[0][1].target, 'fountain');
  assert.equal(Math.abs(went.x), 8, 'the cell nearest twelve from the fountain is the first offered');
});

test('by the fountain already, no walk to another cell of its ring is offered; with arrows in plenty the moves are about the dragon as before', async () => {
  const near = fixture(new Vec3(16.5, 64, 0.5), 20);
  let said = null;
  await fightEndStep(near.bot, near.task, near.goal, () => {}, { navigate: async () => {} }, { systemOne: async ({ questions }) => { said = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'observe' } } }; } });
  assert.ok(!said || !Object.keys(said).some(k => k.startsWith('move_')), Object.keys(said || {}).join(','));
  const rich = fixture(new Vec3(40.5, 64, 0.5), 192);
  await fightEndStep(rich.bot, rich.task, rich.goal, () => {}, { navigate: async () => {} }, { systemOne: async ({ questions }) => { said = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'observe' } } }; } });
  const move = Object.entries(said).find(([k]) => k.startsWith('move_'));
  assert.ok(move && move[1].target === 'ender_dragon', JSON.stringify(move?.[1]));
});

test('the perched head out of reach: the run to the ground under it is offered, and the sword strikes on while the dragon sits', async () => {
  const { bot, goal, task } = fixture(new Vec3(15.5, 64, 7.5), 20);
  const dragon = bot.entities[20], phase = registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase');
  dragon.position = new Vec3(0.5, 66, 0.5); dragon.metadata[phase] = 6;
  bot.equip = async item => { bot.heldItem = item; }; bot.lookAt = async () => {}; bot.look = async () => {}; bot.setControlState = () => {};
  const swings = [];
  bot.attack = e => { swings.push(e.id); if (swings.length === 3) dragon.metadata[phase] = 0; };
  let said = null, went = null;
  const client = { systemOne: async ({ questions }) => { said = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'under_head' } } }; } };
  await fightEndStep(bot, task, goal, () => {}, { navigate: async (b, t, dest) => { went = dest; bot.entity.position = new Vec3(0.5, 64, 7.5); } }, client);
  assert.ok(said.under_head, Object.keys(said).join(','));
  assert.match(said.under_head.action, /Run to the ground under the perched dragon's head and strike it with the sword for as long as it sits/);
  assert.equal(said.under_head.headBlocksOff, 15);
  assert.equal(said.under_head.perchedSeconds, 0);
  assert.match(said.under_head.takeoff, /no water bucket is carried/);
  assert.ok(!Object.keys(said).some(k => k.startsWith('move_')), 'no routes surveyed while the head is the way');
  assert.deepEqual([went.x, went.y, went.z], [0, 64, 7]);
  assert.deepEqual(swings, [21, 21, 21], 'three swings at the head before it took off');
  assert.equal(goal.endCombat.headSwings, 3);
});

test('with no arrow left and crystals still standing, the place offered is by the fountain, said with the crystals that still heal the dragon (note 1169)', async () => {
  const { bot, goal, task } = fixture(new Vec3(40.5, 64, 0.5), 0);
  bot.entities[30] = { id: 30, name: 'end_crystal', position: new Vec3(40.5, 100, 30.5), yaw: 0, metadata: {}, isValid: true, width: 2, height: 2 };
  bot.entities[31] = { id: 31, name: 'end_crystal', position: new Vec3(-40.5, 90, 30.5), yaw: 0, metadata: {}, isValid: true, width: 2, height: 2 };
  let said = null;
  const client = { systemOne: async ({ questions }) => { said = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'observe' } } }; } };
  await fightEndStep(bot, task, goal, () => {}, { navigate: async () => {} }, client);
  const move = Object.entries(said).find(([k]) => k.startsWith('move_'));
  assert.ok(move, Object.keys(said).join(','));
  assert.equal(move[1].target, 'fountain');
  assert.match(move[1].action, /0 arrows are left.*2 healing crystals still stand on their pillars, out of the sword's reach, and heal the dragon while it flies near/);
});

test('under the perched head and a block or two short of it, the bot goes up on blocks laid under its feet and strikes (note 1176)', async () => {
  const { bot, goal, task } = fixture(new Vec3(8.5, 64, 7.5), 20);
  const dragon = bot.entities[20], phase = registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase');
  dragon.position = new Vec3(0.5, 70.2, 0.5); dragon.metadata[phase] = 6;   // its head at (0.5, 69.2, 7): over five blocks up from the ground at 64
  bot.world.raycast = () => null;   // nothing between the eyes and the head
  bot.equip = async item => { bot.heldItem = item; }; bot.lookAt = async () => {}; bot.look = async () => {}; bot.setControlState = () => {};
  const swings = [];
  bot.attack = e => { swings.push(e.id); if (swings.length === 2) dragon.metadata[phase] = 9; };
  const pr = require('../src/pillar-recovery'), pillarUp = pr.pillarUp; let lifted = null;
  pr.pillarUp = async (b, t, y, opts) => { lifted = { y, most: opts.maxBlocks }; b.entity.position = new Vec3(b.entity.position.x, y, b.entity.position.z); };
  try {
    const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'under_head' } } }) };
    await fightEndStep(bot, task, goal, () => {}, { navigate: async () => { bot.entity.position = new Vec3(0.5, 64, 7.5); }, dig: async () => {} }, client);
  } finally { pr.pillarUp = pillarUp; }
  assert.deepEqual(lifted, { y: 66, most: 2 });
  assert.equal(swings.length, 2, 'struck from the blocks');
});

test('where the bot does not stand safe, waiting is still offered beside the run under the head (note 1405)', async () => {
  const { bot, goal, task } = fixture(new Vec3(15.5, 64, 7.5), 20);
  const dragon = bot.entities[20], phase = registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase');
  dragon.position = new Vec3(0.5, 66, 0.5); dragon.metadata[phase] = 6;
  // An endermite nine blocks off: the place is not safe, the strike is.
  bot.entities[50] = { id: 50, name: 'endermite', type: 'hostile', isValid: true, position: new Vec3(24.5, 64, 7.5), metadata: {}, height: 2.9, width: 0.6 };
  let said = null;
  await fightEndStep(bot, task, goal, () => {}, { navigate: async () => {} }, { systemOne: async ({ questions }) => { said = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'observe' } } }; } });
  assert.ok(said?.under_head, Object.keys(said || {}).join(','));
  assert.ok(said.observe, Object.keys(said).join(','));
});

test('a move is said with how near its line passes the dragon (note 1407)', () => {
  const { dragonNearRoute } = require('../src/end-combat');
  // 25588 at 21:04:01Z: from (16.5, -8.5) to (-6, -10), the dragon perched at the fountain's middle.
  assert.equal(dragonNearRoute({ position: new Vec3(0, 65, 0) }, new Vec3(16.5, 62, -8.5), new Vec3(-6, 63, -10)), 10);
  assert.equal(dragonNearRoute({ position: new Vec3(0, 65, 0) }, new Vec3(16.5, 62, -8.5), new Vec3(31, 61, 6)), 19);
  assert.equal(dragonNearRoute(null, new Vec3(0, 0, 0), new Vec3(1, 0, 1)), undefined);
});
