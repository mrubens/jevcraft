'use strict';
const { oldOrder } = require('./support/jev-stand-in');
// Note 704: the rods into a chest in the Nether. A death drops everything
// carried and the bot comes back to life in the Overworld; of the times a bot
// in the Nether first held 2 or more rods (flight records 2026-09-28 to 30),
// 101 of 137 died with them before leaving. The scene is 25589's lull at the
// cage (test/fixtures/spawner-lull-frame-25589.json, the room from the
// region), made 4 rods, 8 health and a chest carried.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const clock = require('../src/spawner-clock');
const es = require('../src/empty-spawner');
const rs = require('../src/rod-stash');
const room = require('./fixtures/spawner-lull-25589.json');
const rec = require('./fixtures/spawner-lull-frame-25589.json');
require('../src/decisions/travel');
require('../src/decisions/survival');
const { question } = require('../src/decisions');
const registry = require('minecraft-data')('26.1');

const CAGE = new Vec3(rec.cage.x, rec.cage.y, rec.cage.z);
function frameBot({ inventory = { ...rec.inventory, blaze_rod: 4, chest: 1 }, health = 8, food = 17, blazes = rec.blazes, at = rec.position } = {}) {
  const bot = groundBot(room, { at: new Vec3(at.x, at.y, at.z), health, food, items: Object.entries(inventory).filter(([, n]) => n > 0), worn: ['iron_helmet', 'iron_chestplate'], dimension: 'the_nether', indexed: true,
    mobs: blazes.map(b => ({ id: b.id, name: 'blaze', at: new Vec3(b.position.x, b.position.y, b.position.z), height: 1.8 })) });
  bot.changed.set(`${CAGE.x},${CAGE.y},${CAGE.z}`, 'spawner');
  bot.inventory.slots[45] = { name: 'shield' };
  bot._spawnClock = { tries: {}, near: {} };
  return bot;
}
const huntGoal = () => ({ kind: 'win', survival: { deaths: [] }, mobHunt: { item: 'blaze_rod', entity: 'blaze', targetCount: 7 }, fortressSearch: { legs: 1, map: { cells: {}, failed: {}, spawners: [{ ...rec.cage }], chests: [] } } });
const task = { check() {} };

// A chest as the server keeps one: the mock's lid opens a window over the
// pockets, and what goes in leaves the pockets.
function chestWorld(bot) {
  const held = new Map();
  const items = bot.inventory.items();
  const take = (name, n) => { let left = n; for (const i of items.filter(x => x.name === name)) { const k = Math.min(left, i.count); i.count -= k; left -= k; } for (let j = items.length - 1; j >= 0; j--) if (items[j].count <= 0) items.splice(j, 1); return n - left; };
  bot.openContainer = async block => {
    const key = `${block.position}`;
    if (!held.has(key)) held.set(key, {});
    const c = held.get(key);
    return {
      containerItems: () => Object.entries(c).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })),
      deposit: async (id, meta, n) => { const name = registry.items[id].name; const k = take(name, n); c[name] = (c[name] || 0) + k; },
      withdraw: async (id, meta, n) => { const name = registry.items[id].name; const k = Math.min(n, c[name] || 0); c[name] -= k; const i = items.find(x => x.name === name); if (i) i.count += k; else items.push({ name, count: k, type: id }); },
      close() {},
    };
  };
  const place = async (b, t, cell, name) => { assert.equal(take(name, 1), 1, `a ${name} carried`); bot.changed.set(`${cell.x},${cell.y},${cell.z}`, name); };
  return { held, place, take };
}

test('the records: of 137 times a bot in the Nether first held 2 or more rods, 101 died with them before leaving; the row said by the rods carried', () => {
  assert.deepEqual(rs.HELD[2], { n: 137, died: 101, left: 5, ended: 31, medianToDeath: 224, lost: 367 });
  assert.match(rs.heldSays(4), /^Of 63 times a bot in the Nether first held 4 or more rods \(2026-09-28 to 2026-09-30\), 47 died with them before leaving \(median 254 s later\), 4 left with them\.$/);
  assert.match(rs.heldSays(9), /held 4 or more rods/);
  assert.match(rs.heldSays(2), /^Of 137 times .* 2 or more rods/);
  // The script counts it so from frames: the death with them, out with them, the record's end.
  const { heldRods, heldTable } = require('../scripts/after-rod');
  const f = (at, hp, dim, rods) => ({ at, kind: 'observation', snapshot: { health: hp, dimension: dim, inventory: { blaze_rod: rods } } });
  const list = heldRods([f(0, 20, 'the_nether', 1), f(10000, 20, 'the_nether', 2), f(20000, 15, 'the_nether', 4), f(30000, 0, 'the_nether', 4), f(40000, 20, 'overworld', 0), f(50000, 20, 'the_nether', 3), f(60000, 20, 'overworld', 3)]);
  const t = heldTable(list);
  assert.deepEqual([t['2 or more'].n, t['2 or more'].died, t['2 or more'].left], [2, 1, 1]);
  assert.equal(t['2 or more'].rodsLostAtTheDeaths, 4);
  assert.equal(t['4 or more'].medianSecondsToDeath, 10);
});

