'use strict';
// Note 690: food kept where it is all there is and said when it goes; a
// craft that made nothing said to every question and rested; a block not
// placed standing up against a furnace; a stray window closed before a craft.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

function pockets(list) {
  const items = [];
  for (const [name, count] of list) { const it = registry.itemsByName[name]; items.push({ name, count, type: it.id, stackSize: it.stackSize }); }
  while (items.length < 36) { const it = registry.itemsByName.white_wool; items.push({ name: 'white_wool', count: 1, type: it.id, stackSize: it.stackSize }); }
  return items;
}
function roomBot(items, dimension) {
  const chat = [], tossed = [];
  const bot = { registry, chat: m => chat.push(m), tossed, said: chat,
    inventory: { items: () => items, emptySlotCount: () => 36 - items.length, slots: [] },
    entity: { position: new Vec3(0, 64, 0) }, game: { dimension }, lookAt: async () => {},
    tossStack: async st => { tossed.push(st.name); items.splice(items.indexOf(st), 1); } };
  return bot;
}
// Jev drops whatever stack is listed last.
const lastOne = () => { let offered = null, state = null; const client = { systemOne: async ({ questions, state: s }) => {
  offered = { ...questions.branch_1.criteria }; state = s; const keys = Object.keys(offered);
  return { answers: { branch_0: { choice: 'drop', confidence: 0.9 }, branch_1: { choice: keys.at(-1), confidence: 0.9 } } }; } };
  return { client, offered: () => offered, state: () => state }; };

test('in the Nether no food stack is offered to drop for room, and the question says why (25598 dropped 12 cooked beef for a gold ingot)', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const items = pockets([['cooked_beef', 12], ['cooked_mutton', 3], ['netherrack', 64], ['iron_sword', 1]]);
  const bot = roomBot(items, 'the_nether');
  const j = lastOne();
  await makeRoom(bot, { check() {}, opportunityClient: j.client }, 'gold_ingot', { goal: { kind: 'win' } });
  const said = Object.values(j.offered()).join('\n');
  assert.doesNotMatch(said, /cooked beef|cooked mutton/);
  assert.match(j.state().foodNotListed, /kept: in the Nether the food carried is all there is/);
  assert(!bot.tossed.some(n => /cooked/.test(n)), `food tossed: ${bot.tossed}`);
});

test('in the Overworld with the crossing ahead food is kept; with none ahead it may go, and dropping it is said', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const ahead = roomBot(pockets([['cooked_beef', 3], ['cobblestone', 64]]), 'overworld');
  const j = lastOne();
  await makeRoom(ahead, { check() {}, opportunityClient: j.client }, 'stick', { goal: { kind: 'win', preparingNether: true } });
  assert.doesNotMatch(Object.values(j.offered()).join('\n'), /cooked beef/);
  assert.match(j.state().foodNotListed, /crossing is ahead/);

  // Unprotected food may still go, but only for something that outranks
  // it (note 730): a gold ingot, not a stick (a stick is never worth the
  // food, whatever else is carried).
  const free = roomBot(pockets([['cooked_beef', 3], ['cobblestone', 64]]), 'overworld');
  const k = { client: { systemOne: async ({ questions }) => { const pick = Object.entries(questions.branch_1.criteria).find(([, d]) => /cooked beef/.test(d))[0];
    return { answers: { branch_0: { choice: 'drop', confidence: 0.9 }, branch_1: { choice: pick, confidence: 0.9 } } }; } } };
  await makeRoom(free, { check() {}, opportunityClient: k.client }, 'gold_ingot', { goal: { kind: 'obtain' } });
  assert.deepEqual(free.tossed, ['cooked_beef']);
  assert.match(free.said.join('\n'), /Dropping 3 cooked beef \(24 food points\) to make room for the gold ingot/);

  // For a stick, food is not offered even with nothing protecting it and
  // no junk to offer instead (25597, note 730): the cobblestone goes first.
  const forAStick = roomBot(pockets([['cooked_beef', 3], ['raw_copper', 5]]), 'overworld');
  const m = lastOne();
  await makeRoom(forAStick, { check() {}, opportunityClient: m.client }, 'stick', { goal: { kind: 'obtain' } });
  assert.doesNotMatch(Object.values(m.offered()).join('\n'), /cooked beef/, 'food is not offered for a stick while raw copper (or anything else) is carried');
  assert(!forAStick.tossed.includes('cooked_beef'), 'the food was kept, not thrown for the stick');
});

