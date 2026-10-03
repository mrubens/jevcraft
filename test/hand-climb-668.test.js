'use strict';
// The climbs out of the mine by hand from the first-days-243 start (note
// 668): the iron pickaxe wore out on the ore walks while the saved batch
// cooked, and the bot dug out with bare hands, 8 seconds a block of stone.
// mid-243-cc (25583, 2026-09-28 22:12Z) stood on a dirt block it had put
// down, and the staircase priced by that block was "249 blocks dug ... about
// 5 minutes with bare hands", half an hour of stone; Jev took it at 0.77 and
// it rose 12 blocks in 4.9 minutes. mid-243-eg (25583, 2026-09-29 10:02Z)
// dug 89 blocks straight up from y 11, twelve minutes, where 23 cells back
// along its own tunnel the column had 67. The fixtures are the mine as it
// stood: rock from the saved source world, the tunnels from the trial world.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { climbOptions, straightUpColumn, returnToSurface } = require('../src/surface');
const { Task } = require('../src/skills');

// Pockets at the decision: no pickaxe, 3 oak planks, the stone and dirt.
const POCKETS = [['oak_planks', 3], ['cobblestone', 285], ['dirt', 60], ['granite', 52], ['andesite', 59], ['diorite', 25], ['cobbled_deepslate', 85], ['tuff', 13], ['iron_ingot', 23], ['coal', 156]];

function mine(name) {
  const fx = require(`./fixtures/${name}`);
  const cache = new Map();
  const nameAt = p => {
    const runs = fx.columns[`${p.x},${p.z}`];
    // Outside the box read: rock under the ground line, air over it.
    if (!runs) return p.y <= 99 ? 'stone' : 'air';
    const top = fx.tops[`${p.x},${p.z}`];
    if (p.y > top) return 'air';
    if (p.y < fx.box.y0) return 'stone';
    let n = 'stone';
    for (const [y, b] of runs) { if (y > p.y) break; n = b; }
    return n;
  };
  const items = POCKETS.map(([n, count]) => ({ name: n, count, type: registry.itemsByName[n].id }));
  const bot = {
    registry, game: { gameMode: 'survival', dimension: 'overworld', minY: -64, height: 384 }, health: 20, food: 18, time: { timeOfDay: 12000 },
    entity: { position: new Vec3(fx.feet.x + 0.5, fx.feet.y, fx.feet.z + 0.5), onGround: true },
    inventory: { items: () => items, slots: [], emptySlotCount: () => 6 },
    blockAt: q => {
      const p = new Vec3(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z)), key = `${p}`;
      if (!cache.has(key)) {
        const b = Block.fromStateId(registry.blocksByName[nameAt(p)].defaultState, 0);
        b.position = p; cache.set(key, b);
      }
      return cache.get(key);
    },
    findBlocks: () => [], entities: {}, world: { raycast: () => null }, pathfinder: { movements: {} },
  };
  return { bot, fx };
}
const minutes = s => s / 60;

test('mid-243-cc: the staircase is priced by the rock on its way, not the dirt block under the feet', () => {
  const { bot } = mine('hand-climb-mid-243-cc.json');
  const feet = bot.entity.position.floored();
  assert.equal(bot.blockAt(feet.offset(0, -1, 0)).name, 'dirt', 'the block it had put under itself');
  const column = straightUpColumn(bot, feet);
  assert.match(column.blocked, /gravel in it would fall on the head/, 'as the question said then');
  // With no landing seen the stairs head east (heading 0), up by the height of open sky here.
  const target = feet.offset(24, 32, 0);
  const { options, estimate } = climbOptions(bot, target, column);
  // What a way back down costs where none is kept, said on both climbs (note 975).
  assert.match(options.staircase.description, /a walk back down to this mine later \(dug again instead, a staircase down these \d+ blocks is about \d+ seconds: 17 staircases down of 441 blocks on 2026-10-02 and 03 made a block of depth every 1\.9 seconds\)\./);
  if (options.straight_up) assert.match(options.straight_up.description, /no way back down is left: a way back down later is a staircase dug down, about \d+ seconds for these \d+ blocks/);
  // Said then: "about 249 blocks dug ... about 5 minutes with bare hands".
  assert(minutes(estimate.staircase) > 25, `the staircase by hand: ${minutes(estimate.staircase).toFixed(1)} minutes`);
  assert.match(options.staircase.description, /about \d+ blocks dug \((stone|granite|andesite|diorite)[^)]*\).*about (2[5-9]|[3-9]\d) minutes with bare hands/);
  // It stood in a pit of its own (three cells, the way on a block up with no
  // room over the head): no column is walked to from there.
  assert(!options.walk_then_up, `offered: ${Object.keys(options)}`);
});

