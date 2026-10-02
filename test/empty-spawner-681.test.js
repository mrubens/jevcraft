'use strict';
const { oldOrder } = require('./support/jev-stand-in');
// Note 681: at a blaze spawner known and no blaze near, the ways are Jev's.
// mid-242-dc-fortress-22 (25589) ended a close-in beside the cage at
// (-108, 77, 155) at 3.8 health, hunger 15 and nothing to eat; the hunt fell
// through to the fortress search, which walked it 42 blocks off the spawner
// ("No measurable progress on find_fortress"). The frames and the room are
// the trial's own (test/fixtures/empty-spawner-25589.json, spawner-room-25589.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const es = require('../src/empty-spawner');
const { question } = require('../src/decisions');
require('../src/decisions/travel');

const room = require('./fixtures/spawner-room-25589.json');
const rec = require('./fixtures/empty-spawner-25589.json');

// The bot as the record has it at the close-in's end: the carried items,
// the iron helmet and chestplate, the shield.
function frameBot({ at = rec.fightEnd.position, health = rec.fightEnd.health, food = rec.fightEnd.food, extra = [], mobs = [] } = {}) {
  const items = [...Object.entries(rec.inventory), ...extra];
  const bot = groundBot(room, { at: new Vec3(at.x, at.y, at.z), health, food, items, worn: rec.worn, dimension: 'the_nether', mobs, indexed: true });
  bot.inventory.slots[45] = { name: 'shield' };
  return bot;
}
// The goal as saved: the hunt, the fortress map's spawner, keep_on held.
function frameGoal(extra = {}) {
  return { kind: 'win', survival: { deaths: [] }, portals: rec.portals, mobHunt: JSON.parse(JSON.stringify(rec.mobHunt)),
    fortressSearch: { legs: 3, map: { cells: {}, failed: {}, spawners: [{ ...rec.spawner }], chests: [] } },
    leaveNether: { ...rec.leaveNether }, sightings: { hoglin: [{ ...rec.hoglinSeen, at: Date.now() - rec.hoglinSeen.minutesAgo * 60000 }] }, ...extra };
}
const task = () => ({ check() {}, opportunityClient: null });

test('the recorded frame: beside the cage at 3.8 health, hunger 15, nothing to eat, the spawner known and no blaze near: the question is asked, not the search', async () => {
  const bot = frameBot(), goal = frameGoal();
  const known = es.knownSpawner(bot, goal);
  assert.ok(known, 'the spawner the map holds is known here');
  assert.deepEqual({ x: known.cage.x, y: known.cage.y, z: known.cage.z }, { x: -108, y: 77, z: 155 });
  assert.equal(es.blazeNear(bot, goal), false);
  const asked = [];
  const client = { model: 'x', systemOne: async req => { asked.push(req); const q = Object.values(req.questions)[0]; return { answers: { branch_0: { choice: 'go_back', confidence: 0.8 } }, q }; } };
  let back = 0, waited = 0;
  // The rods carried were asked about already (rods_now, note 871): this is the cage's own question.
  goal.rodsNowAsked = { rods: 99, at: Date.now() };
  const done = await es.atSpawner(bot, task(), goal, () => {}, { client, returnOverworld: async () => { back++; }, waitAtSpawner: async () => { waited++; } });
  assert.equal(done, true);
  assert.equal(asked.length, 1);
  const q = Object.values(asked[0].questions)[0];
  // The ways: the trip back; no heal (nothing comes back at 15 with nothing to eat), no search; and at
  // 3.8 health with no way to heal, no stand at the cage (physical safety, note 883), said as not offered.
  assert.ok(q.criteria.go_back);
  assert.equal(q.criteria.stand_by_spawner, undefined);
  assert.ok(Object.keys(q.criteria).every(k => ['go_back', 'get_food_here', 'step_out', 'pull_back', 'bank_rods', 'none_good'].includes(k)), Object.keys(q.criteria).join(','));
  assert.match(JSON.stringify(asked[0]), /are not offered under 8 health with no way to heal/);
  assert.equal(q.criteria.heal_first, undefined);
  assert.ok(!Object.keys(q.criteria).some(k => /search|fortress|leg/.test(k)));
  assert.equal(back, 1); assert.equal(waited, 0);
  assert.equal(goal.leaveNether.pick, 'go_back');
  assert.notEqual(goal.step.action, 'find_fortress');
});

