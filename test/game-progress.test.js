'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { observeProgress, watchGameProgress, verifyGameCompletion, nextGameStage, gameStep } = require('../src/game-progress');
// These fixtures test the later ladder, so they carry the preparation gear
// (tools, shield, bucket) that the early rungs would otherwise ask for first.
const GEAR = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow'].map(name => ({ name, count: 1 })).concat({ name: 'arrow', count: 16 });
function fixture() {
  const items = [...GEAR], bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(),
    game: { dimension: 'overworld', gameMode: 'survival' }, health: 20, isAlive: true,
    entity: { position: new Vec3(.5, 64, .5) }, inventory: { items: () => items } });
  const goal = { version: 1, kind: 'win', request: 'Jev beat Minecraft' }, task = new Task('win');
  const give = stock => { items.splice(0, items.length, ...GEAR, ...Object.entries(stock).map(([name, count]) => ({ name, count }))); };
  return { bot, goal, task, give };
}
const credit = timestamp => ({ progressMapping: [{ key: 'minecraft:end/kill_dragon', value: [
  { criterionIdentifier: 'killed_dragon', criterionProgress: timestamp },
] }] });

test('the ladder runs again after a first Nether entry when the pockets hold no Nether supplies', () => {
  const { bot, goal } = fixture(); observeProgress(bot, goal);
  bot.game.dimension = 'minecraft:the_nether'; observeProgress(bot, goal);
  bot.game.dimension = 'overworld';
  assert(goal.gameProgress.milestones.nether_entered);
  bot.inventory.items = () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }];
  assert.equal(nextGameStage(bot, goal).phase, 'bed', 'a death empties the pockets; the climb starts from the ladder, not the portal');
  bot.inventory.items = () => GEAR;
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether', 'with the whole kit the ladder is silent and the portal is next');
  bot.inventory.items = () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'blaze_rod', count: 2 }];
  assert.equal(nextGameStage(bot, goal).phase, 'stone_sword', 'Nether supplies in hand skip the bed and the bucket, not the fighting kit');
  bot.inventory.items = () => [...GEAR.filter(i => !['white_bed', 'water_bucket', 'bow', 'arrow'].includes(i.name)), { name: 'blaze_rod', count: 2 }];
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether', 'with the kit on, the later stages own the shopping');
});

test('progression resolves real carried eyes, powder, rods and pearls without spending them twice', () => {
  const { bot, goal, give } = fixture(); observeProgress(bot, goal);
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether');
  bot.game.dimension = 'minecraft:the_nether'; observeProgress(bot, goal);
  assert.equal(nextGameStage(bot, goal).count, 7, 'thirteen eyes: seven rods (eye-need.js), not the eight the ladder once wanted unsaid');
  give({ ender_eye: 6, blaze_powder: 4, blaze_rod: 1 });
  assert.deepEqual(nextGameStage(bot, goal), { phase: 'obtain_blaze_rods', action: 'acquire', item: 'blaze_rod', count: 2 });
  give({ ender_eye: 6, blaze_powder: 4, blaze_rod: 2 });
  assert.equal(nextGameStage(bot, goal).action, 'warped_pearls', 'rods in hand: the pearls from the warped forest while here');
  require('../src/progress').setAside(goal, 'rung', 'warped_search', 'none found', 600000);
  assert.equal(nextGameStage(bot, goal).action, 'home_with_rods', 'the rods carried and the walk home not blindly begun: leaving is asked once, held (note 711)');
  bot.game.dimension = 'overworld';
  assert.equal(nextGameStage(bot, goal).item, 'ender_pearl'); assert.equal(nextGameStage(bot, goal).count, 7);
  assert.equal(nextGameStage(bot, goal).action, 'pearl_patrol', 'the warped search rested above: endermen on sight, something worth doing between');
  give({ ender_eye: 6, blaze_powder: 4, blaze_rod: 2, ender_pearl: 7 });
  assert.equal(nextGameStage(bot, goal).item, 'ender_eye'); assert.equal(nextGameStage(bot, goal).count, 13);
  give({ ender_eye: 13 }); assert.equal(nextGameStage(bot, goal).action, 'find_stronghold');
  give({ ender_eye: 6 }); assert.equal(nextGameStage(bot, goal).action, 'enter_nether', 'Lost supplies require real replacement');
});

