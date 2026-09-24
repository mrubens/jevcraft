'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const shearing = require('../src/shearing');

function field({ shears = true, iron = 0, sheep = 3 } = {}) {
  const registry = require('minecraft-data')('26.1');
  const woolKey = registry.entitiesByName.sheep.metadataKeys.indexOf('wool');
  const items = [...(shears ? [{ name: 'shears', count: 1 }] : []), ...(iron ? [{ name: 'iron_ingot', count: iron }] : [])];
  const entities = {};
  for (let i = 0; i < sheep; i++) entities[i + 1] = { id: i + 1, name: 'sheep', position: new Vec3(3 + i * 4, 64, 0), metadata: { [woolKey]: 0 }, isValid: true };
  const give = (name, n) => { const it = items.find(i => i.name === name); if (it) it.count += n; else items.push({ name, count: n }); };
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities,
    inventory: { items: () => items }, equip: async () => {}, lookAt: async () => {},
    useOn: e => { e.metadata[woolKey] = 0x10; entities[100 + e.id] = { id: 100 + e.id, name: 'item', position: e.position.clone(), getDroppedItem: () => ({ name: 'white_wool' }) }; } };
  const actions = {
    navigate: async (b, t, g) => { bot.entity.position = (g.entity?.position || new Vec3(g.x, g.y, g.z)).offset(-1, 0, 0); },
    collect: async (b, t, name) => { give(name, 2); for (const [k, e] of Object.entries(entities)) if (e.name === 'item') delete entities[k]; return true; },
    acquireStep: async (b, t, item) => { assert.equal(item, 'shears'); items.find(i => i.name === 'iron_ingot').count -= 2; give('shears', 1); return true; },
  };
  return { bot, items, actions };
}

test('sheep are sheared, not killed: two wool each, until the wool wanted is carried', async () => {
  const { bot, actions } = field();
  const goal = {};
  assert.equal(await shearing.shearSheep(bot, new Task('wool'), goal, () => {}, { ...actions, want: 4 }), true);
  assert.equal(shearing.woolTotal(bot), 4);
  assert.equal(shearing.woollySheep(bot, goal).length, 1, 'one sheep left with its wool; the others still stand, shorn');
  assert.equal(Object.values(bot.entities).filter(e => e.name === 'sheep').length, 3, 'no sheep killed');
});

test('with two iron ingots and no shears, a pair is made first; with neither, no shearing', async () => {
  const pair = field({ shears: false, iron: 3 });
  assert(shearing.canShear(pair.bot));
  assert.equal(await shearing.shearSheep(pair.bot, new Task('wool'), {}, () => {}, { ...pair.actions, want: 2 }), true);
  assert(pair.items.some(i => i.name === 'shears'));
  const none = field({ shears: false, iron: 1 });
  assert.equal(shearing.canShear(none.bot), false);
  assert.equal(await shearing.shearSheep(none.bot, new Task('wool'), {}, () => {}, { ...none.actions }), false);
});

test('the shearing trip is offered with shears, a woolly sheep near and less wool than five beds need', () => {
  const { bot, items } = field();
  assert.equal(shearing.shearReady(bot, {}), true);
  items.push({ name: 'white_wool', count: 15 });
  assert.equal(shearing.shearReady(bot, {}), false, 'fifteen wool is enough');
});