test('the stash takes no food on the valuables trip before the Nether or while the crossing is ahead; the plain chore still stocks the kit', () => {
  const stash = require('../src/home-stash');
  const items = [{ name: 'cooked_beef', count: 20 }, { name: 'diamond', count: 3 }, { name: 'iron_pickaxe', count: 1 }];
  const bot = { registry, game: { dimension: 'overworld' }, inventory: { items: () => items }, entity: { position: new Vec3(0, 64, 0) } };
  const home = { stash: { position: { x: 0, y: 64, z: 0 }, contents: {} } };
  const food = moves => moves.filter(m => m.item === 'cooked_beef');
  assert.equal(food(stash.stashDeposits(bot, home, { valuables: true })).length, 0, 'before the Nether');
  assert.equal(food(stash.stashDeposits(bot, home, { goal: { kind: 'win', preparingNether: true } })).length, 0, 'crossing ahead');
  assert(food(stash.stashDeposits(bot, home, { goal: { kind: 'obtain' } })).length > 0, 'nothing ahead: the kit slot takes food');
  bot.game.dimension = 'the_nether';
  assert.equal(food(stash.stashDeposits(bot, home, { goal: { kind: 'obtain' } })).length, 0, 'in the Nether');
});

test('packing light in the Nether keeps all the food; in the Overworld over twenty points goes', () => {
  const trip = require('../src/trip-kit');
  const carrying = dimension => ({ registry, game: { dimension }, inventory: { items: () => [{ name: 'cooked_beef', count: 12 }, { name: 'gold_ingot', count: 5 }] } });
  assert.equal(trip.tripKeep(carrying('the_nether'), 'bastion').cooked_beef, 12);
  assert.equal(trip.tripKeep(carrying('overworld'), 'deep_dark').cooked_beef, 3);
});

test('a craft that made nothing twice rests five minutes, said to every question, and refused with the reason (25588 clicked sticks fourteen times)', () => {
  const cf = require('../src/craft-failures');
  const bot = { entity: { position: new Vec3(194, 42, 230) } };
  const t0 = Date.parse('2026-09-29T20:02:27Z');
  cf.noteCraftFailure(bot, 'stick', 'no output: stick after crafting, twice (have 1 of 5, 4 free slots)', t0);
  assert.equal(cf.craftRest(bot, 'stick', t0 + 1000), null, 'once is said, not rested');
  assert.match(cf.craftFailuresSay(bot, t0 + 1000), /Crafting stick made nothing once/);
  cf.noteCraftFailure(bot, 'stick', 'no output: stick after crafting, twice (have 1 of 5, 4 free slots)', t0 + 21000);
  const rest = cf.craftRest(bot, 'stick', t0 + 30000);
  assert.match(rest.says, /Crafting stick made nothing twice in the last 30 seconds \(the last 9 seconds ago: no output: stick after crafting.*\)\. It rests 5 minutes more\./);
  assert.equal(cf.craftRest(bot, 'stick', t0 + 21000 + 5 * 60000 + 1), null, 'the rest ends');
  cf.noteCraftMade(bot, 'stick');
  assert.equal(cf.craftFailuresSay(bot, t0 + 40000), null, 'made, the run of failures ends');
});

test('every gameplay question carries the craft that made nothing', async () => {
  const cf = require('../src/craft-failures');
  const { decide } = require('../src/decisions');
  let state = null;
  const client = { systemOne: async ({ state: s }) => { state = s; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.6 } } }; } };
  const bot = { registry, entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' }, inventory: { items: () => [] }, health: 20, food: 20 };
  cf.noteCraftFailure(bot, 'stick', 'no output', Date.now() - 1000);
  await decide('upkeep', { client, bot, task: { check() {} }, goal: {}, tree: { carry_on: { description: 'Carry on.' }, make_pickaxe: { description: 'Make one.' } }, state: {} });
  assert.match(state.craftingFailed, /Crafting stick made nothing once/);
});

