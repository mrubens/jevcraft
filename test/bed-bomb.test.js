'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { bedPlan, bedBomb } = require('../src/bed-bomb');

// Flat end stone, its top at y 63; the perched head at (10.5, 64.3, 0.5).
function island() {
  const placed = new Map(), dug = new Set();
  const nameAt = p => placed.get(`${p}`) || (dug.has(`${p}`) ? 'air' : p.y <= 63 ? 'end_stone' : 'air');
  const blockAt = p => { const f = p.floored(); const name = nameAt(f); return { name, position: f, boundingBox: name === 'air' ? 'empty' : 'block' }; };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'white_bed', count: 2 }] }, blockAt, controls: {},
    equip: async () => {}, look: async () => {}, lookAt: async () => {}, setControlState(k, v) { this.controls[k] = v; } };
  return { bot, placed, dug };
}

test('the bed line: the head half beside the dragon\'s head, the foot before it, the trench three blocks back with ground in front', () => {
  const { bot } = island();
  const head = new Vec3(10.5, 64.3, 0.5);
  const plan = bedPlan(bot, head);
  assert(plan);
  assert(plan.gap <= 2.5);
  assert.equal(plan.foot.distanceTo(plan.top), 1);
  assert.equal(plan.stand.distanceTo(plan.foot), 3);
  assert.equal(plan.stand.y, 64);
  // No ground to dig a trench in: no plan.
  const air = island(); air.bot.blockAt = p => ({ name: 'air', position: p.floored(), boundingBox: 'empty' });
  assert.equal(bedPlan(air.bot, head), null);
});

test('the bed is laid and blown from the trench, sneaking; a dragon that took off is not bombed', async () => {
  const { bot, placed, dug } = island();
  const plan = bedPlan(bot, new Vec3(10.5, 64.3, 0.5));
  const navigate = async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
  const dig = async (b, t, p) => { dug.add(`${p}`); bot.entity.position = bot.entity.position.offset(0, -1, 0); };
  let sneakAtClick = null;
  bot.placeBlock = async (ref, face) => { const f = ref.position.plus(face); placed.set(`${f}`, 'white_bed'); placed.set(`${f.plus(plan.dir)}`, 'white_bed'); };
  bot.activateBlock = async b => { sneakAtClick = bot.controls.sneak; assert.equal(`${b.position}`, `${plan.foot}`, 'the visible foot half is clicked'); placed.delete(`${plan.foot}`); placed.delete(`${plan.top}`); };
  assert.equal(await bedBomb(bot, new Task('dragon'), plan, { navigate, dig }), true);
  assert(dug.has(`${plan.stand.offset(0, -1, 0)}`), 'the trench dug');
  assert.equal(sneakAtClick, true);
  assert.equal(bot.controls.sneak, false, 'standing again after');
  const off = island(); const plan2 = bedPlan(off.bot, new Vec3(10.5, 64.3, 0.5));
  await assert.rejects(bedBomb(off.bot, new Task('dragon'), plan2, { navigate: async (b, t, g) => { off.bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); },
    dig: async () => { off.bot.entity.position = off.bot.entity.position.offset(0, -1, 0); }, stillPerched: () => false }), /took off/);
});