test('game steps call existing actions while retaining the original request and never finish at Nether entry', async () => {
  const { bot, goal, task } = fixture();
  const actions = { enter_nether: async (_b, _t, g) => { assert.equal(g, goal); bot.game.dimension = 'the_nether'; } };
  assert.equal(await gameStep(bot, task, goal, () => {}, actions), false);
  assert.equal(goal.kind, 'win'); assert.equal(goal.request, 'Jev beat Minecraft');
  actions.acquireStep = async (_b, _t, item, count, g) => { assert.equal(item, 'blaze_rod'); assert.equal(count, 7); assert.equal(g, goal); };
  assert.equal(await gameStep(bot, task, goal, () => {}, actions), false);
  assert.equal(goal.gameProgress.phase, 'obtain_blaze_rods');
  assert(goal.gameProgress.milestones.nether_entered);
});

test('ordinary survey eye use continues searching and pending pickup precedes supply replenishment', () => {
  const { bot, goal, give } = fixture(); observeProgress(bot, goal);
  goal.strongholdSearch = { bearings: [], throws: 1 };
  give({ ender_eye: 15 }); assert.equal(nextGameStage(bot, goal).action, 'find_stronghold');
  give({ ender_eye: 12 }); assert.equal(nextGameStage(bot, goal).action, 'enter_nether');
  goal.strongholdSearch.pendingPickup = { end: { x: 1, y: 64, z: 1 } };
  assert.equal(nextGameStage(bot, goal).action, 'find_stronghold');
  delete goal.strongholdSearch.pendingPickup;
  goal.gameProgress.milestones.stronghold_located = { source: 'observed_end_portal_frame_ring' };
  give({ ender_eye: 11 }); assert.equal(nextGameStage(bot, goal).action, 'enter_end', 'Portal action must count actual empty frames instead of discarding spent-eye progress');
});

test('missing later actions report a concrete saved blocker; cancellation and Creative do not execute', async () => {
  const { bot, goal, task, give } = fixture(); give({ ender_eye: 16 });
  await assert.rejects(gameStep(bot, task, goal, () => {}, {}), /find stronghold action is not implemented/);
  assert.equal(goal.gameProgress.phase, 'find_stronghold');
  bot.game.gameMode = 'creative';
  await assert.rejects(gameStep(bot, task, goal, () => {}, {}), /requires Survival/);
  bot.game.gameMode = 'survival'; task.cancel();
  await assert.rejects(gameStep(bot, task, goal, () => {}, {}), { name: 'Cancelled' });
});

test('End entry waits for combat supplies instead of spending Eyes before preparation', async () => {
  const { bot, goal, task } = fixture(); observeProgress(bot, goal);
  goal.gameProgress.milestones.stronghold_located = { source: 'observed_end_portal_frame_ring' };
  let entered = 0, ready = false;
  const actions = { prepare_end: async () => ready, enter_end: async () => entered++ };
  await gameStep(bot, task, goal, () => {}, actions); assert.equal(entered, 0);
  ready = true; await gameStep(bot, task, goal, () => {}, actions); assert.equal(entered, 1);
});

