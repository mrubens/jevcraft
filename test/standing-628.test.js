'use strict';
// mid-242-ab-nether-3-fortress-6 (25587), "slain by Zombie" at 19:16:20Z on 2026-09-28,
// twenty-three minutes in and ten minutes after a blaze killed it in the Nether: back in the
// Overworld with nothing worn, at 14.3 health and hunger 17 (none comes back under eighteen),
// two zombies in sight at 10 and 20 blocks and nine shooters within 48, it was asked whether to
// cross now or cook seven mutton first ("about 72 seconds in all, with no walk") and took the
// cook; the furnace was down, the mutton in it, and the first zombie was at the bot three
// seconds later. The bunker it chose then was told "about 14.1 damage ... from 14.3 health"
// and five blows of three ended it (note 628).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');

function scene({ health = 14.333, food = 17, carried = {}, mobs = [{ name: 'zombie', at: 10 }, { name: 'zombie', at: 20 }] } = {}) {
  const registry = require('minecraft-data')('26.1');
  const items = Object.entries({ cobblestone: 385, iron_pickaxe: 1, stone_pickaxe: 1, stone_sword: 1, coal: 13, furnace: 1, mutton: 7, raw_iron: 5, oak_log: 4, crafting_table: 1, ...carried }).map(([name, count]) => ({ name, count }));
  const entities = {};
  mobs.forEach((m, i) => { entities[100 + i] = { id: 100 + i, name: m.name, type: 'hostile', position: new Vec3(0.5 + m.at, 53, 0.5), height: m.name === 'skeleton' ? 1.99 : 1.95, width: 0.6, isValid: true, ...(m.name === 'skeleton' ? { heldItem: { name: 'bow' } } : {}) }; });
  return {
    registry, oxygenLevel: 20, health, food,
    game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' },
    time: { timeOfDay: 3834 },
    entity: { position: new Vec3(0.5, 53, 0.5), height: 1.8, width: 0.6, onGround: true },
    entities,
    inventory: { items: () => items.filter(i => i.count > 0), slots: [], emptySlotCount: () => 15 },
    blockAt: p => { const q = p.floored(); const name = q.y < 53 ? 'stone' : 'air'; return { name, position: q, boundingBox: name === 'air' ? 'empty' : 'block', getProperties: () => ({}) }; },
    findBlocks: () => [],
    world: { raycast: () => null },
    pathfinder: { movements: {} },
  };
}
const answering = (choice, log) => ({ systemOne: async ({ questions }) => { log.offered = questions.branch_0.criteria; return { answers: { branch_0: { choice, confidence: 0.6 } } }; } });

test('standing among mobs is priced from when each gets there, and said with who is coming', () => {
  const { standingAmong } = require('../src/risk');
  const s = scene();
  const among = standingAmong(s, 72, { what: 'at the furnace' });
  assert(among, 'two zombies about');
  assert.match(among.says, /^Standing at the furnace for those 72 seconds with 2 hostile mobs that can get to the bot within 24 blocks/);
  assert.match(among.says, /a zombie 10 blocks off, it sees the bot and comes at it: at the bot in about 4 seconds at its walk/);
  assert.match(among.says, /a zombie 20 blocks off/);
  // Each zombie hits for 3 about once a second from when it is at the bot: far more than 14.3 in 72 seconds.
  assert(among.damage > 14.3, `damage ${among.damage}`);
  assert.match(among.says, /\(more than the bot has\)\.$/);
  // Nothing about, or only what has no way to it: nothing said.
  assert.equal(standingAmong(scene({ mobs: [] }), 72), null);
});

test('a mob that would not be at the bot within the stretch is said and costs nothing in it', () => {
  const { standingAmong } = require('../src/risk');
  const among = standingAmong(scene({ mobs: [{ name: 'zombie', at: 22 }] }), 5);
  assert(among);
  assert.equal(among.damage, 0, 'a zombie 22 blocks off is at the bot in about nine seconds, past five');
  assert.match(among.says, /About 0 damage from them over those seconds/);
});

