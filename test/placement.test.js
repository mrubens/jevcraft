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

test('placing with stay never moves the bot: a cell its body is in, its own column or out of reach is refused', async () => {
  // Sealing on a Nether ledge, the bot stepped back to clear a wall cell
  // and fell twenty blocks into the lava sea.
  const moves = [];
  const bot = { game: { gameMode: 'survival' }, entity: { position: new Vec3(0.75, 64, 0.5) }, inventory: { items: () => [{ name: 'netherrack', count: 20 }] },
    equip: async () => {}, blockAt: p => ({ name: p.y === 63 && p.x === 0 && p.z === 0 ? 'netherrack' : 'air', boundingBox: p.y === 63 && p.x === 0 && p.z === 0 ? 'block' : 'empty', position: p }),
    setControlState: (k, v) => { if (v) moves.push(k); }, getControlState: () => false, lookAt: async () => {},
    placeBlock: async () => assert.fail('placed') };
  await assert.rejects(place(bot, new Task('seal'), new Vec3(1, 64, 0), 'netherrack', { stay: true }), /would move me off this ledge/, 'the body overlaps the cell');
  await assert.rejects(place(bot, new Task('seal'), new Vec3(0, 63, 0), 'cobblestone', { stay: true }), /would move me off this ledge|obstructed/, 'the floor underfoot');
  await assert.rejects(place(bot, new Task('seal'), new Vec3(6, 64, 0), 'netherrack', { stay: true }), /would move me off this ledge/, 'out of reach');
  assert.deepEqual(moves, [], 'no key was pressed');
});

test('a flower in the cell is punched out before placing; a crop is not', async () => {
  // first-days-212: a dandelion on a pen fence cell was "placement obstructed" seven times.
  const registry = require('minecraft-data')('26.1');
  const target = new Vec3(2, 64, 0);
  const world = (plant) => {
    let there = plant, placed = false;
    const bot = { registry, game: { gameMode: 'survival' }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'oak_fence', count: 4 }] },
      equip: async () => {}, dug: [],
      blockAt: p => p.y === 63 ? { name: 'grass_block', boundingBox: 'block', position: p }
        : p.equals(target) ? { name: placed ? 'oak_fence' : there, boundingBox: placed ? 'block' : 'empty', hardness: registry.blocksByName[placed ? 'oak_fence' : there].hardness, position: p }
        : { name: 'air', boundingBox: 'empty', position: p },
      dig: async b => { bot.dug.push(b.name); there = 'air'; },
      placeBlock: async () => { placed = true; } };
    return bot;
  };
  const flowered = world('dandelion');
  await place(flowered, new Task('fence'), target, 'oak_fence');
  assert.deepEqual(flowered.dug, ['dandelion']);
  const cropped = world('wheat');
  await assert.rejects(place(cropped, new Task('fence'), target, 'oak_fence'), /obstructed by wheat/);
  assert.deepEqual(cropped.dug, []);
});

test('a mob standing in the cell is named as what stops the block, and a spectator is not', async () => {
  // first-days-221: a pen gate "did not go where it was placed" 291 times with a trader llama standing in its cell.
  const { occupant } = require('../src/work');
  const target = new Vec3(2, 64, 0);
  const llama = { id: 9, name: 'trader_llama', type: 'animal', position: new Vec3(2.4, 64, 0.5), width: 0.9, height: 1.87, isValid: true };
  const watcher = { id: 10, type: 'player', username: 'Watcher', position: new Vec3(2.5, 64, 0.5), width: 0.6, height: 1.8, isValid: true };
  const bot = { game: { gameMode: 'survival' }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'dirt', count: 4 }] }, equip: async () => {},
    entities: { 9: llama }, players: { Watcher: { gamemode: 3 } },
    blockAt: p => ({ name: p.y === 63 ? 'stone' : 'air', boundingBox: p.y === 63 ? 'block' : 'empty', position: p }), placeBlock: async () => {} };
  await assert.rejects(place(bot, new Task('wall'), target, 'dirt'), /trader llama stands in the cell/);
  bot.entities = { 10: watcher };
  assert.equal(occupant(bot, target), null, 'a spectator has no body');
  bot.players.Watcher.gamemode = 0;
  assert.equal(occupant(bot, target), watcher);
});

test('a block whose placing would back the body out over a drop is refused, whoever places it (mid-241-w)', async () => {
  // The bot straddles the rim at z 0.05: its floor is the cell at z 0 (y 63); z < 0 is an open drop.
  const pressed = [];
  const bot = { game: { gameMode: 'survival' }, entity: { position: new Vec3(0.5, 64, 0.05) }, inventory: { items: () => [{ name: 'cobblestone', count: 8 }] },
    equip: async () => {}, blockAt: p => ({ name: p.y === 63 && p.z >= 0 ? 'stone' : 'air', boundingBox: p.y === 63 && p.z >= 0 ? 'block' : 'empty', position: p }),
    placeBlock: async () => {}, setControlState: (k, v) => { if (v) pressed.push(k); }, clearControlStates() {}, look: async () => {}, lookAt: async () => {} };
  await assert.rejects(place(bot, new Task('cover'), new Vec3(0, 64, 0), 'cobblestone'), /off this ledge/);
  assert(!pressed.includes('back'), 'never stepped back');
});
