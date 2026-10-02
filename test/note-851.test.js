'use strict';
// Note 851: under water with a creeper about, each way to air says where it
// ends from the creeper, and a way that keeps off it is offered. 25583
// (mid-230-bj, 2026-10-02 00:36:36Z) was offered only the shortest way,
// "2 cells: about 0.8 seconds", a creeper 9.2 off unsaid; the swim ran six
// seconds toward it and the blast took it from 20 to 5.5.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const vitals = require('../src/vitals');
const danger = require('../src/danger');

function pond() {
  return { oxygenLevel: 12, health: 20, entity: { position: new Vec3(0.5, 62, 0.5), isInWater: true }, inventory: { items: () => [], slots: {} },
    blockAt: p => ({ name: p.y >= 66 ? 'air' : 'water', boundingBox: 'empty', position: p }) };
}
const creeperAt = (bot, at) => ({ entity: { id: 9, name: 'creeper', position: at }, distance: at.distanceTo(bot.entity.position), visible: true });

test('a creeper about: the shortest way says where it ends from it, and swim_from_creeper keeps off it (note 851)', t => {
  const bot = pond();
  const c = creeperAt(bot, new Vec3(2.5, 66, 0.5));
  t.mock.method(danger, 'threats', () => [c]);
  const ways = vitals.airWays(bot, { check() {}, cancelled: false });
  assert.match(ways.swim_to_air.description, /It ends [\d.]+ blocks from the creeper now 4\.5 off, which walks at the bot meanwhile\./);
  assert(ways.swim_from_creeper, `offered: ${Object.keys(ways)}`);
  const ends = d => Number(d.match(/It ends ([\d.]+) blocks from the creeper/)[1]);
  assert(ends(ways.swim_from_creeper.description) > ends(ways.swim_to_air.description) + 1, `${ways.swim_from_creeper.description} | ${ways.swim_to_air.description}`);
});

test('no creeper about: the ways to air as before, no word of one (note 851)', t => {
  const bot = pond();
  t.mock.method(danger, 'threats', () => []);
  const ways = vitals.airWays(bot, { check() {}, cancelled: false });
  assert(ways.swim_to_air && !ways.swim_from_creeper);
  assert.doesNotMatch(ways.swim_to_air.description, /creeper/);
});