test('in the lull with 4 rods and a chest carried: a chest cell in reach, out of every blaze\'s line, and the ways at the spawner offer stash_rods first without Jev', () => {
  const bot = frameBot(), goal = huntGoal(), now = Date.now();
  for (const t of rec.tries.map(Date.parse).filter(t => t < Date.parse('2026-09-29T21:17:28.131Z'))) clock.noteTry(bot, CAGE, now - (Date.parse('2026-09-29T21:17:28.131Z') - t));
  const offer = rs.stashOffer(bot, goal, { now });
  assert.ok(offer, 'offered');
  const cell = offer.site.cell;
  const feet = bot.entity.position.floored();
  assert.ok(!(cell.x === feet.x && cell.z === feet.z), 'not the bot\'s own cells');
  assert.equal(bot.blockAt(cell).boundingBox, 'empty');
  assert.equal(bot.blockAt(cell.offset(0, -1, 0)).boundingBox, 'block');
  const T = require('../src/blaze-tactics');
  for (const b of Object.values(bot.entities)) assert.equal([0.2, 0.5, 0.85].some(dy => T.lineThrough(bot, b.position.offset(0, 1.53, 0), cell.offset(0.5, dy, 0.5), new Set())), false, 'no blaze line to the chest');
  assert.ok(offer.making.carried);
  assert.deepEqual(offer.what, [{ item: 'blaze_rod', count: 4 }]);
  const said = rs.offerSays(offer);
  assert.match(said, /^Keep the 4 blaze rods safe from a death first: set a chest down [\d.]+ blocks off at \(-?\d+, \d+, -?\d+\), out of every blaze's line, and put them in, then asked again with the ways here still open\./);
  assert.match(said, /About 1 second of it; done before the spawner's next try about \d+ times in 100\./);
  assert.match(said, /4 blaze rods carried, 4 of the 7 the goal wants\. A death drops them .* 47 died with them before leaving/);
  assert.ok(rs.offerSays(offer, { riskInState: true }).length < 400, 'short (note 672)');
  // The ways at the spawner in the lull.
  const known = es.knownSpawner(bot, goal);
  known.lull = clock.lull(bot, { cage: known.cage, now });
  const tree = es.options(bot, task, goal, () => {}, { navigate: async () => {} }, known, { now });
  assert.ok(tree.stash_rods, Object.keys(tree).join(', '));
  assert.match(tree.stash_rods.rodsCarried, /^4 blaze rods carried/);
  assert.equal(oldOrder('empty_spawner')(tree), 'stash_rods');
});

test('not offered: a blaze with a line to the bot, no chest and no wood, the rods done, or outside the Nether; one rod is offered (note 931)', () => {
  const goal = huntGoal();
  assert.ok(rs.stashOffer(frameBot({ inventory: { ...rec.inventory, blaze_rod: 1, chest: 1 } }), goal), 'one rod kept is a rod kept');
  const seen = frameBot({ blazes: [...rec.blazes, { id: 9, position: { x: -151.5, y: 81, z: 162.5 } }] });
  assert.equal(rs.stashOffer(seen, goal), null, 'a blaze sees the bot');
  const bare = { ...rec.inventory, blaze_rod: 4 }; delete bare.oak_log; delete bare.crafting_table;
  assert.equal(rs.stashOffer(frameBot({ inventory: bare }), goal), null, 'no chest, no wood');
  // The rods done with pearls still wanted: kept here still (note 1021); with the pearls done too, the portal walk takes them.
  assert.ok(rs.stashOffer(frameBot({ inventory: { ...rec.inventory, blaze_rod: 7, chest: 1 } }), goal), 'the rods done, the pearls not');
  assert.equal(rs.stashOffer(frameBot({ inventory: { ...rec.inventory, blaze_rod: 7, chest: 1, ender_pearl: 16 } }), goal), null, 'the rods and the pearls done: the portal walk takes them');
  const over = frameBot(); over.game.dimension = 'overworld';
  assert.equal(rs.stashOffer(over, goal), null);
});

test('with wood and a table carried and no chest, making it is part of the option, said with what it takes', () => {
  const bot = frameBot({ inventory: { ...rec.inventory, blaze_rod: 3 } });
  const offer = rs.stashOffer(bot, huntGoal());
  assert.ok(offer && !offer.making.carried);
  assert.deepEqual({ table: offer.making.table, logsUsed: offer.making.logsUsed }, { table: true, logsUsed: 2 });
  assert.match(rs.offerSays(offer), /The chest is made first: 8 planks at the crafting table carried \(2 logs or stems of those carried made into planks\)\./);
  const noTable = { ...rec.inventory, blaze_rod: 3 }; delete noTable.crafting_table;
  const m = rs.chestMaking(frameBot({ inventory: noTable }));
  assert.deepEqual({ table: m.table, planksUsed: m.planksUsed, logsUsed: m.logsUsed }, { table: false, planksUsed: 12, logsUsed: 3 });
});

test('no cell by lava, none a blaze sees, none under rock (a chest does not open under a solid block)', () => {
  // A floor at y 64 with lava two cells east and a blaze north.
  const lava = new Set(['2,64,0']);
  const blocks = p => { const q = p.floored(), k = `${q.x},${q.y},${q.z}`; const name = lava.has(k) ? 'lava' : q.y < 64 ? 'netherrack' : q.y === 66 && q.x === -1 ? 'nether_bricks' : 'air'; return { name, position: q, boundingBox: name === 'netherrack' || name === 'nether_bricks' ? 'block' : 'empty', getProperties: () => ({}) }; };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 1: { id: 1, name: 'blaze', position: new Vec3(0.5, 66, -8.5), height: 1.8, isValid: true } }, blockAt: blocks };
  const site = rs.chestCell(bot);
  assert.ok(site);
  assert.ok(Math.abs(site.cell.x - 2) + Math.abs(site.cell.z) > 2 || site.cell.y !== 64, 'not beside the lava');
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) assert.notDeepEqual([site.cell.x + dx, site.cell.z + dz], [2, 0], 'no lava within two');
  assert.notEqual(site.cell.x, -1, 'not under the brick');
  const T = require('../src/blaze-tactics');
  assert.equal([0.2, 0.5, 0.85].some(dy => T.lineThrough(bot, new Vec3(0.5, 67.53, -8.5), site.cell.offset(0.5, dy, 0.5), new Set())), false);
});

