'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { localMoves, describeMove, liveView } = require('../src/unstuck');

// mid-242-ah-nether-1-fortress-5 (25587), at 1.1 health from 17:28:59Z
// with nothing to eat (note 622). Jev chose the trip back to the portal for
// food at 17:35:11 (go_back 0.69); the crossing laid a one-wide span of
// netherrack from the south-west, twenty blocks over the cavern floor, and
// stopped at its end at (-67, 55, -62) "out of blocks (0 carried)" with
// thirty-two warped wart blocks in the pack, 98 blocks from the portal; at
// 17:44:30 the unstuck moves offered to put only gravel. The ground is the
// region as saved after the death: x -76 to -58, y 28 to 60, z -72 to -54
// (the gravel it put at (-68, 56, -64) still there).
const SPAN = require('./fixtures/span-end-mid-242-ah.json');
const CARRIED = [['warped_stem', 5], ['bone', 1], ['white_wool', 2], ['white_bed', 1], ['warped_planks', 2], ['light_gray_wool', 2], ['gray_wool', 1],
  ['warped_wart_block', 32], ['black_wool', 7], ['gravel', 12], ['wooden_pickaxe', 1], ['iron_sword', 1], ['stone_axe', 1], ['blaze_rod', 1], ['wheat', 2]];
function spanBot({ at = new Vec3(-66.5, 56, -62.5), health = 1.1, carried = CARRIED } = {}) {
  const [ox, oy, oz] = SPAN.origin, cache = new Map();
  const nameAt = q => {
    const ch = SPAN.layers[q.y - oy]?.[q.z - oz]?.[q.x - ox];
    return ch === undefined ? null : SPAN.palette[ch.charCodeAt(0) - 97];
  };
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), k = `${q.x},${q.y},${q.z}`;
    if (!cache.has(k)) {
      const name = nameAt(q);
      let b = null;
      if (name) {
        const [base, level] = name.split(':');
        const def = registry.blocksByName[base];
        b = level !== undefined ? Block.fromProperties(def.id, { level: Number(level) }, 0) : Block.fromStateId(def.defaultState, 0);
        b.position = q;
      }
      cache.set(k, b);
    }
    return cache.get(k);
  };
  return Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 14, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, effects: {}, attributes: {} }, entities: {},
    inventory: { items: () => carried.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })), slots: {} },
    blockAt,
  });
}

test('the span\'s blocks carried count the wart blocks: thirty-two, where the crossing said 0; the rock is laid before them, and wool is not laid', () => {
  const { blocksCarried, LAID } = require('../src/bridging');
  assert.equal(blocksCarried(spanBot()), 32);
  assert.equal(blocksCarried(spanBot({ carried: [['netherrack', 3], ['warped_wart_block', 5], ['white_wool', 9]] })), 8);
  assert(LAID.indexOf('netherrack') < LAID.indexOf('warped_wart_block'));
  assert(!LAID.some(n => /wool/.test(n)));
});

test('at the span\'s end the unstuck moves put a warped wart block, not gravel, and each drop is priced against the 1.1 health the bot has', () => {
  const bot = spanBot();
  const feet = new Vec3(-67, 56, -63);
  const { moves } = localMoves(liveView(bot), feet, { goal: 'away', from: feet });
  const places = moves.filter(m => m.key.startsWith('place_'));
  assert(places.length, `places offered: ${moves.map(m => m.key)}`);
  for (const m of places) assert.match(m.does, /warped wart block/, `${m.key}: ${m.does}`);
  const said = moves.map(describeMove).join('\n');
  assert.match(said, /falling \d+ blocks costs about \d+ health, more than the 1\.1 health the bot has: the fall is death/);
  assert.doesNotMatch(said, /Put a gravel/);
});

test('at full health the same drop is said against it', () => {
  const { dropBelow } = require('../src/unstuck');
  const view = liveView(spanBot({ health: 20 }));
  assert.match(dropBelow(view, new Vec3(-68, 56, -62)), /falling \d+ blocks costs about 1\d health, of the 20 health the bot has$/);
});

test('the way down "toward the portal back" says when it ends farther from the portal than the bot stands (99 off here, 158 from its foot)', () => {
  const { floorTowardSays } = require('../src/nether-travel');
  const down = { depth: 22, y: 35, columns: 39, carried: 0, from: { x: -67, y: 56, z: -63 },
    way: { cells: 86, across: 59, drops: [2, 2, 3], damage: 0, dug: 5, seconds: 23, end: { x: -101, y: 36, z: -111 } } };
  const floor = { floor: 25, lava: 4, gap: 43, rock: 24, soul: 0, magma: 0, rise: 0, climb: 0, drops: 0, damage: 0, lowest: 33, highest: 37, seconds: 214, lay: 47, carried: 0, runsOut: 22, cells: 96, first: [], mobs: {} };
  const said = floorTowardSays(down, floor, { what: 'the portal back', target: { x: 2, y: 56, z: 7 } });
  assert.match(said, /\(\d+ blocks from the foot of the way down: the way down ends \d+ blocks farther from the portal back than the bot stands now, 98 off\)/);
  const nearer = floorTowardSays({ ...down, way: { ...down.way, end: { x: -40, y: 36, z: -30 } } }, floor, { what: 'the portal back', target: { x: 2, y: 56, z: 7 } });
  assert.match(nearer, /\(56 blocks from the foot of the way down, 42 nearer than where the bot stands now\)/);
});
