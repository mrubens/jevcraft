'use strict';
// Note 1025: the turn's question says the biters in sight as a pack: how
// many, how soon the nearest is at the bot, and their blows together.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const arbiter = require('../src/arbiter');

function bot(mobs, health = 20) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y <= 63 ? 'nether_bricks' : 'air'].defaultState); b.position = f; return b; };
  const b = Object.assign(new EventEmitter(), { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, time: { timeOfDay: 6000 },
    inventory: { items: () => [], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } } }, blockAt, world: { raycast: () => null } });
  mobs.forEach(([name, d], i) => { b.entities[10 + i] = { id: 10 + i, name, type: 'hostile', position: new Vec3(0.5 + d, 64, 0.5), height: 2.4, width: 0.7, isValid: true, metadata: [], velocity: new Vec3(0, 0, 0) }; });
  return b;
}

test('three wither skeletons eight to eleven blocks off: counted, the nearest\'s seconds, and their blows together against the health', () => {
  const said = arbiter.packSays(bot([['wither_skeleton', 7.8], ['wither_skeleton', 9.9], ['wither_skeleton', 10.7]]));
  assert.match(said, /^ In sight and able to walk at the bot: 3 wither skeletons \(7\.8, 9\.9, 10\.7 blocks off\)\. At its speed \(about [\d.]+ blocks a second\) the nearest is at the bot in about [\d.]+ seconds if it comes; each blow about [\d.]+ through the armour worn; all 3 at the bot land about [\d.]+ a second together, and the bot has 20: (one second|two seconds) of it\.$/);
  assert.match(arbiter.packSays(bot([['wither_skeleton', 7.8]])), /^ In sight and able to walk at the bot: a wither skeleton 7\.8 blocks off\. .*each blow about [\d.]+ through the armour worn\.$/);
  assert.equal(arbiter.packSays(bot([['blaze', 8]])), '', 'a shooter is the shot\'s own facts');
  assert.equal(arbiter.packSays(bot([])), '');
});
