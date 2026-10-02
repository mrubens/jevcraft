'use strict';
// Note 849: 25584 (mid-229-ba, 2026-10-01 22:53:52Z) was offered
// charge_nearest at a blaze 17.7 off as "about 1.3 damage ... 18.7 after",
// priced from where it stood with that one blaze; two more hovered 28 and
// 30 off, ten and thirteen from the cell the sword struck from, behind it
// there. It went from 20 to dead in 25 seconds. The charge is priced from
// where it goes: the walk from halfway, the strike from that cell, with the
// blazes within sixteen of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const stand = require('../src/blaze-stand');

function flatBot() {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y <= 63 ? 'nether_bricks' : 'air'].defaultState); b.position = f; return b; };
  const stock = [['iron_sword', 1], ['netherrack', 64], ['cooked_beef', 6]];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => stock.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'golden_boots' }, 45: { name: 'shield' } } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} } });
  bot.findBlocks = () => [];
  return bot;
}
const blazeAt = (bot, id, x, y, z) => { bot.entities[id] = { id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } }; };
const near = bot => require('../src/danger').threats(bot, 24);

test('a charge at the nearest blaze is priced with the blazes about the cell it strikes from, not only those about the bot (25584, note 849)', () => {
  const bot = flatBot();
  blazeAt(bot, 1, 17.5, 65, 0.5);
  const alone = stand.blazeStands(bot, near(bot));
  blazeAt(bot, 2, 28.5, 65, 8.5);
  blazeAt(bot, 3, 28.5, 65, -7.5);
  const danger = near(bot);
  assert.equal(danger.length, 1, 'the two farther ones are beyond the stance\'s own list');
  const o = stand.blazeStands(bot, danger).charge_nearest;
  assert(o, `offered: ${Object.keys(stand.blazeStands(bot, danger))}`);
  assert(alone.close_in && !alone.charge_nearest, 'with one blaze about, the close-in alone');
  const one = alone.close_in.expects.damage;
  assert(o.expects.damage >= one + 2, `${o.expects.damage} with the two by the strike cell, ${one} alone`);
});
