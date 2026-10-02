'use strict';
// Note 563: mid-243-ad, on its own span at y 54 over the lava sea, a ghast
// thirty-seven to fifty-eight blocks off. Its last three planks went into
// cover, the ghast was out of sight a second, and the next stance question
// priced its fireballs at nothing: keep_working said only "a hit's knockback
// ... is into lava" (the state a fall of 19 damage from 20 health). The work
// walked the bot out from behind the planks, a fireball threw it twenty-two
// blocks into the lava, and nothing stood within reach of where it came up.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const terrain = require('../src/terrain');

const air = p => ({ position: p, name: 'air', boundingBox: 'empty' });
// A one-wide netherrack span at y 54 along z over the lava sea (lava at y 31
// and under), with a shore where `shore` says.
const world = (shore = () => false) => p => {
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
  if (y === 53 && x === 190 && z >= 100 && z <= 140) return { position: p, name: 'netherrack', boundingBox: 'block' };
  if (shore(x, y, z)) return { position: p, name: 'netherrack', boundingBox: 'block' };
  return y <= 31 ? { position: p, name: 'lava', boundingBox: 'empty' } : air(p);
};
const ghastAt = (x, y, z) => ({ id: 21, name: 'ghast', type: 'hostile', position: new Vec3(x, y, z), height: 4, width: 4, isValid: true });
const spanBot = ({ items, ghast, seen = true, shore } = {}) => {
  const events = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 18, oxygenLevel: 20,
    entity: { position: new Vec3(190.5, 54, 118.5), onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0) }, entities: { [ghast.id]: ghast }, time: { timeOfDay: 0 },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'golden_boots' }, 45: { name: 'shield' } } },
    // Out of sight: the ray to the ghast meets a block at once.
    world: { raycast: seen ? () => null : from => ({ position: from.floored(), intersect: from }) },
    blockAt: world(shore), registry: require('minecraft-data')('26.1'),
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, getControlState: () => false,
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: () => events.push('swing'), findBlocks: () => [] });
  return { bot, events };
};
const threat = (bot, entity, visible = true) => ({ entity, distance: entity.position.distanceTo(bot.entity.position), visible });

test('a drop into the lava sea is priced by the lava from where the body comes up, not by the fall the lava takes away', () => {
  const { bot } = spanBot({ items: [], ghast: ghastAt(190.5, 60, 160.5) });
  const feet = bot.entity.position.floored();
  const facts = terrain.dropFacts(bot, feet, 3);
  assert.equal(facts.into, 'lava');
  assert.equal(facts.fallBlocks, 22);
  assert.equal(facts.damage, 'death', JSON.stringify(facts));
  assert.equal(facts.lava.shoreBlocks, null);
  assert.equal(facts.lava.perSecond, 4.2, 'lava\'s 4 a half second through iron and gold boots');
  assert.match(terrain.dropNote(terrain.dropNear(bot, feet, 3), 20, bot), /into lava 22 blocks down; the lava breaks the fall and burns about 4\.2 health a second through the armour worn, and no ground out of it stands within 12 blocks of where the body comes up: death/);
  // Ground three blocks from where it comes up: out, at a price, and the
  // fifteen seconds of fire lava sets burn on after it, a point a second
  // that armour does not stop, with no water to pour in the Nether (note
  // 612): 12.6 in it and 15 after, more than the 20 the bot has.
  const near = spanBot({ items: [], ghast: ghastAt(190.5, 60, 160.5), shore: (x, y, z) => y === 31 && x === 194 && z === 118 }).bot;
  const out = terrain.dropFacts(near, feet, 3);
  assert.equal(out.lava.shoreBlocks, 3, JSON.stringify(out));
  assert.equal(out.lava.inIt, 31.5, 'three blocks at the measured 0.4 a second: 7.5 seconds in it');
  assert.equal(out.lava.burn, 15);
  assert.equal(out.lava.takes, 46.5);
  assert.equal(out.damage, 'death');
  assert.ok(out.deadly);
  assert.match(terrain.dropNote(terrain.dropNear(near, feet, 3), 20, near), /about 7\.5 seconds swimming \(0\.4 blocks a second, measured: of 88 stretches in lava 62 ended in death, and those that lived were out within about 1\.2 blocks\), about 31\.5 health in it, then the fire it sets burns on 15 seconds out of it at a point a second that armour does not stop \(no water to put it out in the Nether\): about 46\.5 in all, more than the 20 the bot has: death/);
});

