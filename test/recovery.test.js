'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { recordDeath, recoverItems } = require('../src/recovery');
const { reconnect } = require('../src/reconnect');
const { Task } = require('../src/skills');

function fixture() {
  let items = [];
  const movements = { canDig: true, allow1by1towers: true, allowSprinting: true, scafoldingBlocks: [1], maxDropDown: 3 };
  const bot = {
    game: { gameMode: 'survival', dimension: 'overworld' }, health: 20, food: 20,
    entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, inventory: { items: () => items },
    blockAt: () => ({ name: 'air' }),
    pathfinder: { movements, getPathTo: () => ({ status: 'success', path: [new Vec3(5, 64, 0)] }) },
  };
  const recovery = { status: 'pending', at: new Date().toISOString(), position: { x: 5.5, y: 64, z: 0.5 },
    dimension: 'overworld', inventoryBeforeDeath: { oak_log: 2 }, recovered: {}, attempts: 0 };
  return { bot, recovery, supply: value => { items = value; } };
}

test('death records observed inventory and pauses after three recent deaths without erasing refuges', () => {
  const { bot, supply } = fixture();
  supply([{ name: 'oak_log', count: 3 }]);
  const state = { shelters: [{ origin: { x: 1, y: 64, z: 1 } }], paused: false };
  recordDeath(bot, state, 1000000);
  assert.deepEqual(state.recovery.inventoryBeforeDeath, { oak_log: 3 });
  assert.equal(state.paused, false);
  recordDeath(bot, state, 1001000); recordDeath(bot, state, 1002000);
  assert.equal(state.paused, true);
  assert.match(state.deathBlocked, /three times/);
  assert.equal(state.shelters.length, 1);
});

test('inventory clearing before the death event does not erase the recent alive observation', () => {
  const { observeAliveInventory } = require('../src/recovery');
  const { bot, supply } = fixture();
  bot.entity.id = 1; bot.isAlive = true;
  supply([{ name: 'stick', count: 16 }]);
  observeAliveInventory(bot, 1000);
  supply([]); bot.health = 0;
  observeAliveInventory(bot, 1050);
  const state = {};
  recordDeath(bot, state, 1100);
  assert.deepEqual(state.recovery.inventoryBeforeDeath, { stick: 16 });
  assert.equal(state.recovery.inventoryObservedAt, new Date(1000).toISOString());
  recordDeath(bot, state, 4000);
  assert.deepEqual(state.recovery.inventoryBeforeDeath, {}, 'stale observations must not become current inventory');
});

test('retrieval counts actual pickup and restores ordinary movement capabilities', async () => {
  const { bot, recovery, supply } = fixture();
  bot.entities[9] = { id: 9, position: new Vec3(5.5, 64, 0.5), getDroppedItem: () => ({ name: 'oak_log', count: 2 }) };
  const original = { ...bot.pathfinder.movements };
  const navigate = async () => {
    assert.equal(bot.pathfinder.movements.canDig, false);
    assert.deepEqual(bot.pathfinder.movements.scafoldingBlocks, []);
    supply([{ name: 'oak_log', count: 2 }]);
    bot.entity.position = new Vec3(5.5, 64, 0.5);
    delete bot.entities[9];
  };
  assert(await recoverItems(bot, new Task('test', 'recover'), recovery, () => {}, navigate));
  assert.deepEqual(recovery.recovered, { oak_log: 2 });
  assert.deepEqual(bot.pathfinder.movements, original);
  assert.equal(await recoverItems(bot, new Task('test', 'finish'), recovery, () => {}, navigate), false);
  assert.equal(recovery.status, 'finished');
  assert.match(recovery.reason, /recovered the recorded/);
});

test('unsafe, unavailable or missing drops replan from actual inventory without a dangerous trip', async () => {
  for (const kind of ['dimension', 'unloaded', 'missing', 'route', 'hazard', 'expired']) {
    const { bot, recovery } = fixture();
    if (kind === 'dimension') bot.game.dimension = 'the_nether';
    if (kind === 'unloaded') bot.blockAt = () => null;
    if (kind === 'missing') bot.entity.position = new Vec3(5.5, 64, 0.5);
    if (kind === 'route') bot.pathfinder.getPathTo = () => ({ status: 'noPath' });
    if (kind === 'hazard') bot.blockAt = () => ({ name: 'lava' });
    if (kind === 'expired') recovery.at = new Date(Date.now() - 301000).toISOString();
    const original = { ...bot.pathfinder.movements };
    await recoverItems(bot, new Task('test', kind), recovery, () => {}, async () => { throw new Error('must not navigate'); });
    assert.equal(recovery.status, 'finished', kind);
    assert.deepEqual(recovery.inventoryAfter, {});
    assert.deepEqual(recovery.recovered, {});
    assert.deepEqual(bot.pathfinder.movements, original);
  }
});

