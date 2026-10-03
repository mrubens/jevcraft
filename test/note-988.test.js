'use strict';
// Note 988: a charge at a blaze out of sight is priced with the blazes about
// the cell it strikes from. 25593 (2026-10-03 05:47:31Z), 3.6 health, read
// "about 3.1 damage" for a charge at a blaze 15.9 off out of sight with five
// more beyond it "not counted", walked in and died in twelve seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const stand = require('../src/blaze-stand');

function flatBot() {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y <= 63 ? 'nether_bricks' : 'air'].defaultState); b.position = f; return b; };
  const stock = [['iron_sword', 1], ['netherrack', 64]];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 3.6, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => stock.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} } });
  bot.findBlocks = () => [];
  return bot;
}
const blazeAt = (bot, id, x, y, z) => { bot.entities[id] = { id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } }; };
const unseen = bot => Object.values(bot.entities).map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: false }));

test('a charge at a blaze out of sight counts the blazes about where it strikes it from', () => {
  const bot = flatBot();
  blazeAt(bot, 1, 16.4, 65, 0.5);
  const alone = stand.closeInCost(bot, unseen(bot), { upTo: 1 });
  for (const [i, [x, z]] of [[20.5, 4.5], [21.5, -3.5], [23.5, 0.5], [22.5, 6.5], [24.5, -5.5]].entries()) blazeAt(bot, 2 + i, x, 65, z);
  const six = stand.closeInCost(bot, unseen(bot), { upTo: 1 });
  assert.equal(six.into, 6, 'all six in the fight at the strike cell');
  assert.equal(alone.into, 1);
  assert.ok(six.damage > alone.damage + 1, `${six.damage} with five more about it, ${alone.damage} alone`);
  assert.ok(six.deathAt != null, 'more than 3.6 health');
});
