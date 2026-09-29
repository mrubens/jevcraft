'use strict';
// Note 612: a ghast's fireball pushing the bot off a ledge into the lava,
// seven times on 2026-09-28, each read from its flight frames and replayed
// on its region as saved after the death (test/fixtures, copies read after
// the death).
// mid-242-bb-fortress-2 (25587, 15:05:06): on a one-wide netherrack path at
// y 46 over the lava sea, fighting piglins 14 to 25 blocks off, a ghast 55
// blocks off in sight; the fireball threw it 4 blocks west and 1.2 north
// into the lava 18 down. For the forty seconds before, the ghast 45 to 55
// off, survival had the turn and asked no stance (the ghast past the
// twenty-four an encounter looked at), and the code's step off the edge
// found no route three times, the pathfinder refusing the edge cells while
// the ghast could push.
// mid-242-ac-nether-3-fortress-5 (25581, 15:32:08): on its one-wide span at
// y 72, thirty over the cavern, a ghast 44 blocks off in sight; turn_priority
// was out 4.6 seconds unanswered when the fireball threw it off.
// mid-242-bb-fortress-4 (25584, 15:30:39): on its own span at the lava sea's
// level, told a push into the lava beside it was "about 6.1 health of the
// 20"; the fireball put it in at 15.5, dead three seconds later.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { Survival, pushCarries, blastOverSays, claim } = require('../src/survival');
const { threats } = require('../src/danger');
const terrain = require('../src/terrain');
const arbiter = require('../src/arbiter');
const { groundBot } = require('./fixtures/saved-ground');

const noop = async () => {};
const WORN = ['iron_helmet', 'iron_chestplate'];

const BB = require('./fixtures/ledge-ghast-mid-242-bb.json');
// 15:05:04.5, as the flight has it: the bot at (-102.67, 46, 139.5), the
// ghast 55 blocks off at (-51, 42.1, 156.8) in sight, three piglins to the
// east-south-east 17 to 26 blocks off, no pickaxe and no block that holds
// carried. The fireball broke the netherrack under and beside the feet and
// lit a flame west of it (the save has them gone and lit): put back.
function bbBot({ mobs = null } = {}) {
  const bot = groundBot(BB, { at: new Vec3(-102.67, 46, 139.5), health: 20, food: 20, dimension: 'the_nether', worn: WORN, held: 'iron_sword',
    items: [['iron_sword', 1], ['stone_axe', 1], ['gravel', 14], ['oak_fence', 15], ['white_wool', 5], ['mutton', 8], ['cooked_mutton', 4], ['beef', 14], ['water_bucket', 1], ['crafting_table', 1]],
    mobs: mobs || [
      { id: 1752, name: 'piglin', at: new Vec3(-88.9, 41, 147.2), height: 1.95, width: 0.6 },
      { id: 1751, name: 'piglin', at: new Vec3(-82.6, 41, 150.7), height: 1.95, width: 0.6 },
      { id: 1750, name: 'piglin', at: new Vec3(-78.8, 41, 147.8), height: 1.95, width: 0.6 },
      { id: 1749, name: 'ghast', at: new Vec3(-51, 42.1, 156.8), height: 4, width: 4 }] });
  bot.inventory.slots[45] = { name: 'shield' };
  for (const k of ['-103,45,139', '-102,45,139', '-103,45,140', '-102,45,140']) bot.changed.set(k, 'netherrack');
  bot.changed.set('-104,46,139', 'air');
  return bot;
}
const ghastOnly = () => [{ id: 1749, name: 'ghast', at: new Vec3(-51, 42.1, 156.8), height: 4, width: 4 }];

