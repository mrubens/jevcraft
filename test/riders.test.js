'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { ridersPlugin } = require('../src/riders');

test('a rider is where its mount is: a husk on a camel husk is counted at the camel, not where it mounted', () => {
  // first-days-213: lanced from two blocks by a husk on a camel husk that every layer had fourteen blocks off.
  const { threats } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry,
    world: { raycast: () => null }, time: { timeOfDay: 18000 }, entities: {} });
  ridersPlugin(bot);
  const camel = { id: 1, name: 'camel_husk', type: 'animal', position: new Vec3(14.5, 64, 0.5), height: 2.375, passengers: [], isValid: true };
  const husk = { id: 2, name: 'husk', type: 'hostile', position: new Vec3(14.5, 65.8, 0.5), height: 1.95, isValid: true, heldItem: { name: 'iron_spear' } };
  bot.entities = { 1: camel, 2: husk };
  husk.vehicle = camel; camel.passengers.push(husk);
  bot.emit('entityAttach', husk, camel);
  camel.position = new Vec3(2.5, 64, 0.5);
  bot.emit('entityMoved', camel);
  const t = threats(bot).find(x => x.entity.name === 'husk');
  assert(t && t.distance < 3.5, `the husk rides at the camel: ${t?.distance}`);
});
