'use strict';
// Note 2566: food in view is only what the hunt takes (foraging.js preyFood), as huntInView takes it.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');

test('a young rabbit in view is not offered as food in view; a grown one is', () => {
  const { foodSources } = require('../src/healing');
  const registry = require('minecraft-data')('26.1');
  const keys = registry.entitiesByName.rabbit.metadataKeys || [];
  const rabbit = (id, baby) => { const metadata = []; if (keys.indexOf('baby') >= 0) metadata[keys.indexOf('baby')] = baby; return { id, name: 'rabbit', position: new Vec3(5, 64, 0), isValid: true, metadata }; };
  const bot = { registry, entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' }, inventory: { items: () => [] }, entities: { 1: rabbit(1, true) } };
  assert(!foodSources(bot, {}).some(s => s.kind === 'in_view' && s.animal === 'rabbit'), 'the young one is not food in view');
  bot.entities[2] = rabbit(2, false);
  const seen = foodSources(bot, {}).find(s => s.kind === 'in_view' && s.animal === 'rabbit');
  assert(seen, 'the grown one is'); assert.equal(seen.count, 1);
});
