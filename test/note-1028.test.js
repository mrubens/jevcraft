'use strict';
// Note 1028: the others of the kind hunted, in sight within their fire's
// reach, are survival's answer beside the hunt and the work.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const danger = require('../src/danger');

function bot(blazes) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y <= 63 ? 'nether_bricks' : 'air'].defaultState); b.position = f; return b; };
  const stock = [['cooked_mutton', 4], ['iron_sword', 1]];
  const b = Object.assign(new EventEmitter(), { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, foodSaturation: 5, oxygenLevel: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, time: { timeOfDay: 6000 },
    inventory: { items: () => stock.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count })), slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } } }, blockAt, world: { raycast: () => null } });
  blazes.forEach((d, i) => { b.entities[20 + i] = { id: 20 + i, name: 'blaze', type: 'hostile', position: new Vec3(0.5 + d, 64.5, 0.5), height: 1.8, width: 0.6, isValid: true, metadata: [], velocity: new Vec3(0, 0, 0) }; });
  b._huntingEntity = { name: 'blaze', until: Date.now() + 60000 };
  return b;
}

test('hunting blazes with three in sight five to seven blocks off: no threat by the scan, and the nearest offered as the kind\'s others', () => {
  const b = bot([4.7, 5.3, 7.3]);
  assert.equal(danger.immediateThreat(b), undefined, 'the kind hunted is passed over by the scan');
  const kin = danger.immediateThreat(b, { huntKin: true });
  assert.equal(kin?.entity.id, 20);
  assert.equal(kin.huntKin.length, 3);
  // One alone is the hunt's; no hunt, nothing.
  assert.equal(danger.immediateThreat(bot([4.7]), { huntKin: true }), undefined);
  const idle = bot([4.7, 5.3]); delete idle._huntingEntity;
  assert.equal(danger.immediateThreat(idle, { huntKin: true }), undefined);
});

test('the claim says it: survival\'s answer, routine, with the kind\'s count and distances', () => {
  const survival = require('../src/survival');
  const c = survival.claim(bot([4.7, 5.3, 7.3]), { kind: 'win' });
  assert.equal(c?.action, 'escape_threat');
  assert.equal(c.urgency, 'routine');
  assert.deepEqual(c.facts.huntKin, { name: 'blaze', inSight: 3, distances: [4.7, 5.3, 7.3] });
});
