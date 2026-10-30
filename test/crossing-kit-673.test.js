'use strict';
// The crossing's kit as rungs before the portal (note 673). At the crossing
// the kit was one question answered cross_now 621 of 868 times: 42 of 168
// crossings carried no food and 122 were short of the stay (note 664), five
// of seven bots in the Nether had no pickaxe left (notes 654, 655), and spans
// stopped where the blocks ran out (650, 655). Now a spare pickaxe, the blocks
// and the food are each a rung of the ladder, last before the portal, said
// with what they cost; each may wait, and one set aside stays aside.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

// A bot at the portal: the ladder's gear all carried, by day on the surface.
const GEAR = { stick: 4, iron_pickaxe: 1, diamond_sword: 1, shield: 1, water_bucket: 1, iron_helmet: 1, iron_chestplate: 1, iron_leggings: 1, iron_boots: 1, golden_boots: 1, white_bed: 1, bow: 1, arrow: 16, oak_log: 8, crafting_table: 1, chest: 1 };
function atPortal(carried = {}) {
  const items = Object.entries({ ...GEAR, ...carried }).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  return {
    registry, health: 20, food: 20, oxygenLevel: 20,
    game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' },
    time: { timeOfDay: 6000 },
    entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8, width: 0.6, onGround: true },
    entities: {},
    inventory: { items: () => items, slots: [], emptySlotCount: () => 20 },
    blockAt: p => { const q = p.floored(); const name = q.y < 64 ? 'grass_block' : 'air'; return { name, position: q, boundingBox: name === 'air' ? 'empty' : 'block', getProperties: () => ({}) }; },
    findBlocks: () => [], world: { raycast: () => null }, pathfinder: { movements: {} },
  };
}
const FED = { cooked_beef: 10, stone_pickaxe: 1, cobblestone: 128 };

test('a bot at the portal with no food: the food rung is open, last before the portal, said with the stay it covers', () => {
  const { openRungs, nextGameStage } = require('../src/game-progress');
  const { rungOption } = require('../src/strategy');
  const bot = atPortal({ ...FED, cooked_beef: 0 });
  // Optional before the Nether (note 776): no benefit in the stays' record,
  // so not the ladder's unless chosen; chosen, it is the rung it was.
  assert.deepEqual(openRungs(bot, { kind: 'win' }), []);
  assert.deepEqual(require('../src/game-progress').optionalRungs(bot, { kind: 'win' }).map(r => r.phase), ['nether_food']);
  const goal = { kind: 'win', rungOptIn: { nether_food: Date.now() } };
  const rungs = openRungs(bot, goal);
  assert.deepEqual(rungs.map(r => r.phase), ['nether_food']);
  assert.equal(nextGameStage(bot, goal).phase, 'nether_food');
  assert.deepEqual({ carried: rungs[0].carried, wants: rungs[0].wants }, { carried: 0, wants: 80 }, 'the whole stay, crossing-kit.js netherStay');
  const said = rungOption(rungs[0], true, bot, goal).description;
  assert.match(said, /^Get food carried for the Nether stay\. 0 food points carried, 80 wanted: the Nether stay the goal still needs, about 120 minutes for 7 blaze rods and 13 ender pearls, at about 40 hunger an hour\./);
  assert.match(said, /At the crossing 42 of 168 carried no food and 122 were short of the stay \(note 664\)\./);
  assert.match(said, /No food is known nearby: the home chest, the plot or a search for animals, asked when this is taken\./);
  assert.match(said, /Until it is done, the Nether is entered with the food carried/);
  // Fed, nothing more to get; in the Nether, or with the rods done, no kit at all.
  assert.deepEqual(openRungs(atPortal(FED), goal), []);
  const nether = atPortal({ ...FED, cooked_beef: 0 }); nether.game.dimension = 'the_nether';
  assert.deepEqual(require('../src/crossing-kit').kitRungs(nether, goal), []);
  assert.deepEqual(require('../src/crossing-kit').kitRungs(atPortal({ ...FED, cooked_beef: 0, blaze_rod: 7 }), goal), []);
});

