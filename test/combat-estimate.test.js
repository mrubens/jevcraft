'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fightEstimate, afterArmour, armourOf } = require('../src/combat-estimate');

test('armour takes what the game takes: full iron cuts a zombie\'s hit from 3 to 1.4', () => {
  const iron = armourOf(['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']);
  assert.deepEqual(iron, { points: 15, toughness: 0 });
  assert.equal(Math.round(afterArmour(3, iron) * 10) / 10, 1.4);
  assert.equal(afterArmour(3, { points: 0, toughness: 0 }), 3);
});

test('three zombies against a stone sword and no armour cost more than eight health', () => {
  const zombie = d => ({ name: 'zombie', distance: d, shoots: false, visible: true });
  const e = fightEstimate({ threats: [zombie(6), zombie(7), zombie(8)], armour: [], weapon: 'stone_sword', health: 8 });
  assert.equal(e.mobs[0].swingsToKill, 4); assert.equal(e.mobs[0].secondsToKill, 2.5); assert.equal(e.mobs[0].hitsBot, 3);
  // 2.5 s under three, then two, then one, the one being struck landing a
  // third of its hits: (7 + 4 + 1) * 2.5 = 30.
  assert.equal(e.fightHere.damageTaken, 30);
  assert(e.fightHere.healthAfter < 0);
  const armed = fightEstimate({ threats: [zombie(6)], armour: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], weapon: 'iron_sword', health: 20 });
  assert(armed.fightHere.damageTaken < 5, JSON.stringify(armed.fightHere));
});

test('the arena cave trio comes out near what it measured (about five, with a shield)', () => {
  const e = fightEstimate({ threats: [{ name: 'zombie', distance: 3, visible: true }, { name: 'zombie', distance: 4, visible: true }, { name: 'skeleton', distance: 5, shoots: true, visible: true }],
    armour: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'], weapon: 'diamond_sword', health: 20, shield: true });
  assert(e.fightHere.damageTaken > 4 && e.fightHere.damageTaken < 10, JSON.stringify(e.fightHere));
});

test('a shooter out of sight costs nothing while it is fought for; a creeper\'s blast is said, not summed', () => {
  const e = fightEstimate({ threats: [{ name: 'skeleton', distance: 10, shoots: true, visible: false }, { name: 'creeper', distance: 5, visible: true }], weapon: 'iron_sword' });
  assert.equal(e.fightHere.damageTaken, 0);
  assert.match(e.fightHere.creeper, /goes off for about 22/);
});

test('a skeleton is not a quick kill: it backs off after each hit and shoots while it is closed on', () => {
  // Trial 44 was told 2.5 seconds and 1.3 damage; it lost fourteen health in six seconds.
  const e = fightEstimate({ threats: [{ name: 'skeleton', distance: 4.3, shoots: true, visible: true }], weapon: 'stone_sword', health: 9.2 });
  assert(e.fightHere.damageTaken >= 6, JSON.stringify(e.fightHere));
  assert(e.fightHere.healthAfter < 4, 'at nine health it is close to fatal');
});

test('bare hands land two hits a second, not four: a zombie takes ten seconds and about half the health', () => {
  // A mob struck is unhurt for half a second after. Told five seconds and
  // five damage, a bare-handed fight looked cheap; the ledge replay of trial
  // 57 lost one in three at about that pace.
  const fight = fightEstimate({ threats: [{ name: 'zombie', distance: 2, shoots: false, visible: true }], weapon: null, health: 20 }).fightHere;
  assert.equal(fight.seconds, 10);
  assert(fight.damageTaken >= 8, `took ${fight.damageTaken}`);
});

test('the mob being fought stays in view for a few seconds when it steps below a ledge\'s edge', () => {
  const { threats } = require('../src/danger');
  const { Vec3 } = require('vec3');
  const zombie = { id: 9, name: 'zombie', position: new Vec3(2, 63, 0), height: 1.95, isValid: true };
  const bot = { entity: { position: new Vec3(0, 64, 0) }, entities: { 9: zombie }, time: { timeOfDay: 18000 }, game: {},
    world: { raycast: () => ({ position: new Vec3(1, 64, 0), intersect: new Vec3(1, 64.5, 0) }) } };
  assert.equal(threats(bot, 8)[0].visible, false, 'behind the lip');
  bot._struck = { id: 9, at: Date.now() };
  assert.equal(threats(bot, 8)[0].visible, true, 'the one just punched');
  bot._struck.at = Date.now() - 9000;
  assert.equal(threats(bot, 8)[0].visible, false, 'not for good');
});

test('a mob seen close a moment ago stays a threat when it drops out of view for a look', () => {
  // Trial 65: the creeper at four blocks hid for one look and the stance was asked again without it.
  const { threats } = require('../src/danger');
  const { Vec3 } = require('vec3');
  const creeper = { id: 3, name: 'creeper', position: new Vec3(4, 64, 0), height: 1.7, isValid: true };
  let blocked = false;
  const bot = { entity: { position: new Vec3(0, 64, 0) }, entities: { 3: creeper }, time: { timeOfDay: 18000 }, game: {},
    world: { raycast: () => blocked ? { position: new Vec3(2, 64, 0), intersect: new Vec3(2, 64.5, 0) } : null } };
  assert.equal(threats(bot, 16)[0].visible, true);
  blocked = true;
  assert.equal(threats(bot, 16)[0].visible, true, 'hidden for a look, still counted');
  bot._seenClose.set(3, Date.now() - 4000);
  assert.equal(threats(bot, 16)[0].visible, false, 'not for good');
});

test('a charge that cannot get to the mob fails, and that mob is left be while it lands nothing', async () => {
  // Trial 66: "going for" a zombie in a mineshaft twenty times a second for 159 s, neither able to reach the other.
  const { Survival } = require('../src/survival');
  const { immediateThreat } = require('../src/danger');
  const { Vec3 } = require('vec3');
  const zombie = { id: 5, name: 'zombie', position: new Vec3(5, 64, 0), height: 1.95, isValid: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 5: zombie }, time: { timeOfDay: 18000 }, game: { dimension: 'overworld' },
    world: { raycast: () => null }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }),
    pathfinder: { movements: {} }, inventory: { items: () => [], slots: [] }, on() {}, health: 20 };
  const survival = new Survival(bot, { navigate: async () => { throw new Error('No path to the goal'); } });
  const threat = { entity: zombie, distance: 4.5, visible: true };
  assert.equal(immediateThreat(bot)?.entity, zombie, 'a zombie in view is a threat');
  const charged = await survival.charge({ check() {} }, {}, () => {}, threat, false, { chosen: true });
  assert.equal(charged, false, 'got nowhere: not a charge');
  assert.equal(immediateThreat(bot), undefined, 'out of reach both ways: left be');
  bot._recentHurtAt = Date.now();
  assert.equal(immediateThreat(bot)?.entity, zombie, 'until it lands a hit');
});
