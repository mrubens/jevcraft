'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { bunkerDigMs } = require('../src/bunker');

// Stone to the east of the bot from x = 1, a floor under everything, and
// the mobs to the west: how long the bunker takes depends on the pickaxe.
function wall(items) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y < 64 || f.x >= 1 ? 'stone' : 'air'].defaultState); b.position = f; return b; };
  return { registry, blockAt, entity: { position: new Vec3(0.5, 64, 0.5) }, findBlocks: () => [],
    inventory: { items: () => items.map(name => ({ name, type: registry.itemsByName[name].id, count: 1, durabilityUsed: 0 })) } };
}

test('a bunker is quick with an iron pickaxe and slow by hand: the stance says its seconds', () => {
  const from = new Vec3(-5, 64, 0);
  const iron = bunkerDigMs(wall(['iron_pickaxe']), from), hand = bunkerDigMs(wall([]), from);
  assert(iron <= 3000, `iron: ${iron}`);
  assert(hand > 3000, `by hand: ${hand}`);
  assert(bunkerDigMs(wall(['wooden_pickaxe']), from) > iron);
});

// mid-244-ab (note 569): netherrack all round a passage at y 39 (x 0..3),
// the bot at its west end, the mobs east, and lava placed by each test.
function tunnelWorld({ lavaAt = [] } = {}) {
  const lava = new Set(lavaAt.map(p => `${p}`));
  const dug = new Set();
  const blockAt = p => {
    const f = p.floored(), k = `${f}`;
    if (lava.has(k)) return { name: 'lava', boundingBox: 'empty', position: f };
    if (dug.has(k) || (f.x >= 0 && f.x <= 3 && f.z === 0 && (f.y === 39 || f.y === 40))) return { name: 'air', boundingBox: 'empty', position: f };
    return { name: 'netherrack', boundingBox: 'block', diggable: true, position: f, digTime: () => 300 };
  };
  const dig = [];
  let looked = null;
  const bot = { blockAt, game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 39, 0.5), yaw: 0, pitch: 0 }, findBlocks: () => [],
    inventory: { items: () => [] }, registry: { blocksArray: [] }, heldItem: null, equip: async () => {},
    lookAt: async p => { looked = p; }, look: async () => {}, getControlState: () => false,
    // A held key is a step taken at once to the cell looked at.
    setControlState(k, v) { if (k === 'forward' && v && looked) this.entity.position = new Vec3(looked.x, 39, looked.z); },
    dig: async b => { dig.push(`${b.position}`); dug.add(`${b.position}`); } };
  return { bot, dig };
}

test('the bunker opens no cell with lava beside it or above it, and says the wall it left for that (mid-244-ab, note 569)', () => {
  const { bunkerSide, liquidBehind, cornerCell } = require('../src/bunker');
  const feet = new Vec3(0, 39, 0), from = new Vec3(8, 39, 0);
  // Lava over the third cell west's head: that side is not dug.
  const { bot } = tunnelWorld({ lavaAt: [new Vec3(-3, 41, 0)] });
  const side = bunkerSide(bot, feet, from);
  assert(side, 'another side of rock is taken');
  assert.notDeepEqual([side.x, side.z], [-1, 0], 'not the side under the lava');
  const said = liquidBehind(bot, feet, from);
  assert.equal(said.length, 1);
  assert.match(said[0], /lava behind the netherrack at \(-3, 40, 0\)/);
  // Lava over every side's far cell: no bunker at all.
  const boxed = tunnelWorld({ lavaAt: [new Vec3(-3, 41, 0), new Vec3(0, 41, -3), new Vec3(0, 41, 3)] }).bot;
  assert.equal(bunkerSide(boxed, feet, from), null);
  // The turn at the end is no exception.
  const end = new Vec3(-3, 39, 0);
  const turned = tunnelWorld({ lavaAt: [new Vec3(-3, 39, -2), new Vec3(-3, 41, 1)] }).bot;
  assert.equal(cornerCell(turned, end, new Vec3(-1, 0, 0)), null, 'neither turn: lava beyond one, lava over the other');
});

test('a bunker is dug once: standing in it, the held stance digs no more (mid-244-ab dug four end to end, note 569)', async () => {
  const { digBunker, inBunker } = require('../src/bunker');
  const { Task } = require('../src/skills');
  const { bot, dig } = tunnelWorld();
  const goal = {}, save = () => {};
  const first = await digBunker(bot, new Task('t'), goal, save, { from: new Vec3(8, 39, 0) });
  assert(dig.length >= 6, `the first dig opens its cells: ${dig.length}`);
  assert(inBunker(bot, first), `and the bot stands in it: ${bot.entity.position}`);
  const before = dig.length;
  const again = await digBunker(bot, new Task('t'), goal, save, { from: new Vec3(8, 39, 0), dug: JSON.parse(JSON.stringify(first)) });
  assert.equal(dig.length, before, 'nothing more is dug');
  assert.equal(again.held, true);
});