test('stash_rods run: the chest put down, the rods in, remembered in the goal (surviving a restart), counted as held for the eye need, the hunt and the rung\'s measure', async () => {
  const bot = frameBot(), goal = huntGoal();
  const { place, held } = chestWorld(bot);
  const offer = rs.stashOffer(bot, goal);
  const said = [];
  bot.chat = m => said.push(m);
  const before = require('../src/eye-need').need(bot, goal);
  assert.deepEqual([before.rods, before.rodsLeft], [4, 3]);
  const measureBefore = require('../src/rung-measure').parts(bot, goal, { rung: 'obtain_blaze_rods', items: ['blaze_rod'] }).items.v;
  assert.equal(await rs.stashRods(bot, task, goal, () => {}, { place, navigate: async () => {} }, offer), true);
  assert.equal(bot.inventory.items().filter(i => i.name === 'blaze_rod').length, 0);
  assert.equal([...held.values()][0].blaze_rod, 4);
  assert.equal(goal.rodStashes.length, 1);
  assert.deepEqual(goal.rodStashes[0].position, { x: offer.site.cell.x, y: offer.site.cell.y, z: offer.site.cell.z });
  assert.equal(goal.rodStashes[0].contents.blaze_rod, 4);
  assert.match(said[0], /^Left 4 blaze rods in a chest at \(-?\d+, \d+, -?\d+\)\. I'll take them on the way out\.$/);
  // A restart reads the goal back from its file.
  const again = JSON.parse(JSON.stringify(goal));
  const n = require('../src/eye-need').need(bot, again);
  assert.deepEqual([n.rods, n.rodsLeft, n.stashed.rods], [0, 3, 4]);
  assert.match(require('../src/eye-need').says(bot, again), /Carried: 0 blaze rods, .*; in a chest: 4 blaze rods in a chest at \(.*\) in the Nether; 3 rods still needed\./);
  assert.match(require('../src/eye-need').says(bot, again, { brief: true }), /^Blaze rods: 0 carried \(and 4 blaze rods in a chest at .* counted as held\), 7 wanted in all/);
  assert.equal(require('../src/blaze-stand').rodsNeeded(bot, { ...again, mobHunt: { item: 'blaze_rod', entity: 'blaze', targetCount: 7 } }), 3);
  assert.equal(require('../src/rung-measure').parts(bot, again, { rung: 'obtain_blaze_rods', items: ['blaze_rod'] }).items.v, measureBefore, 'the measure does not fall');
  // With the chest in reach and 2 more rods, the offer is that chest.
  bot.inventory.items().push({ name: 'blaze_rod', count: 2, type: registry.itemsByName.blaze_rod.id });
  const next = rs.stashOffer(bot, again);
  assert.ok(next.existing);
  assert.match(rs.offerSays(next), /put them in the chest at \(/);
  // A failure rests the offer five minutes.
  const failing = frameBot(), g2 = huntGoal();
  const o2 = rs.stashOffer(failing, g2);
  assert.equal(await rs.stashRods(failing, task, g2, () => {}, { place: async () => { throw new Error('no anchor'); } }, o2), false);
  assert.equal(rs.stashOffer(failing, g2), null);
});

test('the ladder in the Nether: the hunt counts the chest, and with the rods done the chest is emptied before the portal walk; a chest gone is lost and no longer counted', async () => {
  const { nextGameStage } = require('../src/game-progress');
  // The pearls carried: the Nether's pearl ways come before the walk back.
  const bot = frameBot({ inventory: { ...rec.inventory, blaze_rod: 0, chest: 1, ender_pearl: 13 } });
  const goal = { kind: 'win', gameProgress: { milestones: {} } };
  const cell = new Vec3(-153, 81, 166);
  const { held } = chestWorld(bot);
  bot.changed.set(`${cell.x},${cell.y},${cell.z}`, 'chest');
  held.set(`${cell}`, { blaze_rod: 4 });
  goal.rodStashes = [{ position: { x: cell.x, y: cell.y, z: cell.z }, dimension: 'nether', contents: { blaze_rod: 4 }, placedAt: new Date().toISOString() }];
  const hunt = nextGameStage(bot, goal);
  assert.deepEqual([hunt.phase, hunt.action, hunt.item, hunt.count], ['obtain_blaze_rods', 'acquire', 'blaze_rod', 3], 'three more carried make the seven');
  bot.inventory.items().push({ name: 'blaze_rod', count: 3, type: registry.itemsByName.blaze_rod.id });
  const stage = nextGameStage(bot, goal);
  assert.deepEqual([stage.phase, stage.action, stage.at], ['collect_rod_stash', 'collect_rod_stash', { x: -153, y: 81, z: 166 }]);
  const said = [];
  bot.chat = m => said.push(m);
  assert.equal(await rs.collect(bot, task, goal, () => {}, { navigate: async () => {} }), true);
  assert.equal(bot.inventory.items().filter(i => i.name === 'blaze_rod').reduce((n, i) => n + i.count, 0), 7);
  assert.match(said.join(' '), /Taking 4 blaze rods out of the chest at \(-153, 81, 166\) before the portal\..*Took 4 blaze rods back out of the chest\./);
  assert.deepEqual(nextGameStage(bot, goal).phase, 'return_with_blaze_supplies');
  // Gone: said, and the rods no longer counted.
  const g2 = { kind: 'win', gameProgress: { milestones: {} }, rodStashes: [{ position: { x: -150, y: 81, z: 166 }, dimension: 'nether', contents: { blaze_rod: 4 } }] };
  const b2 = frameBot({ inventory: { ...rec.inventory, blaze_rod: 3, ender_pearl: 13 } });
  b2.chat = m => said.push(m);
  assert.equal(nextGameStage(b2, g2).action, 'collect_rod_stash');
  assert.equal(await rs.collect(b2, task, g2, () => {}, { navigate: async () => {} }), false);
  assert.ok(g2.rodStashes[0].lostAt);
  assert.match(said.at(-1), /The chest at \(-150, 81, 166\) is gone, and 4 blaze rods with it\./);
  assert.equal(require('../src/eye-need').need(b2, g2).rodsLeft, 4);
  assert.equal(nextGameStage(b2, g2).action, 'acquire');
});

test('the crossing kit takes a chest, deferrable, said with its cost; after a death the corpse run says the rods in the chest are kept', () => {
  const { kitRungs, kitRungSays, KIT_PHASES } = require('../src/crossing-kit');
  const { DEFERRABLE } = require('../src/game-progress');
  assert.ok(KIT_PHASES.has('nether_chest') && DEFERRABLE.has('nether_chest'));
  const items = { stone_pickaxe: 2, iron_pickaxe: 1, cobblestone: 128, cooked_beef: 12, crafting_table: 1 };
  const mk = inv => { const list = Object.entries(inv).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 })); return { registry, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, inventory: { items: () => list, slots: [] }, entity: { position: new Vec3(0, 64, 0) } }; };
  const rung = kitRungs(mk(items), {}).find(r => r.phase === 'nether_chest');
  assert.deepEqual([rung.action, rung.item, rung.carried, rung.wants], ['acquire', 'chest', 0, 8]);
  assert.match(kitRungSays(mk(items), {}, rung), /What it is for: a death in the Nether drops every rod carried where the bot falls.*Its cost: 8 planks \(2 logs\) and one slot\. 0 planks' worth of wood carried of the 8 it takes\.$/);
  // The wood for one carried keeps the rung open (note 760): made now, said so.
  const made = kitRungs(mk({ ...items, oak_log: 2 }), {}).find(r => r.phase === 'nether_chest');
  assert.equal(made.makesNow, true, 'two logs are the 8 planks');
  assert.match(kitRungSays(mk({ ...items, oak_log: 2 }), {}, made), /The wood carried makes it now \(8 planks' worth, a crafting table carried\): a few seconds\./);
  assert.equal(kitRungs(mk({ ...items, chest: 1 }), {}).some(r => r.phase === 'nether_chest'), false);
  const noTable = { ...items }; delete noTable.crafting_table;
  assert.equal(kitRungs(mk({ ...noTable, oak_planks: 8 }), {}).find(r => r.phase === 'nether_chest').wants, 12, 'and 4 for a table');
  // With every rod in a chest in the Nether the crossing is still one, kit and all.
  const stashGoal = { rodStashes: [{ position: { x: 0, y: 70, z: 0 }, dimension: 'nether', contents: { blaze_rod: 7 } }] };
  assert.ok(kitRungs(mk(items), stashGoal).some(r => r.phase === 'nether_chest'));
  // The corpse run.
  const { corpseRunStep } = require('../src/corpse-run');
  assert.equal(typeof corpseRunStep, 'function');
  assert.match(rs.stashSays(stashGoal), /^7 blaze rods in a chest at \(0, 70, 0\) in the Nether$/);
});

test('after a death the corpse run\'s question says the rods in the chest were not dropped', async () => {
  const { corpseRunStep } = require('../src/corpse-run');
  const bot = frameBot({ inventory: { cooked_beef: 3 } });
  bot.game.dimension = 'overworld';
  const at = new Date(Date.now() - 1000).toISOString();
  const goal = { rodStashes: [{ position: { x: -153, y: 81, z: 166 }, dimension: 'nether', contents: { blaze_rod: 4 } }],
    survival: { deaths: [{ at, dimension: 'overworld', position: { x: -140, y: 81, z: 160 }, worn: [] }], recovery: { at, status: 'done', inventoryBeforeDeath: { iron_sword: 1 }, recovered: {} } } };
  let asked = null;
  const client = { model: 'x', systemOne: async req => { asked = req; return { answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, { choice: Object.keys(q.criteria).find(k => k === 'leave_them') || Object.keys(q.criteria)[0], confidence: 0.9 }])) }; } };
  await corpseRunStep(bot, { check() {}, opportunityClient: client }, goal, () => {}, { move: async () => {}, collect: async () => {} });
  assert.ok(asked, 'asked');
  assert.match(asked.state.inAChest, /^4 blaze rods in a chest at \(-153, 81, 166\) in the Nether$/);
  const leave = Object.values(asked.questions)[0].criteria.leave_them;
  assert.match(typeof leave === 'string' ? leave : JSON.stringify(leave), /Not dropped: 4 blaze rods in a chest at \(-153, 81, 166\) in the Nether, kept there and counted as held\./);
});

