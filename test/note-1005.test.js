'use strict';
// Note 1005: no walk in on a blaze with a biter at arm's length.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const stand = require('../src/blaze-stand');

function flatBot() {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y <= 63 ? 'nether_bricks' : 'air'].defaultState); b.position = f; return b; };
  const stock = [['iron_sword', 1], ['netherrack', 64]];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => stock.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} } });
  bot.findBlocks = () => [];
  return bot;
}
const put = (bot, id, name, x, y, z, height = 1.8) => { bot.entities[id] = { id, name, type: 'hostile', position: new Vec3(x, y, z), height, width: 0.7, isValid: true, metadata: { 16: 0 } }; };
const near = bot => require('../src/danger').threats(bot, 24);

test('with a wither skeleton at arm\'s length the walk in on a blaze is not offered; with it gone, it is', () => {
  const bot = flatBot();
  put(bot, 1, 'blaze', 8.5, 65, 0.5);
  const alone = stand.blazeStands(bot, near(bot));
  assert.ok(alone.close_in || alone.charge_nearest, `offered alone: ${Object.keys(alone)}`);
  put(bot, 2, 'wither_skeleton', 0.5, 64, 2.0, 2.4);
  const beside = stand.blazeStands(bot, near(bot));
  assert.equal(beside.close_in, undefined);
  assert.equal(beside.charge_nearest, undefined);
});
