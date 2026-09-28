'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { localMoves, describeMove, risePlan, perform } = require('../src/unstuck');
const { blocksCarried } = require('../src/bridging');

// mid-242-ae-nether-2-fortress-6 (25586), 20:00 to 20:52Z on 2026-09-28,
// "loop: 4x The nether portal at (17, 58, 8) is 146 blocks off and cannot be
// reached from here": fifty minutes at the end of its own span over the lava
// sea. The column at (-96, z 100) from the saved region files: lava at y 30
// and 31, the span's warped planks at y 39, air at 40 to 46, netherrack from
// 47 to 60, then the cave over it (air 61 to 76). Carried at 20:34: five
// warped stems, a warped plank, seven gravel, a wooden pickaxe with eleven
// uses left, no netherrack.
const FEET = new Vec3(-96, 40, 100);
function world({ set = {} } = {}) {
  const cells = { ...set };
  const name = p => {
    const k = `${p.x},${p.y},${p.z}`;
    if (cells[k] !== undefined) return cells[k];
    if (p.x === -96 && p.z === 100) {
      if (p.y === 39) return 'warped_planks';
      if (p.y <= 31) return 'lava';
      if (p.y <= 46) return 'air';
      if (p.y <= 60) return 'netherrack';
      return 'air';
    }
    return p.y <= 31 ? 'lava' : 'air';
  };
  return name;
}
const view = (name, carried, extra = {}) => ({ name, carried, pickaxe: 'wooden_pickaxe', pickaxeUses: 11, health: 17, ...extra });
const CARRIED = { warped_stem: 5, warped_planks: 1, gravel: 7, coal: 108, flint: 4 };

test('at the end of the span the way up through fourteen of netherrack is a move, priced in blocks and seconds', () => {
  const { moves } = localMoves(view(world(), CARRIED), FEET, { goal: 'away', from: FEET });
  const rise = moves.find(m => m.key === 'rise_through');
  assert(rise, 'offered');
  assert.equal(rise.rise, 21);
  assert.equal(rise.top, 61);
  const says = describeMove(rise);
  assert.match(says, /6 blocks of open air, then 14 of netherrack/);
  assert.match(says, /wooden pickaxe \(11 uses left, the last 3 by hand, which drop nothing\)/);
  assert.match(says, /open space at y 61 \(21 up/);
  assert.match(says, /the first 5 from the pack \(.*5 warped stem.*7 gravel/);
  assert.match(says, /the rest from the rock dug on the way \(11 dropped\)/);
});

test('the nether woods are blocks a span or a pillar is laid with, and are counted', () => {
  const bot = { inventory: { items: () => [{ name: 'warped_stem', count: 5 }, { name: 'warped_planks', count: 1 }, { name: 'gravel', count: 7 }, { name: 'oak_planks', count: 4 }] } };
  assert.equal(blocksCarried(bot), 6, 'the stems and the plank, not the gravel that falls or the oak that burns');
  const { moves } = localMoves(view(world(), { warped_stem: 5 }), FEET, { goal: 'away', from: FEET });
  assert(moves.some(m => m.key === 'pillar' && m.block === 'warped_stem'), 'a pillar of the stem');
});

test('with too few blocks for the air under the rock it is not offered, and says why', () => {
  const plan = risePlan(view(world(), { gravel: 3 }), FEET);
  assert.equal(plan.move, undefined);
  assert.match(plan.blocked, /5 blocks to lay before the rock, 3 carried/);
  const out = localMoves(view(world(), { gravel: 3 }), FEET, { goal: 'away', from: FEET });
  assert(!out.moves.some(m => m.key === 'rise_through'));
  assert(out.here.notOffered.some(s => /5 blocks to lay before the rock, 3 carried/.test(s)));
});

test('with no pickaxe the rock drops nothing: every block of the rise is laid from the pack', () => {
  assert.match(risePlan(view(world(), { warped_stem: 12 }, { pickaxe: null, pickaxeUses: null }), FEET).blocked, /21 blocks to lay in all, 12 carried and 0 dropped/);
  const plan = risePlan(view(world(), { warped_stem: 22 }, { pickaxe: null, pickaxeUses: null }), FEET);
  assert(plan.move);
  assert.match(plan.move.does, /bare hands \(nothing dropped\)/);
});

test('lava or water in or beside the column, gravel in it, or open air to the limit is not a rise', () => {
  assert.match(risePlan(view(world({ set: { '-95,52,100': 'lava' } }), CARRIED), FEET).blocked, /lava beside the column at \(-95, 52, 100\)/);
  assert.match(risePlan(view(world({ set: { '-96,50,100': 'gravel' } }), CARRIED), FEET).blocked, /gravel in the way at y 50, and it would fall on the head/);
  assert.match(risePlan(view(world({ set: { '-96,55,100': 'obsidian' } }), CARRIED), FEET).blocked, /obsidian in the way at y 55/);
  const openAir = world({ set: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`-96,${47 + i},100`, 'air'])) });
  assert.equal(risePlan(view(openAir, CARRIED), FEET), null, 'no rock over the head: a pillar, not a rise');
  const noTop = world({ set: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`-96,${47 + i},100`, 'netherrack'])) });
  assert.match(risePlan(view(noTop, CARRIED), FEET).blocked, /no open space above the rock within 48 blocks/);
});