test('with no spare pickaxe the spare is a rung: iron when three ingots are carried, else stone', () => {
  const { openRungs } = require('../src/game-progress');
  const { rungOption } = require('../src/strategy');
  const goal = { kind: 'win', rungOptIn: { nether_pickaxe: Date.now() } }; // chosen (note 776)
  const iron = atPortal({ ...FED, stone_pickaxe: 0, iron_ingot: 5 });
  const [rung] = openRungs(iron, goal);
  assert.deepEqual([rung.phase, rung.item, rung.count], ['nether_pickaxe', 'iron_pickaxe', 2], 'one more than the one carried');
  const said = rungOption(rung, true, iron, goal).description;
  assert.match(said, /^Get a spare pickaxe for the Nether\. 1 of the 2 pickaxes the crossing takes are carried \(stone or better, 24 uses or more each; 250 uses between them, of the 250 a stay takes: a tunnel two high wears two a block, netherrack mined for blocks one each\)/);
  assert.match(said, /5 of 7 bots in the Nether had no pickaxe left \(notes 654, 655\)\. Iron: 3 of the 5 iron ingots carried, about 250 uses\./);
  const stone = atPortal({ ...FED, stone_pickaxe: 0, iron_ingot: 1 });
  assert.deepEqual(openRungs(stone, goal).map(r => [r.phase, r.item]), [['nether_pickaxe', 'stone_pickaxe']]);
  // A pickaxe nearly worn is not the spare.
  const worn = atPortal(FED);
  worn.inventory.items().find(i => i.name === 'stone_pickaxe').durabilityUsed = 120;
  assert.deepEqual(openRungs(worn, goal).map(r => r.phase), ['nether_pickaxe']);
});

test('with 10 blocks the blocks rung mines to the two stacks, said with what they are for and what they wear', () => {
  const { openRungs } = require('../src/game-progress');
  const { rungOption } = require('../src/strategy');
  const goal = { kind: 'win', rungOptIn: { nether_blocks: Date.now() } }; // chosen (note 776)
  const bot = atPortal({ ...FED, cobblestone: 10 });
  const rungs = openRungs(bot, goal);
  assert.deepEqual(rungs.map(r => [r.phase, r.item, r.count]), [['nether_blocks', 'cobblestone', 128]]);
  const said = rungOption(rungs[0], true, bot, goal).description;
  assert.match(said, /^Get blocks for bridging and pillaring in the Nether\. 10 blocks carried of the 128 the crossing takes/);
  assert.match(said, /spans stopped where the blocks ran out \(notes 650, 655\)\. Stone mined wears the pickaxe a use a block\./);
  assert.match(said, /Until it is done, a bridge or a pillar stops where the blocks run out/);
});

test('all three short: each is open, in order, the Nether first beside them; taken, all wait and the portal is next', async () => {
  const { openRungs, nextGameStage } = require('../src/game-progress');
  const { strategyOptions } = require('../src/strategy');
  const bot = atPortal({ cobblestone: 10 });
  const goal = { kind: 'win', rungOptIn: { nether_pickaxe: Date.now(), nether_blocks: Date.now(), nether_food: Date.now() } }; // all chosen (note 776)
  const stage = nextGameStage(bot, goal);
  assert.deepEqual(openRungs(bot, goal).map(r => r.phase), ['nether_pickaxe', 'nether_blocks', 'nether_food']);
  const options = strategyOptions(bot, goal, stage);
  assert.deepEqual(Object.keys(options).filter(k => /^rung_|^nether_first$/.test(k)), ['rung_nether_pickaxe', 'rung_nether_blocks', 'rung_nether_food', 'nether_first']);
  await options.nether_first.run();
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether');
});

test('a kit rung set aside for failing is not handed back when nothing else is left: the crossing goes on (no loop)', () => {
  const { nextGameStage, preparationRung } = require('../src/game-progress');
  const { setAside } = require('../src/progress');
  const bot = atPortal({ ...FED, cooked_beef: 0 });
  const goal = { kind: 'win' };
  setAside(goal, 'rung', 'nether_food', 'ten working minutes on the food for the Nether without a point more', 1800000);
  assert.equal(preparationRung(bot, goal), null, 'the other rungs set aside come back when nothing is left; the kit does not');
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether');
  // Other rungs keep their rule: the shield set aside for failing comes back when it is all that is left.
  const shieldless = atPortal({ ...FED, shield: 0 });
  const g2 = { kind: 'win', rungOptIn: { shield: Date.now() } }; // optional before the Nether, chosen (note 776)
  setAside(g2, 'rung', 'shield', 'no iron', 1800000);
  assert.equal(preparationRung(shieldless, g2)?.phase, 'shield');
});