test('the options say the spawner\'s rule, the median, the cell, and that health does not come back', () => {
  const bot = frameBot(), goal = frameGoal();
  const known = es.knownSpawner(bot, goal);
  const tree = es.options(bot, task(), goal, () => {}, { returnOverworld: async () => {} }, known);
  const stand = tree.stand_by_spawner.description;
  assert.match(stand, /within 16 of it the spawner puts up to 4 within 4 blocks of the cage every 10 to 40 seconds, until 6 are about/);
  assert.match(stand, /4 or more were about by a median 32 seconds/);
  // What a fight there costs at this health: one fireball through the iron worn is more than the bot has.
  assert.match(stand, /Health 3\.8, not coming back: a blaze fires three fireballs a volley, one that lands costs 3\.9 and sets the bot alight, so one that lands is the end/);
  assert.match(stand, /Of the trials' fights begun at under 8 health, 29: 62% died, 3% brought a rod/);
  assert.match(stand, /Each that sees the bot shoots at it, fought or not/);
  // The room's own cell: within three of the cage, rock at its back or a ceiling over it.
  assert.match(stand, /^Take a stand at a cell [\d.]+ blocks from the cage, (a \d+-block walk|where the bot stands), (rock at its back|under a ceiling) and wait/);
  // The way back: its minutes at the measured pace, and the walks begun under 8 health.
  assert.match(tree.go_back.description, /about \d+ to \d+ minutes at the walks' measured pace/);
  assert.match(tree.go_back.description, /of the 33 begun under 8 health, 4 came out and 6 died/);
  // Food here: the hoglin seen, the pillar's measure and the hunts' record, both.
  assert.match(tree.get_food_here.description, /one seen \d+ blocks off 8 minutes ago/);
  assert.match(tree.get_food_here.description, /168 stances lost 0\.1 health on average\); the 66 hunts of 2026-09-28 brought none/);
  const { state } = es.facts(bot, goal, known);
  assert.match(state.spawner, /^at \(-108, 77, 155\), 1 block off: within sixteen: trying now/);
  assert.match(state.healthComesBack, /^no: hunger 15/);
  assert.equal(state.food, 'nothing to eat carried');
});

test('at 20 health with food the stand is on offer and the outage default takes it', () => {
  const bot = frameBot({ health: 20, food: 20, extra: [['cooked_porkchop', 6]] }), goal = frameGoal();
  const known = es.knownSpawner(bot, goal);
  const tree = es.options(bot, task(), goal, () => {}, { returnOverworld: async () => {} }, known);
  assert.ok(tree.stand_by_spawner);
  assert.equal(tree.go_back, undefined, 'health comes back: the trip back for food is not the way offered');
  // The rods carried go in a chest first without Jev (note 704), then the stand.
  assert.equal(oldOrder('empty_spawner')(tree), tree.stash_rods ? 'stash_rods' : 'stand_by_spawner');
  const { stash_rods: _stash, ...rest } = tree;
  assert.equal(oldOrder('empty_spawner')(rest), 'stand_by_spawner');
});

test('the stand is the search\'s wait by the spawner, a minute, with the spawner as the step\'s target', async () => {
  const bot = frameBot({ health: 20, food: 20, extra: [['cooked_porkchop', 6]] }), goal = frameGoal();
  const client = { model: 'x', systemOne: async () => ({ answers: { branch_0: { choice: 'stand_by_spawner', confidence: 0.9 } } }) };
  let waited = 0;
  const before = Date.now();
  await es.atSpawner(bot, task(), goal, () => {}, { client, waitAtSpawner: async () => { waited++; } });
  const w = goal.fortressSearch.spawnerWait;
  assert.equal(w.chosen, 'empty_spawner');
  assert.deepEqual({ x: w.x, y: w.y, z: w.z }, { x: -108, y: 77, z: 155 });
  assert.ok(w.until - before >= es.STAND_MS - 50 && w.until - before <= es.STAND_MS + 1000);
  assert.equal(waited, 1);
  // The next pass carries the wait on, not a new question.
  const again = await es.atSpawner(bot, task(), goal, () => {}, { client: { systemOne: async () => { throw new Error('asked again'); } }, waitAtSpawner: async () => { waited++; } });
  assert.equal(again, true); assert.equal(waited, 2);
  // What the stall watch and the rung's measure read: the spawner is the target.
  goal.step = { action: 'wait_at_spawner', spawner: { x: -108, y: 77, z: 155 }, target: { x: -108, y: 77, z: 155 }, off: 1 };
  const stillness = require('../src/stillness');
  assert.deepEqual(stillness.actionOf(goal).target, { x: -108, y: 77, z: 155 });
  assert.equal(stillness.stepWait(bot, goal), 'waiting by a spawner');
  const parts = require('../src/rung-measure').parts(bot, goal, { rung: 'obtain_blaze_rods', target: stillness.actionOf(goal).target });
  assert.ok(Object.keys(parts).some(k => k.startsWith('step:')), 'the spawner is a distance the rung measures');
});

test('a blaze near is the hunt\'s own; a spawner past 48 blocks, or broken, is not this question\'s', async () => {
  const blaze = { id: 7, name: 'blaze', at: new Vec3(-106.5, 78, 157.5), height: 1.8 };
  const client = { systemOne: async () => { throw new Error('not asked'); } };
  assert.equal(await es.atSpawner(frameBot({ mobs: [blaze] }), task(), frameGoal(), () => {}, { client }), false);
  const far = frameBot({ at: { x: -60.5, y: 77, z: 141.5 } });
  assert.equal(es.knownSpawner(far, frameGoal()), null);
  assert.equal(await es.atSpawner(far, task(), frameGoal(), () => {}, { client }), false);
  // Not in the map but in sight: the one in sight is known.
  const unmapped = frameGoal(); unmapped.fortressSearch.map.spawners = [];
  assert.ok(es.knownSpawner(frameBot(), unmapped));
  // Broken since it was seen: not a spawner.
  const broken = frameBot(); broken.changed.set('-108,77,155', 'air');
  assert.equal(es.knownSpawner(broken, frameGoal()), null);
  assert.equal(await es.atSpawner(broken, task(), frameGoal(), () => {}, { client }), false);
});

test('the heal chosen eats what is carried and waits, and is not asked again meanwhile', async () => {
  const bot = frameBot({ health: 10, food: 14, extra: [['cooked_porkchop', 2]] }), goal = frameGoal();
  let ate = 0;
  bot.consume = async () => { ate++; bot.food = Math.min(20, bot.food + 8); };
  const known = es.knownSpawner(bot, goal);
  const tree = es.options(bot, task(), goal, () => {}, {}, known);
  assert.match(tree.heal_first.description, /^Eat what is carried \(hunger to 20\) and wait here until health is full/);
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'heal_first', confidence: 0.9 } } }) };
  await es.atSpawner(bot, task(), goal, () => {}, { client });
  assert.equal(goal.emptySpawner.pick, 'heal_first');
  assert.ok(ate >= 1);
  assert.equal(goal.step.action, 'heal_at_spawner');
  assert.equal(require('../src/stillness').stepWait(bot, goal), 'recovering');
});

