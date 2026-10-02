'use strict';
// Note 852: the poison on the bot is said wherever its health and healing
// are. 25591 (mid-239-cm, 2026-10-02 00:47:26Z), poisoned by a witch at
// 4.3, was told "no healing: ... so eat first" and nothing of the poison.
const test = require('node:test');
const assert = require('node:assert/strict');
const ce = require('../src/combat-estimate');

const registry = require('minecraft-data')('26.1');
const poisonId = Object.values(registry.effects).find(e => /poison/i.test(e.name)).id;
const botWith = (health, seconds) => ({ health, registry, entity: { effects: seconds ? { [poisonId]: { duration: seconds * 20, amplifier: 0, at: Date.now() } } : {} } });

test('poisonSays: the seconds left, the pace, the floor of one and that a hit there kills (note 852)', () => {
  assert.equal(ce.poisonSays(botWith(10, 0)), null);
  const says = ce.poisonSays(botWith(4.3, 30));
  assert.match(says, /^poisoned, about 30 seconds left: one health every 1\.3 seconds that armour does not stop, down to 1 and no lower, so health is at 1 before it ends/);
  assert.match(says, /a milk bucket ends it\. At 1 health any hit or potion kills\.$/);
  assert.match(ce.poisonSays(botWith(20, 5)), /so health is about 16 when it ends/);
});

test('riskNow says the poison, and not without it (note 852)', () => {
  const { riskNow } = require('../src/risk');
  const { Vec3 } = require('vec3');
  const bot = { ...botWith(4.3, 30), food: 17, time: { timeOfDay: 6000 }, inventory: { items: () => [], slots: [] }, world: { raycast: () => null },
    blockAt: () => ({ name: 'air', skyLight: 15, boundingBox: 'empty' }), entities: {} };
  bot.entity.position = new Vec3(0, 64, 0);
  assert.match(riskNow(bot).poisoned, /^poisoned, about 30 seconds left/);
  bot.entity.effects = {};
  assert.equal(riskNow(bot).poisoned, undefined);
});