test('respawn retrieval waits for delayed item metadata and observes real pickup', async () => {
  const { bot, recovery, supply } = fixture();
  bot.entity.position = new Vec3(3.5, 64, 0.5);
  let metadata;
  bot.entities[9] = { id: 9, position: new Vec3(5.5, 64, 0.5), getDroppedItem: () => metadata };
  const timer = setTimeout(() => { metadata = { name: 'oak_log', count: 2 }; }, 200);
  try {
    assert(await recoverItems(bot, new Task('test', 'delayed drops'), recovery, () => {}, async () => {
      assert(metadata);
      supply([{ name: 'oak_log', count: 2 }]);
    }));
    assert.deepEqual(recovery.recovered, { oak_log: 2 });
  } finally { clearTimeout(timer); }
});

test('stop interrupts the respawn observation window before navigation', async () => {
  const { bot, recovery } = fixture();
  bot.entity.position = new Vec3(5.5, 64, 0.5);
  const task = new Task('test', 'stop observing');
  const timer = setTimeout(() => task.cancel(), 100);
  try {
    await assert.rejects(recoverItems(bot, task, recovery, () => {}, async () => assert.fail('must not navigate')), { name: 'Cancelled' });
    assert.equal(recovery.status, 'pending');
  } finally { clearTimeout(timer); }
});

test('cancelled or interrupted retrieval remains pending and restores movement settings', async () => {
  const { bot, recovery } = fixture();
  const original = { ...bot.pathfinder.movements };
  const task = new Task('test', 'cancel');
  await assert.rejects(recoverItems(bot, task, recovery, () => {}, async () => { task.cancel(); task.check(); }), { name: 'Cancelled' });
  assert.equal(recovery.status, 'pending');
  assert.deepEqual(bot.pathfinder.movements, original);
});

test('reconnection creates fresh sessions with bounded backoff and stops on explicit shutdown', async () => {
  const controller = new AbortController();
  const reports = [];
  let connections = 0, shutdowns = 0;
  await reconnect(() => {
    connections++;
    if (connections < 4) return { closed: Promise.resolve({ reason: 'disconnect', spawned: false, uptimeMs: 0 }), shutdown: () => shutdowns++ };
    let finish;
    const closed = new Promise(resolve => { finish = resolve; });
    queueMicrotask(() => controller.abort());
    return { closed, shutdown: () => { shutdowns++; finish({}); } };
  }, { signal: controller.signal, initialDelay: 1, maximumDelay: 3, report: value => reports.push(value) });
  assert.equal(connections, 4); assert.equal(shutdowns, 1);
  assert.deepEqual(reports.map(r => r.retryInMs), [1, 2, 3]);
});

test('stop received while reconnecting cancels saved work before the world is ready', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const { EventEmitter } = require('node:events');
  const mineflayer = require('mineflayer');
  const { createSession } = require('../src/session');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-reconnect-'));
  const config = { host: 'test', port: 1, username: 'Jev' };
  fs.writeFileSync(path.join(directory, 'test-1-Jev.json'), JSON.stringify({ version: 1, status: 'running', kind: 'follow', createdAt: 'original' }));
  const bot = new EventEmitter();
  bot._client = new EventEmitter(); bot.players = { Caller: { username: 'Caller', uuid: 'player-id' } };
  bot.loadPlugin = () => {}; bot.chat = () => {}; bot.quit = () => bot.emit('end');
  const original = mineflayer.createBot;
  let session;
  try {
    mineflayer.createBot = () => bot;
    session = createSession(config, {}, { stateDirectory: directory });
    bot._client.emit('playerChat', { sender: 'player-id', plainMessage: 'Jev stop' });
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'test-1-Jev.json')));
    assert.equal(saved.status, 'cancelled'); assert.equal(saved.createdAt, 'original');
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'test-1-Jev-survival.json'))).paused, true);
  } finally { session?.shutdown(); mineflayer.createBot = original; fs.rmSync(directory, { recursive: true, force: true }); }
});
