'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

// 25598 (mid-242-ee-fortress-18, 2026-09-29 19:18 to 19:23Z, note 682): no
// food, hunger 17, restock_food answered hoglin_pillar eight times in five
// minutes. Each walk to the hoglin seen went for a sighting 28 blocks up
// ("no route", partial) and ended at once; the hunt's record said "walked to
// where 1 hoglin seen ... and none was within thirty-two blocks", hoglin_walk
// said "None made yet in this trial", and each asking was from a new place,
// so the ledger's "from here" said nothing of the tries before.
function netherBot({ at = new Vec3(-167, 75, 47), items = [['iron_sword', 1], ['netherrack', 104]] } = {}) {
  const inv = items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  return Object.assign(new EventEmitter(), {
    registry, version: '26.1', health: 19.5, food: 17, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' },
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv.filter(i => i.count > 0), slots: [] }, chat() {}, blockAt: () => null,
  });
}
const sighting = (x, y, z, now = Date.now()) => ({ x, y, z, count: 1, at: now, dimension: 'the_nether', sx: x, sy: y, sz: z });

test('a walk to a hoglin that finds no way is said as that, the place rests, and both hunts say it (25598, note 682)', async () => {
  const nf = require('../src/nether-food');
  const bot = netherBot();
  const goal = { kind: 'win', sightings: { hoglin: [sighting(-168, 103, 90)] } };
  const known = require('../src/nether-travel').hoglinsKnown(bot, goal);
  assert.equal(known.seen.length, 1);
  const navigate = async () => { throw new Error('No path to the goal! (partial)'); };
  const went = await nf.huntHoglin(bot, new Task('work'), goal, () => {}, known, { navigate, method: 'pillar' });
  assert.equal(went, false);
  const last = goal.netherFood.hunts.at(-1);
  assert.equal(last.walk, 'failed');
  assert.match(last.why, /^the walk to where 1 hoglin seen just now, 43 blocks south \(-168, 90\) found no way there: No path to the goal! \(partial\)$/);
  assert.doesNotMatch(last.why, /none was within thirty-two blocks/);
  // Seen again from afar at the next look, the place rests: not offered, and said.
  goal.sightings.hoglin = [sighting(-168, 103, 90)];
  const again = require('../src/nether-travel').hoglinsKnown(bot, goal);
  assert.equal(again.seen.length, 0);
  assert.equal(again.noWay.length, 1);
  const routes = nf.foodRoutes(bot, new Task('work'), goal, () => {}, { actions: { navigate } });
  assert.equal(routes.routes.hoglin_pillar, undefined);
  assert.equal(routes.routes.hoglin_walk, undefined);
  assert(routes.notOffered.some(s => /^a hoglin: 1 hoglin seen just now, 43 blocks south \(-168, 90\), but the walk there found no way \d+ seconds ago \(No path to the goal! \(partial\)\); that place rests five minutes from then$/.test(s)), routes.notOffered.join(' | '));
  // A hoglin seen elsewhere is not offered from where the walk found no way
  // (note 775: from about here no walk to one seen is offered for five
  // minutes), said as that.
  goal.sightings.hoglin.push(sighting(-120, 75, 20));
  const fromHere = nf.foodRoutes(bot, new Task('work'), goal, () => {}, { actions: { navigate } });
  assert.equal(fromHere.routes.hoglin_walk, undefined);
  assert(require('../src/nether-travel').hoglinsKnown(bot, goal).noWay.some(w => w.fromHere && w.x === -120), 'withheld for the walk that found no way from here');
  // From 20 blocks off it is offered, and the walk that failed is said on both ways of hunting it.
  bot.entity.position = bot.entity.position.offset(20, 0, 0);
  const other = nf.foodRoutes(bot, new Task('work'), goal, () => {}, { actions: { navigate } });
  assert.match(other.routes.hoglin_walk.description, /Made in this trial: 1, 0 brought meat .*found no way there: No path/);
  assert.match(other.routes.hoglin_pillar.description, /Made in this trial: 1, 0 brought meat .*found no way there: No path/);
});

test('an answer that came to nothing moments ago elsewhere is said on its option at the next asking (note 682)', () => {
  const tried = require('../src/tried');
  const bot = netherBot();
  const now = Date.now();
  const goal = { kind: 'win', tried: { entries: [
    { q: 'restock_food', method: 'hoglin_pillar', place: { x: -151, y: 75, z: 102 }, at: now - 21000, outcome: 'blocked', why: 'the walk to where 1 hoglin seen found no way there: No path', settledAt: now - 20000 },
  ], escalations: [] } };
  const tree = { hoglin_pillar: { description: 'Hunt the hoglin from a pillar.' }, keep_on: { description: 'Go on without food.' } };
  const read = tried.read(bot, goal, 'restock_food', tree);
  assert.equal(read.tree.hoglin_pillar.description, 'Hunt the hoglin from a pillar. Chosen 21 seconds ago 57 blocks from here, and it came to nothing: the walk to where 1 hoglin seen found no way there: No path.');
  assert.equal(read.tree.keep_on.description, 'Go on without food.');
  // Not rested: said only, the choice Jev's.
  assert.deepEqual(read.resting, []);
  // Past the same breath, not said from elsewhere.
  goal.tried.entries[0].at = now - 5 * 60000; goal.tried.entries[0].settledAt = now - 5 * 60000;
  assert.equal(tried.read(bot, goal, 'restock_food', tree).tree.hoglin_pillar.description, 'Hunt the hoglin from a pillar.');
});

test('the hunt\'s failure is kept on the answer that chose it (note 682)', async () => {
  const nf = require('../src/nether-food');
  const tried = require('../src/tried');
  const bot = netherBot();
  const goal = { kind: 'win', sightings: { hoglin: [sighting(-168, 103, 90)] } };
  tried.begin(bot, goal, { q: 'restock_food', method: 'hoglin_walk' });
  const known = require('../src/nether-travel').hoglinsKnown(bot, goal);
  await nf.huntHoglin(bot, new Task('work'), goal, () => {}, known, { navigate: async () => { throw new Error('No path to the goal!'); }, method: 'walk' });
  const e = tried.latestOf(goal, 'restock_food');
  assert.equal(e.outcome, 'blocked');
  assert.match(e.why, /found no way there: No path to the goal!$/);
});
