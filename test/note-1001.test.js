'use strict';
// Note 1001: hurt at hunger under eighteen, the meal is claimed with a mob
// close and a stance held: nothing heals until it is eaten.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const vitals = require('../src/vitals');

function bot({ health, food }) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y <= 63 ? 'nether_bricks' : 'air'].defaultState); b.position = f; return b; };
  const stock = [['cooked_mutton', 4], ['iron_sword', 1]];
  const b = Object.assign(new EventEmitter(), { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food, foodSaturation: 0, oxygenLevel: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, time: { timeOfDay: 6000 },
    inventory: { items: () => stock.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count })), slots: {} }, blockAt, world: { raycast: () => null } });
  b.entities[9] = { id: 9, name: 'blaze', type: 'hostile', position: new Vec3(2.8, 64.5, 0.5), height: 1.8, width: 0.6, isValid: true, metadata: [] };
  return b;
}

test('hurt at hunger 17 with a blaze two blocks off, the meal is claimed and pressing; healing at eighteen, or whole, it is not', () => {
  const hurt = vitals.claim(bot({ health: 12.6, food: 17 }));
  assert.equal(hurt?.action, 'eat');
  assert.equal(hurt.urgency, 'pressing');
  assert.match(hurt.facts.healthComesBackOnlyAfterAMeal, /hunger 17 is under eighteen/);
  assert.equal(vitals.claim(bot({ health: 12.6, food: 18 })), null, 'at eighteen it heals: the blaze close keeps the meal off');
  assert.equal(vitals.claim(bot({ health: 18, food: 17 })), null, 'not much hurt: the blaze close keeps the meal off');
  assert.equal(vitals.claim(bot({ health: 3.6, food: 17 })), null, 'one fireball would end it and the shield cuts every bite: the stance\'s turn, not the meal\'s (note 1006)');
});