test('the cook is offered with what standing at the furnace costs here, and that the meat is not eaten meanwhile', async () => {
  // The cook is a way to the food rung's food now (work.js kitFoodStep, note 673).
  const { crossingKitReady, kitFoodStep } = require('../src/work');
  const log = {};
  const bot = scene({ mobs: [{ name: 'zombie', at: 10 }, { name: 'zombie', at: 20 }, { name: 'skeleton', at: 30 }] });
  assert.equal(await kitFoodStep(bot, new Task('win'), {}, () => {}, { wants: 80 }, answering('go_without', log)), false);
  const cook = log.offered.top_up_cook;
  assert.match(cook, /^Cook the raw food carried first: 7 mutton/);
  assert.match(cook, /about 72 seconds in all, with no walk\./);
  assert.match(cook, /The meat is in the furnace, not eaten, while it cooks: health 14\.3 does not come back at hunger 17 meanwhile; eaten raw now, the 14 points bring hunger to 20, where it does\./);
  assert.match(cook, /Standing at the furnace for those 72 seconds with 3 hostile mobs that can get to the bot within 24 blocks \(the shooters to 48\): a zombie 10 blocks off/);
  assert.match(cook, /a skeleton 30 blocks off, it has the bot in sight and fires at it from as far as \d+ blocks/);
  assert.match(cook, /The cook is stopped when one of them comes within eight blocks in sight or lands a hit, and the batch stays in the furnace to be collected\./);
  // Waiting to heal (the crossing's) says the same, and that at hunger 17 the wait has no end of its own.
  assert.equal(await crossingKitReady(bot, new Task('win'), {}, () => {}, answering('cross_now', log)), true);
  // With food carried the wait is a meal first (note 927): health comes back from hunger eighteen.
  assert.match(log.offered.top_up_health, /^Eat the mutton first \(hunger 17/);
  assert.match(log.offered.top_up_health, /At hunger 17 health does not come back until the meal is eaten: a minute of the meal and the wait is counted\. Standing here for those 60 seconds with 3 hostile mobs/);
  // With nothing to eat it is not offered: a wait with no end. The crossing says why.
  const none = scene({ mobs: [{ name: 'zombie', at: 10 }] });
  const items = none.inventory.items().filter(i => !/mutton|beef|pork|chicken|bread|apple|potato|carrot|stew|cod|salmon/.test(i.name));
  none.inventory.items = () => items;
  const bare = {};
  assert.equal(await crossingKitReady(none, new Task('win'), {}, () => {}, answering('cross_now', bare)), true);
  assert.equal(bare.offered.top_up_health, undefined);
  assert.match(bare.offered.cross_now, /Waiting here to heal is not offered: at hunger 17 health does not come back, and nothing to eat is carried\./);
});

test('with no mob about the cook says nothing of them; at full hunger and health it says nothing of the meat', async () => {
  const { kitFoodStep } = require('../src/work');
  const log = {};
  const quiet = scene({ mobs: [] });
  await kitFoodStep(quiet, new Task('win'), {}, () => {}, { wants: 80 }, answering('go_without', log));
  assert.doesNotMatch(log.offered.top_up_cook, /Standing at the furnace/);
  assert.match(log.offered.top_up_cook, /not eaten, while it cooks/, 'hurt and under eighteen: still said');
  const fed = scene({ health: 20, food: 18, mobs: [] });
  await kitFoodStep(fed, new Task('win'), {}, () => {}, { wants: 80 }, answering('go_without', log));
  assert.doesNotMatch(log.offered.top_up_cook || '', /not eaten, while it cooks/);
});

test('every option of the batch that cooks says who is coming while the bot is at the furnace', async () => {
  const { whileCooking } = require('../src/work');
  const bot = scene();
  let offered;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'wait_here', confidence: 0.5 } } }; } } };
  const args = { cooking: 70000, oreInReach: () => null, walkTarget: () => new Vec3(4.5, 53, 0.5), what: 'mutton', count: 7 };
  bot.blockAt = p => ({ name: p.y < 53 ? 'stone' : 'coal_ore', position: p.floored(), boundingBox: 'block' });
  assert.equal(await whileCooking(bot, task, {}, () => {}, args), 'wait_here');
  for (const key of ['mine_nearby', 'wait_here']) {
    assert.match(offered[key], /Standing at or near the furnace for those 70 seconds with 2 hostile mobs/, key);
    assert.match(offered[key], /The work is stopped when one of them comes within eight blocks in sight or lands a hit\.$/, key);
  }
});

test('a price that leaves less health than one blow is said to be a coin toss', () => {
  const { costSays } = require('../src/survival');
  const zombie = { name: 'zombie', hitsBot: 3, distance: 7.2 };
  const cost = { seconds: 15, setup: 4.2, damage: 14.1, blasts: [], later: [], still: ['zombie'] };
  const says = costSays(cost, 14.3, [zombie], { doing: 'digging in', done: 'In it, the zombie there before it is dug in in the tunnel' });
  assert.match(says, /About 14\.1 damage from the mobs here in the next fifteen seconds this way, the 4\.2 seconds of digging in included, from 14\.3 health\./);
  assert.match(says, /That leaves 0\.2 health, less than the 3 of one blow: one blow more than the figure counts, or one landing sooner than it does, ends the bot\.$/);
  // Room for a blow, no damage, more than the bot has, or a blast alone: nothing added.
  assert.doesNotMatch(costSays({ ...cost, damage: 9 }, 14.3, [zombie]), /That leaves/);
  assert.doesNotMatch(costSays({ ...cost, damage: 0 }, 14.3, [zombie]), /That leaves/);
  assert.doesNotMatch(costSays({ ...cost, damage: 14.6 }, 14.3, [zombie]), /That leaves/);
  assert.doesNotMatch(costSays({ ...cost, damage: 40, blasts: [] }, 43, [{ name: 'creeper', hitsBot: 43, distance: 5 }]), /That leaves/);
});

test('the unstuck move that bridges a gap in the floor is a move its question declares', async () => {
  // Asked of Jev (a one-way tree is not checked): the trial logged "unstuck_move offered options it
  // does not declare: bridge_north ..." nine times between 19:07 and 19:10Z.
  const { decide } = require('../src/decisions');
  const tree = { bridge_north: { description: 'Put a dirt into the gap in the floor north, against the floor stood on.' }, step_east: { description: 'Walk one block east.' } };
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'bridge_north', confidence: 0.7 } } }) };
  const d = await decide('unstuck_move', { client, bot: null, goal: {}, tree });
  assert.deepEqual(d.path, ['bridge_north']);
});

test('one pickaxe carried and the pockets make another: a spare is offered at the crossing, said with the uses left (note 943)', async () => {
  const { crossingKitReady } = require('../src/work');
  const one = scene({ carried: { stone_pickaxe: 0 } });
  const log = {};
  await crossingKitReady(one, new Task('win'), {}, () => {}, answering('cross_now', log));
  assert.match(log.offered.top_up_spare_pickaxe, /^Make a spare pickaxe first, from what is carried: \w+ pickaxe, a few seconds at a table\. The one carried, iron pickaxe, has 250 uses left; a tunnel through netherrack digs about two blocks a block across/);
  // Two carried: no spare offered.
  const two = {};
  await crossingKitReady(scene(), new Task('win'), {}, () => {}, answering('cross_now', two));
  assert.equal(two.offered?.top_up_spare_pickaxe, undefined);
});
