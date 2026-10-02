'use strict';
// Note 856: the close-in and the charge at a blaze are priced with the biters
// within sixteen of where the walk goes, not only those near the bot.
// 25583 (2026-10-02 01:33:49Z), a rod carried, took close_in at 9.1 on
// "about 0 damage" with a blaze 16.4 off; a wither skeleton by it met the
// walk and two blows ended it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const stand = require('../src/blaze-stand');

function flatBot(health = 9.1) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y <= 63 ? 'nether_bricks' : 'air'].defaultState); b.position = f; return b; };
  const stock = [['iron_sword', 1], ['netherrack', 64]];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food: 17, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => stock.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'golden_boots' }, 45: { name: 'shield' } } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} } });
  bot.findBlocks = () => [];
  return bot;
}
const mob = (bot, id, name, x, y, z, h = 1.8) => { bot.entities[id] = { id, name, type: 'hostile', position: new Vec3(x, y, z), height: h, width: 0.6, isValid: true, metadata: { 16: 0 } }; };
const near = bot => require('../src/danger').threats(bot, 16).filter(t => t.entity.name === 'blaze');

test('a wither skeleton by the blaze, past the bot\'s sixteen, is priced into the close-in and said (note 856)', () => {
  const bot = flatBot();
  mob(bot, 1, 'blaze', 15.5, 65, 0.5);
  const alone = stand.blazeStands(bot, near(bot)).close_in;
  mob(bot, 2, 'wither_skeleton', 20.5, 64, 0.5, 2.4);
  const withIt = stand.blazeStands(bot, near(bot)).close_in;
  assert(alone && withIt, 'offered');
  assert(withIt.expects.damage >= alone.expects.damage + 3, `${withIt.expects.damage} with the wither skeleton, ${alone.expects.damage} without`);
  assert.match(withIt.description, /The wither skeleton [\d.]+ blocks from where the walk goes gets to the bot meanwhile/);
});