test('in the lull, stand_by_spawner keeps the trials\' health-cost row: box options have their own safety said, and this one is not left bare beside them (note 740)', () => {
  // 25583 (mid-242-wf) was offered stand_by_spawner seeing 97 in 100 of the
  // spawner's blazes against box_here's 3 in 100, and box_here (0.7) won:
  // stand_by_spawner's own text said only "Nothing is built" where box_here
  // said "Arena: took no damage" -- the lull branch stripped stand_by_spawner's
  // own died%/rod% row, so the one option that actually fights had no cost
  // beside the one that barely does.
  const bot = frameBot(), goal = frameGoal();
  const known = es.knownSpawner(bot, goal);
  known.lull = { cage: known.cage, off: known.off, within16: 0, next: {}, says: 'No blaze sees the bot now', short: 'No blaze in sight.' };
  const tree = es.options(bot, task(), goal, () => {}, { returnOverworld: async () => {}, navigate: async () => {}, dig: async () => {} }, known);
  assert.match(tree.stand_by_spawner.description, /^Take a stand in the open at/, 'the lull\'s own short form');
  assert.match(tree.stand_by_spawner.description, /Of the trials' fights begun at under 8 health, 29: 62% died, 3% brought a rod\./, 'the health-cost record is kept, not stripped, in the lull');
});

test('box_in_line says its own safety, as box_here and box_at_spawner do, not left bare beside them (note 740)', () => {
  const bot = frameBot({ health: 20, food: 20 }), goal = frameGoal();
  const known = es.knownSpawner(bot, goal);
  known.lull = { cage: known.cage, off: known.off, within16: 0, next: {}, says: 'No blaze sees the bot now', short: 'No blaze in sight.' };
  const tree = es.options(bot, task(), goal, () => {}, { returnOverworld: async () => {}, navigate: async () => {}, dig: async () => {} }, known);
  assert.ok(tree.box_in_line && tree.box_at_spawner, Object.keys(tree).join(','));
  assert.match(tree.box_in_line.description, /Arena: as box_here's is, once whole, 45-second holds took no damage with six to ten blazes about\./);
  assert.match(tree.box_at_spawner.description, /Arena: built among four blazes it lost 3 runs of 5, never whole in those\./);
  // 6 blocks off here (outside the four-block spawn range, note 740): no
  // false positive on a box that is not actually in the spawner's own range.
  assert.doesNotMatch(tree.box_in_line.description, /spawn range/);
});

test('a box built inside the spawner\'s own spawn range says a blaze can spawn already at its wall (note 740, 25588)', () => {
  const { Vec3: V } = require('vec3');
  const registry = require('minecraft-data')('26.1');
  const cage = new V(0, 64, 0);
  const cells = new Map();
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) { cells.set(`${x},63,${z}`, 'nether_bricks'); cells.set(`${x},64,${z}`, 'air'); cells.set(`${x},65,${z}`, 'air'); }
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (const y of [63, 64, 65]) if (Math.abs(x) > 2 || Math.abs(z) > 2) cells.set(`${x},${y},${z}`, 'nether_bricks');
  cells.set('0,64,0', 'spawner');
  const blockAt = p => { const f = p.floored(); const name = cells.get(`${f.x},${f.y},${f.z}`) ?? 'nether_bricks'; const b = registry.blocksByName[name]; return { name, position: f, boundingBox: name === 'air' || name === 'spawner' ? (name === 'spawner' ? 'block' : 'empty') : 'block', hardness: b?.hardness, harvestTools: b?.harvestTools, type: b?.id }; };
  const { EventEmitter } = require('events');
  const bot = Object.assign(new EventEmitter(), { registry, health: 20, food: 20, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: new V(1.5, 64, 0.5), onGround: true }, entities: {}, inventory: { items: () => [{ name: 'netherrack', count: 64, type: registry.itemsByName.netherrack.id }, { name: 'iron_sword', count: 1, type: registry.itemsByName.iron_sword.id }, { name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }], slots: { 45: { name: 'shield' } } },
    world: { raycast: () => null }, blockAt, findBlocks: () => [], chat() {} });
  const goal = { kind: 'win', survival: { deaths: [] }, mobHunt: { item: 'blaze_rod', entity: 'blaze', targetCount: 7 },
    fortressSearch: { legs: 0, map: { cells: {}, failed: {}, spawners: [{ x: cage.x, y: cage.y, z: cage.z }], chests: [] } } };
  const known = es.knownSpawner(bot, goal);
  known.lull = { cage: known.cage, off: known.off, within16: 0, next: {}, says: 'x', short: 'y' };
  const tree = es.options(bot, { check() {} }, goal, () => {}, { returnOverworld: async () => {}, navigate: async () => {}, dig: async () => {} }, known);
  const boxed = tree.box_here || tree.box_in_line;
  assert(boxed, Object.keys(tree).join(','));
  assert.match(boxed.description, /It is inside the spawner's own spawn range \(up to four blocks across\): a blaze can spawn already at the box's own wall or window there, not only fly in through it, so "only a blaze in line with the window sees in" does not hold this close\./);
});
