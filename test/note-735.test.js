'use strict';
// Note 735: three of the live critic's items from critic-20260930T0755Z.md.
// (3)/(4) unstuck_move storms in water with no move that works there; a
// pillar is now offered while standing on solid ground under water, not
// only on dry ground (src/unstuck.js).
// (4) a craft that times out with no free slot for the output makes room
// first, or fails at once with the reason, instead of retrying the same
// doomed click a second time (src/work.js craft).
// (5) night_mine_target's ore, once it says "no route", rests at once
// instead of being re-offered as ore_0 up to two more times before the
// three-failure count gives up on it (src/survival.js nightMine).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

// --- (3)/(4) unstuck_move: pillar while standing on solid ground under water ---

test('a pillar is offered standing in shallow water over solid ground, not only on dry ground (25584 sat in the flooded cast for 4+ minutes)', () => {
  const { localMoves } = require('../src/unstuck');
  // A flooded platform: solid stone at y 59, water filling y 60-63, open sky
  // at y 64. The bot stands at the bottom of the flood, on solid ground.
  const cells = {};
  for (let y = 60; y <= 63; y++) cells[`40,${y},60`] = 'water';
  cells['40,64,60'] = 'air';
  const view = { name: p => cells[`${p.x},${p.y},${p.z}`] ?? (p.y === 59 ? 'stone' : 'stone'), carried: { cobblestone: 8 }, pickaxe: 'iron_pickaxe' };
  const feet = new Vec3(40, 60, 60);
  const { moves, here } = localMoves(view, feet, { goal: 'sky' });
  assert.equal(here.inWater, true);
  const pillar = moves.find(m => m.key === 'pillar');
  assert(pillar, `pillar was not offered; moves were ${moves.map(m => m.key).join(', ')}`);
  assert.match(pillar.does, /filling the water there/);

  // Deep open water with no solid floor within reach under the feet: no
  // pillar (nothing to place against), same as before this fix.
  const deep = {};
  for (let y = 40; y <= 63; y++) deep[`40,${y},60`] = 'water';
  deep['40,64,60'] = 'air';
  const deepView = { name: p => deep[`${p.x},${p.y},${p.z}`] ?? 'stone', carried: { cobblestone: 8 }, pickaxe: 'iron_pickaxe' };
  const deepMoves = localMoves(deepView, new Vec3(40, 50, 60), { goal: 'sky' }).moves;
  assert(!deepMoves.some(m => m.key === 'pillar'), 'no floor under the feet to place against, deep in the water column');
});

// --- (4) craft with no free slot ---

function fullPockets({ junk = [], extra = [], slots = 36 } = {}) {
  const items = [];
  for (const [name, count] of [...junk, ...extra]) { const it = registry.itemsByName[name]; items.push({ name, count, type: it.id, stackSize: it.stackSize }); }
  while (items.length < slots) { const it = registry.itemsByName.white_wool; items.push({ name: 'white_wool', count: 1, type: it.id, stackSize: it.stackSize }); }
  return items;
}
function craftBot(items) {
  const tossed = [];
  const bot = {
    registry, game: { gameMode: 'survival' }, entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => items, emptySlotCount: () => 36 - items.length, slots: [], selectedItem: null },
    getControlState: () => false, currentWindow: null, closeWindow() {},
    toss: async (type, meta, count) => {
      let remaining = count;
      for (const it of items.filter(i => i.type === type).sort((a, b) => b.count - a.count)) {
        if (remaining <= 0) break;
        const take = Math.min(it.count, remaining);
        it.count -= take; remaining -= take;
      }
      for (let i = items.length - 1; i >= 0; i--) if (items[i].count <= 0) { tossed.push(items[i].name); items.splice(i, 1); }
    },
    lookAt: async () => {},
  };
  bot.tossed = tossed;
  return bot;
}
function pickaxeStep() {
  return { action: 'craft', item: 'stone_pickaxe', count: 1, needs_table: false,
    recipe: { count: 1, ingredients: ['stick', 'stick', 'cobblestone', 'cobblestone', 'cobblestone'] } };
}

