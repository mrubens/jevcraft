'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixMiningMaterials } = require('../src/compatibility');

test('26.1 mining uses pickaxe speed while preserving harvest requirements', () => {
  const registry = require('prismarine-registry')('26.1');
  const Block = require('prismarine-block')(registry);
  const originalHarvest = { ...registry.blocksByName.obsidian.harvestTools };
  fixMiningMaterials(registry);
  const obsidian = Block.fromStateId(registry.blocksByName.obsidian.defaultState);
  const diamond = registry.itemsByName.diamond_pickaxe.id;
  const iron = registry.itemsByName.iron_pickaxe.id;
  assert.equal(obsidian.digTime(diamond, false, false, false), 9400);
  assert.equal(obsidian.canHarvest(diamond), true);
  assert.ok(!obsidian.canHarvest(iron));
  assert.deepEqual(obsidian.harvestTools, originalHarvest);
  assert.equal(registry.blocksByName.oak_log.material, 'mineable/axe');
});

test('difficulty accepts both numeric and 26.1 named protocol values', () => {
  const { EventEmitter } = require('node:events');
  const { compatibilityPlugin } = require('../src/compatibility');
  const bot = { _client: new EventEmitter(), game: {} };
  compatibilityPlugin(bot);
  bot._client.emit('difficulty', { difficulty: 'normal' });
  assert.equal(bot.game.difficulty, 'normal');
  bot._client.emit('difficulty', { difficulty: 0 });
  assert.equal(bot.game.difficulty, 'peaceful');
});

test('decoded lpVec3 projectile velocities retain blocks per tick without changing older integer protocols', () => {
  const { EventEmitter } = require('events'), { Vec3 } = require('vec3');
  const { compatibilityPlugin } = require('../src/compatibility');
  for (const version of ['26.1', '1.21.4']) {
    const entity = { velocity: new Vec3(0, 0, 0) };
    const bot = { _client: new EventEmitter(), entities: { 8: entity }, registry: require('prismarine-registry')(version) };
    for (const name of ['spawn_entity', 'entity_velocity']) {
      bot._client.on(name, packet => entity.velocity.set(packet.velocity.x / 8000, packet.velocity.y / 8000, packet.velocity.z / 8000));
    }
    compatibilityPlugin(bot);
    for (const name of ['spawn_entity', 'entity_velocity']) {
      bot._client.emit(name, { entityId: 8, velocity: { x: 2, y: -.5, z: 1 } });
      assert.equal(entity.velocity.x, version === '26.1' ? 2 : 2 / 8000);
      assert.equal(entity.velocity.y, version === '26.1' ? -.5 : -.5 / 8000);
    }
  }
});

test('nearby animals cannot overwrite the bot oxygen reading', () => {
  const { EventEmitter } = require('node:events');
  const { compatibilityPlugin } = require('../src/compatibility');
  const bot = { _client: new EventEmitter(), entity: { id: 10 }, registry: require('prismarine-registry')('26.1') };
  const key = bot.registry.entitiesByName.player.metadataKeys.indexOf('air_supply');
  // Reproduce the upstream listener: it does not check entityId.
  bot._client.on('entity_metadata', packet => { bot.oxygenLevel = packet.metadata[0].value / 15; });
  compatibilityPlugin(bot);
  bot._client.emit('entity_metadata', { entityId: 10, metadata: [{ key, value: 150 }] });
  assert.equal(bot.oxygenLevel, 10);
  bot._client.emit('entity_metadata', { entityId: 99, metadata: [{ key, value: 6000 }] });
  assert.equal(bot.oxygenLevel, 10);
  bot._client.emit('entity_metadata', { entityId: 10, metadata: [{ key, value: 300 }] });
  assert.equal(bot.oxygenLevel, 20);
});

test('26.1 credits acknowledgement and respawn use the named client-command field', () => {
  const { EventEmitter } = require('events'), writes = [];
  const bot = { _client: new EventEmitter(), registry: require('prismarine-registry')('26.1') };
  bot._client.write = (...args) => writes.push(args);
  require('../src/compatibility').compatibilityPlugin(bot);
  bot._client.write('client_command', { action: 0 });
  bot._client.write('client_command', { actionId: 0 });
  bot._client.write('client_command', { actionId: 'request_stats' });
  bot._client.write('other_packet', { action: 0 });
  assert.deepEqual(writes, [['client_command', { actionId: 'perform_respawn' }], ['client_command', { actionId: 'perform_respawn' }],
    ['client_command', { actionId: 'request_stats' }], ['other_packet', { action: 0 }]]);
});

