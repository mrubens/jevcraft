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
  assert.match(e.fightHere.creeper, /goes off for about 24 after armour two blocks off \(43 at point blank, 24 at 2 blocks/);
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

test('a fight held facing a mob that does not come is given up after eight seconds, and the mob is left be', async () => {
  // Trial 73: three minutes facing a creeper that stayed six blocks off.
  const { Survival } = require('../src/survival');
  const { immediateThreat } = require('../src/danger');
  const { Vec3 } = require('vec3');
  const creeper = { id: 8, name: 'creeper', position: new Vec3(6, 67, 0), height: 1.7, isValid: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 8: creeper }, time: { timeOfDay: 18000 }, game: { dimension: 'overworld' },
    world: { raycast: () => null }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }),
    pathfinder: { movements: {} }, inventory: { items: () => [{ name: 'iron_sword', type: 1 }], slots: [] }, on() {}, health: 20, lookAt: async () => {} };
  const survival = new Survival(bot, { navigate: async () => {} });
  const danger = [{ entity: creeper, distance: 6.3, visible: true }];
  const fight = survival.stanceOptions({ check() {} }, {}, () => {}, danger, false).fight;
  assert.equal(await fight.run(), true, 'held while it may yet come');
  survival.state.standing.since = Date.now() - 9000;
  assert.equal(await fight.run(), false, 'eight seconds and no nearer: the stance failed');
  assert.equal(immediateThreat(bot), undefined, 'left be while it lands nothing');
});

test('a golden apple carried is offered in a fight, and not at full health', () => {
  // Trial 81: died to a spider with a golden apple from the dungeon chest in its pack.
  const { Survival } = require('../src/survival');
  const { Vec3 } = require('vec3');
  const spider = { id: 4, name: 'spider', position: new Vec3(1.5, 64, 0), height: 0.9, isValid: true };
  const items = [{ name: 'golden_apple', count: 1 }];
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 4: spider }, time: { timeOfDay: 18000 }, game: { dimension: 'overworld' },
    world: { raycast: () => null }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }),
    pathfinder: { movements: {} }, inventory: { items: () => items, slots: [] }, on() {}, health: 7 };
  const survival = new Survival(bot, {});
  const danger = [{ entity: spider, distance: 1.1, visible: true }];
  const options = survival.stanceOptions({ check() {} }, {}, () => {}, danger, false);
  assert.match(options.eat_golden_apple?.description || '', /four extra health as absorption/);
  bot.health = 20;
  assert.equal(survival.stanceOptions({ check() {} }, {}, () => {}, danger, false).eat_golden_apple, undefined);
});

test('copper armour: its points in the estimate, worn over nothing and under iron, and offered only with nothing on', async () => {
  const { afterArmour, armourOf } = require('../src/combat-estimate');
  const set = ['copper_helmet', 'copper_chestplate', 'copper_leggings', 'copper_boots'];
  assert.equal(armourOf(set).points, 10);
  assert(Math.abs(afterArmour(3, armourOf(set)) - 1.98) < 0.01, 'a zombie\'s three comes to about two');
  const { wearBestArmour } = require('../src/mob-policy');
  const worn = {};
  const items = [{ name: 'copper_chestplate', type: 1 }, { name: 'iron_chestplate', type: 2 }, { name: 'copper_helmet', type: 3 }];
  const bot = { registry: require('minecraft-data')('26.1'), inventory: { items: () => items, slots: {} }, game: { dimension: 'overworld' },
    equip: async (item, slot) => { worn[slot] = item.name; bot.inventory.slots[{ head: 5, torso: 6, legs: 7, feet: 8 }[slot]] = item; } };
  await wearBestArmour(bot);
  assert.equal(worn.torso, 'iron_chestplate', 'iron over copper');
  assert.equal(worn.head, 'copper_helmet', 'copper over nothing');
});

test('copper armour is offered as a side trip with a stone pickaxe and nothing worn, and not once anything is worn', () => {
  const { sideTrips } = require('../src/work');
  const { Vec3 } = require('vec3');
  const reg = require('minecraft-data')('26.1');
  const slots = {};
  const bot = { registry: reg, game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 40, 0) }, entities: {},
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, type: reg.itemsByName.stone_pickaxe.id }, { name: 'raw_copper', count: 7 }], slots },
    findBlocks: ({ matching }) => matching.includes(reg.blocksByName.copper_ore.id) ? [new Vec3(5, 40, 0)] : [], blockAt: () => null };
  const goal = {};
  const offered = sideTrips(bot, goal, null).copper_armour;
  assert.match(offered?.description || '', /twenty-four copper ingots \(0 carried, 7 raw copper\), copper ore in view 5 blocks off/);
  slots[6] = { name: 'iron_chestplate' };
  assert.equal(sideTrips(bot, goal, null).copper_armour, undefined, 'something worn: not offered');
});

// The crowd of mid-110-k at 05:31:04 (2026-09-26): a spider and a zombie at
// arm's length, a creeper and a skeleton six blocks off, two more skeletons,
// full iron and a shield, 13.3 health.
const IRON = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
const crowd110k = () => fightEstimate({ threats: [['spider', 1.8], ['zombie', 3.2], ['creeper', 6.4], ['skeleton', 6.4, 1], ['skeleton', 8.5, 1], ['skeleton', 20, 1]]
  .map(([name, distance, shoots]) => ({ name, distance, shoots: !!shoots, visible: true })), armour: IRON, weapon: 'iron_sword', health: 13.3, shield: true });