test('in water, or with no floor, or rock over the head at once, there is no rise', () => {
  assert.equal(risePlan(view(world({ set: { '-96,40,100': 'water' } }), CARRIED), FEET), null);
  assert.equal(risePlan(view(world({ set: { '-96,39,100': 'air' } }), CARRIED), FEET), null);
  assert.equal(risePlan(view(world({ set: { '-96,41,100': 'netherrack' } }), CARRIED), FEET), null);
});

test('three blocks of rock over a floor, up through a live bot: the gravel goes down, the rock is dug, its drops are laid', async () => {
  const dug = [], placed = [];
  const cells = new Map();
  const at = p => { const k = `${p.x},${p.y},${p.z}`; if (cells.has(k)) return cells.get(k); if (p.x === 0 && p.z === 0) return p.y <= 63 ? 'netherrack' : p.y >= 67 && p.y <= 69 ? 'netherrack' : 'air'; return 'air'; };
  const pack = [{ name: 'gravel', count: 3 }, { name: 'wooden_pickaxe', count: 1 }];
  const give = n => { const i = pack.find(x => x.name === n); if (i) i.count++; else pack.push({ name: n, count: 1 }); };
  const blockAt = p => { const name = at(p); return { name, position: p, diggable: true, boundingBox: name === 'air' ? 'empty' : 'block' }; };
  let y = 64;
  const bot = { registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, y, 0.5), yaw: 0, onGround: true, velocity: new Vec3(0, 0, 0) }, entities: {}, blockAt,
    inventory: { items: () => pack.filter(i => i.count > 0) }, equip: async () => {}, look: async () => {}, controlState: {},
    setControlState(k, v) { this.controlState[k] = v; if (k === 'jump' && v) { this.entity.onGround = false; this.entity.position = new Vec3(0.5, y + 1.2, 0.5); } },
    clearControlStates() {},
    _placeBlockWithOptions: async (ref) => {
      const item = pack.find(i => i.count > 0 && ['gravel', 'netherrack'].includes(i.name));
      item.count--; placed.push(item.name); cells.set(`0,${y},0`, item.name); y += 1; bot.entity.position = new Vec3(0.5, y, 0.5); bot.entity.onGround = true;
    } };
  const dig = async (b, t, p) => { dug.push(at(p)); cells.set(`${p.x},${p.y},${p.z}`, 'air'); give('netherrack'); };
  const feet = new Vec3(0, 64, 0);
  const name = p => at(p);
  const plan = risePlan({ name, carried: { gravel: 3 }, pickaxe: 'wooden_pickaxe', pickaxeUses: 11 }, feet);
  assert.equal(plan.move.top, 70);
  assert.equal(plan.move.rise, 6);
  await perform(bot, new Task('rise'), { ...plan.move, from: feet }, { dig });
  assert.equal(bot.entity.position.y, 70);
  assert.equal(dug.length, 3, 'the three blocks of rock were dug');
  assert.equal(placed[0], 'gravel', 'the gravel first, before any rock is dug');
  assert(placed.includes('netherrack'), 'the rock dug was laid');
});

test('a pillar move with the gravel it names puts the gravel down (it failed 48 times: "The block did not go under the feet")', async () => {
  const placed = [];
  const cells = new Map();
  const at = p => { const k = `${p.x},${p.y},${p.z}`; if (cells.has(k)) return cells.get(k); return p.y <= 63 && p.x === 0 && p.z === 0 ? 'netherrack' : 'air'; };
  const pack = [{ name: 'gravel', count: 3 }];
  const blockAt = p => { const name = at(p); return { name, position: p, diggable: true, boundingBox: name === 'air' ? 'empty' : 'block' }; };
  let y = 64;
  const bot = { registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, y, 0.5), yaw: 0, onGround: true, velocity: new Vec3(0, 0, 0) }, entities: {}, blockAt,
    inventory: { items: () => pack }, equip: async () => {}, look: async () => {}, controlState: {},
    setControlState(k, v) { this.controlState[k] = v; if (k === 'jump' && v) { this.entity.onGround = false; this.entity.position = new Vec3(0.5, y + 1.2, 0.5); } },
    clearControlStates() {},
    _placeBlockWithOptions: async () => { pack[0].count--; placed.push('gravel'); cells.set(`0,${y},0`, 'gravel'); y += 1; bot.entity.position = new Vec3(0.5, y, 0.5); bot.entity.onGround = true; } };
  const feet = new Vec3(0, 64, 0);
  const { moves } = localMoves({ name: at, carried: { gravel: 3 }, pickaxe: null }, feet, { goal: 'away', from: feet });
  const pillar = moves.find(m => m.key === 'pillar');
  assert.equal(pillar.block, 'gravel');
  await perform(bot, new Task('pillar'), { ...pillar, from: feet }, { dig: async () => {} });
  assert.deepEqual(placed, ['gravel']);
  assert.equal(bot.entity.position.y, 65);
});
