'use strict';
// Note 610: four deaths of 2026-09-28 to a ghast's fireball by a deadly
// drop, each read from its flight frames and replayed on its saved region
// (test/fixtures, copies read after the death).
// mid-243-ah-fortress-5 (25591, 14:09:16): on a one-wide diagonal ridge of
// basalt at y 52 over the lava sea, every side at the feet floored, fourteen
// gravel carried and no other block; out_of_sight was offered four times
// and its walk refused each time ("the way passes along a drop that would
// kill"), the rail was not offered, and the fireball threw the bot 2.9
// blocks west and 1.9 north, over the basalt west of it and off the ridge.
// mid-243-ag-nether-2 (25598, 14:18:15 and 14:18:18): its fight held on a
// one-wide span through the first fireball, which threw it four blocks along
// the span; the second threw it off the south side.
// mid-242-ba-fortress-4 (25584, 14:25:55) and mid-242-ac-nether-3-fortress-4
// (25587, 13:15:44): the fireball broke the netherrack under the feet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { threats, pushersAbout } = require('../src/danger');
const { groundBot } = require('./fixtures/saved-ground');

const WORN = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'];
const RIDGE = require('./fixtures/ridge-ghast-mid-243-ah.json');
// 14:09:16.2, as the flight has it: the bot at (-222.5, 52, -301.49), the
// ghast 43 blocks off at (-184.5, 58, -282.5), in sight. The flame at
// (-224, 52, -301) in the save was lit by the fireball that threw the bot:
// the walk offered at 14:09:15.0 went through that cell.
function ridgeBot({ items = [['iron_sword', 1], ['gravel', 14], ['leaf_litter', 46], ['stick', 3]] } = {}) {
  const bot = groundBot(RIDGE, { at: new Vec3(-222.5, 52, -301.49), health: 16.9, food: 16, dimension: 'the_nether', worn: WORN, held: 'iron_sword', items,
    mobs: [{ id: 1216, name: 'ghast', at: new Vec3(-184.5, 58, -282.5), height: 4, width: 4 }] });
  bot.changed.set('-224,52,-301', 'air');
  return bot;
}
const noop = async () => {};

test('on the ridge, the sides a fireball\'s push goes toward are walled with the gravel carried, though each is floored: the push carries past the cell beside it (mid-243-ah-fortress-5)', async () => {
  const bot = ridgeBot();
  const placed = [];
  const survival = new Survival(bot, { place: async (b, t, p, material) => { placed.push(`${p} ${material}`); }, dig: noop, navigate: noop }, { state: { shelters: [] } });
  const danger = threats(bot, 64);
  assert.equal(danger[0]?.entity.name, 'ghast');
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'find_fortress' } }, () => {}, danger, false);
  assert.ok(options.rail_and_fight, `no wall on offer: ${Object.keys(options).join(', ')}`);
  const rail = options.rail_and_fight.description;
  assert.match(rail, /^Wall the 2 sides at the feet a push goes toward or open over the drop: west and north floored but with the drop beside them, where a push carries the body past the cell beside it \(2 blocks, 2 of them gravel, which holds on the floor under it/);
  // Every other stance still says the fall a fireball that lands is.
  assert.match(options.fight.description, /Open here to the ghast 43 blocks off/);
  await survival.railSpan(new Task('rail'), {}, () => {}, { blast: true });
  assert.deepEqual(placed, ['(-224, 52, -302) gravel', '(-223, 52, -303) gravel'], 'west, then north, the gravel on the basalt');
});

test('on the ridge, the walk out of the ghast\'s line says the cells of its way beside the drop and the push on the way, and walks them: the pathfinder refused the way it was offered (mid-243-ah-fortress-5)', async () => {
  const bot = ridgeBot();
  const movements = bot.pathfinder.movements;
  const searched = [];
  const navigate = async (b, task, goal, opts = {}) => {
    movements.edgeTaken = opts.edgeTaken;
    try { searched.push(b.pathfinder.getPathTo(movements, goal, 2000).status); } finally { movements.edgeTaken = undefined; }
  };
  const survival = new Survival(bot, { place: noop, dig: noop, navigate }, { state: { shelters: [] } });
  assert.ok(pushersAbout(bot).length, 'the ghast in sight can push the bot');
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'find_fortress' } }, () => {}, threats(bot, 64), false);
  const hide = options.out_of_sight;
  assert.ok(hide, Object.keys(options).join(', '));
  assert.match(hide.description, /4 of the 4 cells of its way lie beside a drop into lava \d+ down, walked crouched \(a step does not go over the edge; a push still throws the body\): about 3\.1 seconds beside it, while the ghast 43 blocks off fires one fireball every 3 seconds while it has a line, so a fireball can all but surely land on the way, and one that lands there is the push over the drop/);
  // As recorded: the walk without the cells it was offered along finds no way.
  const goal = new (require('mineflayer-pathfinder').goals.GoalBlock)(-225, 52, -301);
  assert.equal(bot.pathfinder.getPathTo(movements, goal, 2000).status, 'noPath', 'the edge rule refuses the ridge while the ghast can push');
  await hide.run();
  assert.deepEqual(searched, ['success'], 'the walk takes the cells it was offered along');
});