test('every stance is priced over the same fifteen seconds: the pillar under a creeper and three skeletons is not the cheap one', () => {
  const { stanceCost } = require('../src/combat-estimate');
  const e = crowd110k();
  assert(e.fightHere.inFifteenSeconds < e.fightHere.damageTaken, 'the fight\'s first fifteen seconds are part of its whole');
  const pillar = stanceCost({ mobs: e.mobs, setup: 1.5, fight: { only: m => m.name === 'spider' }, reaches: m => m.shoots || m.name === 'creeper', shield: true });
  // Up in a second and a half, the creeper at the foot a second later: the
  // blast is counted, and the three skeletons and the spider still reach.
  assert.equal(pillar.blasts.length, 1);
  assert.equal(pillar.blasts[0].seconds, 2.6);
  assert.deepEqual(pillar.still.sort(), ['creeper', 'skeleton', 'spider']);
  assert(pillar.damage > e.fightHere.inFifteenSeconds, `two up costs more than the fight's first fifteen seconds here: ${pillar.damage} against ${e.fightHere.inFifteenSeconds}`);
  // Thirty-one blocks of pocket: not shut within the fifteen seconds.
  const seal = stanceCost({ mobs: e.mobs, setup: 31 * 0.6 });
  assert(seal.damage > pillar.damage && seal.still.length === 0);
  // Three and a half seconds down into the ground, and then nothing reaches;
  // but the creeper six blocks off goes off before the cap is on, and that
  // is counted too.
  const down = stanceCost({ mobs: e.mobs, setup: 3.4 });
  assert(down.damage < pillar.damage, JSON.stringify(down));
  assert.equal(down.blasts.length, 1, 'the creeper is there before the hole is shut');
  const later = stanceCost({ mobs: e.mobs.filter(m => m.name !== 'creeper'), setup: 3.4 });
  assert(later.damage < e.fightHere.inFifteenSeconds, JSON.stringify(later));
});

test('in a tunnel a crowd comes one or two at a time: the fight costs less than on open ground', () => {
  const zombies = [2, 3, 4, 5].map(distance => ({ name: 'zombie', distance, visible: true }));
  const open = fightEstimate({ threats: zombies, armour: IRON, weapon: 'iron_sword', health: 20 });
  const tunnel = fightEstimate({ threats: zombies, armour: IRON, weapon: 'iron_sword', health: 20, atOnce: 2 });
  assert(tunnel.fightHere.damageTaken < open.fightHere.damageTaken * 0.7, `${tunnel.fightHere.damageTaken} against ${open.fightHere.damageTaken}`);
  assert.equal(tunnel.fightHere.atArmsLengthAtOnce, 2);
  assert.equal(open.fightHere.atArmsLengthAtOnce, undefined);
});

test('a shooter out of its range walks in before it shoots, and a shield does not stop a witch\'s potion', () => {
  const { stanceCost } = require('../src/combat-estimate');
  const mobsAt = distance => fightEstimate({ threats: [{ name: 'skeleton', distance, shoots: true, visible: true }], armour: IRON, weapon: 'iron_sword' }).mobs;
  const far = stanceCost({ mobs: mobsAt(24), reaches: () => true }), near = stanceCost({ mobs: mobsAt(12), reaches: () => true });
  assert.equal(Math.round((near.damage - far.damage) / (near.damage / 15) * 10) / 10, 3, 'three seconds walking in from twenty-four');
  const witch = fightEstimate({ threats: [{ name: 'witch', distance: 6, shoots: true, visible: true }], armour: IRON, weapon: 'iron_sword' }).mobs;
  const shielded = stanceCost({ mobs: witch, reaches: () => true, shield: true }), bare = stanceCost({ mobs: witch, reaches: () => true, shield: false });
  assert.equal(shielded.damage, bare.damage);
  assert.equal(bare.damage, 30, 'six a potion, one each three seconds, for fifteen seconds');
});

test('a mob with a spear is reckoned at its thrust, not its hand', () => {
  // mid-87-m: a zombie villager's spear took it from twenty to 11.4 through full iron, reckoned at three a hit.
  const { fightEstimate } = require('../src/combat-estimate');
  const armour = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  const bare = fightEstimate({ threats: [{ name: 'zombie_villager', distance: 2, visible: true }], armour, weapon: 'diamond_sword' }).mobs[0];
  const spear = fightEstimate({ threats: [{ name: 'zombie_villager', distance: 2, visible: true, held: 'iron_spear' }], armour, weapon: 'diamond_sword' }).mobs[0];
  assert(spear.hitsBot >= 8 && spear.hitsBot <= 9.5, `about 8.6 through iron: ${spear.hitsBot}`);
  assert(bare.hitsBot < 3);
  assert.match(spear.note, /spear/);
});

test('biters already at arm\'s length are counted however few open cells there are round the bot', () => {
  // mid-235-f in a shaft with three zombies in it was told the fight cost nothing, took it at 0.91 from 5.9 health and was killed (2026-09-27).
  const zombies = [0.4, 1.8, 2.5].map(distance => ({ name: 'zombie', distance, visible: true }));
  const e = fightEstimate({ threats: zombies, armour: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], weapon: 'iron_sword', health: 6, atOnce: 0 });
  assert(e.fightHere.damageTaken > 3, JSON.stringify(e.fightHere));
  assert.equal(e.fightHere.atArmsLengthAtOnce, 3);
});
