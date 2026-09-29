'use strict';
// Note 648: one number for "enough blaze rods", and the rung that ends at it. mid-235-p-nether-4-fortress-6
// (25589, 2026-09-28) had seven rods at 18:57Z; the ladder wanted eight (sixteen eyes' worth, said nowhere) while
// the Nether stay's text said six rods and twelve pearls; the bot went home with seven, the ladder sent it back
// into the Nether for the eighth, and it died there holding all seven at 19:32Z.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const need = require('../src/eye-need');
const { observeProgress, nextGameStage } = require('../src/game-progress');
const blazeStand = require('../src/blaze-stand');
const script = require('../scripts/blaze-record');

const GEAR = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow'].map(name => ({ name, count: 1 }));
function fixture(dimension = 'overworld') {
  const items = [...GEAR], bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(),
    game: { dimension, gameMode: 'survival' }, health: 20, isAlive: true,
    entity: { position: new Vec3(.5, 64, .5) }, inventory: { items: () => items } });
  const goal = { version: 1, kind: 'win', request: 'Jev beat Minecraft' };
  const give = stock => { items.splice(0, items.length, ...GEAR, ...Object.entries(stock).map(([name, count]) => ({ name, count }))); };
  observeProgress(bot, goal);
  return { bot, goal, give, task: new Task('win') };
}

test('enough is one number: thirteen eyes, seven rods, thirteen pearls; the frames still empty once the portal is found', () => {
  const { bot, goal, give } = fixture();
  assert.equal(need.EYES_WANTED, 13, 'the twelve frames and the eye the search throws with (stronghold.js never throws the twelfth)');
  assert.equal(need.rodsFor(need.EYES_WANTED), 7, 'a rod makes two powder: thirteen powder is seven rods');
  give({});
  assert.deepEqual([need.need(bot, goal).target, need.need(bot, goal).rodsWanted, need.need(bot, goal).pearlsWanted], [13, 7, 13]);
  // Powder and eyes made count: rods are wanted for what is not yet made.
  give({ blaze_rod: 2, blaze_powder: 6, ender_eye: 3 });
  const n = need.need(bot, goal);
  assert.equal(n.rodsWanted, 2, '13 eyes - 3 made - 6 powder = 4 powder, 2 rods'); assert.equal(n.rodsLeft, 0); assert.equal(n.pearlsLeft, 10);
  // Converting a rod to powder does not change what is left to get.
  give({ blaze_rod: 3 }); const before = need.need(bot, goal).rodsLeft;
  give({ blaze_rod: 2, blaze_powder: 2 }); assert.equal(need.need(bot, goal).rodsLeft, before);
  // The portal found: its empty frames are the number (some come filled).
  goal.gameProgress.milestones.stronghold_located = { source: 'observed' }; goal.endPortal = { neededEyes: 10 };
  give({}); assert.deepEqual([need.need(bot, goal).target, need.need(bot, goal).rodsWanted], [10, 5]);
});

test('seven rods carried end the rung: the bot that went home with seven is not sent back into the Nether for an eighth', () => {
  const { bot, goal, give } = fixture('overworld');
  bot.game.dimension = 'minecraft:the_nether'; observeProgress(bot, goal); bot.game.dimension = 'overworld';
  give({ blaze_rod: 7 });
  const stage = nextGameStage(bot, goal);
  // The run at 19:13Z on 25589 went 'reach_nether' for the rods with seven; the next rung is the pearls (here by the warped
  // forest, a route the pearl question offers beside barter and the Overworld's endermen).
  assert.notEqual(stage.phase, 'reach_nether'); assert.notEqual(stage.phase, 'obtain_blaze_rods');
  assert.equal(stage.phase, 'obtain_ender_pearls', JSON.stringify(stage)); assert.equal(stage.item, 'ender_pearl'); assert.equal(stage.count, 13);
  give({ blaze_rod: 6 });
  const short = nextGameStage(bot, goal);
  assert.equal(short.phase, 'reach_nether', 'six rods make twelve eyes: one more rod is the thirteenth, said'); assert.equal(short.action, 'enter_nether');
});