test('fresh player kill credit plus living exit-portal return is required for completion', () => {
  const { bot, goal, give } = fixture(); let now = 1000, saves = 0;
  const detach = watchGameProgress(bot, goal, () => saves++, { now: () => now });
  bot._client.emit('advancements', credit(1001)); assert.equal(goal.gameProgress.milestones.dragon_defeated, undefined);
  bot.game.dimension = 'the_nether'; bot.emit('game'); give({ ender_eye: 12 });
  now = 2000; bot.game.dimension = 'the_end'; bot.emit('game');
  bot.emit('entityDead', { name: 'ender_dragon' }); assert.equal(verifyGameCompletion(bot, goal), false, 'A despawn/death observation alone gives no player kill credit');
  bot._client.emit('advancements', credit(999));
  bot._client.emit('advancements', credit(1500));
  bot._client.emit('advancements', credit(999999));
  assert.equal(goal.gameProgress.milestones.dragon_defeated, undefined, 'Old/pre-entry/future credit must not count');
  now = 3000; bot._client.emit('advancements', credit([0, 3000]));
  assert.equal(nextGameStage(bot, goal).action, 'exit_end');
  bot.game.dimension = 'overworld'; assert.equal(verifyGameCompletion(bot, goal), false, 'A dimension transition without exit-portal evidence is insufficient');
  bot.game.dimension = 'the_end'; now = 4000; bot._client.emit('game_state_change', { reason: 'win_game', gameMode: 1 });
  assert.equal(verifyGameCompletion(bot, goal), false, 'Still in the End');
  bot.game.dimension = 'overworld'; bot.emit('game'); assert(verifyGameCompletion(bot, goal));
  const entered = goal.gameProgress.milestones.nether_entered; delete goal.gameProgress.milestones.nether_entered;
  assert.equal(verifyGameCompletion(bot, goal), false, 'The earlier progression milestones remain required');
  goal.gameProgress.milestones.nether_entered = entered;
  bot.health = 0; assert.equal(verifyGameCompletion(bot, goal), false); bot.health = 20;
  assert(saves >= 3); detach();
  assert.equal(bot.listenerCount('game'), 0); assert.equal(bot.listenerCount('death'), 0);
  assert.equal(bot._client.listenerCount('advancements'), 0); assert.equal(bot._client.listenerCount('game_state_change'), 0);
});

test('death and reload preserve kill credit but cannot turn respawn into victory', () => {
  const { bot, goal, give } = fixture(); let now = 1000;
  const detach = watchGameProgress(bot, goal, () => {}, { now: () => now });
  bot.game.dimension = 'the_nether'; bot.emit('game'); give({ ender_eye: 12 });
  bot.game.dimension = 'the_end'; bot.emit('game');
  now = 2000; bot._client.emit('advancements', credit(2000n));
  now = 3000; bot._client.emit('game_state_change', { reason: 4, gameMode: 0 });
  const copy = JSON.parse(JSON.stringify(goal));
  now = 4000; bot.emit('death'); bot.game.dimension = 'overworld'; bot.emit('spawn');
  assert(goal.gameProgress.milestones.dragon_defeated); assert.equal(verifyGameCompletion(bot, goal), false);
  copy.survival = { deaths: [{ at: new Date(4000).toISOString() }] };
  assert.equal(verifyGameCompletion(bot, copy), false, 'Persisted death also invalidates an older exit event after reconnect');
  detach();
  const reloaded = JSON.parse(JSON.stringify(goal)), detachAgain = watchGameProgress(bot, reloaded, () => {}, { now: () => 5000 });
  assert.equal(reloaded.gameProgress.startedAt, 1000); assert.equal(verifyGameCompletion(bot, reloaded), false);
  assert(reloaded.gameProgress.milestones.dragon_defeated); detachAgain();
});

test('twenty working minutes on a rung that can wait put the choice of what next to Jev again, with the minutes; a waiting rung comes back before the Nether', () => {
  const { timeRung, RUNG_BUDGET_MS } = require('../src/game-progress');
  const { setAside } = require('../src/progress');
  const { bot, goal } = fixture(); observeProgress(bot, goal);
  bot.inventory.items = () => GEAR.filter(i => !['golden_boots', 'diamond_sword'].includes(i.name));
  assert.equal(nextGameStage(bot, goal).phase, 'golden_boots');
  goal.strategy = { choice: 'rung_golden_boots', ladderNext: 'golden_boots' };
  let now = Date.now(), fired = false;
  for (let t = 0; t <= RUNG_BUDGET_MS / 30000; t++) { now += 30000; if (timeRung(bot, goal, 'golden_boots', now)) { fired = true; break; } }
  assert(fired && !goal.strategy, 'the held strategy is dropped, so Jev is asked again');
  assert(!require('../src/progress').isSetAside(goal, 'rung', 'golden_boots'), 'not set aside by rule');
  assert(goal.rungTime.activeMs >= RUNG_BUDGET_MS, 'the minutes are kept for the question');
  // When Jev (or a stall answer) does leave it for later, the ladder goes on
  // and brings it back before the portal.
  setAside(goal, 'rung', 'golden_boots', 'Jev chose the rung for later', 1800000);
  assert.equal(nextGameStage(bot, goal).phase, 'diamond_sword', 'the ladder gets on with the next rung');
  bot.inventory.items = () => GEAR.filter(i => i.name !== 'golden_boots');
  assert.equal(nextGameStage(bot, goal).phase, 'golden_boots', 'with nothing else left, the waiting rung comes back instead of the portal');
});