test('mid-243-eg: from the bottom of the mine, the column its own tunnel reaches highest is walked to first', () => {
  const { bot } = mine('hand-climb-mid-243-eg.json');
  const feet = bot.entity.position.floored();
  const column = straightUpColumn(bot, feet);
  assert.equal(column.up, 92, 'as the question said: 92 blocks up');
  const { options, estimate } = climbOptions(bot, feet.offset(24, 32, 0), column);
  assert(options.straight_up && options.walk_then_up, `offered: ${Object.keys(options)}`);
  assert.match(options.straight_up.description, /92 blocks up, 89 blocks to dig/);
  // Two minutes or more quicker, the walk counted; nothing dug on the way.
  assert(estimate.straight_up - estimate.walk_then_up >= 120, JSON.stringify(estimate));
  const to = options.walk_then_up.walkTo;
  const there = straightUpColumn(bot, new Vec3(to.x, to.y, to.z));
  assert(there.cells.length <= 72, `${there.cells.length} blocks over ${JSON.stringify(to)}`);
  assert.match(options.walk_then_up.description, new RegExp(`where ${there.up} blocks lie over the head to open sky against 92 here`));
});

test('the walk is taken, and the climb goes on straight up there without asking again', async () => {
  const { bot } = mine('hand-climb-mid-243-eg.json');
  const goal = {}, walks = [], pillars = [];
  const actions = {
    dig: async () => {},
    navigate: async (_b, _t, g) => { walks.push(g); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); },
    pillar: async (_b, _t, targetY) => { pillars.push({ at: bot.entity.position.floored(), targetY }); bot.entity.position = bot.entity.position.offset(0, 8, 0); },
  };
  // Without Jev the quicker way is taken: the walk.
  await returnToSurface(bot, new Task('exit'), goal, () => {}, actions);
  assert.equal(walks.length, 1);
  assert.equal(goal.surfaceReturn.climb.method, 'straight_up', 'kept as straight up once there');
  assert.deepEqual(goal.surfaceReturn.climb.walked, { x: walks[0].x, y: walks[0].y, z: walks[0].z });
  await returnToSurface(bot, new Task('exit'), goal, () => {}, actions);
  assert.equal(pillars.length, 1);
  assert.deepEqual([pillars[0].at.x, pillars[0].at.z], [walks[0].x, walks[0].z], 'up the column walked to');
  const asked = (goal.decisions || []).filter(d => d.id === 'climb_out');
  assert.equal(asked.length, 1, 'asked once, where the climb began');
  assert.deepEqual(asked[0].path, ['walk_then_up']);
});

test('a walk that does not arrive is not offered again from there', async () => {
  const { bot } = mine('hand-climb-mid-243-eg.json');
  const goal = {};
  const actions = { dig: async () => {}, navigate: async () => {}, pillar: async () => {} };
  await returnToSurface(bot, new Task('exit'), goal, () => {}, actions);
  assert.equal(goal.surfaceReturn.walkedAway.length, 1);
  const refused = goal.surfaceReturn.walkedAway[0];
  const { options } = climbOptions(bot, bot.entity.position.floored().offset(24, 32, 0), straightUpColumn(bot), { walkedAway: goal.surfaceReturn.walkedAway });
  if (options.walk_then_up) { const t = options.walk_then_up.walkTo; assert.notEqual(`${t.x},${t.y},${t.z}`, refused); }
});

test('a way kept that has run to twice what it was said to take is asked about again, with what it did', async () => {
  const { bot } = mine('hand-climb-mid-243-eg.json');
  const feet = bot.entity.position.floored();
  // Straight up chosen 14 minutes ago at "about 5 minutes", risen 12 blocks since.
  const at = new Date(Date.now() - 14 * 60000).toISOString();
  const goal = { surfaceReturn: { attempts: 0, visited: {}, climb: { method: 'straight_up', tools: 'hand', offered: ['staircase', 'straight_up', 'walk_then_up'], estimate: 300, fromY: feet.y - 12, at } } };
  const actions = { dig: async () => {}, navigate: async (_b, _t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); }, pillar: async () => {} };
  await returnToSurface(bot, new Task('exit'), goal, () => {}, actions);
  const asked = (goal.decisions || []).filter(d => d.id === 'climb_out');
  assert.equal(asked.length, 1);
  assert.match(asked[0].state.climbSoFar, /the straight up chosen 14 minutes ago, said then as 5 minutes, has risen 12 blocks since/);
  // Within twice its word it is kept, not asked.
  const kept = { surfaceReturn: { attempts: 0, visited: {}, climb: { method: 'straight_up', tools: 'hand', offered: ['staircase', 'straight_up', 'walk_then_up'], estimate: 600, fromY: feet.y, at: new Date(Date.now() - 5 * 60000).toISOString() } } };
  await returnToSurface(bot, new Task('exit'), kept, () => {}, actions);
  assert.equal((kept.decisions || []).filter(d => d.id === 'climb_out').length, 0);
});
