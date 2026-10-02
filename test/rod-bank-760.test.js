'use strict';
// Note 760: rods never carried out. (1) The crossing kit's chest: of 122
// Nether entries from 2026-09-29T23:00Z to 2026-09-30T17:00Z none carried a
// chest, and the rung that asked for one was open only while the wood for one
// was short, chosen 0 of 60 times. It is open now while no chest is carried,
// said with what a chest is for and its cost. (2) The rods got so far banked
// past the portal (rod-bank.js): offered in the rods stage, held through the
// portal, stored on the Overworld side, counted as held, and taken out there
// once the rods carried and banked are what the goal wants.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const es = require('../src/empty-spawner');
const rb = require('../src/rod-bank');
const rs = require('../src/rod-stash');
const room = require('./fixtures/spawner-lull-25589.json');
const rec = require('./fixtures/spawner-lull-frame-25589.json');
require('../src/decisions/travel');
require('../src/decisions/combat');
const { question } = require('../src/decisions');
const registry = require('minecraft-data')('26.1');

const CAGE = new Vec3(rec.cage.x, rec.cage.y, rec.cage.z);
// 25589's lull at the cage with no chest and no wood carried: the 34 of 46.
const BARE = Object.fromEntries(Object.entries(rec.inventory).filter(([k]) => !/_(log|planks)$|^crafting_table$/.test(k)));
function frameBot({ inventory = { ...BARE, blaze_rod: 4 }, health = 12, dimension = 'the_nether' } = {}) {
  const bot = groundBot(room, { at: new Vec3(rec.position.x, rec.position.y, rec.position.z), health, food: 18, items: Object.entries(inventory).filter(([, n]) => n > 0), worn: ['iron_helmet', 'iron_chestplate'], dimension: 'the_nether', indexed: true, mobs: [] });
  bot.changed.set(`${CAGE.x},${CAGE.y},${CAGE.z}`, 'spawner');
  bot._spawnClock = { tries: {}, near: {} };
  bot.game.dimension = dimension;
  return bot;
}
// The portal the bot came through, 40 blocks off.
const PORTAL = { dimension: 'nether', x: -192, y: 81, z: 166 };
const huntGoal = () => ({ kind: 'win', gameProgress: { milestones: {} }, survival: { deaths: [] }, portals: [{ ...PORTAL }], fortressSearch: { legs: 1, map: { cells: {}, failed: {}, spawners: [{ ...rec.cage }], chests: [] } } });
const task = { check() {} };
const rodsOf = bot => bot.inventory.items().filter(i => i.name === 'blaze_rod').reduce((n, i) => n + i.count, 0);
function chestWorld(bot) {
  const held = new Map(), items = bot.inventory.items();
  const take = (name, n) => { let left = n; for (const i of items.filter(x => x.name === name)) { const k = Math.min(left, i.count); i.count -= k; left -= k; } for (let j = items.length - 1; j >= 0; j--) if (items[j].count <= 0) items.splice(j, 1); return n - left; };
  bot.openContainer = async block => {
    const key = `${block.position}`;
    if (!held.has(key)) held.set(key, {});
    const c = held.get(key);
    return {
      containerItems: () => Object.entries(c).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })),
      deposit: async (id, meta, n) => { const name = registry.items[id].name; c[name] = (c[name] || 0) + take(name, n); },
      withdraw: async (id, meta, n) => { const name = registry.items[id].name; const k = Math.min(n, c[name] || 0); c[name] -= k; const i = items.find(x => x.name === name); if (i) i.count += k; else items.push({ name, count: k, type: id }); },
      close() {},
    };
  };
  const place = async (b, t, cell, name) => { assert.equal(take(name, 1), 1, `a ${name} carried`); bot.changed.set(`${cell.x},${cell.y},${cell.z}`, name); };
  return { held, place };
}

