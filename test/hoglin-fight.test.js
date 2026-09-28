'use strict';
// Note 587: two hoglin deaths. mid-208-k-nether-4-fortress-1 (25589),
// "shot by Piglin" at 04:46:00 after a minute between hoglins at 1.6 to 2.8
// health: fight and eat taken in turn with a hoglin two blocks off, every
// stance opening "hits for about 3.4 a blow ... (6 before it), a blow a
// second at arm's length: 5 blows end the bot from 13.9 health", where in
// that iron a hoglin's blow is 1.5 to 4.8 and three did; the meal with a
// hoglin at the bot 0.7 seconds before its end priced 2.3. And
// mid-208-k-nether-1 (25587), bitten to death at 01:30:01 while it ate at
// 4 health, its hoglin's blows 01:29:28.6, 30.6, 32.8, 34.9 and 36.9, two
// seconds apart as the jar has it (MeleeAttack.create(40)), while it was
// being struck. Neither was offered the warped fungus: hoglins shun the
// block within eight across and four up or down (HoglinSpecificSensor),
// and only the block, never the item held.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { fightEstimate, fightTimeline, stanceCost, MOBS } = require('../src/combat-estimate');

// As worn in both: iron helmet, chestplate and leggings, golden boots (14 points).
const WORN = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'];
const slots = () => ({ 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'golden_boots' }, 45: { name: 'shield' } });
const hoglin = (id, x, z = 0.5, name = 'hoglin') => ({ id, name, type: 'animal', position: new Vec3(x, 47, z), height: 1.4, width: 1.4, isValid: true });
// A floor at y 46 of `ground` (netherrack where nothing is said), open
// above; `blocks` the blocks set down (key "x,y,z" -> name).
const floorBot = ({ entities = [], items = [], ground = () => 'netherrack', blocks = new Map(), health = 13.9 } = {}) => {
  const registry = require('minecraft-data')('26.1');
  const nameAt = p => blocks.get(`${p.x},${p.y},${p.z}`) || (p.y === 46 ? ground(p) : p.y < 46 ? 'netherrack' : 'air');
  const solid = n => !['air', 'warped_fungus'].includes(n);
  return Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, registry, health, food: 14,
    entities: Object.fromEntries(entities.map(e => [e.id, e])), time: { timeOfDay: 6000 }, oxygenLevel: 20,
    entity: { position: new Vec3(0.5, 47, 0.5), onGround: true, velocity: new Vec3(0, 0, 0), eyeHeight: 1.62 },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, ...items], emptySlotCount: () => 10, slots: slots() },
    blockAt: p => { const name = nameAt(p); return { position: p, name, boundingBox: solid(name) ? 'block' : 'empty' }; },
    findBlocks: ({ point, matching, maxDistance }) => [...blocks.entries()].filter(([, n]) => [].concat(matching).includes(registry.blocksByName[n]?.id))
      .map(([k]) => new Vec3(...k.split(',').map(Number))).filter(p => p.distanceTo(point) <= maxDistance),
    world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
};
const threat = (bot, entity) => ({ entity, distance: entity.position.distanceTo(bot.entity.position), visible: true });

test('a hoglin\'s blow is three to eight before armour and comes every two seconds, struck or not (26.1.2 jar)', () => {
  assert.equal(MOBS.hoglin.least, 3); assert.equal(MOBS.hoglin.most, 8); assert.equal(MOBS.hoglin.blowEvery, 2);
  const [m] = fightEstimate({ threats: [{ name: 'hoglin', distance: 1, visible: true }], armour: WORN, weapon: 'iron_sword' }).mobs;
  // Through fourteen points: 1.5 at the least, 4.8 at the hardest, the
  // hardest being what mid-208-k-nether-4-fortress-1 took at 04:45:11.5
  // and 04:45:14.6 (11.2 to 6.4, 6.4 to 1.6).
  assert.equal(m.hitsBotLeast, 1.5); assert.equal(m.hitsBotMost, 4.8); assert.equal(m.hitsBot, 3);
  // The one struck lands its every blow (its knockback resistance), one
  // every two seconds; the next at two seconds too, not a blow a second.
  const two = fightEstimate({ threats: [{ name: 'hoglin', distance: 1, visible: true }, { name: 'hoglin', distance: 1.2, visible: true }], armour: WORN, weapon: 'iron_sword' }).mobs;
  const pieces = fightTimeline(two).filter(p => p.hit > 0 && p.from === 0);
  assert.deepEqual(pieces.map(p => p.perSecond), [1.5, 1.5]);
});

test('every stance opens with the hoglin\'s blow from its least to its hardest, its two seconds, and the blows that end the bot at the hardest (mid-208-k-nether-4-fortress-1, 04:45:06)', () => {
  const entity = hoglin(210, 7);
  const bot = floorBot({ entities: [entity] });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [threat(bot, entity)], false);
  const lead = /^The hoglin 7 blocks off hits for 1\.5 to 4\.8 a blow through the armour worn, about 3 on the average \(3 to 8 before it\), a blow every 2 seconds at arm's length: 3 blows at their hardest end the bot from 13\.9 health \(5 on the average\), and at its own speed \(about 3\.9 blocks a second\) it can be at arm's length in about 1\.3 seconds\. /;
  assert.ok(options.fight);
  for (const [k, o] of Object.entries(options)) if (k !== 'none_good') assert.match(o.description, lead, k);
  assert.match(options.fight.description, /from the hoglin \(about 3 each after armour, up to 4\.8: 3 at the hardest\) end it/);
});