test('on a span over the lava sea with a ghast out of sight within its reach, every stance that leaves the bot open says one fireball is the fall into the lava, death; the walls do not', () => {
  const ghast = ghastAt(190.5, 62, 160.5);
  const { bot } = spanBot({ items: [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 20 }], ghast, seen: false });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'cross_toward' } }, () => {}, [threat(bot, ghast, false)], false);
  assert.ok(options.keep_working, Object.keys(options).join(','));
  assert.match(options.keep_working.description, /Open here to the ghast 43 blocks off \(out of sight now; it flies, and can have a line again at any moment, its fireball about a second after\): one fireball that lands pushes the bot off its feet, and the drop 1 block off is into lava 22 blocks down, no ground to climb out onto within 12 blocks of where the body comes up\. So a fireball that lands here is priced by that fall, not by its 3\.4 damage: the bot's death/);
  // The span's hold walls for it though it is out of sight, and says it stays walled.
  assert.ok(options.hold_on_span, Object.keys(options).join(','));
  assert.match(options.hold_on_span.description, /walled first: .* a push stops at a wall, and the walls stay up while the bot holds here/);
  assert.match(options.hold_on_span.description, /What can push the bot here: the ghast 43 blocks off \(out of sight, and it flies\)/);
  assert.doesNotMatch(options.hold_on_span.description, /Open here to the ghast/, 'walled, it is not open');
  assert.ok(options.rail_and_fight, Object.keys(options).join(','));
  assert.doesNotMatch(options.rail_and_fight.description, /Open here to the ghast/);
  // The span is netherrack, which the fireball can break under the feet: walled, the push stops and the floor
  // does not (mid-242-ba-fortress-4, note 610).
  assert.match(options.rail_and_fight.description, /Walled, a fireball that lands here pushes the bot into the wall, not over the drop beside it\. The floor under the feet is netherrack \(blast resistance 0\.4\)/);
  assert.match(options.hold_on_span.description, /Walled, a fireball that lands here pushes the bot into the wall, not over the drop beside it\. The floor under the feet is netherrack/);
  assert.match(options.keep_working.description, /The work does not stop in time: the hit that would stop it is the one that throws the bot over\./);
  assert.match(options.fight.description, /Open here to the ghast/);
});

test('the planks the logs carried make count for the span\'s walls and the rail, made first', async () => {
  const ghast = ghastAt(190.5, 62, 158.5);
  let items = [{ name: 'iron_sword', count: 1 }, { name: 'oak_planks', count: 3 }, { name: 'oak_log', count: 5 }, { name: 'gravel', count: 16 }];
  const { bot } = spanBot({ items: [], ghast });
  bot.inventory.items = () => items;
  const placed = [], made = [];
  const survival = new Survival(bot, {
    place: async (b, t, p, material) => { placed.push(material); },
    acquireStep: async (b, t, item, count) => { made.push(`${item} ${count}`); items = [{ name: 'iron_sword', count: 1 }, { name: 'oak_planks', count }, { name: 'oak_log', count: 5 - Math.ceil((count - 3) / 4) }]; },
    dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, ghast)], false);
  assert.doesNotMatch(options.hold_on_span.description, /Too few blocks carried/);
  assert.match(options.hold_on_span.description, /walled first: 4 blocks, about 2\.4 seconds, the oak planks for them made first from the logs carried \(20\), about a second more; a push stops at a wall/);
  assert.ok(options.rail_and_fight, Object.keys(options).join(','));
  assert.match(options.rail_and_fight.description, /the oak planks for it made first from the logs carried, about a second more/);
  const goal = {};
  await survival.railSpan(new Task('x'), goal, () => {}, { blast: true });
  assert.deepEqual(made, ['oak_planks 7']);
  assert.equal(placed.length, 4, placed.join(','));
  assert.ok(placed.every(m => m === 'oak_planks'));
});

test('on a span, a stance Jev chose and that holds is carried out, not the span\'s hold in its place', async () => {
  // mid-243-ad chose return_fireball; between its watches the code held still on the span instead, four turns in
  // twelve seconds ("turning between return fireball and hold on span").
  const ghast = ghastAt(190.5, 62, 150.5);
  const { bot } = spanBot({ items: [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 20 }], ghast });
  const placed = [];
  const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p}`); }, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  const asked = [];
  survival.decide = async (task, goal, save, q) => { asked.push(q.id); return { path: ['take_cover'], stale: false }; };
  const now = Date.now();
  survival.state.stance = bot._stance = { choice: 'take_cover', kinds: 'ghast', ids: [ghast.id], shooters: ['ghast'], at: now, health: 20, ranAt: now };
  const goal = {};
  await survival.flee(new Task('span'), goal, () => {}).catch(() => {});
  assert.equal(goal.survivalAction?.action, 'take_cover', JSON.stringify(goal.survivalAction));
  assert.ok(!asked.includes('encounter_stance'), `held, not asked: ${asked.join(',')}`);
});

test('on the span over the lava sea with a ghast in sight, return_fireball is priced by the fall a fireball that lands is, not by the fireball (note 574)', () => {
  // mid-242-ab-nether-2 chose it at 19.3 health two blocks from a drop into
  // lava, told "Priced with one fireball missed: about 4.8 damage"; the
  // first fireball threw it in.
  const ghast = ghastAt(190.5, 62, 160.5);
  const { bot } = spanBot({ items: [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 20 }], ghast });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, ghast)], false);
  assert.ok(options.return_fireball, Object.keys(options).join(','));
  const back = options.return_fireball.description;
  assert.match(back, /Priced by that record \(7 of the 9 fireballs that came to the bot sent back, none landed\): about 0\.4 of the next 2 fireballs landing, and here the first that lands is the push over the drop below: the price is that fall, the bot's death, and everything carried lost with it, not its 3\.4 damage\./);
  assert.doesNotMatch(back, /Priced by that record[^.]*about [\d.]+ damage in about/);
  assert.match(back, /Open here to the ghast 43 blocks off \(in sight\): one fireball that lands pushes the bot off its feet/);
});