test('the crossing question does not offer the blocks or the pickaxe, and says what the rungs left; with no food at all the food is offered (note 1224)', async () => {
  const { crossingKitReady } = require('../src/work');
  const bot = atPortal({ cobblestone: 10, golden_boots: 0 });
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cross_now', confidence: 0.7 } } }; } };
  assert.equal(await crossingKitReady(bot, new Task('win'), { kind: 'win' }, () => {}, client), true);
  // A spare made from the pockets in seconds is offered beside them (note 943).
  // The food is asked on its own first (note 2565); crossing chosen there, the rest of the kit is asked without it.
  assert.deepEqual(Object.keys(asked).sort(), ['cross_now', 'top_up_gold', 'top_up_spare_pickaxe']);
  assert.match(asked.cross_now, /Left from the ladder's kit steps: food 0 of 80, blocks 10 of 128, pickaxe 1 of 2\./);
  // Only the rungs' items short: asked only for the spare the pockets make (note 943).
  asked = null;
  assert.equal(await crossingKitReady(atPortal({ cobblestone: 10 }), new Task('win'), { kind: 'win' }, () => {}, client), true);
  assert.deepEqual(Object.keys(asked).sort(), ['cross_now', 'top_up_spare_pickaxe']);
});

test('cross_now weighs the hunger crossed at against the food carried, not just a bare count left from the rungs', async () => {
  // 25597 answered cross_now at hunger 9 with 6 of 80 food points carried,
  // went 36 blocks down, and fifty seconds later win_strategy said "nether
  // food first" and climbed back (note 747).
  const { crossingKitReady } = require('../src/work');
  const bot = atPortal({ cobblestone: 10, golden_boots: 0, cooked_beef: 3 });
  bot.food = 9;
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cross_now', confidence: 0.7 } } }; } };
  assert.equal(await crossingKitReady(bot, new Task('win'), { kind: 'win' }, () => {}, client), true);
  assert.match(asked.cross_now, /Hunger 9 now, already below eighteen: health does not come back; \d+ of 80 food points carried for the stay, spent there at about 40 an hour\./);
  // Under the Nether's reserve: the food question there said (note 808).
  const carried = Number(asked.cross_now.match(/(\d+) of 80 food points carried/)[1]);
  if (carried < 36) assert.match(asked.cross_now, /Under the Nether's reserve of 36 food points, the first question there is food: back through this portal for it, or food found there \(a hoglin, a bastion's chests\)\. In the record/);
  else assert.doesNotMatch(asked.cross_now, /Under the Nether's reserve/);
});

test('the food rung taken: going without sets it aside as a choice, which the crossing offers back', async () => {
  const { kitFoodStep } = require('../src/work');
  const { nextGameStage, asideRungs } = require('../src/game-progress');
  const { isSetAside } = require('../src/progress');
  const bot = atPortal({ ...FED, cooked_beef: 0 });
  const goal = { kind: 'win' };
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'go_without', confidence: 0.7 } } }; } };
  assert.equal(await kitFoodStep(bot, new Task('win'), goal, () => {}, { wants: 80 }, client), false);
  assert.deepEqual(Object.keys(asked).sort(), ['go_without', 'top_up_food']);
  assert.match(asked.go_without, /^Go on without more food for now: 0 of 80 points carried\./);
  assert(isSetAside(goal, 'rung', 'nether_food'));
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether');
  assert.deepEqual(asideRungs(bot, goal).map(r => r.phase), ['nether_food'], 'a take-up of its own at the portal');
  // Met, the rung is done: nothing asked.
  asked = null;
  assert.equal(await kitFoodStep(atPortal(FED), new Task('win'), {}, () => {}, { wants: 80 }, client), true);
  assert.equal(asked, null);
});