test('a craft that times out with no free slot for the output makes room (drops junk) before trying again, rather than retrying blind (25595\'s stone pickaxe, "0 free slots")', async () => {
  const { craft } = require('../src/work');
  const { Task } = require('../src/skills');
  // One free slot to start (36 - 35 filled), enough room by the pre-check;
  // sand is junk (kept to no cap at all) so a real slot can be dropped whole.
  const items = fullPockets({ junk: [['sand', 10]], slots: 35 });
  assert.equal(36 - items.length, 1, 'one free slot to start');
  const bot = craftBot(items);
  let calls = 0;
  bot.craft = async () => {
    calls++;
    if (calls === 1) {
      // The click used the one free slot for its own shuffling and did not
      // give it back when the output failed to land: 0 free slots now.
      const filler = registry.itemsByName.white_wool;
      items.push({ name: 'white_wool', count: 1, type: filler.id, stackSize: filler.stackSize });
      return;
    }
    // Room was made: the craft goes through for real.
    const pickaxe = registry.itemsByName.stone_pickaxe;
    items.push({ name: 'stone_pickaxe', count: 1, type: pickaxe.id, stackSize: pickaxe.stackSize });
  };
  await craft(bot, new Task('craft'), pickaxeStep(), {});
  assert.equal(calls, 2, 'a second, real attempt was made once room existed');
  assert(bot.tossed.includes('sand'), 'the junk (sand) was dropped to make room');
  assert.equal(items.filter(i => i.name === 'stone_pickaxe').length, 1);
});

test('a craft with no free slot and nothing to drop fails at once with that reason, never clicking a doomed craft', async () => {
  const { craft } = require('../src/work');
  const { Task } = require('../src/skills');
  // No junk at all: every slot is something the tidy will not drop, and
  // nothing carried would free a slot of its own by being used up.
  const items = fullPockets({ extra: [['diamond', 5]] });
  assert.equal(36 - items.length, 0, 'no free slot to start');
  const bot = craftBot(items);
  let calls = 0;
  bot.craft = async () => { calls++; };
  await assert.rejects(() => craft(bot, new Task('craft'), pickaxeStep(), {}), err => {
    assert.equal(err.name, 'Blocked');
    assert.match(err.message, /No free slot for the 1 stone pickaxe; the inventory is full/);
    return true;
  });
  assert.equal(calls, 0, 'the doomed craft was never clicked');
});

// --- (5) night_mine_target: an ore that says "no route" rests at once ---

test('an ore the dig finds no route to abandons and rests at once, not after three failures (25589 asked ore_0 twenty times in 30s)', async () => {
  const { Survival } = require('../src/survival');
  const { attemptsFor } = require('../src/progress');
  const target = new Vec3(16, 49, 228);
  const bot = {
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { position: target.offset(0, 0, 1) }, health: 20, food: 20, oxygenLevel: 20,
    time: { timeOfDay: 6000 }, entities: {}, world: { raycast: () => null },
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] },
    blockAt: p => ({ position: p, name: (p.x === target.x && p.y === target.y && p.z === target.z) ? 'iron_ore' : 'stone', boundingBox: 'block' }),
    on() {}, once() {}, removeListener() {}, emit() {},
  };
  const controller = new Survival(bot, {}, { state: {} });
  controller.canNightMine = () => true;
  controller.actions.dig = async () => { throw Object.assign(new Error('No route from here to (16, 49, 228) (timeout)'), { name: 'NoRoute' }); };
  const mine = controller.state.nightMine = { startedAt: Date.now(), origin: { x: 0, y: 49, z: 0 }, heading: 0, failures: 0, mined: 0,
    target: { x: target.x, y: target.y, z: target.z }, targetOre: 'iron_ore' };
  await controller.nightMine({ check() {} }, {}, () => {});
  assert.equal(mine.target, undefined, 'the target is abandoned after the first NoRoute, not after three failures');
  assert.equal(mine.failures, 0, 'abandoning clears the failure count, as the other give-up reasons do');
  assert(attemptsFor(controller).resting('night_mine', target), 'the ore now rests: it is not re-offered as ore_0 while it does');
});