test('the stance in the lull offers stash_rods with the record\'s row; with a blaze seeing the bot it is offered too, said and priced for its seconds in the fire (note 759)', () => {
  const { Task } = require('../src/skills');
  const { Survival } = require('../src/survival');
  const offered = bot => {
    const survival = new Survival(bot, { navigate: async () => {}, place: async () => {}, dig: async () => {}, acquireStep: async () => {} }, { state: { shelters: [] } });
    return survival.stanceOptions(new Task('x'), huntGoal(), () => {}, require('../src/danger').threats(bot, 24), false);
  };
  const o = offered(frameBot());
  assert.ok(o.stash_rods, Object.keys(o).join(', '));
  assert.deepEqual(o.stash_rods.expects, { damage: 0, seconds: 1 });
  assert.match(o.stash_rods.description, /^Keep the 4 blaze rods safe from a death first: .* A chest keeps them \(no mob opens one\), counted as held, taken out before the portal\. Toward the rods/);
  assert.doesNotMatch(o.stash_rods.description, /Of 63 times/);
  // The rods at risk and the record are the question's own fact (note 759, rodsAtRisk).
  assert.match(require('../src/rod-risk').risk(frameBot(), huntGoal()).says, /^4 rods carried, 7 wanted; 3 still needed\./);
  const seen = offered(frameBot({ blazes: [...rec.blazes, { id: 9, position: { x: -151.5, y: 81, z: 162.5 } }] }));
  assert.ok(seen.stash_rods, 'offered in the fire (note 759)');
  assert.match(seen.stash_rods.description, /Done where the bot stands, in the line of 1 blaze that sees it now\./);
  assert.match(seen.stash_rods.description, /About [\d.]+ damage from the mobs here in the 1 second it takes, from 8 health\./);
  assert.ok(seen.stash_rods.expects.damage > 0 && seen.stash_rods.expects.oneHit > 0, JSON.stringify(seen.stash_rods.expects));
  // The lull's own question still asks it only with no line (empty_spawner).
  assert.equal(rs.stashOffer(frameBot({ blazes: [...rec.blazes, { id: 9, position: { x: -151.5, y: 81, z: 162.5 } }] }), huntGoal()), null);
});