test('in the Nether at seven rods the rods rung is over: the ladder goes on to the pearls or the way home, not to the fortress', () => {
  const { bot, goal, give } = fixture('minecraft:the_nether');
  give({ blaze_rod: 6 });
  assert.deepEqual(nextGameStage(bot, goal), { phase: 'obtain_blaze_rods', action: 'acquire', item: 'blaze_rod', count: 7 });
  give({ blaze_rod: 7 });
  const stage = nextGameStage(bot, goal);
  assert.notEqual(stage.phase, 'obtain_blaze_rods', JSON.stringify(stage));
  assert.notEqual(stage.action, 'rods_waiting'); assert.notEqual(stage.action, 'acquire');
  give({ blaze_rod: 4, blaze_powder: 6 });
  assert.notEqual(nextGameStage(bot, goal).phase, 'obtain_blaze_rods', 'four rods and six powder are seven rods');
});

test('the blaze hunt counts to the ladder\'s number, not the saved count from when the step began; a request\'s hunt keeps its own', () => {
  const { bot, goal, give } = fixture('minecraft:the_nether');
  goal.gameProgress.phase = 'obtain_blaze_rods';
  goal.mobHunt = { item: 'blaze_rod', entity: 'blaze', targetCount: 8 };
  give({ blaze_rod: 5 });
  assert.equal(blazeStand.rodsNeeded(bot, goal), 2, 'seven wanted, five carried; the eight saved when the step began is not a second number');
  assert.equal(blazeStand.rodsTarget(bot, goal), 7);
  assert.equal(blazeStand.rodsOf(bot, goal), 'the goal wants 7 in all for 13 eyes, 5 carried');
  give({ blaze_rod: 7 });
  assert.equal(blazeStand.rodsNeeded(bot, goal), 0); assert.equal(blazeStand.rodsTarget(bot, goal), 7);
  // Powder made of rods: the same rods still needed.
  give({ blaze_rod: 3, blaze_powder: 4 }); assert.equal(blazeStand.rodsNeeded(bot, goal), 2);
  // A chat request for rods ("get me 3 blaze rods") is that hunt's own count.
  const asked = { mobHunt: { item: 'blaze_rod', entity: 'blaze', targetCount: 3 }, request: 'get me 3 blaze rods' };
  give({ blaze_rod: 1 });
  assert.equal(blazeStand.rodsNeeded(bot, asked), 2); assert.equal(blazeStand.rodsTarget(bot, asked), 3); assert.equal(blazeStand.rodsOf(bot, asked), '');
});

