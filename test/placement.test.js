'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { place } = require('../src/work');

test('placement refreshes a depleted stack before another construction material is selected', async () => {
  const target = new Vec3(2, 64, 0), items = [{ name: 'andesite', count: 1 }];
  let placed = false, synced = false;
  const bot = { game: { gameMode: 'survival' }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => items },
    equip: async () => {}, blockAt: p => ({ name: p.y === 63 ? 'stone' : placed && p.equals(target) ? 'andesite' : 'air',
      boundingBox: p.y === 63 || placed && p.equals(target) ? 'block' : 'empty', position: p }),
    placeBlock: async () => { placed = true; }, _syncWindow: async () => { items.length = 0; synced = true; } };
  await place(bot, new Task('last anchor'), target, 'andesite');
  assert(placed); assert(synced); assert.equal(items.length, 0);
});

test('stop interrupts a missing inventory acknowledgement after the world confirms placement', async () => {
  const task = new Task('cancel placement'), target = new Vec3(2, 64, 0);
  let placed = false;
  const bot = { game: { gameMode: 'survival' }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'dirt', count: 1 }] },
    equip: async () => {}, blockAt: p => ({ name: p.y === 63 ? 'stone' : placed && p.equals(target) ? 'dirt' : 'air',
      boundingBox: p.y === 63 ? 'block' : 'empty', position: p }),
    placeBlock: async () => { placed = true; }, _syncWindow: () => { setTimeout(() => task.cancel(), 10); return new Promise(() => {}); } };
  await assert.rejects(place(bot, task, target, 'dirt'), { name: 'Cancelled' });
  assert(placed);
});

test('an oriented block is placed facing the wanted way, not the way the click point happens to lie', async () => {
  // Jev walked in heading south and placed a west stair: the server took the
  // facing from the last yaw it had been sent, and the build waited forever on
  // a block that could never match.
  const registry = require('minecraft-data')('26.1'), target = new Vec3(7, 70, -20);
  let placed = null, look = null, serverYaw = Math.PI; // it walked in heading south
  const solid = p => p.y <= 69 || (p.x === 6 && p.y === 70);
  const block = p => {
    if (placed && p.equals(target)) return { name: 'dark_oak_stairs', position: p, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], getProperties: () => placed };
    return solid(p) ? { name: 'spruce_planks', position: p, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], stateId: 1 }
      : { name: 'air', position: p, boundingBox: 'empty', shapes: [] };
  };
  const bot = { registry, game: { gameMode: 'creative' }, entity: { position: new Vec3(9.5, 69.05, -21.5), yaw: 0, pitch: 0 },
    inventory: { items: () => [{ name: 'dark_oak_stairs', count: 1 }] }, equip: async () => {}, blockAt: block,
    world: { getBlock: block, raycast: (from, dir, range) => {
      // March the ray to the first solid cell; the face is the side it came in through.
      let prev = from.floored();
      for (let t = 0; t <= range; t += 0.01) {
        const cell = from.plus(dir.scaled(t)).floored();
        if (cell.equals(prev)) continue;
        if (solid(cell)) { const d = prev.minus(cell); return { position: cell, face: d.y < 0 ? 0 : d.y > 0 ? 1 : d.z < 0 ? 2 : d.z > 0 ? 3 : d.x < 0 ? 4 : 5 }; }
        prev = cell;
      }
      return null;
    } }, getControlState: () => false, setControlState() {},
    // As on a real server, a turn counts only once a tick has sent it.
    look: async (yaw, pitch) => { look = { yaw, pitch }; bot.entity.yaw = yaw; bot.entity.pitch = pitch; },
    waitForTicks: async () => { serverYaw = bot.entity.yaw; },
    _placeBlockWithOptions: async (_ref, _face, options) => {
      assert.equal(options.forceLook, 'ignore', 'the click must not turn Jev back toward the click point');
      // The server sets a stair's facing from the player's horizontal look.
      const dirs = [['north', 0], ['west', Math.PI / 2], ['south', Math.PI], ['east', -Math.PI / 2]];
      const facing = dirs.reduce((best, d) => Math.abs(Math.atan2(Math.sin(serverYaw - d[1]), Math.cos(serverYaw - d[1]))) <
        Math.abs(Math.atan2(Math.sin(serverYaw - best[1]), Math.cos(serverYaw - best[1]))) ? d : best)[0];
      placed = { facing, half: 'bottom', shape: 'straight', waterlogged: false };
    },
    placeBlock: async () => assert.fail('an oriented block goes through the look-controlled placement') };
  await place(bot, new Task('stair'), target, 'dark_oak_stairs', { properties: { facing: 'west', half: 'bottom', waterlogged: false } });
  assert.equal(look.yaw, Math.PI / 2);
  assert.equal(placed.facing, 'west');
});
