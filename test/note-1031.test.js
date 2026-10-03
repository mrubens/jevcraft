'use strict';
// Note 1031: with none in line from the slot's mouth, a cell a few steps out
// from which one is, far enough off for the bot to be back before it comes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const slot = require('../src/enderman-slot');

// A floor at y 63; rock west of x 0 with the slot dug into it at z 0; a wall
// three wide at x 4 between the mouth and what stands east.
function world(endermanAt) {
  const solid = c => c.y <= 63 || (c.x < 0 && !(c.z === 0 && c.x >= -2 && c.y <= 65)) || (c.x === 4 && c.z >= -1 && c.z <= 1 && c.y <= 68);
  const blockAt = p => { const c = p.floored(); return { position: c, name: solid(c) ? 'netherrack' : 'air', boundingBox: solid(c) ? 'block' : 'empty', shapes: solid(c) ? [[0, 0, 0, 1, 1, 1]] : [] }; };
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(-1.5, 64, 0.5) }, blockAt, entities: { 5: { id: 5, name: 'enderman', position: endermanAt, isValid: true, metadata: [] } },
    world: { raycast: (from, dir, range) => { for (let t = 0; t <= range; t += 0.2) { const p = from.plus(dir.scaled(t)); if (solid(p.floored())) return { position: p.floored(), intersect: p }; } return null; } } };
  const site = { mouth: new Vec3(0, 64, 0), a: new Vec3(-1, 64, 0), b: new Vec3(-2, 64, 0), d: new Vec3(-1, 0, 0), digs: [] };
  return { bot, site };
}

test('behind a wall from the mouth, in sight two cells out: that cell, its path and the gap wanted; too near, none', () => {
  const far = world(new Vec3(24.5, 64, 0.5));
  assert.equal(slot.lineFrom(far.bot, far.site.mouth, far.bot.entities[5]), false, 'no line from the mouth');
  const spot = slot.outSpot(far.bot, far.site, [far.bot.entities[5]]);
  assert.ok(spot, 'a cell out of the mouth sees it');
  assert.ok(spot.steps <= slot.OUT_STEPS && spot.path.length === spot.steps);
  assert.ok(slot.lineFrom(far.bot, spot.cell, far.bot.entities[5]));
  assert.ok(spot.e.position.distanceTo(spot.cell.offset(0.5, 0, 0.5)) >= spot.gap - 0.5, 'far enough off to be back first');
  // Note 1035: the slot is found for it, marked as one the look goes out for, and said so.
  far.bot.entity.position = new Vec3(0.5, 64, 0.5);
  const site = slot.slotSite(far.bot, { toward: far.bot.entities[5], reach: 0 });
  assert.ok(site && !site.line && site.out, JSON.stringify(site && { line: site.line, out: site.out }));
  assert.match(slot.says(site, 1), /the mouth has no line to one now: the bot goes \d cells? out of it to where one \d+ blocks off is in sight, looks, and is back at the slot's end before it comes/);
  // Eight blocks off it would be at the bot before the slot's end: no cell.
  const near = world(new Vec3(8.5, 64, 3.5));
  assert.equal(slot.outSpot(near.bot, near.site, [near.bot.entities[5]]), null);
  // One already turned is waited for at the back, not gone out to.
  far.bot.entities[5].metadata = { 17: true };
  assert.equal(slot.outSpot(far.bot, far.site, [far.bot.entities[5]]), null);
});
