'use strict';
// Trial note 820: with lava in hand and no slot free, the fetch takes what
// it carries to the frame and asks nothing about dropping.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

test('no slot free with a lava bucket carried: no drop question, the cast takes the lava carried (note 820)', async () => {
  const { collectLava } = require('../src/obsidian');
  const blocks = new Map();
  const put = (x, y, z, name, extra = {}) => blocks.set(`${x},${y},${z}`, { name, position: new Vec3(x, y, z), boundingBox: name === 'stone' ? 'block' : 'empty', getProperties: () => ({ level: 0 }), metadata: 0, ...extra });
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) put(x, 63, z, 'stone');
  put(1, 63, 0, 'lava'); put(1, 63, 1, 'lava');
  const items = [{ name: 'bucket', count: 5, type: registry.itemsByName.bucket.id }, { name: 'lava_bucket', count: 1, type: registry.itemsByName.lava_bucket.id }];
  const asked = [];
  const bot = { registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 64, 0.5) },
    inventory: { items: () => items, emptySlotCount: () => 0 }, world: { raycast: () => null },
    blockAt: p => blocks.get(`${p.x},${p.y},${p.z}`) || { name: 'air', position: p.clone(), boundingBox: 'empty', getProperties: () => ({}) },
    findBlocks: ({ matching, maxDistance, count, point = bot.entity.position, useExtraInfo = () => true }) => [...blocks.values()]
      .filter(b => registry.blocksByName[b.name]?.id === matching && b.position.distanceTo(point) <= maxDistance && useExtraInfo(b))
      .sort((a, b) => a.position.distanceTo(point) - b.position.distanceTo(point)).slice(0, count).map(b => b.position.clone()),
    pathfinder: { movements: {}, getPathTo: async () => ({ status: 'success', path: [] }) }, chat() {} };
  const task = new Task('lava');
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(Object.keys(questions.branch_0.criteria)); return { answers: { branch_0: { choice: 'none', confidence: 0.5 } } }; } };
  const logs = []; const log = console.log; console.log = (...a) => logs.push(a.join(' '));
  try { await collectLava(bot, task, { action: 'fill_bucket', item: 'lava_bucket', count: 6 }, {}, () => {}, { navigate: async () => {}, dig: async () => {} }); }
  catch (_) { /* a fetch that ends is not the point */ }
  finally { console.log = log; }
  assert.equal(asked.length, 0, `no drop question: ${JSON.stringify(asked)}`);
  assert(logs.some(l => /^\[lava\] no slot free for another lava bucket: the cast takes the 1 carried/.test(l)), logs.filter(l => /lava|room/.test(l)).join('\n'));
});