test('aim evidence tracks only forwarded rotation packets and is cleared on dimension respawn', () => {
  const { EventEmitter } = require('events'), writes = [];
  const bot = { _client: new EventEmitter() };
  bot._client.write = (name, packet) => { if (packet.reject) throw new Error('write failed'); writes.push([name, packet]); return true; };
  require('../src/compatibility').compatibilityPlugin(bot);
  assert.equal(bot._client.write('look', { yaw: 10, pitch: -45 }), true);
  assert.equal(bot.lastSentRotation.pitch, -45);
  bot._client.write('position', { x: 1, y: 64, z: 1 });
  assert.equal(bot.lastSentRotation.pitch, -45);
  bot._client.write('position_look', { x: 1, y: 64, z: 1, yaw: 20, pitch: -60 });
  assert.equal(bot.lastSentRotation.yaw, 20); assert.equal(bot.lastSentRotation.pitch, -60);
  assert.throws(() => bot._client.write('look', { yaw: 40, pitch: -30, reject: true }), /write failed/);
  assert.equal(bot.lastSentRotation.pitch, -60, 'Failed writes do not count as sent');
  bot._client.emit('respawn'); assert.equal(bot.lastSentRotation, undefined);
  assert.equal(writes.length, 3, 'Tracking never sends extra packets');
});

test('path smoothing and execution cannot corrupt an ongoing AStar search', () => {
  const AStar = require('mineflayer-pathfinder/lib/astar');
  const Move = require('mineflayer-pathfinder/lib/move');
  const { Vec3 } = require('vec3');
  require('../src/compatibility').fixPathfinderResults();
  const search = Object.create(AStar.prototype);
  Object.assign(search, { startTime: 0, closedDataSet: new Set(), openHeap: { size: () => 0 } });
  const move = new Move(1, 70, 2, 4, 1, [new Vec3(1, 70, 2)], [{ x: 1, y: 69, z: 2, returnPos: new Vec3(0, 70, 2) }]);
  const node = { data: move, g: 1, parent: { parent: null } };
  const first = search.makeResult('partial', node);
  first.path[0].y -= 10;
  first.path[0].toBreak.shift();
  first.path[0].toPlace[0].returnPos.x = 99;
  const second = search.makeResult('partial', node);
  assert.equal(second.path[0].y, 70);
  assert.equal(second.path[0].toBreak.length, 1);
  assert.equal(second.path[0].toPlace[0].returnPos.x, 0);
  assert.equal(move.y, 70);
});

test('walking into a wall keeps the server-sized player outside its collision box', () => {
  const { Physics, PlayerState } = require('prismarine-physics');
  const { Vec3 } = require('vec3');
  const { fixPlayerDimensions } = require('../src/compatibility');
  const registry = require('prismarine-registry')('26.1');
  const Block = require('prismarine-block')(registry);
  const world = { getBlock(p) {
    const cell = p.floored();
    const name = cell.y === 62 || (cell.x === 58 && cell.y === 63) ? 'stone' : 'air';
    const block = Block.fromStateId(registry.blocksByName[name].defaultState);
    block.position = cell;
    return block;
  } };
  function walk(fixed) {
    const physics = Physics(registry, world);
    if (fixed) fixPlayerDimensions(physics);
    const bot = { version: '26.1', entity: { position: new Vec3(57.5, 63, -2.5), velocity: new Vec3(0, 0, 0),
      onGround: true, yaw: -Math.PI / 2, pitch: 0, effects: {}, attributes: {} }, inventory: { slots: [] } };
    const controls = Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(k => [k, k === 'forward']));
    let state = new PlayerState(bot, controls);
    for (let tick = 0; tick < 50; tick++) state = physics.simulatePlayer(state, world);
    return state;
  }
  assert(walk(false).pos.x + Math.fround(0.6) / 2 > 58, 'the old physics overlaps the server wall');
  const corrected = walk(true);
  assert.equal(corrected.pos.x + Math.fround(0.6) / 2, 58);
  assert(corrected.onGround);
  assert.equal(corrected.pos.y, 63);
  const custom = { playerHalfWidth: 0.4, playerHeight: 2 };
  fixPlayerDimensions(custom);
  assert.deepEqual(custom, { playerHalfWidth: 0.4, playerHeight: 2 });
});
