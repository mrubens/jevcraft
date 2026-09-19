'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('events'), { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('26.1');
const { Task } = require('../src/skills');
const { metadata, perchedHead, safeEndPoint, arenaMovement, fightEndStep } = require('../src/end-combat');
const { exitEnd } = require('../src/end-exit');
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

test('End hazard envelopes include crystal blasts and observed breath radius; the arena policy restores', () => {
  const { bot } = fixture();
  const crystal = entity(bot, 8, 'end_crystal', new Vec3(10, 64, 0));
  assert.equal(safeEndPoint(bot, bot.entity.position), false);
  const original = { ...bot.pathfinder.movements }, policy = arenaMovement(bot);
  assert(policy.allowed({ x: -5, y: 64, z: 0 })); assert.equal(policy.allowed({ x: 5, y: 64, z: 0 }), false);
  policy.restore(); assert.deepEqual(bot.pathfinder.movements, { ...original, allow1by1towers: undefined, allowSprinting: undefined, allowedPosition: undefined });
  delete bot.entities[crystal.id];
  entity(bot, 9, 'area_effect_cloud', new Vec3(0, 64, 0), { radius: 6 });
  assert.equal(safeEndPoint(bot, new Vec3(7, 64, 0)), false);
  assert.equal(safeEndPoint(bot, new Vec3(9, 64, 0)), true);
  assert.equal(safeEndPoint(bot, new Vec3(0, 70, 0)), true);
});

test('perched head geometry uses the actual part id and sitting phase; flying or flaming dragons are not melee candidates', () => {
  const { bot } = fixture(), dragon = entity(bot, 20, 'ender_dragon', new Vec3(0, 65, 0), { phase: 6 });
  const head = perchedHead(bot, dragon); assert.equal(head.id, 21); assert.deepEqual(head.position, new Vec3(0, 64, 6.5));
  assert.equal(metadata(bot, dragon, 'phase'), 6);
  for (const phase of [0, 3, 5, 9]) {
    dragon.metadata[registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase')] = phase;
    assert.equal(perchedHead(bot, dragon), null);
  }
});

test('End controller verifies an explosion and removal together; crystal loss alone is not success or dragon credit', async () => {
  for (const exploded of [false, true]) {
    const { bot, goal, task } = fixture();
    entity(bot, 8, 'end_crystal', new Vec3(24, 70, 0));
    await fightEndStep(bot, task, goal, () => {}, {}, {}, { shot: async (b, t, target) => {
      if (exploded) bot._client.emit('explosion', { center: { ...target.position } });
      delete bot.entities[target.id]; return { ticks: 0, targetId: target.id };
    } });
    assert.equal(goal.endCombat.destroyedCrystals.length, exploded ? 1 : 0);
    assert.equal(goal.gameProgress.milestones.dragon_defeated, undefined);
    assert.equal(bot.listenerCount('entityMoved'), 0); assert.equal(bot._client.listenerCount('explosion'), 0);
    assert.equal(task.interruptCheck, undefined); assert.equal(bot.pathfinder.movements.canDig, false);
  }
});

test('a changed combat target triggers a bounded replan while explicit cancellation still unwinds', async () => {
  for (const cancel of [false, true]) {
    const { bot, goal, task } = fixture(); entity(bot, 8, 'end_crystal', new Vec3(24, 70, 0));
    const step = fightEndStep(bot, task, goal, () => {}, {}, {}, { shot: async () => {
      if (cancel) { task.cancel(); task.check(); }
      throw new Error('The target moved during drawing');
    } });
    if (cancel) await assert.rejects(step, { name: 'Cancelled' });
    else { await step; assert.match(goal.endCombat.lastInterrupted.reason, /moved/); assert.equal(goal.endCombat.noProgress, 1); }
    assert.equal(bot.listenerCount('entityMoved'), 0); assert.equal(bot._client.listenerCount('explosion'), 0);
  }
});

test('End exit needs player kill credit, an observed active portal, an exit event and a living landing', async () => {
  const { bot, goal, task } = fixture();
  await assert.rejects(exitEnd(bot, task, goal, () => {}, {}), /kill credit/);
  goal.gameProgress.milestones.dragon_defeated = { source: 'minecraft:end/kill_dragon', at: Date.now() };
  await assert.rejects(exitEnd(bot, task, goal, () => {}, {}), /No active exit/);
  const p = new Vec3(3, 64, 0), original = bot.blockAt;
  bot.findBlocks = () => [p]; bot.blockAt = q => q.equals(p) ? { name: 'end_portal' } : original(q);
  await assert.rejects(exitEnd(bot, task, goal, () => {}, { navigate: async () => { bot.game.dimension = 'overworld'; } }, { timeoutMs: 60 }), /No exit-portal event/);
  bot.game.dimension = 'the_end';
  await exitEnd(bot, task, goal, () => {}, { navigate: async () => {
    goal.gameProgress.milestones.exit_portal_used = { at: Date.now(), source: 'game_state_change:win_game' };
    bot.game.dimension = 'overworld'; bot.isAlive = false;
    setTimeout(() => { bot.isAlive = true; }, 30);
  } }, { timeoutMs: 300 });
  assert.equal(goal.endReturn.source, 'living_exit_portal_return');
  assert.equal(bot.pathfinder.movements.canDig, false);
});