test('the push goes away from the ghast, two to four blocks and sliding along a wall it meets side-on, as the seven pushes of the day went', () => {
  // A floor at y 63 for x -4..4 and z -3..3, the lava 20 down round it.
  const floor = new Set();
  for (let x = -4; x <= 4; x++) for (let z = -3; z <= 3; z++) floor.add(`${x},63,${z}`);
  const scene = (extra = {}) => {
    const bot = { health: 20, entity: { position: new Vec3(0.5, 64, 0.5) },
      blockAt: p => { const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`, position = p.floored();
        if (extra[k] || floor.has(k)) return { name: extra[k] || 'netherrack', boundingBox: 'block', position };
        return Math.floor(p.y) <= 43 ? { name: 'lava', boundingBox: 'empty', position } : { name: 'air', boundingBox: 'empty', position }; } };
    return bot;
  };
  // Four blocks of floor west of the feet: a push from the east lands on it, the four seen at the most; with
  // the edge two blocks off, it goes over.
  assert.equal(pushCarries(scene(), new Vec3(0, 64, 0), new Vec3(40, 70, 0.5)), null, 'four blocks of floor west: the push stays on it');
  const near = scene();
  for (let z = -3; z <= 3; z++) for (const x of [-4, -3, -2]) floor.delete(`${x},63,${z}`);
  const over = pushCarries(near, new Vec3(0, 64, 0), new Vec3(40, 70, 0.5));
  assert.equal(over?.toward, 'west'); assert.equal(over.into, 'lava'); assert.equal(over.blocksAway, 2);
  // The drop on the ghast's own side is not the push's: the push goes away from it.
  assert.equal(pushCarries(near, new Vec3(0, 64, 0), new Vec3(-40, 70, 0.5)), null, 'from the west, the push goes east onto the floor');
  // A block at the head's height in the way stops it; a wall to the north met side-on by a push to the north-west
  // does not: the push goes on west along it, over the drop.
  assert.equal(pushCarries(scene({ '-1,65,0': 'netherrack' }), new Vec3(0, 64, 0), new Vec3(40, 70, 0.5)), null, 'a block at the head beside the feet stops it');
  const slide = pushCarries(scene({ '0,64,-1': 'netherrack', '0,65,-1': 'netherrack' }), new Vec3(0, 64, 0), new Vec3(12, 70, 30), { at: new Vec3(0.3, 64, 0.5) });
  assert.equal(slide?.into, 'lava', 'walled north only, a push north-west slides west along the wall and over');
  for (let z = -3; z <= 3; z++) for (const x of [-4, -3, -2]) floor.add(`${x},63,${z}`);
});

test('on its netherrack path over the lava sea with a ghast 55 blocks off in sight, the step back to footing its push cannot carry the bot over is offered, and every stance says where it is (mid-242-bb-fortress-2, 15:05:04.5)', () => {
  const bot = bbBot();
  const survival = new Survival(bot, { place: noop, dig: noop, navigate: noop }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'find_fortress' } }, () => {}, threats(bot, 64), false);
  const step = options.out_of_the_push;
  assert.ok(step, `no step out of the push: ${Object.keys(options).join(', ')}`);
  // The nearest footing whose floor holds against the blast and that the walk can reach: the rock's corridor at
  // y 45 to the north, the netherrack under every nearer cell one block thick over the lava, the bricks east toward the piglins.
  assert.match(step.description, /Step 11 blocks back from the edge to footing at \(-95, 45, 136\), 8\.8 blocks off, where a push from the ghast cannot carry the bot over a drop, and stand there, striking what comes to arm's length; 6 of the 11 cells of its way lie beside the drop, walked crouched\. Until it stands there, about 6 seconds, it is within a push of the drop/);
  // The way goes north-east, across the ghast's line: its fireballs fired while it walks pass to the side.
  assert.match(step.description, /this walk carries the body about 2\.5 blocks across its line meanwhile, where a fireball meets the body only within about 0\.8: one fired while it walks passes to the side of it, and lands only where it meets a block within two blocks of the bot, pushing it less the farther off it bursts; one already on its way when the walk starts comes where the bot stands now, and meets it if it comes in the first 0\.7 seconds, before the body is 0\.8 across: about 23 in 100 while the ghast has a line/);
  assert.match(step.description, /There a fireball that lands costs its 4\.8 damage and a push onto ground or into rock, the floor under it holding against the blast/);
  for (const k of ['fight', 'out_of_sight', 'keep_working', 'retreat', 'return_fireball']) {
    assert.match(options[k].description, /Footing a push from the ghast cannot carry the bot over stands 11 steps off at \(-95, 45, 136\)\./, k);
  }
  // Three blocks from any drop is short of a fireball's throw, and that ground's netherrack breaks under it.
  assert.match(options.fight_from_footing.description, /There a fireball from the ghast still carries the bot over a fall through the floor its blast can break\./);
});

test('the step back walks the cells it was offered along, which the pathfinder refuses beside the drop while the ghast can push (mid-242-bb-fortress-2)', async () => {
  const bot = bbBot();
  const movements = bot.pathfinder.movements;
  const searched = [];
  const navigate = async (b, task, goal, opts = {}) => {
    movements.edgeTaken = opts.edgeTaken;
    try { searched.push(b.pathfinder.getPathTo(movements, goal, 2000).status); } finally { movements.edgeTaken = undefined; }
  };
  const survival = new Survival(bot, { place: noop, dig: noop, navigate }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'find_fortress' } }, () => {}, threats(bot, 64), false);
  const goal = new (require('mineflayer-pathfinder').goals.GoalBlock)(-95, 45, 136);
  assert.equal(bot.pathfinder.getPathTo(movements, goal, 2000).status, 'noPath', 'the edge rule refuses the path while the ghast can push');
  await options.out_of_the_push.run();
  assert.deepEqual(searched, ['success']);
});

test('the ghast alone in sight 55 blocks off by the drop: the stance is asked with it, the step out of its push among the ways; the code\'s own step off the edge is the fallback, and walks its way (mid-242-bb-fortress-2, 15:04:26 to 15:04:52)', async () => {
  const run = async jev => {
    const bot = bbBot({ mobs: ghastOnly() });
    const movements = bot.pathfinder.movements;
    const walks = [];
    const navigate = async (b, t, g, o = {}) => {
      movements.edgeTaken = o.edgeTaken;
      try { walks.push(`${g.x},${g.y},${g.z} ${b.pathfinder.getPathTo(movements, g, 2000).status}`); } finally { movements.edgeTaken = undefined; }
    };
    const survival = new Survival(bot, { place: noop, dig: noop, navigate }, { client: jev ? {} : undefined, state: { shelters: [] } });
    const asked = [];
    survival.decide = async (task, goal, save, q) => { asked.push([q.id, Object.keys(q.tree)]); return { path: [q.tree.out_of_the_push ? 'out_of_the_push' : Object.keys(q.tree)[0]] }; };
    const goal = {};
    await survival.step(new Task('leg'), goal, () => {});
    return { survival, goal, walks, asked };
  };
  const withJev = await run(true);
  assert.deepEqual(withJev.survival.encounterDanger().map(t => t.entity.name), ['ghast'], 'the ghast past the twenty-four is among the mobs the encounter answers');
  assert.equal(withJev.asked[0]?.[0], 'encounter_stance');
  assert.ok(withJev.asked[0][1].includes('out_of_the_push'), withJev.asked[0][1].join(', '));
  assert.equal(withJev.goal.survivalAction?.action, 'out_of_the_push');
  // With no piglins toward the east, the fortress's bricks along the path.
  assert.deepEqual(withJev.walks, ['-94,46,140 success']);
  // Jev not reachable: the code's step off the edge, along the cells of its own way.
  const without = await run(false);
  assert.equal(without.goal.survivalAction?.action, 'off_the_edge');
  assert.deepEqual(without.walks, ['-100,45,136 success'], 'found no route live, the edge refused');
});

// Note 643: "rail_span failed and rests three minutes: Cannot read properties
// of undefined (reading 'run')" (and the same for fight_from_footing), seven
// times on 2026-09-28: the stances that end in the fight called
// options.fight.run(), and the caller deletes 'fight' from the options when
// it ended here without acting and other ways are on offer.
test('fight_from_footing and rail_and_fight still end in the fight when the fight was left out of the options', async () => {
  const bot = bbBot();
  const navigate = async (b, task, goal) => { b.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); };
  const survival = new Survival(bot, { place: noop, dig: noop, navigate }, { state: { shelters: [] } });
  survival.railSpan = async () => true;
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'find_fortress' } }, () => {}, threats(bot, 64), false);
  assert.ok(options.fight_from_footing && options.fight, Object.keys(options).join(', '));
  delete options.fight;
  for (const k of ['fight_from_footing', 'rail_and_fight']) {
    if (!options[k]) continue;
    await options[k].run().catch(err => assert.doesNotMatch(String(err.message), /reading 'run'/, k));
  }
});

const AC5 = require('./fixtures/span-ghast-mid-242-ac5.json');
// 15:32:04: the bot at (-12.37, 72, 137.5) on its one-wide netherrack span at
// y 71, the ghast 44.5 blocks off at (12.5, 61, 102.3) in sight, fifty
// netherrack and two cobblestone carried. The fireball of 15:32:08 broke the
// span under the feet (put back).
function acBot() {
  const bot = groundBot(AC5, { at: new Vec3(-12.37, 72, 137.5), health: 20, food: 20, dimension: 'the_nether', worn: WORN, held: 'iron_sword',
    items: [['iron_sword', 1], ['netherrack', 50], ['gravel', 15], ['cobblestone', 2], ['oak_planks', 1], ['oak_log', 2], ['mutton', 9]],
    mobs: [{ id: 436, name: 'ghast', at: new Vec3(12.5, 61, 102.3), height: 4, width: 4 }] });
  bot.inventory.slots[45] = { name: 'shield' };
  bot.time = { timeOfDay: 6000, age: 100000 };
  bot.changed.set('-13,71,137', 'netherrack'); bot.changed.set('-12,71,137', 'netherrack');
  return bot;
}

test('turn_priority says the ghast\'s push over the drop and the footing out of it on the survival claim and on the work (mid-242-ac-nether-3-fortress-5, 15:32:04)', async () => {
  const bot = acBot();
  const goal = { kind: 'win', step: { action: 'find_fortress' }, survival: {} };
  const claims = [claim(bot, goal, { state: goal.survival, currentShelter: () => null }), { layer: 'work', action: 'find_fortress', urgency: 'routine', facts: { doing: 'find fortress' } }];
  assert.equal(claims[0]?.action, 'escape_threat');
  let tree = null;
  await arbiter.take(bot, claims.map(c => ({ ...c, run: async () => true })), { decide: async (id, q) => { tree = q.tree; return { path: ['survival'] }; }, now: Date.now() });
  const push = /The ghast 44 blocks off has the bot in sight and fires one fireball every 3 seconds while it has a line, the first about a second after it has one; one that lands pushes the body about 2 to 4 blocks away from it, south-west, and a block up or more, and here that carries it over the drop 1 block south-west, into lava 40 blocks down: the bot's death, and everything carried lost with it\. Footing a push from it cannot carry the bot over stands 6 steps off at \(-19, 72, 137\)/;
  assert.match(tree.survival.description.does, push);
  assert.match(tree.work.description.does, /Where the bot stands now: The ghast 44 blocks off has the bot in sight/);
  assert.match(tree.work.description.does, push);
});

test('on the span, the step back to the rock\'s tunnel is offered, across the ghast\'s line, its fireballs passing a walking bot; the rail is priced with the shots behind it (mid-242-ac-nether-3-fortress-5)', () => {
  const bot = acBot();
  const survival = new Survival(bot, { place: noop, dig: noop, navigate: noop }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'find_fortress' } }, () => {}, survival.encounterDanger(), false);
  const step = options.out_of_the_push?.description;
  assert.ok(step, Object.keys(options).join(', '));
  assert.match(step, /Step 6 blocks back from the edge to footing at \(-19, 72, 137\), 6\.1 blocks off/);
  assert.match(step, /this walk carries the body about 1\.9 blocks across its line meanwhile, where a fireball meets the body only within about 0\.8: one fired while it walks passes to the side of it/);
  assert.match(step, /meets it if it comes in the first 0\.8 seconds, before the body is 0\.8 across: about 27 in 100 while the ghast has a line/);
  // Behind the rail the ghast still shoots: its fireballs are in the price, as the span's hold has them.
  assert.match(options.rail_and_fight.description, /About 20\.9 damage from the mobs here in the next fifteen seconds this way/);
});

const BB4 = require('./fixtures/lava-span-mid-242-bb4.json');
test('lava level with the feet beside the span is priced with the fire it sets, not a second\'s swim: death at 20 (mid-242-bb-fortress-4, 15:30:38)', () => {
  // The bot at (-144.91, 32, 92.54) on its span of netherrack laid on the lava sea at y 31, the ghast 19 blocks off to
  // the north-east at the lava's height. The fireball broke the netherrack under the feet (lava in the save): put back.
  const bot = groundBot(BB4, { at: new Vec3(-144.91, 32, 92.54), health: 20, food: 20, dimension: 'the_nether', worn: WORN, held: 'iron_sword',
    items: [['iron_sword', 1], ['gravel', 10], ['warped_stem', 2]], mobs: [{ id: 2815, name: 'ghast', at: new Vec3(-130.7, 31.1, 105.1), height: 4, width: 4 }] });
  bot.changed.set('-145,31,92', 'netherrack'); bot.changed.set('-145,32,91', 'air');
  const feet = bot.entity.position.floored();
  const facts = terrain.dropFacts(bot, feet, 3);
  assert.equal(facts.fallBlocks, 0); assert.equal(facts.into, 'lava');
  assert.equal(facts.lava.inIt, 6.1); assert.equal(facts.lava.burn, 15);
  assert.equal(facts.damage, 'death', JSON.stringify(facts));
  assert.match(terrain.dropNote(terrain.dropNear(bot, feet, 3), 20, bot), /^ Lava level with the feet is 1 block off: a hit's knockback or a step back over it is into lava level with the feet; the lava breaks the fall and burns about 6\.1 health a second through the armour worn, and the nearest ground out of it from where the body comes up is about 1 block off, about 1 seconds swimming \(not measured\), about 6\.1 health in it, then the fire it sets burns on 15 seconds out of it at a point a second that armour does not stop \(no water to put it out in the Nether\): about 21\.1 in all, more than the 20 the bot has: death\./);
  const said = blastOverSays(bot);
  assert.match(said.says, /carries it over the drop 1 block north-west, into lava level with the feet: the bot's death/);
});
