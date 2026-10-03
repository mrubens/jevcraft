'use strict';
// Note 999: a blaze at the box's window is struck through it and its blows
// meet the shield; the hold was priced as if it swung on unanswered for the
// whole fifteen seconds (72 damage for one blaze).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const stand = require('../src/blaze-stand');

function flatBot() {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y <= 63 ? 'nether_bricks' : 'air'].defaultState); b.position = f; return b; };
  const stock = [['stone_sword', 1], ['netherrack', 64], ['cooked_beef', 6]];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 8.1, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => stock.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} } });
  bot.findBlocks = () => [];
  return bot;
}
const blazeAt = (bot, id, x, y, z) => { bot.entities[id] = { id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } }; };

test('a box with a blaze within two blocks of its window is not priced as fifteen seconds of its blows landing', () => {
  const bot = flatBot();
  blazeAt(bot, 1, 2.0, 64.5, 0.5);
  blazeAt(bot, 2, 9.5, 66, 3.5);
  const danger = require('../src/danger').threats(bot, 24);
  const o = stand.blazeStands(bot, danger);
  const box = o.box_here || o.box_at_spawner;
  assert.ok(box, `a box offered: ${Object.keys(o)}`);
  const held = box.description.match(/in line with the window, about ([0-9.]+) damage over fifteen seconds/);
  assert.ok(held, box.description.slice(-600));
  assert.ok(Number(held[1]) < 10, `the hold priced ${held[1]}`);
  assert.match(box.description, /within two blocks of the window and swings? at it: each is struck through it and dies in about [0-9.]+ seconds of the sword, its blows on the shield meanwhile/);
});