test('the chest here as an answer of its own: said with the health and what a ghast does to a chest, run stores the rods then the walk after (note 931)', async () => {
  const goal = huntGoal();
  const bot = frameBot({ inventory: { ...rec.inventory, blaze_rod: 3, chest: 1 } });
  bot.health = 5; bot.food = 9;
  let after = 0;
  const keep = rs.keepOption(bot, { check() {} }, goal, () => {}, {}, { then: async () => { after++; }, thenSays: 'Then back for food.' });
  assert.ok(keep, 'offered');
  assert.match(keep.description, /^Keep the 3 blaze rods/);
  assert.match(keep.description, /taken out on the way out once every rod wanted is got; a death meanwhile .* drops none of them/);
  assert.match(keep.description, /A ghast's fireball breaks a chest only where it lands beside it/);
  assert.match(keep.description, /Now: health 5, and at hunger 9 it does not come back/);
  assert.match(keep.description, /Then back for food\.$/);
});

test('seen by a blaze, the chest here is offered by a step out of its line first (note 973)', async () => {
  const goal = huntGoal();
  const seeing = [...rec.blazes, { id: 9, position: { x: -151.5, y: 81, z: 162.5 } }];
  const bot = frameBot({ inventory: { ...rec.inventory, blaze_rod: 2, chest: 1 }, blazes: seeing, health: 20, food: 20 });
  assert.equal(rs.stashOffer(bot, goal), null, 'no chest set down in a blaze\'s line');
  const keep = rs.keepOption(bot, { check() {} }, goal, () => {}, {}, { thenSays: 'Then the hunt goes on.' });
  assert.ok(keep, 'offered by the step out');
  assert.match(keep.description, /^Step out of their line first, then keep them here: walk \d+ blocks? to \(-?\d+, \d+, -?\d+\), which none of the \d+ shooters? that see the bot now has a line to \(the nearest then [\d.]+ blocks off\), set a chest down there and put 2 blaze rods in it: about [\d.]+ seconds in all, the walk in their fire\./);
  assert.match(keep.description, /a death meanwhile .* drops none of them.* Then the hunt goes on\.$/);
  // No chest and no wood for one: not offered either way.
  assert.equal(rs.keepOption(frameBot({ inventory: { blaze_rod: 2, iron_sword: 1 }, blazes: seeing }), { check() {} }, huntGoal(), () => {}, {}), null);
});