test('a night in a shelter or a stop does not run a rung\'s budget down', () => {
  const { timeRung } = require('../src/game-progress');
  const goal = {}, bot = {};
  const start = Date.now();
  timeRung(bot, goal, 'shield', start);
  timeRung(bot, goal, 'shield', start + 10 * 60 * 1000);
  assert.equal(goal.rungTime.activeMs, 30000, 'a night away counts as half a minute');
  timeRung(bot, goal, 'shield', start + 60 * 60 * 1000);
  assert.equal(goal.rungTime.activeMs, 0, 'a clock untouched for half an hour and more is a rung come round again: it starts from nothing');
  timeRung(bot, goal, 'bucket', start + 60 * 60 * 1000 + 1000);
  assert.equal(goal.rungTime.phase, 'bucket'); assert.equal(goal.rungTime.activeMs, 0, 'a new rung starts a new clock');
});

test('a rung\'s clock keeps its time when another step comes between', () => {
  const { timeRung } = require('../src/game-progress');
  const goal = {}, bot = {};
  let now = Date.now();
  for (let i = 0; i < 10; i++) {
    timeRung(bot, goal, 'shield', now); now += 20000;
    timeRung(bot, goal, 'shield', now); now += 1000;
    timeRung(bot, goal, 'home_restock', now); now += 1000;
  }
  assert(goal.rungClocks.shield.activeMs >= 10 * 20000, 'the shield has had its twenty seconds ten times over');
});

test('a diamond pickaxe with two hundred uses left is a pickaxe, not a reason to make a stone one', () => {
  const { bot, goal } = fixture();
  bot.registry = require('minecraft-data')('26.1');
  const max = bot.registry.itemsByName.diamond_pickaxe.maxDurability;
  bot.inventory.items = () => [{ name: 'diamond_pickaxe', count: 1, durabilityUsed: max - 202 }, { name: 'iron_sword', count: 1 }];
  assert.notEqual(nextGameStage(bot, goal).phase, 'stone_pickaxe');
  bot.inventory.items = () => [{ name: 'diamond_pickaxe', count: 1, durabilityUsed: max - 20 }, { name: 'iron_sword', count: 1 }];
  assert.equal(nextGameStage(bot, goal).phase, 'stone_pickaxe', 'twenty uses is not a trip');
});

test('with blaze rods in hand the armour lost in a death is still made again before anything else', () => {
  const { bot, goal } = fixture(); observeProgress(bot, goal);
  const noArmour = GEAR.filter(i => !/^iron_(helmet|chestplate|leggings|boots)$/.test(i.name)).concat({ name: 'blaze_rod', count: 7 });
  bot.inventory.items = () => noArmour;
  const stage = nextGameStage(bot, goal);
  assert.match(stage.phase, /^iron_/, 'the armour rung, not the Nether');
  bot.inventory.items = () => GEAR.filter(i => i.name !== 'bucket' && i.name !== 'water_bucket').concat({ name: 'blaze_rod', count: 7 });
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether', 'a missing bucket is not the fighting kit and waits');
});

test('the bed and the armour can be left for later when they failed twice; the tools before them cannot', () => {
  const { bot, goal } = fixture(); observeProgress(bot, goal);
  const { setAside } = require('../src/progress');
  bot.inventory.items = () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'shield', count: 1 }, { name: 'water_bucket', count: 1 }];
  assert.equal(nextGameStage(bot, goal).phase, 'bed');
  goal.survival = {}; setAside(goal, 'rung', 'bed', 'failed twice without progress', 1800000);
  const next = nextGameStage(bot, goal).phase;
  assert.notEqual(next, 'bed', 'the bed waits');
  setAside(goal, 'rung', next, 'failed twice without progress', 1800000);
  assert.notEqual(nextGameStage(bot, goal).phase, next, 'and so can the rung after it');
  bot.inventory.items = () => [];
  setAside(goal, 'rung', 'stone_pickaxe', 'failed twice', 1800000);
  assert.match(nextGameStage(bot, goal).phase, /pickaxe|log|wood|table/, 'the first tools are not skipped: everything after needs them');
});