const SPAN = require('./fixtures/span-ghast-mid-243-ag.json');
// 14:18:16.4, after the first fireball threw the bot four blocks west along
// its one-wide span of dirt, diorite and basalt at y 36 over the lava sea:
// at (-11.46, 37, -183.24), 16.6 health, the ghast 56 blocks off to the
// east-north-east, a magma cube 12 blocks off below, one plank and sixteen
// gravel carried.
function spanBot() {
  return groundBot(SPAN, { at: new Vec3(-11.46, 37, -183.24), health: 16.6, food: 17, dimension: 'the_nether', worn: WORN, held: 'iron_sword',
    items: [['iron_sword', 1], ['oak_planks', 1], ['gravel', 16], ['crafting_table', 1], ['leaf_litter', 34]],
    mobs: [{ id: 2453, name: 'ghast', at: new Vec3(38.9, 55.5, -199.5), height: 4, width: 4 }, { id: 2403, name: 'magma_cube', at: new Vec3(-21.3, 32.4, -177.5), height: 2.04, width: 2.04 }] });
}

test('on the span with one plank and gravel, the side a fireball\'s push goes toward is walled, the plank under the gravel, where the rest cannot be (mid-243-ag-nether-2)', async () => {
  const bot = spanBot();
  const placed = [];
  const place = async (b, t, p, material) => { placed.push(`${p} ${material}`); bot.changed.set(`${p.x},${p.y},${p.z}`, material); bot.inventory.items().find(i => i.name === material).count--; };
  const survival = new Survival(bot, { place, dig: noop, navigate: noop }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'cross_toward' } }, () => {}, threats(bot, 64), false);
  assert.ok(options.rail_and_fight, Object.keys(options).join(', '));
  assert.match(options.rail_and_fight.description, /Wall the 1 open side at the feet over the drop; the blocks carried wall only the side a push from the ghast goes toward, and north stays open \(a push from it does not go that way; a hit from a mob beside the bot can\) \(2 blocks, 1 of them gravel, which holds on the floor under it, about 1\.2 seconds, anything at reach hitting freely meanwhile\), then fight here: a push from its shot stops at the wall; a knock toward north still goes over\./);
  await survival.railSpan(new Task('rail'), {}, () => {}, { blast: true });
  assert.deepEqual(placed, ['(-12, 36, -183) oak_planks', '(-12, 37, -183) gravel'], 'the plank as the floor south, the gravel on it');
});

test('a stance held on the span is asked again when the ghast\'s fireball lands and the bot is still open over the drop (mid-243-ag-nether-2)', async () => {
  const make = hitAt => {
    const bot = spanBot();
    if (hitAt) { bot._hurtBy = { ghast: hitAt }; bot._recentHurtAt = hitAt; }
    const survival = new Survival(bot, { place: noop, dig: noop, navigate: noop }, { client: { systemOne: async () => { throw new Error('offline'); } }, state: { shelters: [] } });
    survival.state.stance = { choice: 'fight', kinds: 'ghast,magma_cube', ids: [2453, 2403], shooters: ['ghast'], at: Date.now() - 3200, health: 20, expects: { damage: 21.9, seconds: 15, oneHit: 3.4 } };
    let asked = null;
    survival.decide = async (task, goal, save, question) => { asked = question; return { path: ['fight'], stale: true }; };
    return { bot, survival, asked: () => asked };
  };
  const held = make(null);
  await held.survival.stanceStep(new Task('t'), {}, () => {}, threats(held.bot, 64), false);
  assert.equal(held.asked(), null, 'no shot landed since it was chosen: held, as it was');
  const hit = make(Date.now() - 1100);
  await hit.survival.stanceStep(new Task('t'), {}, () => {}, threats(hit.bot, 64), false);
  assert.ok(hit.asked(), 'the fireball landed and the bot is still over the drop: asked again');
  assert.match(hit.asked().state.previousStance.askedAgainFor, /^the ghast it was chosen against landed a shot 1 seconds ago, 3\.4 health lost since it was chosen; it is still open over the drop a push puts it over/);
});

