'use strict';
// Note 896: at the known portal's place with no sheet in its frame, the
// frame is lit again with the flint and steel carried, or it is said.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

function scene({ lighter = true, whole = true } = {}) {
  // A frame along x at (5..6, 50..54, 13): bottom at y 50, inside y 51 to 53, top at y 54.
  const blocks = new Map();
  const set = (x, y, z, n) => blocks.set(`${x},${y},${z}`, n);
  for (const x of [5, 6]) { set(x, 50, 13, 'obsidian'); if (whole) set(x, 54, 13, 'obsidian'); }
  for (const y of [51, 52, 53]) { set(4, y, 13, 'obsidian'); set(7, y, 13, 'obsidian'); }
  const items = [{ name: 'blaze_rod', count: 1 }, ...(lighter ? [{ name: 'flint_and_steel', count: 1 }] : [])];
  const said = [], used = [];
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, oxygenLevel: 20, entities: {}, time: { timeOfDay: 6000 },
    entity: { position: new Vec3(8.5, 50, 11.5), height: 1.8, width: 0.6 }, inventory: { items: () => items, slots: [] }, chat: m => said.push(m),
    blockAt: p => { const q = p.floored ? p.floored() : p; const n = blocks.get(`${q.x},${q.y},${q.z}`) || (q.y < 50 ? 'netherrack' : 'air'); return { name: n, position: q, boundingBox: n === 'air' || n === 'nether_portal' ? 'empty' : 'block' }; },
    findBlocks: ({ matching }) => [...blocks.entries()].filter(([, n]) => registry.blocksByName[n]?.id === matching).map(([k]) => new Vec3(...k.split(',').map(Number))),
    equip: async i => { used.push(i.name); },
    activateBlock: async b => { used.push(`lit ${b.position}`); for (const x of [5, 6]) for (const y of [51, 52, 53]) set(x, y, 13, 'nether_portal'); },
    pathfinder: { movements: {}, setGoal() {}, stop() {}, goto: async () => {}, getPathTo: () => ({ status: 'success', path: [] }) }, on() {}, off() {}, removeListener() {}, emit() {}, clearControlStates() {} };
  const goal = { kind: 'win', survival: {}, portals: [{ x: 5, y: 50, z: 13, dimension: 'nether' }] };
  return { bot, goal, said, used };
}

test('25592: three blocks from its portal, the frame whole and no sheet, flint and steel carried: lit again', async () => {
  const { relightPortalAt } = require('../src/work');
  const { bot, goal, said, used } = scene();
  bot.entity.position = new Vec3(6.5, 50, 12.5);
  assert.equal(await relightPortalAt(bot, new Task('home'), goal, () => {}), true);
  assert.equal(goal.step.action, 'relight_portal');
  assert.deepEqual(said, ['My portal is out. Lighting it again.']);
  assert.equal(used[0], 'flint_and_steel');
  assert.match(used[1], /^lit \((5|6), 50, 13\)$/);
});

test('nothing to light it with, or no whole frame: said, not a silent return; far from the portal: nothing', async () => {
  const { relightPortalAt } = require('../src/work');
  const none = scene({ lighter: false }); none.bot.entity.position = new Vec3(6.5, 50, 12.5);
  await assert.rejects(relightPortalAt(none.bot, new Task('home'), none.goal, () => {}), /The portal at \(5, 50, 13\) is out: no sheet stands in its frame \(a ghast's fireball puts one out\), and neither flint and steel nor a fire charge is carried to light it again/);
  const broken = scene({ whole: false }); broken.bot.entity.position = new Vec3(6.5, 50, 12.5);
  await assert.rejects(relightPortalAt(broken.bot, new Task('home'), broken.goal, () => {}), /no whole frame of it is found within six blocks/);
  const far = scene(); far.bot.entity.position = new Vec3(40.5, 50, 12.5);
  assert.equal(await relightPortalAt(far.bot, new Task('home'), far.goal, () => {}), false);
});

test('note 1338: the Overworld side too, a remembered Overworld portal with no sheet is lit again', async () => {
  const { relightPortalAt } = require('../src/work');
  const { bot, goal, used } = scene();
  bot.game.dimension = 'overworld';
  goal.portals = [{ x: 5, y: 50, z: 13, dimension: 'overworld' }];
  bot.entity.position = new Vec3(6.5, 50, 12.5);
  assert.equal(await relightPortalAt(bot, new Task('home'), goal, () => {}), false, 'the Nether list holds none');
  assert.equal(await relightPortalAt(bot, new Task('home'), goal, () => {}, 'overworld'), true);
  assert.equal(used[0], 'flint_and_steel');
});