test('a hoglin that comes during the meal lands its first blow whole: the recorded 04:45:43 meal, priced 2.3, is a blow', () => {
  // Asked at 1.6 health, the hoglin 5.08 blocks off: at the bot in 0.9
  // seconds of the meal's 1.6.
  const mobs = fightEstimate({ threats: [{ name: 'hoglin', distance: 5.08, visible: true }], armour: WORN, weapon: 'iron_sword', health: 1.6 }).mobs;
  const meal = stanceCost({ mobs, setup: 1.6, seconds: 1.6 });
  assert.equal(meal.damage, mobs[0].hitsBot, 'one whole blow, not 0.7 seconds of a steady rate');
  // One that is at the bot already is priced at its pace: where in its two
  // seconds the next blow falls is not known.
  const near = fightEstimate({ threats: [{ name: 'hoglin', distance: 1, visible: true }], armour: WORN, weapon: 'iron_sword' }).mobs;
  assert.equal(stanceCost({ mobs: near, setup: 1.6, seconds: 1.6 }).damage, Math.round(1.6 * near[0].hitsBot / 2 * 10) / 10);
  // The meal's own option, at 1.6 health.
  const entity = hoglin(210, 5.58);
  const bot = floorBot({ entities: [entity], items: [{ name: 'porkchop', count: 1 }], health: 1.6 });
  bot.food = 19;
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  const eat = survival.stanceOptions(new Task('t'), {}, () => {}, [threat(bot, entity)], false).eat;
  assert.ok(eat);
  assert.match(eat.description, /About 3 damage from the mobs here while it eats, from 1\.6 health \(more than the bot has\)\./);
});

test('a hoglin within eight across and four up or down of a warped fungus block is no threat; the item carried does nothing, and a zoglin shuns nothing', () => {
  const { hostileEntities } = require('../src/danger');
  const h = hoglin(210, 3.5), far = hoglin(211, 0.5, 12.5), z = hoglin(212, -3.5, 0.5, 'zoglin');
  const blocks = new Map();
  const bot = floorBot({ entities: [h, far, z], items: [{ name: 'warped_fungus', count: 2 }], ground: () => 'crimson_nylium', blocks });
  const names = () => hostileEntities(bot, 24).map(e => e.id).sort();
  // Carried, the fungus keeps off nothing.
  assert.deepEqual(names(), [210, 211, 212]);
  // Set down two east of the bot: the hoglin 1.5 from it is calmed, the
  // one 12 across from it is not, and the zoglin is not.
  blocks.set('2,47,0', 'warped_fungus'); bot._repellentCache = null;
  assert.deepEqual(names(), [211, 212]);
  // A nether portal's block does the same.
  blocks.delete('2,47,0'); blocks.set('0,51,12', 'nether_portal'); bot._repellentCache = null;
  assert.deepEqual(names(), [210, 212]);
  // Five up is out of its box.
  blocks.delete('0,51,12'); blocks.set('3,53,0', 'warped_fungus'); bot._repellentCache = null;
  assert.deepEqual(names(), [210, 211, 212]);
});

