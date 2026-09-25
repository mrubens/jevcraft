'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const home = require('../src/home-base');
const { wallPlan, ring } = require('../src/home-wall');
const { establishedHome } = require('./fixtures/home-world');

test('a wall round home is Jev\'s option from the bed and the chest on, said with its cost and what it keeps out, and built two high with a door by the bed', async () => {
  // The user, 2026-09-25: "add wall as an option", after a creeper blew up trial 98's chest.
  const w = await establishedHome({ items: [['cobblestone', 96], ['oak_door', 1]], walled: false }), { bot, goal } = w;
  const h = goal.survival.home;
  const chores = home.homeChores(bot, goal);
  assert(chores.wall_home, Object.keys(chores).join(','));
  assert.match(chores.wall_home.description, /two blocks high round the bed, the chest, the plot and the pen, with a door/);
  assert.match(chores.wall_home.description, /cannot break a door on Normal/);
  const plan = wallPlan(bot, h);
  assert.equal(plan.fill.filter(p => p.y > h.origin.y).length, ring(h).length * 2 - 2, 'every column two high over the ground, the door column none');
  assert.equal(plan.fill.filter(p => p.y === h.origin.y).length, 3, 'the pond\'s edge on the ring filled too');
  assert(plan.door, 'a door by the bed');
  const placed = [];
  const actions = { acquireStep: async () => assert.fail('all carried'), place: async (b, t, p, name, opts) => { placed.push(name); w.set(p, name); if (/_door$/.test(name)) { assert.equal(opts.properties.half, 'lower'); w.set(p.offset(0, 1, 0), name); } } };
  await chores.wall_home.run(bot, new Task('wall'), goal, () => {}, actions);
  assert.equal(placed.filter(n => n === 'cobblestone').length, plan.fill.length);
  assert.equal(placed.at(-1), 'oak_door');
  assert(h.walledAt, 'walled');
  assert.equal(home.homeChores(bot, goal).wall_home, undefined, 'not offered again');
  // Every cell inside the footprint is left alone: nothing was built on the bed, the plot or the pen.
  const { footprint } = home.layout(h);
  for (const c of footprint) assert.notEqual(bot.blockAt(new Vec3(c.x, c.y + 1, c.z))?.name, 'cobblestone');
});

test('ground outside the footprint is built up from where it is, and a column already high enough is left', async () => {
  const w = await establishedHome({ items: [['cobblestone', 96]], walled: false }), { bot, goal } = w;
  const h = goal.survival.home, cols = ring(h);
  const low = cols.find(c => c.v === 4), high = cols.find(c => c.u === 9 && c.v === 0);
  w.set(new Vec3(low.x, h.origin.y, low.z), 'air'); // a dip one deep
  for (const dy of [1, 2]) w.set(new Vec3(high.x, h.origin.y + dy, high.z), 'stone'); // a rock already there
  const plan = wallPlan(bot, h);
  assert.equal(plan.fill.filter(p => p.x === low.x && p.z === low.z).length, 3, 'the dip filled, then two');
  assert.equal(plan.fill.filter(p => p.x === high.x && p.z === high.z).length, 0, 'the rock is wall already');
});
