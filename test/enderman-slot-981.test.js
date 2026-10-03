'use strict';
// Note 981: an enderman fought from a slot two high dug two cells into rock.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const slot = require('../src/enderman-slot');

function world(at) {
  return { entity: { position: new Vec3(5.5, 64, 0.5) }, entities: {},
    blockAt: p => { const name = at(p.x, p.y, p.z); return { name, position: p, boundingBox: /^(air|lava|water)$/.test(name) ? 'empty' : 'block' }; } };
}
// A floor at 63 and below, a rock wall from x <= 3, open air east of it.
const wall = (over = () => null) => world((x, y, z) => over(x, y, z) || (y <= 63 ? 'netherrack' : x <= 3 ? 'netherrack' : 'air'));

test('a slot is found in the wall nearest the bot: mouth, two cells in, four blocks to dig', () => {
  const site = slot.slotSite(wall());
  assert.ok(site);
  assert.deepStrictEqual([site.mouth.x, site.mouth.y, site.d.x, site.d.z], [4, 64, -1, 0]);
  assert.deepStrictEqual([site.a.x, site.b.x, site.digs.length], [3, 2, 4]);
  assert.match(slot.says(site, 1), /one wide and two high two cells into the rock/);
  assert.match(slot.says(site, 1), /4 blocks to dig/);
});

test('with an enderman named, the slot found says whether its mouth has a line to its eyes (note 1000)', () => {
  const b = wall();
  b.world = { raycast: () => null };
  const seen = slot.slotSite(b, { toward: { position: new Vec3(12.5, 64, 0.5) } });
  assert.strictEqual(seen.line, true);
  b.world = { raycast: (from) => ({ position: from.offset(1, 0, 0), intersect: from.offset(1, 0, 0) }) };
  const hidden = slot.slotSite(b, { toward: { position: new Vec3(12.5, 64, 0.5) } });
  assert.strictEqual(hidden.line, false);
  assert.match(slot.says(seen, 1), /the mouth has a line to its eyes now/);
});

test('no slot on open ground, beside lava, or where the back is open', () => {
  assert.strictEqual(slot.slotSite(world((x, y) => y <= 63 ? 'netherrack' : 'air')), null);
  assert.strictEqual(slot.slotSite(wall((x, y, z) => x <= 3 && y === 66 ? 'lava' : null)), null, 'lava over the roof');
  assert.strictEqual(slot.slotSite(wall((x, y, z) => x <= 1 && y >= 64 ? 'air' : null)), null, 'a wall two thick has no back');
});

test('the gaze guard stands down only while a stare is meant', () => {
  const { gazePlugin, DOWN } = require('../src/gaze');
  const handlers = {};
  const bot = { on: (name, fn) => { handlers[name] = fn; }, once: (name, fn) => fn(), entity: { position: new Vec3(0.5, 64, 0.5), pitch: 0, yaw: 0, height: 1.8 }, entities: { 7: { id: 7, name: 'enderman', position: new Vec3(0.5, 64, -5.5), isValid: true } }, blockAt: () => ({ name: 'air', boundingBox: 'empty' }), game: { dimension: 'the_nether' } };
  gazePlugin(bot);
  const tick = handlers.physicsTick || handlers.physicTick;
  assert.ok(tick, 'the plugin ticks');
  bot._stareMeant = { id: 7, until: Date.now() + 1000 };
  bot.entity.pitch = 0.1; tick();
  assert.strictEqual(bot.entity.pitch, 0.1, 'left as meant');
  bot._stareMeant = { id: 7, until: Date.now() - 1 };
  tick();
  assert.notStrictEqual(bot.entity.pitch, 0.1, 'turned off its eyes again');
  assert.ok(DOWN != null);
});
