'use strict';
// Note 1036: head under water with a mob at arm's length, each way to air
// says the blows over the next seconds first, and the strike is a way.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const vitals = require('../src/vitals');
const danger = require('../src/danger');

function pond(health = 20) {
  return { oxygenLevel: 12, health, entity: { position: new Vec3(0.5, 62, 0.5), isInWater: true, yaw: 0 }, inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: {} }, heldItem: { name: 'iron_sword' },
    blockAt: p => ({ name: p.y >= 66 ? 'air' : 'water', boundingBox: 'empty', position: p }) };
}
const drownedAt = (bot, at) => ({ entity: { id: 9, name: 'drowned', position: at, height: 1.95, width: 0.6 }, distance: at.distanceTo(bot.entity.position), visible: true });

test('a drowned at arm\'s length: the blows said first on each way, and the strike offered beside the swim', t => {
  const bot = pond();
  t.mock.method(danger, 'threats', () => [drownedAt(bot, new Vec3(2.1, 62, 0.5))]);
  const ways = vitals.airWays(bot, { check() {}, cancelled: false });
  assert.ok(ways.strike_at_arm, `offered: ${Object.keys(ways)}`);
  assert.match(ways.swim_to_air.description, /^Over the next \d+ seconds this way, if nothing turns to the drowned at arm's length: about [\d.]+ health, \d+ blows?, from 20 \(each blow about [\d.]+ through the armour worn and knocking the body back off its swim\)\. Swim the shortest way to air/);
  assert.match(ways.strike_at_arm.description, /^Over the next \d+ seconds this way: about [\d.]+ health, \d+ blows?, from 20 .*Turn to the drowned 1\.6 blocks off(, behind the bot,)? and strike it with the iron sword, head under: it has 20 health, about \d+ swings, about [\d.]+ seconds, against [\d.]+ seconds of breath/);
});

test('at low health the ways whose blows take more than the bot has come after the strike; with no mob at arm, nothing is added', t => {
  const low = pond(4);
  t.mock.method(danger, 'threats', () => [drownedAt(low, new Vec3(2.1, 62, 0.5))]);
  const ways = vitals.airWays(low, { check() {}, cancelled: false }), order = Object.keys(ways);
  assert.match(ways.swim_to_air.description, /more than the bot has/);
  if (!/more than the bot has/.test(ways.strike_at_arm.description)) assert.equal(order[0], 'strike_at_arm', order.join(', '));
  t.mock.restoreAll();
  t.mock.method(danger, 'threats', () => []);
  const calm = vitals.airWays(pond(), { check() {}, cancelled: false });
  assert.equal(calm.strike_at_arm, undefined);
  assert.match(calm.swim_to_air.description, /^Swim the shortest way to air/);
});
