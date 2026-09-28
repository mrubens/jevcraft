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
  // Five swings each through a zombie's armor of two (4.9 a swing), at the
  // 0.9 seconds a swing the bot's fights went (note 550).
  assert.equal(e.mobs[0].swingsToKill, 5); assert.equal(e.mobs[0].secondsToKill, 4.5); assert.equal(e.mobs[0].hitsBot, 3);
  // Four seconds closing on the first, six blocks off, under the other two
  // (it lands 0.18 of its hits a second as it comes); then 3.6 seconds of
  // swings at it, 4.5 at the second and 4.5 at the third, the one being
  // struck landing a third of its hits; no more than two hits a second land
  // on a body hurt half a second ago (note 535): 6 * 4 + 6 * 3.6 + 4 * 4.5
  // + 1 * 4.5 = 68.1, in 16.6 seconds.
  assert.equal(e.fightHere.closingFirst, 4);
  assert.equal(e.fightHere.seconds, 16.6);
  assert.equal(e.fightHere.damageTaken, 68.1);
  assert(e.fightHere.healthAfter < 0);
  const armed = fightEstimate({ threats: [zombie(6)], armour: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], weapon: 'iron_sword', health: 20 });
  assert(armed.fightHere.damageTaken < 5, JSON.stringify(armed.fightHere));
});