test('fewer than four sticks, wood and cobblestone carried: the crossing offers sticks for pickaxes made in the Nether (note 962)', async () => {
  const { crossingKitReady } = require('../src/work');
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cross_now', confidence: 0.7 } } }; } };
  assert.equal(await crossingKitReady(atPortal({ stick: 0, oak_log: 2, cobblestone: 40, crafting_table: 1 }), new Task('win'), { kind: 'win' }, () => {}, client), true);
  assert.match(asked?.top_up_sticks || '', /^Make 8 sticks from the wood carried first \(4 planks, a few seconds, one slot; 0 carried now\)\. In the Nether a pickaxe worn out is made again only from what is carried or from the forests' stems: with 2 sticks and 3 of the 40 cobblestone carried, a stone pickaxe \(131 uses\) is made anywhere at a crafting table \(one carried\)\. On 2026-10-02, 26% of the Nether time with rods carried had no pickaxe/);
});

test('the crossing says the last one turned back for food, while the food is no better and hunger under eighteen (note 1134)', async () => {
  // 25591 (2026-10-03 23:24:44 to 23:25:21Z): crossed at hunger 14 with nothing to eat, back through the portal for food 22 seconds in, as at 23:11Z.
  const { crossingKitReady } = require('../src/work');
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cross_now', confidence: 0.7 } } }; } };
  const hungry = atPortal({ cobblestone: 10, golden_boots: 0 }); hungry.food = 14;
  await crossingKitReady(hungry, new Task('win'), { kind: 'win', foodTurnBack: { at: Date.now() - 2 * 60000 } }, () => {}, client);
  assert.match(asked.cross_now, /The last crossing turned back through the portal for food 2 minutes ago, the first thing asked on the far side; 0 food points are carried now and hunger is 14: crossed so, the same question is asked there again\./);
  asked = null;
  await crossingKitReady(hungry, new Task('win'), { kind: 'win' }, () => {}, client);
  assert.doesNotMatch(asked.cross_now, /turned back through the portal for food/);
});

test('the bot\'s own chests in the Nether with the End\'s makings: crossing says what waits there, how far, the eyes it all makes, and the food that trip takes (note 1395)', async () => {
  const { crossingKitReady } = require('../src/work');
  const bot = atPortal({ cobblestone: 10, golden_boots: 0, blaze_rod: 1, ender_pearl: 1 });
  const goal = { kind: 'win', portals: [{ x: 4, y: 50, z: 13, dimension: 'nether' }],
    rodStashes: [{ position: { x: -167, y: 80, z: 152 }, dimension: 'nether', contents: { blaze_rod: 5 } }, { position: { x: -93, y: 39, z: 35 }, dimension: 'nether', contents: { ender_pearl: 11 } }] };
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cross_now', confidence: 0.7 } } }; } };
  assert.equal(await crossingKitReady(bot, new Task('win'), goal, () => {}, client), true);
  assert.match(asked.cross_now, /What waits there: 2 chests of the bot's own in the Nether, 5 blaze rods; 11 ender pearls, the farthest 220 blocks from its portal there; with what is kept here, 6 blaze rods and 12 ender pearls in all, about 12 eyes of ender\. Out to the chests and back is about 18 minutes/);
});

test('take_up_food at the crossing hands the ladder the food rung next, whatever rest it had (note 1964)', async () => {
  // full-3 (2026-10-20 15:14:15Z, 0 of 80 food points) chose take_up_food; the opt-in alone left the rung resting, the ladder went on to the crossing, and it was asked again ten seconds later and crossed with nothing to eat.
  const { crossingKitReady } = require('../src/work');
  const gp = require('../src/game-progress');
  const { setAside } = require('../src/progress');
  const bot = atPortal({ cobblestone: 128, stone_pickaxe: 1 });
  const goal = { kind: 'win' };
  // The food rung resting from an earlier failure, as it was.
  setAside(goal, 'rung', 'nether_food', 'came to nothing', 20 * 60000);
  const client = { systemOne: async ({ questions }) => ({ answers: { branch_0: { choice: questions.branch_0.criteria.take_up_food ? 'take_up_food' : 'cross_now', confidence: 0.63 } } }) };
  assert.equal(await crossingKitReady(bot, new Task('win'), goal, () => {}, client), false, 'not crossing: the food first');
  assert.ok(goal.foodTrip?.at, 'the food trip is set');
  const stage = gp.nextGameStage(bot, goal);
  assert.equal(stage?.phase, 'nether_food', `the ladder's next is ${stage?.phase}`);
});

test('take_up_food at the crossing runs the food step there and then, not a later pass (note 1969)', async () => {
  // full-2 (2026-10-20 17:45:48 and 17:45:58Z, 17 of 80 food points) chose take_up_food; handed back to the ladder, the crossing step ran again and the question came back ten seconds later, answered cross_now.
  const { crossingKitReady } = require('../src/work');
  const bot = atPortal({ cobblestone: 128, stone_pickaxe: 1 });
  const goal = { kind: 'win' };
  const asked = [];
  const client = { systemOne: async ({ questions }) => { const c = questions.branch_0.criteria; asked.push(Object.keys(c)); const choice = c.take_up_food ? 'take_up_food' : Object.keys(c).find(k => k !== 'none_good'); return { answers: { branch_0: { choice, confidence: 0.6 } } }; } };
  assert.equal(await crossingKitReady(bot, new Task('win'), goal, () => {}, client), false, 'not crossing');
  assert.ok(asked.length >= 2, `the food step asked its own question after the crossing's: ${asked.map(a => a.slice(0, 3).join('/')).join(' | ')}`);
  assert.ok(asked.slice(1).some(keys => keys.some(k => /food|go_without|cook/.test(k)) && !keys.includes('cross_now')), 'the food step\'s own question, not the crossing\'s again');
});

test('two iron pickaxes made on this run: the diamond pickaxe is the ladder\'s before the sword, deferrable; none made, it is not (note 2090)', () => {
  const { openRungs } = require('../src/game-progress');
  // Past the first Nether entry, where the deferrable rungs are the ladder's (note 776's rule is before it).
  const bot = atPortal({ ...FED, diamond_sword: 0, iron_sword: 1 });
  const been = { nether_entered: { at: 1 } };
  assert.ok(!openRungs(bot, { kind: 'win', gameProgress: { milestones: been } }).some(r => r.phase === 'diamond_pickaxe'));
  const worn = openRungs(bot, { kind: 'win', gameProgress: { milestones: been }, toolsMade: { iron_pickaxe: 2 } });
  assert.ok(worn.some(r => r.phase === 'diamond_pickaxe' && r.item === 'diamond_pickaxe'), JSON.stringify(worn));
});

test('a pickaxe worn out with three diamonds carried: the one made is diamond, not iron or stone (note 2091)', () => {
  const { nextGameStage } = require('../src/game-progress');
  const been = { kind: 'win', gameProgress: { milestones: { nether_entered: { at: 1 } } } };
  const worn = atPortal({ ...FED, iron_pickaxe: 0, stone_pickaxe: 0, iron_ingot: 6, diamond: 3 });
  assert.equal(nextGameStage(worn, been).item, 'diamond_pickaxe');
  const noDiamonds = atPortal({ ...FED, iron_pickaxe: 0, stone_pickaxe: 0, iron_ingot: 6 });
  assert.equal(nextGameStage(noDiamonds, been).item, 'iron_pickaxe');
});

test('the diamond rung set aside by choosing the Nether first: a worn pickaxe is still made again as diamond with three carried; set aside for failing, it is not (note 2094)', () => {
  const { nextGameStage } = require('../src/game-progress');
  const { setAside } = require('../src/progress');
  const worn = atPortal({ ...FED, iron_pickaxe: 0, stone_pickaxe: 0, iron_ingot: 6, diamond: 5 });
  const chose = { kind: 'win', gameProgress: { milestones: { nether_entered: { at: 1 } } } };
  setAside(chose, 'rung', 'diamond_pickaxe', 'Jev chose the Nether first', 30 * 60000);
  assert.equal(nextGameStage(worn, chose).item, 'diamond_pickaxe');
  const failed = { kind: 'win', gameProgress: { milestones: { nether_entered: { at: 1 } } } };
  setAside(failed, 'rung', 'diamond_pickaxe', 'the craft failed twice', 30 * 60000);
  assert.equal(nextGameStage(worn, failed).item, 'iron_pickaxe');
});