const BRIDGE = require('./fixtures/bridge-floor-mid-242-ba.json');
test('walled toward the push on its own netherrack over the lava sea, every stance says the fireball can break the floor under the feet, not "a push into the wall, not the fall" (mid-242-ba-fortress-4)', () => {
  // 14:25:53.9: the bot at (-24.5, 33, -31.92) on the netherrack at (-25, 32, -32), which the fireball of 14:25:55.7
  // broke (the save has it gone: put back, as the one beside it); its own netherrack west at (-26, 33, -32), the ghast 21 blocks off to the
  // east-south-east pushing it west and south; the lava sea's top at y 31.
  const bot = groundBot(BRIDGE, { at: new Vec3(-24.5, 33, -31.92), health: 16.8, food: 12, dimension: 'the_nether', worn: WORN, held: 'iron_sword',
    items: [['iron_sword', 1], ['netherrack', 22], ['gravel', 15]],
    mobs: [{ id: 2666, name: 'ghast', at: new Vec3(-6, 29.5, -40.5), height: 4, width: 4 }] });
  // The block east of it too: the recorded question had the bot walled west and south, so nothing beside the
  // south cell was open, and the save has (-24, 32, -32) gone with the one under the feet.
  bot.changed.set('-25,32,-32', 'netherrack'); bot.changed.set('-24,32,-32', 'netherrack');
  const survival = new Survival(bot, { place: noop, dig: noop, navigate: noop }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'cross_toward' } }, () => {}, threats(bot, 64), false);
  for (const [k, o] of Object.entries(options)) {
    // The pocket and the bunker close the drop and say nothing of the push.
    if (['none_good', 'seal', 'bunker'].includes(k)) continue;
    assert.doesNotMatch(o.description, /a push into the wall, not the fall/, k);
    assert.match(o.description, /The floor under the feet is netherrack \(blast resistance 0\.4\), a block a ghast's fireball can break \(under about 4\): one that lands at the feet can open it, and a wall at the side does not hold the body up: it goes down through it into lava 1 blocks down/, k);
  }
  assert.match(options.fight.description, /Walled here toward the push: a fireball from the ghast 21 blocks off \(in sight\) pushes the bot away from it, west and south, into a block or onto ground with no drop beside it\. The floor/);
});

const SPAN_FLOOR = require('./fixtures/span-floor-mid-242-ac.json');
// mid-242-ac-nether-3-fortress-4, 13:15:44: its one-wide netherrack span at
// y 71, the two cells under and beside the bot broken by the fireball (put
// back), thirty blocks over the cavern floor; the ghast 34 blocks east.
function spanFloorBot(at = new Vec3(-13.32, 72, 137.5)) {
  const bot = groundBot(SPAN_FLOOR, { at, health: 14.5, food: 18, dimension: 'the_nether', worn: WORN, held: 'iron_sword',
    items: [['iron_sword', 1], ['netherrack', 46], ['gravel', 15], ['mutton', 9]],
    mobs: [{ id: 314, name: 'ghast', at: new Vec3(18.8, 77, 126), height: 4, width: 4 }] });
  bot.changed.set('-14,71,137', 'netherrack'); bot.changed.set('-13,71,137', 'netherrack');
  return bot;
}

test('on the netherrack span the floor the fireball broke is said as the fall under it, and the crouched walk out of a fire says the push on its way (mid-242-ac-nether-3-fortress-4)', () => {
  const bot = spanFloorBot();
  const survival = new Survival(bot, { place: noop, dig: noop, navigate: noop }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'find_fortress' } }, () => {}, threats(bot, 64), false);
  assert.match(options.fight.description, /The floor under the feet is netherrack \(blast resistance 0\.4\).*it goes down through it a fall of (more than )?\d+ blocks, about (more than )?\d+ health, more than the [\d.]+ left after the fireball/);
  // In fire at the span's west part (-16, 72, 137): every way out along it is beside the drop.
  const burning = spanFloorBot(new Vec3(-15.5, 72, 137.5));
  burning.changed.set('-16,72,137', 'fire');
  const ways = require('../src/vitals').fireWays(burning, new Task('x'));
  assert.ok(ways.crouch_out_of_fire, Object.keys(ways).join(', '));
  assert.match(ways.crouch_out_of_fire.description, /of its way lies? beside a drop of more than \d+|of its way lie beside a drop/);
  assert.match(ways.crouch_out_of_fire.description, /while the ghast 3\d blocks off fires one fireball every 3 seconds while it has a line, so (about \d+ in 100 that a fireball lands|a fireball can all but surely land) on the way, and one that lands there is the push over the drop/);
});