test('the steps still open are said with what each is for and what it takes from the pockets', () => {
  const { rungsAhead } = require('../src/game-progress');
  const { catalogPlan, planningInventory } = require('../src/work');
  const registry = require('minecraft-data')('26.1');
  const inv = { stone_pickaxe: 1, furnace: 1, stick: 3, crafting_table: 1, dirt: 11, wooden_pickaxe: 1, stone_sword: 1, spruce_log: 9 };
  const items = Object.entries(inv).map(([name, count], i) => ({ name, count, type: registry.itemsByName[name].id, slot: 9 + i, durabilityUsed: 0 }));
  const bot = { registry, version: '26.1', game: { gameMode: 'survival', dimension: 'minecraft:overworld' }, time: { timeOfDay: 17000 }, entity: { position: new Vec3(0, 64, 0) },
    entities: {}, inventory: { items: () => items, slots: [] }, blockAt: () => null, findBlocks: () => [], health: 20, food: 20 };
  const planFor = (b, item, count, goal) => catalogPlan(b, item, count, planningInventory(b), goal);
  const ahead = rungsAhead(bot, { kind: 'win', dream: 'beat_the_game' }, planFor);
  assert.deepEqual(ahead.map(r => r.step), ['bed', 'iron pickaxe']);
  assert.match(ahead[0].for, /wool/);
  assert.match(ahead[1].takes, /^mine 3 iron ore.*smelt 3 iron ingot.*craft 1 iron pickaxe$/);
  assert.deepEqual(rungsAhead(bot, { kind: 'request' }, planFor), []);
});

test('the blaze rods set aside because their sources are in the Overworld: the ladder offers the routes, not the same acquire', async () => {
  // mid-227-r-nether-1: iron ore planned in the Nether 1,130 times in twenty-five minutes; the ten-minute set-aside was never read (note 476).
  const { setAside, isSetAside } = require('../src/progress');
  const { bot, goal, task, give } = fixture();
  bot.game.dimension = 'minecraft:the_nether'; observeProgress(bot, goal);
  give({ ender_eye: 6, blaze_powder: 4, blaze_rod: 1 });
  const why = 'No iron ore in the nether: it is only found in the overworld';
  goal.wrongDimension = { n: 3, at: Date.now(), error: why, phase: 'obtain_blaze_rods', block: 'iron_ore', to: 'overworld', step: { action: 'mine', block: 'iron_ore', drops: 'raw_iron', count: 5 } };
  setAside(goal, 'rung', 'obtain_blaze_rods', why, 600000);
  const stage = nextGameStage(bot, goal);
  assert.notDeepEqual(stage, { phase: 'obtain_blaze_rods', action: 'acquire', item: 'blaze_rod', count: 2 });
  assert.equal(stage.action, 'elsewhere'); assert.equal(stage.phase, 'obtain_blaze_rods'); assert.match(stage.why, /only found in the overworld/);
  // Asked: the Overworld for what is found there, or the warped forest's pearls here meanwhile.
  const asked = [], left = [];
  const client = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'go_overworld', confidence: 0.9 } } }; } };
  const helmet = [{ action: 'mine', block: 'iron_ore', drops: 'raw_iron', count: 5, produces: { raw_iron: 5 }, consumes: {} },
    { action: 'smelt', item: 'iron_ingot', count: 5, consumes: { raw_iron: 5, coal: 1 }, produces: { iron_ingot: 5 } },
    { action: 'craft', item: 'iron_helmet', count: 1, consumes: { iron_ingot: 5 }, produces: { iron_helmet: 1 } },
    { action: 'hunt_mob', entity: 'blaze', item: 'blaze_rod', count: 1, requires: { iron_helmet: 1 }, consumes: {}, produces: { blaze_rod: 1 } }];
  const actions = { client, planFor: () => helmet, acquireStep: async () => assert.fail('not the same acquire again'), return_overworld: async () => left.push('portal') };
  assert.equal(await gameStep(bot, task, goal, () => {}, actions), false);
  assert.equal(asked.length, 1, 'the routes are Jev\'s');
  assert(asked[0].go_overworld && asked[0].on_here, Object.keys(asked[0]).join(','));
  assert.match(asked[0].go_overworld, /5 iron ore, found only there, and back with 1 iron helmet/);
  assert.match(asked[0].on_here, /go on here with obtain ender pearls/);
  assert.deepEqual(goal.errand.items, [{ item: 'iron_helmet', count: 2 }], 'one more than the helmet carried');
  assert(!isSetAside(goal, 'rung', 'obtain_blaze_rods'), 'the way chosen replaces the set-aside');
  assert.deepEqual(nextGameStage(bot, goal), { phase: 'errand', action: 'return_overworld', for: 'obtain_blaze_rods' });
  await gameStep(bot, task, goal, () => {}, actions);
  assert.deepEqual(left, ['portal']);
  bot.game.dimension = 'overworld';
  assert.deepEqual(nextGameStage(bot, goal), { phase: 'errand', action: 'acquire', item: 'iron_helmet', count: 2, for: 'obtain_blaze_rods' });
  // A plan that needs the other dimension is not begun: acquireStep hands it to the choice.
  bot.game.dimension = 'minecraft:the_nether'; delete goal.errand;
  let handed = null;
  actions.acquireStep = async (_b, _t, _item, _count, _g, _s, { elsewhere }) => { handed = elsewhere; };
  await gameStep(bot, task, goal, () => {}, actions);
  assert.equal(typeof handed, 'function', 'the ladder\'s acquire carries the elsewhere answer');
});

