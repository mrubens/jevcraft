'use strict';
// Note 576: mid-242-ae-nether-1, "slain by Piglin Brute" at 04:06:32 in a
// bastion, in an iron helmet and chestplate at 20 health. The stance was
// asked five times in twenty seconds; the last took rail_and_fight at 0.66
// with the brute 6.9 blocks off. The rail said its 2.4 seconds of walling
// with "anything at reach hitting freely meanwhile" and no figure; nothing
// said that two of the brute's blows (12.2 each through that armour) were
// the bot's twenty; the retreat said "no way out" (every mob about kept
// clear of, eighteen piglins within twenty-four) and the way off the
// brute's ground was never offered. The brute was at the bot in about a
// second and struck twice.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { fightEstimate, stanceCost, blocksPerSecond, GIVES_UP } = require('../src/combat-estimate');

const WORN = ['iron_helmet', 'iron_chestplate'];
const brute = (x, z = 0.5) => ({ id: 7, name: 'piglin_brute', type: 'hostile', position: new Vec3(x, 74, z), height: 1.95, isValid: true, heldItem: { name: 'golden_axe' } });
// A ledge one wide along z 0 at y 73 over the lava sea (lava at y 30 and
// under), as mid-211-s-nether-2's: no ground three from a drop within
// sixteen, so the rail is on offer and the step to ground is not.
const ledgeBot = ({ entity, items = [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 16 }], placed = new Set() } = {}) => {
  const solid = p => placed.has(`${p}`) || (p.y === 73 && p.z === 0 && p.x > -30 && p.x <= 5);
  return Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { [entity.id]: entity }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 74, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => items, emptySlotCount: () => 10, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } } },
    blockAt: p => ({ position: p, name: solid(p) ? 'netherrack' : p.y <= 30 ? 'lava' : 'air', boundingBox: solid(p) ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
};
const threat = (bot, entity) => ({ entity, distance: entity.position.distanceTo(bot.entity.position), visible: true });

test('a biter comes on at its own chase speed in every stance\'s price: a piglin brute 6.9 blocks off is at the bot inside a rail\'s walling', () => {
  const mobs = fightEstimate({ threats: [{ name: 'piglin_brute', distance: 6.9, visible: true }], armour: WORN, weapon: 'iron_sword' }).mobs;
  assert.equal(mobs[0].hitsBot, 12.2, 'thirteen through an iron helmet and chestplate');
  assert.ok(blocksPerSecond('piglin_brute') > 5, 'near a sprint');
  // 2.4 seconds of walling: at the old three blocks a second it came at
  // 1.8 seconds and was priced at 7.3, less than one blow; at its own 5.3
  // it is there at about 1 second, and more than one blow lands.
  const rail = stanceCost({ mobs, setup: 2.4 });
  assert.ok(rail.damage > 12.2, JSON.stringify(rail));
});

test('the rail, the step to ground and the fight each price the brute\'s melee, and the two blows that end the bot lead every stance (mid-242-ae-nether-1)', () => {
  const entity = brute(-6.4);
  const bot = ledgeBot({ entity });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [threat(bot, entity)], false);
  assert.ok(options.rail_and_fight, Object.keys(options).join(','));
  const lead = /^The piglin brute 7 blocks off hits for about 12\.2 a blow through the armour worn \(13 before it\), a blow a second at arm's length: 2 blows end the bot from 20 health, and at its own speed \(about 5\.3 blocks a second\) it can be at arm's length in about 1 second\. /;
  for (const [k, o] of Object.entries(options)) assert.match(o.description, lead, k);
  // The rail was the one fighting stance with no figure: now its walling
  // and the fight after it, from 20 health, and expected of it when held.
  const rail = options.rail_and_fight;
  assert.ok(rail.expects && rail.expects.damage >= 20, JSON.stringify(rail.expects));
  assert.match(rail.description, /About [\d.]+ damage from the mobs here in the next fifteen seconds this way, the 2\.4 seconds of walling included, from 20 health \(more than the bot has\)\. Walled, the piglin brute still reaches it\./);
});

