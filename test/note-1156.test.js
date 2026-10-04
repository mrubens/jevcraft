'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('events'), { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('26.1');
const { Task } = require('../src/skills');
const { fightEndStep, safeEndPoint } = require('../src/end-combat');

test('under the perched dragon\'s head the place is not unsafe for the dragon itself, and the strike is offered and lands (note 1156)', async () => {
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), registry,
    health: 20, food: 20, oxygenLevel: 20, isAlive: true, game: { gameMode: 'survival', dimension: 'the_end', difficulty: 'normal' },
    entity: { position: new Vec3(0.5, 64, 7.5), onGround: true }, entities: {},
    inventory: { items: () => [{ name: 'diamond_sword', count: 1, type: registry.itemsByName.diamond_sword.id, durabilityUsed: 0 }], slots: [] },
    blockAt: p => ({ name: p.y < 64 ? 'end_stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    findBlocks: () => [], world: { raycast: () => null }, clearControlStates() {}, setControlState() {},
    equip: async item => { bot.heldItem = item; }, lookAt: async () => {}, look: async () => {},
    pathfinder: { movements: { blocksCantBreak: new Set(), scafoldingBlocks: [], canDig: false }, setGoal() {}, getPathTo: () => ({ status: 'success', path: [] }) } });
  const phase = registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase');
  const dragon = { id: 20, name: 'ender_dragon', type: 'hostile', position: new Vec3(0.5, 66, 0.5), yaw: 0, metadata: { [phase]: 6, [registry.entitiesByName.ender_dragon.metadataKeys.indexOf('health')]: 100 }, isValid: true, width: 2, height: 2 };
  bot.entities[20] = dragon;
  // It has hurt the bot: by that it is one of the mobs set on it (danger.js provoked).
  bot._hurtById = { 20: Date.now() };
  assert.deepEqual(require('../src/danger').hostileEntities(bot, 64).map(e => e.name), ['ender_dragon']);
  assert.equal(safeEndPoint(bot, bot.entity.position), true, 'the perched dragon seven blocks off is no mob to stand off from');
  const swings = [];
  bot.attack = e => { swings.push(e.id); if (swings.length === 2) dragon.metadata[phase] = 9; };
  let said = null;
  const client = { systemOne: async ({ questions }) => { said = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'strike_head' } } }; } };
  const goal = { kind: 'win', request: 'Jev beat Minecraft', gameProgress: { milestones: {} } };
  await fightEndStep(bot, new Task('End'), goal, () => {}, { navigate: async () => {} }, client);
  assert.ok(said?.strike_head || swings.length, Object.keys(said || {}).join(','));
  assert.deepEqual(swings, [21, 21]);
  assert.equal(goal.endCombat.headSwings, 2);
});

test('the dragon coming down to its perch is run from only right overhead; in flight at the same range it is (note 1157)', () => {
  const { dragonThreat } = require('../src/end-safety');
  const phase = registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase');
  const bot = { registry, entity: { position: new Vec3(12.5, 64, 0.5) }, entities: {} };
  const dragon = { id: 20, name: 'ender_dragon', position: new Vec3(0.5, 70, 0.5), metadata: { [phase]: 2 }, isValid: true };
  bot.entities[20] = dragon;
  assert.equal(dragonThreat(bot), undefined, 'landing approach twelve blocks off: the wait by the fountain holds');
  dragon.metadata[phase] = 3; assert.equal(dragonThreat(bot), undefined);
  dragon.position = new Vec3(5.5, 68, 0.5); assert.equal(dragonThreat(bot), dragon, 'landing seven blocks off, its head over the bot: run from');
  dragon.position = new Vec3(0.5, 70, 0.5); dragon.metadata[phase] = 0; assert.equal(dragonThreat(bot), dragon, 'in flight twelve blocks off: run from as before');
});