test('an errand set aside waits its rest like any rung: the loop\'s set-aside and Jev\'s set_aside_rung are read', async () => {
  // mid-243-af-nether-3-fortress-1 (note 603): the errand for an oak log (the goal as archived at 12:06), its way back
  // needing the log, set itself aside ninety times a minute for ten minutes ("the errand step set aside ten minutes"),
  // and set_aside_rung chosen at 12:05:32 and 12:05:35 changed nothing: errandStage read no set-aside.
  const { setAside } = require('../src/progress');
  const { bot, goal } = fixture();
  bot.game.dimension = 'minecraft:the_nether'; observeProgress(bot, goal);
  goal.errand = { dimension: 'overworld', items: [{ item: 'oak_log', count: 1 }], for: 'obtain_blaze_rods', at: Date.now() - 30 * 60000 };
  assert.deepEqual(nextGameStage(bot, goal), { phase: 'errand', action: 'return_overworld', for: 'obtain_blaze_rods' });
  setAside(goal, 'rung', 'errand', 'No oak log in the nether: it is only found in the overworld', 600000);
  assert.notEqual(nextGameStage(bot, goal).phase, 'errand', 'set aside, the ladder goes on');
  // Its rest over, the errand comes back while its hour lasts.
  setAside(goal, 'rung', 'errand', 'rested', 1);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(nextGameStage(bot, goal).phase, 'errand');
});