test('stepping to firm ground is priced with the step and the fight there', () => {
  const entity = brute(-6.4);
  // Ground from x -10 back along a one-wide span; the brute on the span.
  const solid = p => p.y < 74 && p.y > 30 && (p.x <= -10 || (p.z === 0 && p.x <= 5 && p.y === 73));
  const bot = Object.assign(ledgeBot({ entity }), { blockAt: p => ({ position: p, name: solid(p) ? 'netherrack' : p.y <= 30 ? 'lava' : 'air', boundingBox: solid(p) ? 'block' : 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const option = survival.stanceOptions(new Task('t'), {}, () => {}, [threat(bot, entity)], false).fight_from_footing;
  assert.ok(option);
  assert.ok(option.expects && option.expects.damage >= 20, JSON.stringify(option.expects));
  assert.match(option.description, /About [\d.]+ damage from the mobs here in the next fifteen seconds this way, the \d+ seconds of stepping there included, from 20 health \(more than the bot has\)\. There, the piglin brute still reaches it\./);
});

test('with no run past every mob, the way past the brute\'s reach is offered, with the shots on it and how a brute gives up and goes home to its bastion', async () => {
  const entity = brute(-6.4);
  const bot = ledgeBot({ entity });
  const went = [];
  const survival = new Survival(bot, { navigate: async (b, t, goal) => { went.push({ x: goal.x, y: goal.y, z: goal.z }); } }, { state: { shelters: [] } });
  const feet = `${bot.entity.position.floored()}`;
  // As the scout leaves it: no run passing every mob, a way past the
  // brute's twelve found 18 blocks east along the ledge.
  const scout = () => ({ at: Date.now(), feet, radius: 20, spots: 3, tried: 3, candidates: 3,
    pastReach: { destination: { x: 18, y: 74, z: 0 }, blocks: 18, from: [{ id: 7, name: 'piglin_brute', blocks: 24, follows: 12 }] } });
  survival.state.retreatScout = scout();
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [threat(bot, entity)], false);
  assert.ok(options.leave_reach, Object.keys(options).join(','));
  assert.match(options.retreat.description, /No way out/);
  const o = options.leave_reach;
  assert.match(o.description, /Run past the reach of what bites, taking the shooters' fire on the way: 18 blocks to footing 24 from the piglin brute \(it follows a player to 12\), nearer the bot than any of them, by a route that passes none of those that bite \(the shooters are not kept clear of\), about 3\.2 seconds at a run\./);
  assert.match(o.description, /the piglin brute 7 blocks off at about 5\.3 blocks a second/);
  assert.ok(o.description.includes(`By the game's rule, ${GIVES_UP.piglin_brute}.`));
  assert.match(GIVES_UP.piglin_brute, /within 12 blocks of it and in its sight .* walks back to the spot in its bastion it was made at; brutes come only with a bastion/);
  assert.ok(o.expects);
  // Chosen, it runs to the way found.
  survival.state.retreatScout = scout();
  assert.equal(await o.run(), true);
  assert.deepEqual(went, [{ x: 18, y: 74, z: 0 }]);
  // No such way found: not offered.
  survival.state.retreatScout = { ...scout(), pastReach: undefined };
  assert.equal(survival.stanceOptions(new Task('t'), {}, () => {}, [threat(bot, entity)], false).leave_reach, undefined);
});

test('footing past the reach is further from each biter than it follows, nearer the bot than any, and a bastion\'s floor counts', () => {
  const entity = brute(-6.4);
  const bot = ledgeBot({ entity });
  const ids = [];
  const reg = bot.registry;
  // Bastion bricks east and west along z 0; only the east ones are past
  // the brute's reach and nearer the bot than it.
  bot.findBlocks = ({ matching }) => { ids.push(...matching); return [-20, -3, 3, 8, 12, 16].map(x => new Vec3(x, 73, 0)); };
  bot.blockAt = p => ({ position: p, name: p.y === 73 ? 'polished_blackstone_bricks' : p.y <= 30 ? 'lava' : 'air', boundingBox: p.y === 73 ? 'block' : 'empty' });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const found = survival.reachFootings([threat(bot, entity)]);
  assert.ok(ids.includes(reg.blocksByName.polished_blackstone_bricks.id), 'a bastion\'s floor is footing');
  assert.deepEqual(found.candidates.map(p => p.x), [8, 12, 16], 'at least 14 from the brute, and the bot there first');
  // A shooter alone is not a biter: nothing to get past.
  const piglin = { id: 8, name: 'piglin', type: 'hostile', position: new Vec3(-6.4, 74, 0.5), height: 1.95, isValid: true, heldItem: { name: 'crossbow' } };
  assert.equal(survival.reachFootings([threat(bot, piglin)]), null);
});
