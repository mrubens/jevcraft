'use strict';
// Note 1057: the slot the bot stands at the back of comes before any other,
// and with an enderman turned on the bot about it is the only one.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const slot = require('../src/enderman-slot');

// A floor at 63 and below, a rock wall from x <= 3, open air east of it, and
// a slot dug at z = 0: (3, 64, 0) and (2, 64, 0), two high.
const dug = (x, y, z) => z === 0 && (x === 3 || x === 2) && (y === 64 || y === 65);
function world(entities = {}) {
  const at = (x, y, z) => dug(x, y, z) ? 'air' : y <= 63 ? 'netherrack' : x <= 3 ? 'netherrack' : 'air';
  const bot = { entity: { position: new Vec3(2.5, 64, 0.5) }, entities, world: { raycast: () => null },
    blockAt: p => { const name = at(p.x, p.y, p.z); return { name, position: p, boundingBox: name === 'air' ? 'empty' : 'block' }; } };
  const site = { mouth: new Vec3(4, 64, 0), a: new Vec3(3, 64, 0), b: new Vec3(2, 64, 0), d: new Vec3(-1, 0, 0) };
  bot._slotAt = { b: site.b.clone(), mouth: site.mouth.clone(), d: site.d.clone(), at: Date.now(), site };
  return bot;
}
const enderman = (id, x, z, turned) => ({ id, name: 'enderman', isValid: true, position: new Vec3(x, 64, z), metadata: turned ? { 17: true } : {} });

test('at the back of its slot with an enderman turned on the bot, the slot found is the one it stands in, nothing to dig, and says what leaving is', () => {
  const e = enderman(7, 4.5, 16.5, true);
  const bot = world({ 7: e });
  const site = slot.slotSite(bot, { toward: enderman(8, 20.5, 9.5, false) });
  assert.deepStrictEqual([site.mouth.x, site.mouth.z, site.b.x, site.digs.length, site.off, site.held], [4, 0, 2, 0, 0, true]);
  assert.strictEqual(site.turned.n, 1);
  assert.match(slot.says(site, 2), /stands at the back of this slot now, and one enderman is turned on it, the nearest 16 blocks off/);
  assert.match(slot.says(site, 2), /walks out of the slot to it in the open/);
});

test('with none turned the slot stood in still comes first, and off it the search is as before', () => {
  const bot = world({ 8: enderman(8, 20.5, 0.5, false) });
  const site = slot.slotSite(bot, { toward: bot.entities[8] });
  assert.deepStrictEqual([site.mouth.x, site.mouth.z, site.held, site.line, site.turned], [4, 0, true, true, undefined]);
  bot.entity.position = new Vec3(5.5, 64, 6.5);
  const other = slot.slotSite(bot, { toward: bot.entities[8] });
  assert.strictEqual(other.held, undefined);
});

test('a slot whose roof is gone is not held', () => {
  const bot = world({ 7: enderman(7, 4.5, 16.5, true) });
  const at = bot.blockAt;
  bot.blockAt = p => p.x === 2 && p.y === 66 && p.z === 0 ? { name: 'air', position: p, boundingBox: 'empty' } : at(p);
  const site = slot.slotSite(bot, { toward: bot.entities[7] });
  assert.ok(!site || !site.held);
});