test('with a warped fungus carried and a hoglin coming, setting it down is offered with the rule, where it goes and its price; on netherrack only with ground carried to lay first', async () => {
  const entity = hoglin(210, 5.58);
  // On crimson nylium, where hoglins live: one block.
  const placed = [];
  const blocks = new Map();
  const bot = floorBot({ entities: [entity], items: [{ name: 'warped_fungus', count: 1 }], ground: () => 'crimson_nylium', blocks, health: 1.6 });
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, t, p, item) => { placed.push({ p: `${p}`, item }); blocks.set(`${p.x},${p.y},${p.z}`, item); } }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [threat(bot, entity)], false);
  const fungus = options.warped_fungus;
  assert.ok(fungus, Object.keys(options).join(','));
  assert.match(fungus.description, /Set a warped fungus down at -?\d+, 47, -?\d+, [\d.]+ blocks off, on the crimson nylium there \(1 carried\), against the hoglin 5 blocks off: about 0\.6 seconds placing one block, the shield down, and about 1 second more before the hoglins notice it; then stay by it\./);
  assert.match(fungus.description, /within 8 blocks of it across and 4 up or down, a hoglin drops its target and attacks nothing for 10 seconds/);
  assert.match(fungus.description, /Held in the hand or carried, a warped fungus does nothing: only the block counts/);
  assert.match(fungus.description, /not on netherrack, soul sand, blackstone or basalt/);
  // Priced with the hoglin's first blow while it is set down (at the bot in
  // 0.9 seconds, noticed at 1.6), and none after.
  assert.equal(fungus.expects.damage, 3);
  assert.ok(fungus.expects.damage < options.fight.expects?.damage || /more than the bot has/.test(options.fight.description));
  // Run: the fungus goes down on the nylium, and the stance holds by it.
  survival.state.stance = { choice: 'warped_fungus', at: Date.now() };
  assert.equal(await fungus.run(), true);
  assert.equal(placed.length, 1); assert.equal(placed[0].item, 'warped_fungus');
  assert.ok(survival.state.stance.fungus);
  bot._repellentCache = null;
  assert.deepEqual(require('../src/danger').hostileEntities(bot, 24), [], 'the hoglin is calmed by the block set down');
  // On netherrack with nothing to lay under it: not offered.
  const bare = floorBot({ entities: [entity], items: [{ name: 'warped_fungus', count: 1 }] });
  const s2 = new Survival(bare, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  assert.equal(s2.stanceOptions(new Task('t'), {}, () => {}, [threat(bare, entity)], false).warped_fungus, undefined);
  // With dirt carried: the dirt first, the fungus on it.
  const dirt = floorBot({ entities: [entity], items: [{ name: 'warped_fungus', count: 1 }, { name: 'dirt', count: 4 }] });
  const s3 = new Survival(dirt, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  const laid = s3.stanceOptions(new Task('t'), {}, () => {}, [threat(dirt, entity)], false).warped_fungus;
  assert.ok(laid);
  assert.match(laid.description, /on a block of dirt laid first from the dirt carried \(nothing here takes it\) \(1 carried\), against the hoglin 5 blocks off: about 1\.2 seconds placing 2 blocks/);
  // No hoglin, no fungus: a zoglin shuns nothing.
  const zog = hoglin(213, 5.58, 0.5, 'zoglin');
  const zb = floorBot({ entities: [zog], items: [{ name: 'warped_fungus', count: 1 }], ground: () => 'crimson_nylium' });
  const s4 = new Survival(zb, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  assert.equal(s4.stanceOptions(new Task('t'), {}, () => {}, [threat(zb, zog)], false).warped_fungus, undefined);
});

test('the drop within a hoglin\'s toss is said, four blocks off where a knockback\'s is three', () => {
  const entity = hoglin(210, -6.5);
  // A floor ending four blocks east of the bot: a drop of 20 from x 4.
  const bot = floorBot({ entities: [entity] });
  const inner = bot.blockAt;
  bot.blockAt = p => (p.x >= 4 && p.y <= 46 && p.y > 26) ? { position: p, name: 'air', boundingBox: 'empty' } : inner(p);
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  const fight = survival.stanceOptions(new Task('t'), {}, () => {}, [threat(bot, entity)], false).fight;
  assert.match(fight.description, /A drop of \d+ blocks is 4 blocks off: a hit's knockback or a step back over it is .*A hoglin's blow throws the bot up and back, up to about 4 blocks back and three up, not a step\./);
});

test('the pillar is offered only where its climb goes: lava beside the cells the body rises through stops it before its first block (mid-244-ab-nether-3, 05:46:53)', async () => {
  // Two hoglins at 7.1 and 11.6, 5.1 health, netherrack carried: the pillar
  // taken at 0.87 put no block down in six milliseconds ("0 of 2 blocks went
  // down"), and the fight asked 0.6 seconds later met the hoglin at 2.7. The
  // terrain is not in the record; lava at head height beside the column is
  // one of the stops the climb makes before any wait.
  const near = hoglin(5995, 7.6), far = hoglin(5996, 0.5, -11.1);
  const items = [{ name: 'netherrack', count: 20 }];
  const withLava = floorBot({ entities: [near, far], items, health: 5.1 });
  const inner = withLava.blockAt;
  withLava.blockAt = p => (p.x === 1 && p.y === 48 && p.z === 0) ? { position: p, name: 'lava', boundingBox: 'empty' } : inner(p);
  const { climbStop } = require('../src/pillar-recovery');
  assert.match(climbStop(withLava, new Vec3(0, 47, 0)), /^lava at 1, 48, 0, in or beside the cells the body rises through$/);
  const s1 = new Survival(withLava, { navigate: async () => {}, place: async () => {}, dig: async () => {} }, { state: { shelters: [] } });
  assert.equal(s1.stanceOptions(new Task('t'), {}, () => {}, [threat(withLava, near), threat(withLava, far)], false).pillar, undefined, 'not offered where the climb stops at once');
  // pillarFrom says where the climb stops.
  assert.equal(await s1.pillarFrom(new Task('t'), {}, () => {}, [threat(withLava, near)]), false);
  assert.match(s1.state.stanceWhy, /^0 of 2 blocks went down: the climb stops at lava at 1, 48, 0/);
  // With nothing beside it, the pillar is on offer.
  const dry = floorBot({ entities: [near, far], items, health: 5.1 });
  const s2 = new Survival(dry, { navigate: async () => {}, place: async () => {}, dig: async () => {} }, { state: { shelters: [] } });
  assert.ok(s2.stanceOptions(new Task('t'), {}, () => {}, [threat(dry, near), threat(dry, far)], false).pillar);
});