test('the rods set aside in the Nether for a stall: leaving is Jev\'s, with why they wait, the trip and the hour on the other side', async () => {
  // mid-218-m-nether-1 and the mid-202-o-nether trials (note 495): a ladder short of rods whose step waited went back
  // through the portal unasked (nextGameStage's return_overworld), whatever the reason the rods waited.
  const { setAside, isSetAside } = require('../src/progress');
  const { bot, goal, task, give } = fixture();
  bot.game.dimension = 'minecraft:the_nether'; observeProgress(bot, goal);
  bot.time = { timeOfDay: 11000 };
  give({ ender_eye: 6, blaze_powder: 4, blaze_rod: 1 });
  goal.portals = [{ x: 20, y: 102, z: 7, dimension: 'nether' }];
  bot.entity.position = new Vec3(-2, 87, -15);
  setAside(goal, 'rung', 'obtain_blaze_rods', 'No measurable progress on find_fortress', 600000);
  setAside(goal, 'rung', 'warped_search', 'none found', 600000);
  const stage = nextGameStage(bot, goal);
  assert.notEqual(stage.action, 'return_overworld', 'not back through the portal without a decision');
  assert.equal(stage.action, 'rods_waiting'); assert.match(stage.why, /No measurable progress/);
  const asked = [], left = [];
  const picks = ['wait_here', 'go_back'];
  const states = [];
  const client = { systemOne: async ({ state, questions }) => { states.push(state); asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
  const holds = [];
  const actions = { client, return_overworld: async () => left.push('portal'), acquireStep: async () => assert.fail('the rods wait'), hold_for_rest: async (b, t, g, sv, opts) => holds.push(opts) };
  // Other work here till the rest ends: the stage's own work (note 605), and not asked again for the same rest.
  await gameStep(bot, task, goal, () => {}, actions);
  assert.equal(holds.length, 1); assert.equal(holds[0].reason, 'step:rods_waiting');
  assert.match(holds[0].why, /The blaze rods step waits \(No measurable progress on find_fortress\), taken up again in 10 minutes/);
  assert.equal(asked.length, 1);
  assert.deepEqual(Object.keys(asked[0]).sort(), ['go_back', 'search_on', 'wait_here']);
  assert.match(states[0].rodsTheGoalWants, /^The goal wants 2 blaze rods in all for 13 eyes .* Carried: 1 blaze rod, 4 blaze powder, 6 eyes, 0 ender pearls; 1 rod still needed\.$/, 'the number the rods step is for, against what is carried (note 648)');
  assert.match(asked[0].go_back, /The nearest portal remembered is 31 blocks off, about 7 seconds at a walk/);
  assert.match(asked[0].go_back, /comes out in the Overworld at dusk/);
  assert.match(asked[0].go_back, /Back there the ladder's next step is the Nether again for the rods/);
  await gameStep(bot, task, goal, () => {}, actions);
  assert.equal(holds.length, 2);
  assert.equal(asked.length, 1, 'the same rest met again is not the question again');
  // Without the hold (a caller that has none), the rest is thrown as before.
  const { hold_for_rest: _unused, ...bare } = actions;
  await assert.rejects(gameStep(bot, task, goal, () => {}, bare), err => err.name === 'WaysResting');
  assert.deepEqual(left, []);
  // Asked afresh: back, as Jev chose, and kept while the rest stands.
  delete goal.leaveNether;
  await gameStep(bot, task, goal, () => {}, actions);
  assert.equal(asked.length, 2); assert.deepEqual(left, ['portal']);
  assert.equal(nextGameStage(bot, goal).action, 'return_overworld', 'kept: the way back goes on');
  // The rods taken up again instead: the rest lifted.
  delete goal.leaveNether; picks.push('search_on');
  await gameStep(bot, task, goal, () => {}, actions);
  assert(!isSetAside(goal, 'rung', 'obtain_blaze_rods'));
  assert.equal(nextGameStage(bot, goal).action, 'acquire');
});

test('a "go back" Jev chose ends with the stay it was chosen in: in again by the crossing, leaving is asked again', () => {
  // mid-218-m-nether-3 (note 502): back for food at 20:59, in again with none by Jev's cross_now at 21:03, and on the
  // far side the held go_back turned it round at once, out of the sheet into soul fire.
  const { netherLeaveHeld } = require('../src/game-progress');
  const { bot, goal } = fixture(), t0 = 1_000_000;
  bot.game.dimension = 'minecraft:the_nether'; observeProgress(bot, goal, t0);
  goal.leaveNether = { reason: 'food', pick: 'go_back', until: 0, at: t0 + 1000 };
  observeProgress(bot, goal, t0 + 1500);
  assert.equal(netherLeaveHeld(goal, 'food', t0 + 2000), true, 'kept on the way to the portal');
  bot.game.dimension = 'overworld'; observeProgress(bot, goal, t0 + 60000);
  observeProgress(bot, goal, t0 + 90000);
  bot.game.dimension = 'minecraft:the_nether'; observeProgress(bot, goal, t0 + 240000);
  assert.equal(netherLeaveHeld(goal, 'food', t0 + 241000), false, 'a new stay: the way back is Jev\'s to choose again');
});