test('the arena cave trio comes out near what it measured (about five, with a shield)', () => {
  const e = fightEstimate({ threats: [{ name: 'zombie', distance: 3, visible: true }, { name: 'zombie', distance: 4, visible: true }, { name: 'skeleton', distance: 5, shoots: true, visible: true }],
    armour: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'], weapon: 'diamond_sword', health: 20, shield: true });
  assert(e.fightHere.damageTaken > 4 && e.fightHere.damageTaken < 10, JSON.stringify(e.fightHere));
});

test('a shooter out of sight costs nothing while it is fought for; a creeper backed from on open ground goes off where its blast does nothing', () => {
  const e = fightEstimate({ threats: [{ name: 'skeleton', distance: 10, shoots: true, visible: false }, { name: 'creeper', distance: 5, visible: true }], weapon: 'iron_sword' });
  assert.equal(e.fightHere.damageTaken, 0);
  assert.match(e.fightHere.creeper, /^counted: .*goes off first, about 6 blocks off, where the blast does nothing \(if there is room behind the bot/);
  assert.match(e.fightHere.creeper, /A blast by distance after the armour worn: 43 at point blank, 24 at 2 blocks/);
});

const IRON_ARMOUR = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
// mid-241-a (2026-09-27 23:26:53): 4.8 health, full iron, an iron sword, a
// creeper 4.4 blocks off coming on and a wall at the bot's back. The fight
// was told "about 2.5 seconds and 0 damage", closed on it, and it went off
// three blocks off: 4.9 to none (note 529).
test('a creeper fought is priced by its fuse: the swings that do not fit in it leave its blast where the bot has backed to', () => {
  const { creeperFought, afterArmour, creeperBlast } = require('../src/combat-estimate');
  const iron = armourOf(IRON_ARMOUR);
  const walled = fightEstimate({ threats: [{ name: 'creeper', distance: 4.4, visible: true, backRoom: 0 }], armour: IRON_ARMOUR, weapon: 'iron_sword', health: 4.8, shield: true });
  assert.equal(walled.mobs[0].fought.goesOffAt, 3);
  assert.equal(walled.fightHere.damageTaken, Math.round(afterArmour(creeperBlast(3), iron) * 10) / 10);
  assert(walled.fightHere.healthAfter < 0, JSON.stringify(walled.fightHere));
  assert.equal(walled.fightHere.inFifteenSeconds, walled.fightHere.damageTaken);
  assert.match(walled.fightHere.creeper, /With the iron sword, the creeper 4 blocks off takes 4 swings, the first about 0\.25 seconds after it lights and one each 0\.7 seconds after: about 2\.35 seconds, longer than the fuse, so it goes off first, about 3 blocks off \(no room to back out\): about 12 after the armour worn, more than the bot has/);
  // A block of room: four blocks off, still more than 4.8.
  const oneBlock = fightEstimate({ threats: [{ name: 'creeper', distance: 4.4, visible: true, backRoom: 1 }], armour: IRON_ARMOUR, weapon: 'iron_sword', health: 4.8 });
  assert(oneBlock.fightHere.damageTaken > 4.8 && oneBlock.fightHere.damageTaken < walled.fightHere.damageTaken, JSON.stringify(oneBlock.fightHere));
  // mid-230-v (23:50:06 and 23:50:13): a diamond sword's three swings take
  // 1.4 seconds after the first, and the first comes a moment after it
  // lights: it went off twice, 4.8 to 1.8 and 1.8 to none.
  const diamond = creeperFought({ weapon: 'diamond_sword', worn: iron, room: 0 });
  assert.equal(diamond.diesFirst, false);
  assert(fightEstimate({ threats: [{ name: 'creeper', distance: 4.6, visible: true, backRoom: 0 }], armour: IRON_ARMOUR, weapon: 'diamond_sword', health: 4.8 }).fightHere.healthAfter < 0);
  // One already struck to 14 dies in two, inside the fuse.
  const struck = fightEstimate({ threats: [{ name: 'creeper', distance: 4.4, visible: true, backRoom: 0, health: 14 }], armour: IRON_ARMOUR, weapon: 'diamond_sword', health: 4.8 });
  assert.equal(struck.mobs[0].fought.diesBeforeItGoesOff, true);
  assert.equal(struck.fightHere.damageTaken, 0);
  assert.match(struck.fightHere.creeper, /\(14 health left\) takes 2 swings.*about 0\.95 seconds, inside the fuse, so held at reach it dies before it goes off/);
  // An axe swings too slowly for that, and bare hands never.
  assert.equal(creeperFought({ weapon: 'diamond_axe', worn: iron, room: 0 }).diesFirst, false);
  assert.equal(creeperFought({ weapon: null, worn: iron, room: 0 }).swings, 20);
  // A zombie beside it still bites while the creeper is met.
  const both = fightEstimate({ threats: [{ name: 'creeper', distance: 4.4, visible: true, backRoom: 0 }, { name: 'zombie', distance: 5, visible: true }], armour: IRON_ARMOUR, weapon: 'iron_sword', health: 20 });
  assert(both.fightHere.damageTaken > walled.fightHere.damageTaken, JSON.stringify(both.fightHere));
});

test('every stance that fights a creeper prices it as the fight does; a stance that builds meets it two blocks off', () => {
  const { stanceCost } = require('../src/combat-estimate');
  const e = fightEstimate({ threats: [{ name: 'creeper', distance: 4.4, visible: true, backRoom: 0 }], armour: IRON_ARMOUR, weapon: 'iron_sword', health: 4.8 });
  // At the doorway (the bunker, one at a time, the creeper among the fought): the fight's blast.
  const door = stanceCost({ mobs: e.mobs, setup: 0, fight: { atOnce: 1, only: m => !m.shoots }, reaches: m => m.name === 'creeper' });
  assert.equal(door.damage, e.fightHere.damageTaken);
  assert.equal(door.blasts[0].at, 3);
  // Killed inside its fuse there, nothing.
  const d = fightEstimate({ threats: [{ name: 'creeper', distance: 4.4, visible: true, backRoom: 0, health: 14 }], armour: IRON_ARMOUR, weapon: 'diamond_sword', health: 4.8 });
  assert.equal(stanceCost({ mobs: d.mobs, fight: { atOnce: 1, only: m => !m.shoots }, reaches: m => m.name === 'creeper' }).damage, 0);
  // Digging, the hands busy: it goes off beside the bot, two blocks off.
  const dig = stanceCost({ mobs: e.mobs, setup: 7, fight: { atOnce: 1, only: m => !m.shoots }, reaches: m => m.name === 'creeper' });
  assert.equal(dig.blasts[0].at, 2);
  assert.equal(dig.damage, e.mobs[0].hitsBot);
});

test('a skeleton is not a quick kill: it backs off after each hit and shoots while it is closed on', () => {
  // Trial 44 was told 2.5 seconds and 1.3 damage; it lost fourteen health in six seconds.
  const e = fightEstimate({ threats: [{ name: 'skeleton', distance: 4.3, shoots: true, visible: true }], weapon: 'stone_sword', health: 9.2 });
  assert(e.fightHere.damageTaken >= 6, JSON.stringify(e.fightHere));
  assert(e.fightHere.healthAfter < 4, 'at nine health it is close to fatal');
});

test('bare hands land two hits a second at most, not four: a zombie takes about fifteen seconds and most of the health', () => {
  // A mob struck is unhurt for half a second after. Told five seconds and
  // five damage, a bare-handed fight looked cheap; the ledge replay of trial
  // 57 lost one in three at about that pace. Twenty-two punches through a
  // zombie's armor of two, one each 0.7 seconds at the pace the bot's
  // fights went (note 550).
  const fight = fightEstimate({ threats: [{ name: 'zombie', distance: 2, shoots: false, visible: true }], weapon: null, health: 20 }).fightHere;
  assert.equal(fight.seconds, 14.7);
  assert(fight.damageTaken >= 12, `took ${fight.damageTaken}`);
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
  // Since note 586 a walker's own way to the bot is walk-reach's to judge, not the charge's: shown with a cave
  // spider, which climbs and which walk-reach does not judge; the zombie on open ground stays a threat.
  const { Survival } = require('../src/survival');
  const { immediateThreat } = require('../src/danger');
  const { Vec3 } = require('vec3');
  const walker = { id: 6, name: 'zombie', position: new Vec3(5, 64, 0), height: 1.95, isValid: true };
  const zombie = { id: 5, name: 'cave_spider', position: new Vec3(5, 64, 0), height: 0.5, isValid: true };
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
  delete bot._recentHurtAt;
  bot.entities = { 6: walker }; bot._unreachable.ids.push(6);
  assert.equal(immediateThreat(bot)?.entity, walker, 'a walker with a way over open ground is one, whatever the charge found');
});

test('a fight held facing a mob that does not come is given up after eight seconds, and the mob is left be', async () => {
  // Trial 73: three minutes facing a creeper that stayed six blocks off. A climber here (a cave spider): a walker's
  // way to the bot is walk-reach's to judge since note 586.
  const { Survival } = require('../src/survival');
  const { immediateThreat } = require('../src/danger');
  const { Vec3 } = require('vec3');
  const creeper = { id: 8, name: 'cave_spider', position: new Vec3(6, 67, 0), height: 0.5, isValid: true };
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

test('a hold\'s eight seconds are its own: the record of one at the same mob half a minute before starts over (mid-208-k-nether-1, note 552)', async () => {
  // The old record read as eight seconds without the hoglin coming nearer the moment a new fight began, and it was left be while it walked up.
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
  survival.state.standing = { id: 8, since: Date.now() - 30000, distance: 6.3, lastAt: Date.now() - 29000 };
  assert.equal(await fight.run(), true, 'a new hold, not the old one\'s thirty seconds');
  assert(Date.now() - survival.state.standing.since < 1000, 'the hold is counted from now');
  assert.equal(immediateThreat(bot)?.entity, creeper, 'still a threat, not left be');
  survival.state.standing.since = Date.now() - 9000;
  assert.equal(await fight.run(), false, 'held on eight seconds of its own without it nearer: the stance failed');
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
  // Less, not a third less: two hits a second at most land on open ground
  // too, where four bite (note 535).
  assert(tunnel.fightHere.damageTaken < open.fightHere.damageTaken, `${tunnel.fightHere.damageTaken} against ${open.fightHere.damageTaken}`);
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
  assert.equal(bare.damage - bare.poison, 30, 'six a potion, one each three seconds, for fifteen seconds');
  // And its poison, from three quarters of a second after the first (note 542).
  assert.equal(bare.poison, Math.round(14.25 * 0.8 * 10) / 10);
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

test('a spear holder jabs from its reach as often while struck, and puts the bot back to close again (mid-244-z)', () => {
  // mid-244-z was told 2.5 seconds and 7.2 damage from 15.4 health; jabbed from 2.5 to 3 blocks about once a second, it went to 2.7 in six.
  const { fightEstimate } = require('../src/combat-estimate');
  const armour = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  const at = held => fightEstimate({ threats: [{ name: 'zombie', distance: 2.1, visible: true, ...(held ? { held } : {}) }], armour, weapon: 'iron_sword', health: 15.4 });
  const bare = at(null), spear = at('iron_spear');
  assert.equal(spear.mobs[0].reach, 3, 'its reach said');
  assert.equal(spear.mobs[0].jab, 2.5, 'five before armour, 2.5 through iron');
  assert.match(spear.mobs[0].note, /from about 3 blocks.*a block back/);
  assert.equal(spear.fightHere.seconds, 2 * bare.fightHere.seconds, 'closed on again after each jab');
  assert(spear.fightHere.damageTaken >= 12, `a jab a second for five seconds: ${spear.fightHere.damageTaken}`);
  assert(spear.fightHere.damageTaken > bare.fightHere.damageTaken * 5, `${spear.fightHere.damageTaken} against ${bare.fightHere.damageTaken}`);
});

test('biters already at arm\'s length are counted however few open cells there are round the bot', () => {
  // mid-235-f in a shaft with three zombies in it was told the fight cost nothing, took it at 0.91 from 5.9 health and was killed (2026-09-27).
  const zombies = [0.4, 1.8, 2.5].map(distance => ({ name: 'zombie', distance, visible: true }));
  const e = fightEstimate({ threats: zombies, armour: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], weapon: 'iron_sword', health: 6, atOnce: 0 });
  assert(e.fightHere.damageTaken > 3, JSON.stringify(e.fightHere));
  assert.equal(e.fightHere.atArmsLengthAtOnce, 3);
});

test('a big magma cube is fought with the mediums and smalls it splits into, each coming when the one before it dies (mid-211-s)', () => {
  const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  const e = fightEstimate({ threats: [{ name: 'magma_cube', distance: 3, visible: true }], armour: iron, weapon: 'iron_sword', health: 20, atOnce: 2 });
  assert.equal(e.mobs.length, 13);
  assert(e.fightHere.seconds > 5, `${e.fightHere.seconds}`);
  assert(e.fightHere.damageTaken > 8, `more than one hit: ${e.fightHere.damageTaken}`);
  assert.doesNotThrow(() => JSON.stringify(e), 'the link to the one it came from is off the record');
  const zombie = fightEstimate({ threats: [{ name: 'zombie', distance: 3, visible: true }], armour: iron, weapon: 'iron_sword', health: 20 });
  assert.equal(zombie.mobs.length, 1);
});

test('a blaze is priced with the burn its fireballs set, not the hit alone (mid-235-p-fortress-2)', () => {
  const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  const e = fightEstimate({ threats: [{ name: 'blaze', distance: 15, visible: true, shoots: true }], armour: iron, weapon: 'iron_sword', health: 20 });
  // At the game's pace (note 602): a volley of three about every 8.9 seconds,
  // each landing about 24 in 100 from 15, a landing about every 12 seconds;
  // alight from each for five, so alight about 34 in 100 of the time.
  assert.equal(e.mobs[0].every, 11.9);
  assert.equal(e.mobs[0].burns, 0.34);
  // The burn counted beside the hits: 2.5 a landing over its eight seconds is 1.7.
  assert(e.fightHere.damageTaken >= 1.7 + 0.34 * 8 - 0.1, `${e.fightHere.damageTaken}`);
});

test('four blazes about burn the bot as one fire, lit more often the more of them there are (note 602)', () => {
  const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  const one = fightEstimate({ threats: [{ name: 'blaze', distance: 10, visible: true, shoots: true }], armour: iron, weapon: 'iron_sword', health: 20 });
  const four = fightEstimate({ threats: [1, 2, 3, 4].map(() => ({ name: 'blaze', distance: 10, visible: true, shoots: true })), armour: iron, weapon: 'iron_sword', health: 20 });
  const { stanceCost } = require('../src/combat-estimate');
  const burnOf = mobs => stanceCost({ mobs: mobs.map(m => ({ ...m, hitsBot: 0 })), seconds: 10, reaches: () => true }).damage;
  const b1 = burnOf(one.mobs), b4 = burnOf(four.mobs);
  assert(b4 > b1 * 2 && b4 <= 10, `one ${b1}, four ${b4}: more than the likeliest one alone, never more than a health a second`);
});

test('a blaze\'s fireball lands by the game\'s scatter: about 46 in 100 at 4 blocks, 24 at 16, 14 at 48, and its volleys mostly land within about twenty-two (notes 509, 513)', () => {
  const { fireballHit, volleyHit, FIRE_REACH, RANGE, FIREBALL, fireballSays } = require('../src/combat-estimate');
  // Blaze$BlazeAttackGoal: triangle(0, 2.297 * sqrt(d) * 0.5) on the aim's x and z; a
  // Monte Carlo of the same (a million shots) gave 45.9, 24.0 and 14.2.
  assert.equal(Math.round(fireballHit(4) * 100), 46);
  assert.equal(Math.round(fireballHit(16) * 100), 24);
  assert.equal(Math.round(fireballHit(48) * 100), 14);
  assert(fireballHit(8) > fireballHit(16) && fireballHit(16) > fireballHit(32), 'fewer land the farther');
  assert.equal(RANGE.blaze, 48, 'it still fires from forty-eight: a fact');
  assert.equal(FIRE_REACH.blaze, 22, 'a volley lands one more often than not to twenty-two');
  assert(volleyHit(22) >= 0.5 && volleyHit(23) < 0.5);
  assert.equal(FIRE_REACH.ghast, 64, 'a ghast is counted to its sixty-four as before (note 513)');
  // Its push, the game's knockback 0.4 through the bot's own physics.
  assert.equal(FIREBALL.knock, 2);
  assert.match(fireballSays(16.5), /^ A blaze's fireball lands about 23 in 100 from 17 blocks, a volley of three at least one about 55 in 100 \(the game scatters its aim wider with distance: about 46 in 100 at 4 blocks, 24 at 16, 14 at 48; a volley about every 9 seconds\); each that lands pushes the bot about 2 blocks, shield raised or not\.$/);
});

test('a wither skeleton withers as it hits: half a health a second through armour while it bites and ten seconds after, and the fight says more than the bot has (mid-235-p-fortress-7, note 528)', () => {
  // Told 13.7 damage from 15.5 against a wither skeleton at arm's length and a piglin's crossbow, the blade alone
  // priced; the bot was at 4.2 six seconds after the skeleton was gone, withering and burning.
  const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  const e = fightEstimate({ threats: [{ name: 'wither_skeleton', distance: 1.3, held: 'stone_sword', visible: true }, { name: 'piglin', distance: 20.3, shoots: true, held: 'crossbow', visible: true }],
    armour: iron, weapon: 'iron_sword', health: 15.5, shield: true, atOnce: 8 });
  assert.equal(e.mobs[0].hitsBot, 4.5, 'eight through full iron');
  assert.equal(e.mobs[0].withers, 0.5);
  assert.match(e.mobs[0].note, /withers the bot for ten seconds/);
  assert(e.fightHere.damageTaken > 15.5, JSON.stringify(e.fightHere));
  // Alone: its 2.7 seconds of blade (four swings at 0.9, the first at once;
  // a third of its hits) and 12.7 seconds withering.
  const alone = fightEstimate({ threats: [{ name: 'wither_skeleton', distance: 1.3, visible: true }], armour: iron, weapon: 'iron_sword', health: 15.5 });
  assert.equal(alone.fightHere.damageTaken, Math.round((2.7 * 4.5 / 3 + 12.7 * 0.5) * 10) / 10);
  // Two at once wither the bot no faster: 16.3 seconds of it, not 29.
  const two = fightEstimate({ threats: [{ name: 'wither_skeleton', distance: 1.3, visible: true }, { name: 'wither_skeleton', distance: 1.5, visible: true }], armour: iron, weapon: 'iron_sword', health: 20 });
  assert(Math.abs(two.fightHere.damageTaken - (2.7 * 4.5 / 3 + 2.7 * 4.5 + 3.6 * 4.5 / 3 + 16.3 * 0.5)) < 0.06, JSON.stringify(two.fightHere));
  // A stance it still reaches withers the bot too.
  const { stanceCost } = require('../src/combat-estimate');
  assert.equal(stanceCost({ mobs: alone.mobs, reaches: () => true }).damage, 15 * 4.5 + 15 * 0.5);
});

test('the wither on the bot is said with its rate and what is left of it (note 528)', () => {
  const { effectsSay } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const id = registry.effectsByName?.wither?.id ?? registry.effectsArray.find(x => /wither/i.test(x.name)).id;
  const bot = { registry, entity: { effects: { [id]: { id, amplifier: 0, duration: 200 } } } };
  assert.match(effectsSay(bot), /The bot is withering, about 10 seconds left: about one health every 2 seconds that armour does not stop, about 5 more before it ends, and it can take the last/);
});

test('a wither skeleton chases at its melee goal\'s 1.2, a spider\'s 3.9 blocks a second, and a run from it says where it meets the bot and the wither meanwhile (note 559)', () => {
  // mid-242-ac-nether-1-fortress-1 ran three times from one, told it would be about 10 blocks behind; it was at the bot again each time.
  const { blocksPerSecond, stanceCost, bodyHeight } = require('../src/combat-estimate');
  const { chaseSays } = require('../src/survival');
  const { Vec3 } = require('vec3');
  assert.equal(Math.round(blocksPerSecond('wither_skeleton') * 10) / 10, 3.9);
  assert.equal(Math.round(blocksPerSecond('skeleton') * 10) / 10, 2.7, 'one with a bow keeps its own speed');
  assert.equal(bodyHeight('wither_skeleton'), 2.4);
  const registry = require('minecraft-data')('26.1');
  const id = registry.effectsByName?.wither?.id ?? registry.effectsArray.find(x => /wither/i.test(x.name)).id;
  const bot = { registry, health: 6.4, entity: { position: new Vec3(0.5, 74, 0.5), effects: { [id]: { id, amplifier: 0, duration: 200 } } } };
  const skeleton = { entity: { id: 1, name: 'wither_skeleton', position: new Vec3(1.5, 74, 0.5) }, distance: 1 };
  const says = chaseSays(bot, [skeleton], { destination: { x: -19, y: 74, z: 0 }, runSeconds: 19 / 5.6 });
  assert.match(says, /the wither skeleton 1 blocks off at about 3\.9 blocks a second: about 7 blocks behind when the run ends, and at the bot about 1\.4 seconds after/);
  assert.match(says, /The wither on the bot runs on meanwhile: about 4 health when the first of them is at the bot again\./);
  // Fought from a pillar's top, the fight meets it as the fight here does: its closing counted.
  const mobs = fightEstimate({ threats: [{ name: 'wither_skeleton', distance: 7.5, shoots: false, visible: true }], armour: [], weapon: 'stone_sword', health: 20 }).mobs;
  const bare = stanceCost({ mobs, setup: 1.5, fight: { only: () => true } }).damage;
  const led = stanceCost({ mobs, setup: 1.5, fight: { only: () => true, lead: true } }).damage;
  assert(led > bare, `${led} > ${bare}`);
});

test('a body hurt half a second ago cannot be hurt again: however many bite, two full hits a second land (note 535)', () => {
  const { stanceCost } = require('../src/combat-estimate');
  const IRON_SET = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  const eight = Array.from({ length: 8 }, (_, i) => ({ name: 'zombie', distance: 1 + i * 0.1, visible: true }));
  const e = fightEstimate({ threats: eight, armour: IRON_SET, weapon: 'iron_sword', health: 20 });
  const hit = e.mobs[0].hitsBot;
  // The first 2.5 seconds: eight biting, summed seven and a third hits a
  // second; at most two land.
  assert(e.fightHere.inFifteenSeconds <= 2 * hit * 15 + 0.01, JSON.stringify(e.fightHere));
  const held = stanceCost({ mobs: e.mobs, reaches: () => true });
  assert.equal(held.damage, Math.round(2 * hit * 15 * 10) / 10, 'eight standing round the bot for fifteen seconds: thirty hits, not a hundred and twenty');
  // The wither is not a hit: it runs beside the capped bites.
  const mobs = fightEstimate({ threats: [{ name: 'wither_skeleton', distance: 1, visible: true }, ...eight], armour: IRON_SET, weapon: 'iron_sword' }).mobs;
  const withered = stanceCost({ mobs, reaches: () => true });
  const blade = mobs.find(m => m.name === 'wither_skeleton').hitsBot;
  assert.equal(withered.damage, Math.round((2 * blade * 15 + 0.5 * 15) * 10) / 10, 'two of the hardest hits a second, and the wither on top');
});

test('two zombies in the bot\'s own cell each bite at full rate while struck: mid-241-aa, told 5.8, took 10.8 in five seconds (note 535)', () => {
  const armour = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  const zombies = inCell => [1.3, 1.6].map(distance => ({ name: 'zombie', distance, visible: true, ...(inCell ? { inCell: true } : {}) }));
  // Out of its cell, the one struck at a third: 1.4 a bite, 1.33 a second
  // for 2.7 seconds, then a third of one for 3.6 (at the pace of note 550;
  // told 5.8 then, at a sword's recharge).
  const then = fightEstimate({ threats: zombies(false), armour, weapon: 'iron_sword', health: 10.8, atOnce: 2 });
  assert.equal(then.fightHere.damageTaken, 6.7);
  const now = fightEstimate({ threats: zombies(true), armour, weapon: 'iron_sword', health: 10.8, atOnce: 2 });
  // Two a second for 2.7 seconds, then one for 3.6: more than the bot had.
  assert.equal(now.fightHere.damageTaken, 12.6);
  assert(now.fightHere.healthAfter < 0);
  assert(now.mobs.every(m => m.inCell));
});

// mid-243-f, "slain by Cave Spider" at y 39 by a cave spider spawner (note 542).
const IRON_KIT = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
test('a cave spider\'s bite poisons: priced a point each 1.25 seconds through armour, and only down to 1 (mid-243-f, told 0.4 at 6.1 health, note 542)', () => {
  const { POISON, stanceCost } = require('../src/combat-estimate');
  assert.equal(POISON.perSecond, 0.8, 'one health every twenty-five ticks');
  const spider = [{ name: 'cave_spider', distance: 5, visible: true }];
  // As asked at 00:50:48.4: one cave spider in view, the poison of a bite
  // 2.4 seconds before on the bot. Told 1.3 seconds and 0.4 damage.
  const e = fightEstimate({ threats: spider, armour: IRON_KIT, weapon: 'iron_sword', health: 6.1, poisonedFor: 4.6 });
  assert.equal(e.mobs[0].poisons, 7, 'seven seconds on Normal');
  // The bites: 0.18 of 0.9 a second for the 2.4 seconds closing on it five
  // blocks off, then a third of 0.9 a second for its second swing's 0.9
  // (note 550); the poison to seven seconds past the kill, floored at 1:
  // 5.1 of it.
  assert.equal(e.fightHere.damageTaken, 5.8, JSON.stringify(e.fightHere));
  assert.equal(e.fightHere.healthAfter, 0.3);
  assert.match(e.fightHere.poison, /^About 5\.1 of it is poison: the poison on the bot now has about 4\.6 seconds left, and each cave spider bite that lands poisons the bot \(cave spider 7 seconds, renewed by the next\); one health every 1\.25 seconds that armour does not stop, however many poison it, and only while health is above 1/);
  // At full health the same fight's poison is whole: one bite at the
  // start and one at the kill, 0.75 to 10.3 seconds.
  const whole = fightEstimate({ threats: spider, armour: IRON_KIT, weapon: 'iron_sword', health: 20 });
  assert.equal(whole.fightHere.damageTaken, Math.round((2.4 * 0.9 * 0.18 + 0.9 * 0.9 / 3 + 9.55 * 0.8) * 10) / 10);
  // Two poison the bot no faster than one: one poison, renewed.
  const one = stanceCost({ mobs: whole.mobs, reaches: () => true });
  const two = stanceCost({ mobs: fightEstimate({ threats: [...spider, { name: 'cave_spider', distance: 5.5, visible: true }], armour: IRON_KIT, weapon: 'iron_sword' }).mobs, reaches: () => true });
  // From its first bite on arriving (5 blocks, less the reach, at its own
  // chase speed, a spider's 3.9 a second: note 576), three quarters of a
  // second on.
  const v = require('../src/combat-estimate').blocksPerSecond('cave_spider');
  assert.equal(one.poison, Math.round((15 - 3.5 / v - 0.75) * 0.8 * 10) / 10);
  assert.equal(two.poison, one.poison);
  // Its first bite lands as it arrives, 0.13 seconds after the first
  // spider's: within the half second a body struck cannot be hurt again by
  // a blow no bigger, so that much of it is lost (note 587).
  assert.ok(Math.abs((two.damage - one.damage) - ((15 - 4 / v) * 0.9 - 2 * 0.9 * (3.5 / v + 0.5 - 4 / v))) <= 0.1, 'the second adds its bites alone, from its arrival');
  // Floored at 1 where the health is given: the poison alone never kills.
  const low = stanceCost({ mobs: whole.mobs, reaches: () => true, health: 3 });
  assert.equal(low.damage, Math.round(((15 - 3.5 / v) * 0.9 + 2) * 10) / 10);
});

test('a stance a poisoner or a wither skeleton reaches while it builds keeps the effect past the reach (note 542)', () => {
  const { stanceCost } = require('../src/combat-estimate');
  // Shut in after 3.6 seconds of building with a cave spider at arm's
  // length: its bites while the blocks go down, and its poison for seven
  // seconds after the last.
  const spider = fightEstimate({ threats: [{ name: 'cave_spider', distance: 1, visible: true }], armour: IRON_KIT, weapon: 'iron_sword' }).mobs;
  const seal = stanceCost({ mobs: spider, setup: 3.6 });
  assert.equal(seal.poison, Math.round((3.6 + 7 - 0.75) * 0.8 * 10) / 10, JSON.stringify(seal));
  // A wither skeleton's wither runs ten seconds past its last hit, where it
  // stopped with the hits.
  const wither = fightEstimate({ threats: [{ name: 'wither_skeleton', distance: 1, visible: true }], armour: IRON_KIT, weapon: 'iron_sword' }).mobs;
  const pillar = stanceCost({ mobs: wither, setup: 1.5 });
  assert.equal(pillar.damage, Math.round((1.5 * 4.5 + 11.5 * 0.5) * 10) / 10);
  // The poison already on the bot runs in every stance, whatever reaches.
  const running = fightEstimate({ threats: [{ name: 'zombie', distance: 10, visible: true }], armour: IRON_KIT, weapon: 'iron_sword', poisonedFor: 5 }).mobs;
  assert.equal(stanceCost({ mobs: running, setup: 0 }).poison, 4);
});

test('the poison on the bot is said with what is left of it now, its rate and that it stops at 1 (mid-243-f, note 542)', () => {
  const { effectsSay } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const id = registry.effectsByName?.poison?.id ?? registry.effectsArray.find(x => /poison/i.test(x.name)).id;
  // Seven seconds sent 2.4 seconds ago: "about 7 seconds left" was said.
  const bot = { registry, health: 6.07, entity: { effects: { [id]: { id, amplifier: 0, duration: 140, at: Date.now() - 2400 } } } };
  const says = effectsSay(bot);
  assert.match(says, /The bot is poisoned, about 5 seconds left: one health every 1\.25 seconds that armour does not stop, about 3 more before it ends, whatever is chosen; it takes a point only while health is above 1, so on its own it leaves the bot at 1 or just under and never kills, but a bite, a hit or a harming potion after it does/);
  assert.match(says, /a point each four seconds does not keep up/);
  const { healingSays } = require('../src/healing');
  const h = healingSays({ ...bot, food: 18, game: { gameMode: 'survival' }, inventory: { items: () => [] } }, null);
  assert.match(h.poison, /^poisoned, about 5 seconds left: one health each 1\.25 seconds that armour does not stop, about 3 more before it ends, three times as fast as health comes back here/);
});

test('a fight among cave spiders counts the ones round the corner and names the spawner making them (mid-243-f, note 542)', () => {
  const { Survival } = require('../src/survival');
  const { threats } = require('../src/danger');
  const { Vec3 } = require('vec3');
  const registry = require('minecraft-data')('26.1');
  const spider = (id, x, z) => ({ id, name: 'cave_spider', position: new Vec3(x, 64, z), height: 0.5, width: 0.7, isValid: true });
  const entities = { 1: spider(1, 5.5, 0.5), 2: spider(2, 0.5, 6.1), 3: spider(3, 0.5, 6.3), 4: { id: 4, name: 'skeleton', position: new Vec3(-7.5, 64, 0.5), height: 1.99, isValid: true } };
  const spawnerAt = new Vec3(-2, 64, -6);
  const bot = { registry, entity: { position: new Vec3(0.5, 64, 0.5), effects: {} }, entities, time: { timeOfDay: 18000 }, game: { dimension: 'overworld' },
    // Rock toward +z and -x: the two spiders there and the skeleton are out of sight.
    world: { raycast: (from, dir) => dir.z > 0.5 || dir.x < -0.5 ? { position: from.offset(dir.x, 0, dir.z).floored(), intersect: from.offset(dir.x, 0, dir.z) } : null },
    blockAt: p => p.equals(spawnerAt) ? { name: 'spawner', boundingBox: 'block', position: p, blockEntity: { SpawnData: { entity: { id: 'minecraft:cave_spider' } } } }
      : { name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p },
    findBlocks: () => [spawnerAt],
    pathfinder: { movements: {} }, inventory: { items: () => [{ name: 'iron_sword' }], slots: [] }, on() {}, health: 6.1 };
  const survival = new Survival(bot, {});
  const danger = threats(bot).filter(t => t.visible);
  assert.deepEqual(danger.map(t => t.entity.id), [1], 'one in view, as the question had it');
  const options = survival.stanceOptions({ check() {} }, {}, () => {}, danger, false);
  const fight = options.fight.description;
  assert.match(fight, /Counted in the figures though out of sight, each with a way to the bot: a cave spider 6 blocks off, a cave spider 6 blocks off\./);
  assert.match(fight, /Out of sight but about: a skeleton 8 blocks off/, 'the skeleton, a shooter out of sight, is said and not counted');
  // "Them all" said of the ones in the figures, the skeleton left out named (note 614).
  const damage = Number(fight.match(/seconds and ([\d.]+) damage to kill the 3 in these figures, not those out of sight below/)[1]);
  assert(damage > 5, fight);
  assert.match(fight, /of it is poison/);
  // Said with every stance (stanceStep), with the mob it makes.
  const { spawnerAbout } = require('../src/survival');
  assert.match(spawnerAbout(bot).says, /^ A cave spider spawner is 7 blocks off: while a player is within 16 blocks of it, it makes more cave spiders, up to four at a time/);
  assert.equal(spawnerAbout(bot).mob, 'cave_spider');
});

test('the fire on the bot is priced, one health a second for its seconds left, and one fire however many blazes light it (mid-208-k, note 548)', () => {
  // mid-208-k was asked its stance at 5.9 health alight, the fire in no figure, and burned the rest.
  const { within, burnLeft, FIRE_SECONDS } = require('../src/combat-estimate');
  const zombie = burningFor => fightEstimate({ threats: [{ name: 'zombie', distance: 3, shoots: false, visible: true }], weapon: 'iron_sword', health: 20, burningFor }).fightHere;
  const cold = zombie(0), alight = zombie(5);
  assert.equal(Math.round((alight.damageTaken - cold.damageTaken) * 10) / 10, 5, 'five seconds of fire left: five more');
  assert.match(alight.fire, /^The bot is alight: about 5 seconds of fire left, 1 health a second that armour does not stop/);
  // Four blazes' fireballs each light it: one fire, burning one a second, not four.
  const burn = { from: 0, to: 10, perSecond: 1, effect: 'burn' };
  assert.equal(within([burn, { ...burn }, { ...burn }, { ...burn }], 15), 10);
  assert.equal(within([burn, { ...burn, from: 5, to: 20 }], 15), 15, 'overlapping, the longer runs on');
  // What is left: from the hurt that lit it, while the game says it burns.
  const now = Date.now();
  assert.equal(burnLeft({ entity: { metadata: [1] }, _alightUntil: now + FIRE_SECONDS.lava * 1000 }, now), 15);
  assert.equal(burnLeft({ entity: { metadata: [0] }, _alightUntil: now + 9000 }, now), 0, 'put out');
  assert.equal(burnLeft({ entity: { metadata: [1] } }, now), 1, 'alight with nothing stamped: the second to come');
});

// mid-235-p-nether-4 (25590, 2026-09-28 01:17:35): full iron, an iron
// sword and a shield at 20 health, a wither skeleton 7.1 blocks off. The
// fight was told "about 2.5 seconds and 10 damage to kill them all" (four
// swings at the sword's recharge); the charge ran for four seconds with the
// skeleton at 0.9 to 1.8 blocks and nothing swung, three hits took 20 to
// 6.6, two criticals did not kill it, and the bot was dead six seconds in.
// fortress-2 (25585, 01:30:30) went the same way (note 550).
test('the kill is priced at the pace the bot\'s own fights went, the closing first: a wither skeleton seven blocks off (mid-235-p-nether-4, note 550)', () => {
  const { PACE, swingEvery, leadFor } = require('../src/combat-estimate');
  assert.equal(swingEvery('iron_sword'), 0.9, 'a sword\'s 0.7 and about 0.2 of jumps, knockback walked back and misses');
  assert.equal(swingEvery(null), 0.7);
  assert.equal(leadFor(3), 0);
  assert.equal(leadFor(7.1), Math.round((7.1 - PACE.closeFrom) * PACE.closePerBlock * 10) / 10);
  const e = fightEstimate({ threats: [{ name: 'wither_skeleton', distance: 7.1, held: 'stone_sword', visible: true }], armour: IRON, weapon: 'iron_sword', health: 20, shield: true, atOnce: 8 });
  assert.equal(e.mobs[0].swingsToKill, 4);
  assert.equal(e.mobs[0].secondsASwing, 0.9);
  assert.equal(e.fightHere.closingFirst, 5.8);
  // 5.8 closing, then four swings, the first at once: 8.5 seconds, not 2.5.
  assert.equal(e.fightHere.seconds, 8.5);
  assert(e.fightHere.damageTaken > 15, `nearly all of the twenty: ${e.fightHere.damageTaken}`);
  assert.match(e.fightHere.pace, /^With the iron sword, about 4 swings that land: the wither skeleton 4 \(20 health, 6 a swing\)\. In the bot's own fights so far one came about every 0\.9 seconds, not the 0\.63 of the weapon's recharge: the jump for a critical, the knockback walked back and the misses\. Closing on the wither skeleton 7 blocks off came first: about 5\.8 seconds before the first swing/);
  // At reach there is no closing: the first swing at once, then one each 0.9.
  const near = fightEstimate({ threats: [{ name: 'wither_skeleton', distance: 1.5, visible: true }], armour: IRON, weapon: 'iron_sword', health: 20, shield: true });
  assert.equal(near.fightHere.seconds, 2.7);
  assert.equal(near.fightHere.closingFirst, undefined);
  assert.doesNotMatch(near.fightHere.pace, /Closing/);
});

test('a zombie\'s armor takes from the bot\'s swings as the bot\'s takes from its bite, and the healths are the 26.1 jar\'s (note 550)', () => {
  const { MOBS, WEAPONS } = require('../src/combat-estimate');
  // Zombie.createAttributes: armor 2, kept by the husk, the drowned, the
  // zombie villager and the zombified piglin. A stone sword's five is 4.9.
  for (const name of ['zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin']) assert.equal(MOBS[name].armor, 2, name);
  const stone = fightEstimate({ threats: [{ name: 'zombie', distance: 2, visible: true }], weapon: 'stone_sword' }).mobs[0];
  assert.equal(stone.swingsToKill, 5, 'five swings of a stone sword, not four');
  assert.equal(stone.eachSwing, 4.9);
  assert.equal(fightEstimate({ threats: [{ name: 'skeleton', distance: 2, visible: true, shoots: true }], weapon: 'stone_sword' }).mobs[0].swingsToKill, 4, 'a skeleton wears none');
  // Healths set in createAttributes (the rest keep the default twenty).
  assert.deepEqual(['zombie', 'skeleton', 'wither_skeleton', 'creeper', 'blaze', 'spider', 'bogged', 'parched', 'piglin', 'hoglin', 'enderman', 'witch'].map(n => MOBS[n].health), [20, 20, 20, 20, 20, 16, 16, 16, 16, 40, 40, 26]);
  // A sword is one, plus three, plus its material's bonus (ToolMaterial;
  // Items: sword(material, 3.0, -2.4)), at 1.6 swings a second.
  assert.deepEqual(['wooden_sword', 'golden_sword', 'stone_sword', 'copper_sword', 'iron_sword', 'diamond_sword', 'netherite_sword'].map(w => WEAPONS[w]), [[4, 1.6], [4, 1.6], [5, 1.6], [5, 1.6], [6, 1.6], [7, 1.6], [8, 1.6]]);
});

test('the fight option says the pace and the closing with its figures (note 550)', () => {
  const { Survival } = require('../src/survival');
  const { Vec3 } = require('vec3');
  const zombie = { id: 6, name: 'zombie', position: new Vec3(5.5, 64, 0.5), height: 1.95, isValid: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 6: zombie }, time: { timeOfDay: 18000 }, game: { dimension: 'overworld' },
    world: { raycast: () => null }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }),
    pathfinder: { movements: {} }, inventory: { items: () => [{ name: 'iron_sword' }], slots: [] }, on() {}, health: 20 };
  const survival = new Survival(bot, {});
  const fight = survival.stanceOptions({ check() {} }, {}, () => {}, [{ entity: zombie, distance: 5, visible: true }], false).fight.description;
  assert.match(fight, /to kill them all, from 20 health; about [\d.]+ of it in the first fifteen seconds\. With the iron sword, about 4 swings that land: the zombie 4 \(20 health, 5\.9 a swing through its armor\)\. In the bot's own fights so far one came about every 0\.9 seconds/);
  assert.match(fight, /Closing on the zombie 5 blocks off came first: about 2\.4 seconds before the first swing/);
});