test('the crossing kit asks for a chest itself while none is carried, said with what it is for (the record of rods carried without one) and its cost', () => {
  const { kitRungs, kitRungSays } = require('../src/crossing-kit');
  const { CHEST_RECORD } = require('../src/rod-risk');
  assert.deepEqual([CHEST_RECORD.entries, CHEST_RECORD.withChest, CHEST_RECORD.deaths2, CHEST_RECORD.deaths2Neither], [122, 0, 46, 34]);
  const items = { stone_pickaxe: 2, iron_pickaxe: 1, cobblestone: 128, cooked_beef: 12 };
  const mk = inv => { const list = Object.entries(inv).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 })); return { registry, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, inventory: { items: () => list, slots: [] }, entity: { position: new Vec3(0, 64, 0) } }; };
  const bare = kitRungs(mk(items), {}).find(r => r.phase === 'nether_chest');
  const said = kitRungSays(mk(items), {}, bare);
  assert.match(said, /^ What it is for: a death in the Nether drops every rod carried where the bot falls, and it comes back to life in the Overworld; rods put in a chest there \(stash_rods, a second or so\) are kept through a death/);
  assert.match(said, /55 lives carried 2 or more rods in the Nether: 49 died with them, none carried them out, 183 rods lost in all; of the 46 deaths that dropped 2 or more rods, 34 carried neither a chest nor the wood for one/);
  assert.match(said, /Of 122 Nether entries, 0 carried a chest\. Its cost: 8 planks \(2 logs\) and one slot\. 0 planks' worth of wood carried of the 12 it takes \(8 for the chest, 4 for a crafting table, none carried\)\.$/);
  // The wood for one carried: the rung stays, made now.
  const wood = kitRungs(mk({ ...items, oak_log: 3 }), {}).find(r => r.phase === 'nether_chest');
  assert.equal(wood.makesNow, true);
  assert.match(kitRungSays(mk({ ...items, oak_log: 3 }), {}, wood), /The wood carried makes it now \(12 planks' worth, 4 of them for a crafting table\): a few seconds\. Wood carried in unmade is spent there on sticks, tables and planks: of the 55 lives that carried 2 or more rods in the Nether, 24 had the wood for a chest at their start and 15 at their end\.$/);
  assert.equal(kitRungs(mk({ ...items, chest: 1 }), {}).some(r => r.phase === 'nether_chest'), false, 'a chest carried closes it');
});

test('bank_rods in the rods stage: offered with 2 or more rods carried, rods still wanted and the portal\'s walk open, said with the chest there, the walk, the round trip and the record', () => {
  const bot = frameBot(), goal = huntGoal();
  const offer = rb.bankOffer(bot, goal);
  assert.ok(offer, 'offered');
  assert.deepEqual([offer.rods, offer.left, offer.d, offer.chest.how], [4, 3, 40, 'tree']);
  const said = rb.offerSays(offer);
  assert.match(said, /^Bank the rods got so far: walk back to the portal 40 blocks off with the 4 blaze rods, go through the portal, put them in a chest made on the Overworld side from a tree's wood there \(2 logs for the chest and 1 for a crafting table; no chest or wood is carried/);
  assert.match(said, /come back through for the 3 rods still needed\. About 9 seconds at a walk\. There and back is about 1 minute and the time the wood takes on the Overworld side, no rod meanwhile\./);
  assert.match(said, /once in the chest they are kept through any death after, counted as held, and taken out once the rods carried and banked together are what the goal wants, so a death after loses only the rods got since\. Staying with them: In the trials of 2026-09-29T23:00Z to 2026-09-30T17:00Z, 19 lives carried 4 or more rods in the Nether: 17 died with them, none carried them out \(2 ended with the trial\)\.$/);
  // The chest carried, or the wood for one, is said so.
  assert.equal(rb.bankOffer(frameBot({ inventory: { ...BARE, blaze_rod: 4, chest: 1 } }), huntGoal()).chest.how, 'carried');
  assert.equal(rb.bankOffer(frameBot({ inventory: { ...BARE, blaze_rod: 4, oak_log: 3 } }), huntGoal()).chest.how, 'wood');
  // Offered from the first rod (note 874). Not offered: no rod, the rods done, no portal known, under way already.
  assert.equal(rb.bankOffer(frameBot({ inventory: { ...BARE, blaze_rod: 1 } }), huntGoal()).rods, 1);
  assert.equal(rb.bankOffer(frameBot({ inventory: { ...BARE, blaze_rod: 0, blaze_powder: 0 } }), huntGoal()), null);
  assert.equal(rb.bankOffer(frameBot({ inventory: { ...BARE, blaze_rod: 7 } }), huntGoal()), null);
  assert.equal(rb.bankOffer(bot, { ...huntGoal(), portals: [] }), null);
  assert.equal(rb.bankOffer(bot, { ...huntGoal(), rodBank: { at: Date.now() } }), null);
  assert.equal(rb.bankOffer(frameBot({ dimension: 'overworld' }), huntGoal()), null);
  // In empty_spawner's ways, and registered in both rods-stage questions.
  const known = es.knownSpawner(bot, goal);
  const tree = es.options(bot, task, goal, () => {}, { navigate: async () => {} }, known, { now: Date.now() });
  assert.ok(tree.bank_rods, Object.keys(tree).join(', '));
  for (const id of ['empty_spawner', 'hunt_target']) assert.ok(question(id).options.some(o => o.key === 'bank_rods'), id);
});

test('banked: the walk out held through the portal, the chest set down on the Overworld side, counted as held, the Nether again for the rest, and taken out there once they make the seven', async () => {
  const { nextGameStage } = require('../src/game-progress');
  const bot = frameBot({ inventory: { ...BARE, blaze_rod: 4, chest: 1, ender_pearl: 13 } }), goal = huntGoal();
  const offer = rb.bankOffer(bot, goal);
  let walked = 0;
  const said = [];
  bot.chat = m => said.push(m);
  // A set-aside of the stage from an earlier walk out does not end the bank chosen now (note 887).
  require('../src/progress').setAside(goal, 'rung', 'bank_rods', 'No oak log in the nether: it is only found in the overworld', 600000);
  await rb.option(bot, task, goal, () => {}, { returnOverworld: async () => { walked++; } }, offer).run();
  assert.equal(walked, 1, 'the walk begins at once');
  assert.equal(require('../src/progress').isSetAside(goal, 'rung', 'bank_rods'), false);
  assert.match(said[0], /^Taking the 4 blaze rods out to a chest past the portal, then back for the rest\.$/);
  // Held: the ladder walks out, not the hunt.
  assert.deepEqual([nextGameStage(bot, goal).phase, nextGameStage(bot, goal).action], ['bank_rods', 'return_overworld']);
  // Out: the chest set down and the rods in.
  bot.game.dimension = 'overworld';
  const stage = nextGameStage(bot, goal);
  assert.deepEqual([stage.phase, stage.action], ['bank_rods', 'bank_rods']);
  const { place } = chestWorld(bot);
  // A rest from a bank begun on arrival is lifted by the store (note 881): the next coming out banks again.
  require('../src/progress').setAside(goal, 'rod_bank', 'arrival', 'banked on coming out with rods', 30 * 60000);
  assert.equal(await rb.bank(bot, task, goal, () => {}, { place, navigate: async () => {} }), true);
  assert.equal(require('../src/progress').isSetAside(goal, 'rod_bank', 'arrival'), false);
  assert.equal(rodsOf(bot), 0);
  assert.equal(goal.rodStashes[0].dimension, 'overworld');
  assert.equal(goal.rodStashes[0].contents.blaze_rod, 4);
  assert.ok(goal.rodBank.doneAt);
  assert.match(said.at(-1), /^Banked 4 blaze rods, 13 ender pearls in a chest at \(-?\d+, \d+, -?\d+\)\. Back to the Nether for the rest\.$/);
  const en = require('../src/eye-need');
  assert.equal(en.need(bot, goal).rodsLeft, 3, 'counted as held');
  assert.match(en.says(bot, goal), /in a chest: 4 blaze rods, 13 ender pearls in a chest at \(.*\) in the Overworld; 3 rods still needed/);
  const next = nextGameStage(bot, goal);
  assert.ok(!['bank_rods', 'collect_rod_stash'].includes(next.phase), `${next.phase}: not taken out while short`);
  // The Nether again: the hunt is for the 3 still needed, and with them the walk home, not a chest here.
  bot.game.dimension = 'the_nether';
  const hunt = nextGameStage(bot, goal);
  assert.deepEqual([hunt.phase, hunt.item, hunt.count], ['obtain_blaze_rods', 'blaze_rod', 3]);
  bot.inventory.items().push({ name: 'blaze_rod', count: 3, type: registry.itemsByName.blaze_rod.id });
  assert.equal(nextGameStage(bot, goal).phase, 'return_with_blaze_supplies');
  // Out again: the bank is emptied, the seven carried at once.
  bot.game.dimension = 'overworld';
  const take = nextGameStage(bot, goal);
  assert.deepEqual([take.phase, take.action], ['collect_rod_stash', 'collect_rod_stash']);
  assert.equal(await rs.collect(bot, task, goal, () => {}, { navigate: async () => {} }), true);
  assert.equal(rodsOf(bot), 7);
  assert.match(said.join(' '), /Taking 4 blaze rods, 13 ender pearls out of the chest at \(-?\d+, \d+, -?\d+\)\. Took/);
});

test('a bank ends where there is nothing left to bank, the walk out ran past its time, or the store failed twice; with no chest and no wood the chest is made first', async () => {
  const { nextGameStage } = require('../src/game-progress');
  // A death on the walk out: nothing carried, the bank ends and the hunt goes on.
  const dead = frameBot({ inventory: { ...BARE, blaze_rod: 0 } }), g1 = { ...huntGoal(), rodBank: { at: Date.now(), rods: 4 } };
  assert.notEqual(nextGameStage(dead, g1).phase, 'bank_rods');
  assert.ok(g1.rodBank.endedAt);
  // Past twenty minutes in the Nether.
  const slow = frameBot(), g2 = { ...huntGoal(), rodBank: { at: Date.now() - rb.OUT_MS - 1000, rods: 4 } };
  assert.notEqual(nextGameStage(slow, g2).phase, 'bank_rods');
  assert.match(g2.rodBank.why, /twenty minutes/);
  // Out with no chest and no wood: the chest is the ladder's to make.
  const out = frameBot({ dimension: 'overworld' }), g3 = { ...huntGoal(), rodBank: { at: Date.now(), rods: 4 } };
  const s3 = nextGameStage(out, g3);
  assert.deepEqual([s3.phase, s3.action, s3.item], ['bank_rods', 'acquire', 'chest']);
  // Two failed stores end it.
  const g4 = { ...huntGoal(), rodBank: { at: Date.now(), rods: 4, fails: 2, lastError: 'no anchor' } };
  const out4 = frameBot({ dimension: 'overworld', inventory: { ...BARE, blaze_rod: 4, chest: 1 } });
  assert.notEqual(nextGameStage(out4, g4).phase, 'bank_rods');
  assert.match(g4.rodBank.why, /failed 2 times: no anchor/);
  // The kit is not asked for on the Overworld side with the rods banked and done.
  const { kitRungs } = require('../src/crossing-kit');
  const done = frameBot({ dimension: 'overworld', inventory: { ...BARE, blaze_rod: 3 } });
  done.registry = registry;
  const g5 = { ...huntGoal(), rodStashes: [{ position: { x: 0, y: 70, z: 0 }, dimension: 'overworld', contents: { blaze_rod: 4 } }] };
  assert.deepEqual(kitRungs(done, g5), []);
});

test('at the crossing, no chest carried and the wood for one: top_up_chest asks the question on its own, said with what a chest is for; a chest carried, not asked', async () => {
  const { crossingKitReady } = require('../src/work');
  const { Task } = require('../src/skills');
  const GEAR = { iron_pickaxe: 1, stone_pickaxe: 1, diamond_sword: 1, shield: 1, water_bucket: 1, iron_helmet: 1, iron_chestplate: 1, iron_leggings: 1, iron_boots: 1, golden_boots: 1, white_bed: 1, bow: 1, arrow: 16, oak_log: 8, crafting_table: 1, cooked_beef: 10, cobblestone: 128 };
  const atPortal = extra => {
    const items = Object.entries({ ...GEAR, ...extra }).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
    return { registry, health: 20, food: 20, oxygenLevel: 20, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, time: { timeOfDay: 6000 },
      entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8, width: 0.6, onGround: true }, entities: {}, inventory: { items: () => items, slots: [], emptySlotCount: () => 20 },
      blockAt: p => { const q = p.floored(); const name = q.y < 64 ? 'grass_block' : 'air'; return { name, position: q, boundingBox: name === 'air' ? 'empty' : 'block', getProperties: () => ({}) }; },
      findBlocks: () => [], world: { raycast: () => null }, pathfinder: { movements: {} } };
  };
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cross_now', confidence: 0.7 } } }; } };
  assert.equal(await crossingKitReady(atPortal({}), new Task('win'), { kind: 'win' }, () => {}, client), true);
  assert.deepEqual(Object.keys(asked).sort(), ['cross_now', 'top_up_chest']);
  assert.match(asked.top_up_chest, /^Make a chest from the wood carried first and carry it in \(8 planks at the crafting table carried, a few seconds, one slot\)\. What it is for: a death in the Nether drops every rod carried/);
  assert.match(asked.cross_now, /Left from the ladder's kit steps: chest 0 of 1\./);
  asked = null;
  assert.equal(await crossingKitReady(atPortal({ chest: 1 }), new Task('win'), { kind: 'win' }, () => {}, client), true);
  assert.equal(asked, null);
});

test('out of the Nether with rods for another reason, the bank begins on arrival; once a trip (note 868)', () => {
  const gp = require('../src/game-progress');
  const bot = frameBot({ inventory: { ...BARE, blaze_rod: 2 }, dimension: 'overworld' });
  const said = []; bot.chat = m => said.push(m);
  const arrived = () => { const g = huntGoal(); g.gameProgress.here = { dimension: 'overworld', at: Date.now() - 20000 }; return g; };
  // No stay on record (a goal that never looked at where it is): nothing begun.
  assert.equal(rb.bankOnArrival(bot, huntGoal(), 'overworld'), false);
  // Long out with the rods still carried (25597, out before note 868 ran): begun all the same (note 873).
  const long = huntGoal(); long.gameProgress.here = { dimension: 'overworld', at: Date.now() - 40 * 60000 };
  assert.equal(rb.bankOnArrival(bot, long, 'overworld'), true);
  const goal = arrived();
  assert.equal(rb.bankOnArrival(bot, goal, 'overworld'), true);
  assert.equal(goal.rodBank.rods, 2);
  assert.equal(goal.rodBank.onArrival, true);
  assert.match(said[0], /^Out with 2 blaze rods: into a chest here first, 5 more to get\.$/);
  // The ladder's next stage is the bank's: the chest made, or the store.
  assert.equal(gp.nextGameStage(bot, goal).phase, 'bank_rods');
  // Under way already, or begun once this trip: not begun again.
  assert.equal(rb.bankOnArrival(bot, goal, 'overworld'), false);
  goal.rodBank.endedAt = Date.now();
  assert.equal(rb.bankOnArrival(bot, goal, 'overworld'), false, 'not again within half an hour');
  // In the Nether, or with no rod carried: nothing.
  assert.equal(rb.bankOnArrival(frameBot({ inventory: { ...BARE, blaze_rod: 2 } }), huntGoal(), 'nether'), false);
  assert.equal(rb.bankOnArrival(frameBot({ inventory: { ...BARE, blaze_rod: 0, blaze_powder: 0 }, dimension: 'overworld' }), arrived(), 'overworld'), false);
});

test('two rods at the cage: asked on its own, out now or stay; once for each count of rods (rods_now, note 871)', async () => {
  const bot = frameBot({ inventory: { ...BARE, blaze_rod: 2 } });
  const goal = huntGoal();
  const asked = [], answers = ['stay_for_more', 'bank_now'];
  const client = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: answers.shift(), confidence: 0.9 } } }; } };
  let walked = 0;
  const actions = { returnOverworld: async () => { walked++; } };
  assert.equal(await rb.askBank(bot, task, goal, () => {}, actions, client), 'stay');
  assert.deepEqual(Object.keys(asked[0]).filter(k => k !== 'none_good').sort(), ['bank_now', 'stay_for_more']);
  assert.match(asked[0].bank_now, /^Bank the rods got so far: walk back to the portal .*4 stayed and died with them \(4, 3, 2, 2 rods lost\), 1 left and carried its 2 out\./);
  assert.match(asked[0].stay_for_more, /^Stay and hunt on for the 5 rods still needed with the 2 rods in the pack: .*every rod carried is lost with a death here/);
  // The same two rods: not asked again.
  assert.equal(await rb.askBank(bot, task, goal, () => {}, actions, client), null);
  assert.equal(asked.length, 1);
  // A third rod: asked again; out now begins the bank and the walk.
  const three = frameBot({ inventory: { ...BARE, blaze_rod: 3 } });
  assert.equal(await rb.askBank(three, task, goal, () => {}, actions, client), 'banked');
  assert.equal(walked, 1);
  assert.equal(goal.rodBank.rods, 3);
});
