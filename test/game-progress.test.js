'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { observeProgress, watchGameProgress, verifyGameCompletion, nextGameStage, gameStep } = require('../src/game-progress');
// These fixtures test the later ladder, so they carry the preparation gear
// (tools, shield, bucket) that the early rungs would otherwise ask for first.
const GEAR = ['diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow'].map(name => ({ name, count: 1 })).concat({ name: 'arrow', count: 16 });
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
  assert.equal(nextGameStage(bot, goal).item, 'iron_pickaxe', 'a death empties the pockets; the climb starts from the ladder, not the portal');
  bot.inventory.items = () => GEAR;
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether', 'with the whole kit the ladder is silent and the portal is next');
  bot.inventory.items = () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'blaze_rod', count: 2 }];
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether', 'Nether supplies in hand mean the later stages own the shopping');
});

test('progression resolves real carried eyes, powder, rods and pearls without spending them twice', () => {
  const { bot, goal, give } = fixture(); observeProgress(bot, goal);
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether');
  bot.game.dimension = 'minecraft:the_nether'; observeProgress(bot, goal);
  assert.equal(nextGameStage(bot, goal).count, 8);
  give({ ender_eye: 6, blaze_powder: 4, blaze_rod: 2 });
  assert.deepEqual(nextGameStage(bot, goal), { phase: 'obtain_blaze_rods', action: 'acquire', item: 'blaze_rod', count: 3 });
  give({ ender_eye: 6, blaze_powder: 4, blaze_rod: 3 });
  assert.equal(nextGameStage(bot, goal).action, 'return_overworld');
  bot.game.dimension = 'overworld';
  assert.equal(nextGameStage(bot, goal).item, 'ender_pearl'); assert.equal(nextGameStage(bot, goal).count, 10);
  give({ ender_eye: 6, blaze_powder: 4, blaze_rod: 3, ender_pearl: 10 });
  assert.equal(nextGameStage(bot, goal).item, 'ender_eye'); assert.equal(nextGameStage(bot, goal).count, 16);
  give({ ender_eye: 16 }); assert.equal(nextGameStage(bot, goal).action, 'find_stronghold');
  give({ ender_eye: 6 }); assert.equal(nextGameStage(bot, goal).action, 'enter_nether', 'Lost supplies require real replacement');
});

test('game steps call existing actions while retaining the original request and never finish at Nether entry', async () => {
  const { bot, goal, task } = fixture();
  const actions = { enter_nether: async (_b, _t, g) => { assert.equal(g, goal); bot.game.dimension = 'the_nether'; } };
  assert.equal(await gameStep(bot, task, goal, () => {}, actions), false);
  assert.equal(goal.kind, 'win'); assert.equal(goal.request, 'Jev beat Minecraft');
  actions.acquireStep = async (_b, _t, item, count, g) => { assert.equal(item, 'blaze_rod'); assert.equal(count, 8); assert.equal(g, goal); };
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