test('a stray window is closed before crafting, and a block is placed crouched against a furnace or beside it instead', async () => {
  const { closeStrayWindow, opensOnClick } = require('../src/skills');
  const closed = [];
  const bot = { inventory: {}, currentWindow: { type: 'minecraft:furnace' }, closeWindow: w => { closed.push(w.type); bot.currentWindow = null; } };
  assert.equal(closeStrayWindow(bot), 'furnace');
  assert.deepEqual(closed, ['minecraft:furnace']);
  assert.equal(closeStrayWindow(bot), null);
  assert(opensOnClick('furnace') && opensOnClick('crafting_table') && opensOnClick('barrel') && !opensOnClick('stone'));
});

test('the unstuck place move goes against stone before a furnace, and against a furnace alone it crouches and closes what opened', async () => {
  const { perform } = require('../src/unstuck');
  const run = async around => {
    const log = [];
    const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'cobblestone', count: 10 }] }, equip: async () => {},
      blockAt: p => ({ name: around(p) || 'air', position: p }), getControlState: () => false, waitForTicks: async () => {},
      setControlState: (k, v) => log.push(`${k}:${v}`), currentWindow: null, closeWindow: w => { log.push(`close:${w.type}`); },
      placeBlock: async ref => { log.push(`against:${ref.name}`); if (ref.name === 'furnace' && !log.includes('sneak:true')) bot.currentWindow = { type: 'minecraft:furnace' }; } };
    bot.closeWindow = w => { log.push(`close:${w.type}`); bot.currentWindow = null; };
    await perform(bot, { check() {} }, { key: 'place_north', kind: 'place', cell: new Vec3(0, 64, -1), block: 'cobblestone' }, { dig: async () => {} });
    return log;
  };
  // Below the cell a furnace, west of it stone.
  const both = await run(p => p.x === 0 && p.y === 63 && p.z === -1 ? 'furnace' : p.x === -1 && p.y === 64 && p.z === -1 ? 'stone' : null);
  assert.deepEqual(both, ['against:stone']);
  const alone = await run(p => p.x === 0 && p.y === 63 && p.z === -1 ? 'furnace' : null);
  assert.deepEqual(alone, ['sneak:true', 'against:furnace', 'sneak:false']);
});

test('sticks are crafted with a furnace window left open: it is closed first (before: fourteen timeouts); a grid that makes nothing is rested and refused, said', async () => {
  const { acquireStep } = require('../src/work');
  const { Task } = require('../src/skills');
  const make = ({ refuse }) => {
    const server = { oak_planks: 4, stick: 1 };
    const bot = {
      registry, game: { gameMode: 'survival' }, entity: { position: new Vec3(0, 64, 0) },
      _catalogObservation: { at: Date.now(), position: { x: 0, y: 64, z: 0 }, nearby: [] }, findBlocks: () => [],
      currentWindow: { type: 'minecraft:furnace' }, closed: [],
      closeWindow: w => { bot.closed.push(w.type); bot.currentWindow = null; },
      inventory: { inventoryStart: 9, inventoryEnd: 45, slots: [], emptySlotCount: () => 4,
        items: () => Object.entries(server).filter(([, c]) => c).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, stackSize: 64 })) },
      // The server takes no click in the pockets' grid while another window is open.
      craft: async () => { if (bot.currentWindow || refuse) return; server.oak_planks -= 2; server.stick += 4; },
    };
    return bot;
  };
  const open = make({ refuse: false });
  await acquireStep(open, new Task('craft', 'sticks'), 'stick', 5, {}, () => {});
  assert.deepEqual(open.closed, ['minecraft:furnace']);
  assert.equal(open.inventory.items().find(i => i.name === 'stick').count, 5);

  const stuck = make({ refuse: true });
  const tries = async () => { try { await acquireStep(stuck, new Task('craft', 'sticks'), 'stick', 5, {}, () => {}); return 'made'; } catch (err) { return err; } };
  const first = await tries(), second = await tries(), third = await tries();
  assert.match(first.message, /stick after crafting, twice \(have 1 of 5/);
  assert.match(second.message, /stick after crafting, twice/);
  assert.equal(third.name, 'Blocked');
  assert.match(third.message, /^Crafting stick made nothing twice in the last \d+ seconds \(the last \d+ seconds ago: no output: stick after crafting, twice.*It rests 5 minutes more\.$/);
});