test('what is carried against what the goal wants is one sentence with the number and its reason, and says when the rods are done', () => {
  const { bot, goal, give } = fixture();
  give({ blaze_rod: 4 });
  const s = need.says(bot, goal);
  assert.match(s, /^The goal wants 7 blaze rods in all for 13 eyes \(an End portal takes 12 eyes, an eye is one pearl and one blaze powder, a rod makes two powder, and the stronghold search throws only the eyes above 12/);
  assert.match(s, /so 13 eyes are what it begins on: 7 rods and 13 pearls\)\. Carried: 4 blaze rods, 0 ender pearls; 3 rods still needed\.$/);
  give({ blaze_rod: 7 });
  assert.match(need.says(bot, goal), /Carried: 7 blaze rods, 0 ender pearls; no rod is still needed: the rods are done, and the fortress has nothing more the goal needs\.$/);
  goal.gameProgress.milestones.stronghold_located = { source: 'observed' }; goal.endPortal = { neededEyes: 11 };
  assert.match(need.says(bot, goal), /for 11 eyes \(the portal has 11 frames still empty/);
});

test('the fortress questions carry it: fortress_visit says the number and what is carried; the towardRods lines say "of the N the goal wants"', () => {
  const visit = require('../src/fortress-visit');
  const { bot, goal, give } = fixture('minecraft:the_nether');
  goal.gameProgress.phase = 'obtain_blaze_rods';
  goal.mobHunt = { item: 'blaze_rod', entity: 'blaze', targetCount: 8 };
  give({ blaze_rod: 5 });
  bot.registry = require('minecraft-data')('26.1'); bot.food = 20; bot.entities = {}; bot.time = { timeOfDay: 6000 };
  bot.inventory.slots = {}; bot.blockAt = () => ({ name: 'netherrack', boundingBox: 'block', position: new Vec3(0, 63, 0) }); bot.world = { raycast: () => null };
  const { state } = visit.facts(bot, goal, { fortress: { distance: 40, height: 0 } });
  assert.equal(state.rodsStillNeeded, 2);
  assert.match(state.rodsTheGoalWants, /^The goal wants 7 blaze rods in all for 13 eyes .* Carried: 5 blaze rods, 0 ender pearls; 2 rods still needed\.$/);
  assert.match(blazeStand.towardRods(2, 'none', { of: blazeStand.rodsOf(bot, goal) }), /; 2 rods still needed \(the goal wants 7 in all for 13 eyes, 5 carried\)\.$/);
  assert.match(blazeStand.towardRods(2, 'comes'), /; 2 rods still needed\.$/, 'without a ladder, the count alone');
});

test('the fortress approach and the legs carry the brief line, at the end of the state (read first, the long one moved recorded answers)', () => {
  const { bot, goal, give } = fixture('minecraft:the_nether');
  goal.gameProgress.phase = 'obtain_blaze_rods';
  give({ blaze_rod: 1 });
  assert.equal(need.says(bot, goal, { brief: true }), 'Blaze rods: 1 carried, 7 wanted in all (13 eyes for the portal and the search), 6 still needed.');
  give({ blaze_rod: 7 });
  assert.match(need.says(bot, goal, { brief: true }), /7 carried, 7 wanted in all .*none still needed, the rods are done\.$/);
});

test('the funnel per run: rods reached, alive or dead, and the seconds from the last rod to the death (scripts/blaze-record.js --runs)', () => {
  const T0 = Date.parse('2026-09-28T10:00:00Z');
  const f = (s, snapshot) => ({ at: T0 + s * 1000, kind: 'observation', snapshot });
  const inv = (rod, powder = 0) => ({ blaze_rod: rod, blaze_powder: powder });
  const frames = [
    f(0, { health: 20, dimension: 'the_nether', inventory: inv(0) }),
    f(60, { health: 20, dimension: 'the_nether', inventory: inv(1) }),
    f(120, { health: 20, dimension: 'the_nether', inventory: inv(3) }),
    f(180, { health: 20, dimension: 'the_nether', inventory: inv(2, 2) }),   // a rod made into powder: still three
    f(300, { health: 0, dimension: 'the_nether' }),
    f(301, { health: 0, dimension: 'the_nether', inventory: inv(0) }),
    // The next life: overworld, no rods, then the Nether, six rods and out alive at the end of the record.
    f(310, { health: 20, dimension: 'overworld', inventory: inv(0) }),
    f(330, { health: 20, dimension: 'the_nether', inventory: inv(0) }),
    f(400, { health: 20, dimension: 'the_nether', inventory: inv(6) }),
    f(500, { health: 18, dimension: 'the_nether', inventory: inv(7) }),
  ];
  const list = script.runs(frames);
  assert.equal(list.length, 2);
  assert.deepEqual([list[0].died, list[0].inNether, list[0].startRods, list[0].maxRods, list[0].gained, list[0].secondsFromLastRodToDeath], [true, true, 0, 3, 3, 180], 'the death 180 seconds after the third rod');
  assert.deepEqual([list[1].died, list[1].maxRods, list[1].gained, list[1].secondsFromLastRodToDeath], [false, 7, 7, null]);
  const t = script.runsTable(list);
  assert.deepEqual([t.runs, t.inNether, t.diedInNether, t.mostRods], [2, 2, 1, 7]);
  assert.deepEqual([t.reaching[1].reached, t.reaching[1].alive, t.reaching[1].died], [2, 1, 1]);
  assert.deepEqual([t.reaching[3].reached, t.reaching[3].alive, t.reaching[3].died], [2, 1, 1]);
  assert.deepEqual([t.reaching[6].reached, t.reaching[6].alive, t.reaching[6].died], [1, 1, 0]);
  assert.equal(t.reaching[3].medianSecondsToDeathAfterLastRod, 180);
  // A run that began with rods in hand (a stage start from a save) reaches, and does not gain.
  const saved = script.runs([f(0, { health: 20, dimension: 'the_nether', inventory: inv(1) }), f(60, { health: 20, dimension: 'the_nether', inventory: inv(1) })]);
  assert.deepEqual([saved[0].startRods, saved[0].gained], [1, 0]);
  assert.equal(script.runsTable(saved).reaching[1].reached, 1); assert.equal(script.runsTable(saved).gainingInTheRun[1].reached, 0);
});
