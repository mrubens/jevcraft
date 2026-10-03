'use strict';
// Options that promise what the code cannot do (note 754): replayed from
// 25589 (mid-243-je, 12:09 to 12:19Z on 2026-09-30), walled in at y -30 in
// deepslate with no pickaxe and no wood, 79 iron ingots, 225 cobblestone and
// 129 coal carried; and 25597 (mid-241-ba), a craft with 0 free slots.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

const stacks = list => list.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, stackSize: registry.itemsByName[name].stackSize }));
// A world of rock: deepslate under y 0, stone to y 74, air over it; `open`
// cells are air.
function world({ open = [], surface = 74 } = {}) {
  const air = new Set(open.map(p => `${p.x},${p.y},${p.z}`));
  return p => {
    const q = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    const name = air.has(`${q.x},${q.y},${q.z}`) || q.y > surface ? 'air' : q.y < 0 ? 'deepslate' : 'stone';
    const d = registry.blocksByName[name];
    return { name, type: d.id, position: new Vec3(q.x, q.y, q.z), boundingBox: name === 'air' ? 'empty' : 'block', diggable: name !== 'air',
      hardness: d.hardness, harvestTools: d.harvestTools, skyLight: 0, getProperties: () => ({}) };
  };
}
// 25589 at (89, -30, 22): a cell of air for the feet and the head.
function walledBot(items, { y = -30, open = null } = {}) {
  const feet = new Vec3(89, y, 22);
  const bot = Object.assign(new EventEmitter(), {
    registry, game: { dimension: 'overworld', gameMode: 'survival', minY: -64, height: 384 }, time: { timeOfDay: 3000 }, health: 20, food: 20, entities: {},
    entity: { position: new Vec3(89.5, y, 22.5), onGround: true }, experience: { level: 0 },
    inventory: { items: () => stacks(items), slots: {}, emptySlotCount: () => 10 },
    findBlocks: () => [], world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} },
    _catalogObservation: { at: Date.now(), position: { x: 89.5, y, z: 22.5 }, nearby: [] },
  });
  bot.blockAt = world({ open: open || [feet, feet.offset(0, 1, 0)] });
  return bot;
}
const CARRIED_25589 = [['iron_ingot', 64], ['iron_ingot', 15], ['cobblestone', 64], ['cobblestone', 56], ['cobbled_deepslate', 64], ['cobbled_deepslate', 41], ['coal', 64], ['coal', 64], ['coal', 1], ['iron_sword', 1], ['cooked_mutton', 4], ['crafting_table', 1], ['furnace', 1]];

test('walled in with no pickaxe, no walk is offered and no craft whose chain begins with one; the digging out is said (25589)', async () => {
  const { detourWork, restWork, restWorkSays } = require('../src/work');
  const bot = walledBot(CARRIED_25589);
  const goal = { kind: 'win', survival: {}, biomes: {} };
  const task = new Task('rung', 'stone pickaxe');
  const work = await detourWork(bot, task, goal, () => {}, { preview: true });
  const keys = work.map(w => w.key);
  for (const k of ['stone_tools', 'torches', 'explore', 'look_around']) assert(!keys.includes(k), `${k} is not offered from a cell no walk leaves: ${keys}`);
  assert(!keys.some(k => /^travel_/.test(k)), 'no travel');
  assert.match(work.withheld, /Not offered from here: .*stone tools.*torches.*look around/);
  assert.match(work.withheld, /walled in where it stands \(deepslate on every side\) with no pickaxe: no walk leaves the cell until a way is dug, deepslate comes away by hand at about 15 s a block, dropping nothing: a staircase climbs about 1\.3 blocks a minute by hand, straight up about 3\.8/);
  // The hold's own offer says it too.
  const held = await restWork(bot, task, goal, () => {});
  assert.match(restWorkSays(bot, held, { until: Date.now() + 300000 }), /Not offered from here: .*walled in where it stands/);
});

test('walled in with a pickaxe, a walk is offered with the digging out said first', async () => {
  const { idleOptions } = require('../src/work');
  const bot = walledBot([...CARRIED_25589, ['stick', 4], ['iron_pickaxe', 1]], { y: 40 });
  const options = idleOptions(bot, { kind: 'survive', survival: {} });
  assert(options.explore, 'explore is offered');
  assert.match(options.explore.description, /It is walled in where it stands \(stone on every side\): a walk from here digs its way out first with the iron pickaxe\./);
});

test('a craft with no sticks and nothing to make them from says its chain and the fetch it begins with (25589)', () => {
  const { idleOptions } = require('../src/work');
  // Open on every side at the feet: not walled in.
  const feet = new Vec3(89, 40, 22), open = [];
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (const dy of [0, 1]) open.push(feet.offset(x, dy, z));
  const bot = walledBot(CARRIED_25589, { y: 40, open });
  const options = idleOptions(bot, { kind: 'survive', survival: {} });
  assert(options.stone_tools, 'offered, said as what it is');
  assert.match(options.stone_tools.description, /Not from the pockets as they are: no sticks can be made from the pockets \(0 logs, 0 planks, 0 sticks\): sticks need planks and planks need logs, so this begins by mining \d+ \w+ log: no wood is known near here\./);
  assert.match(options.torches.description, /Not from the pockets as they are: no sticks can be made/);
  // With sticks carried, the craft is from the pockets and said so.
  const stocked = walledBot([...CARRIED_25589, ['stick', 8]], { y: 40, open });
  const again = idleOptions(stocked, { kind: 'survive', survival: {} });
  assert.doesNotMatch(again.torches.description, /Not from the pockets/);
});

test('a trip underground says the climb to open sky, not the daylight left (25589, 105 blocks down)', () => {
  const { tripTime } = require('../src/work');
  const bot = walledBot(CARRIED_25589);
  const says = tripTime(bot, 91);
  assert.doesNotMatch(says, /daylight/);
  assert.match(says, /about 105 blocks under open sky, and a way that leads up there climbs that first: about \d+ minutes by staircase by hand \(deepslate comes away by hand at about 15 s a block/);
  // On the surface the daylight is said as before.
  const up = walledBot(CARRIED_25589, { y: 80 });
  assert.match(tripTime(up, 91), /seconds of daylight left/);
});

test('one pace by hand everywhere: the rock round the bot, at the game\'s time', () => {
  const hd = require('../src/hand-dig');
  const deep = walledBot([]);
  assert.equal(hd.rockAt(deep), 'deepslate');
  assert.deepEqual({ ...hd.handPace(deep), minutesUp: undefined }, { rock: 'deepslate', seconds: 15, drops: false, stairSeconds: 46.2, stairPerMinute: 1.3, straightPerMinute: 3.8, minutesUp: undefined });
  const high = walledBot([], { y: 40 });
  assert.equal(hd.handPace(high).seconds, 7.5);
  // work_free's aim, spare_pickaxe and wood_reserve say the same figure.
  const { aimFor } = require('../src/unstuck');
  const aim = aimFor(deep);
  assert.match(aim.says, /no pickaxe is carried: deepslate comes away by hand at about 15 s a block, dropping nothing/);
});

test('underground short of wood, wood_reserve says what no wood deep has cost in the record', async () => {
  const { upkeepStep, NO_WOOD_DEEP } = require('../src/work');
  let offered;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  const bot = walledBot([['stone_pickaxe', 1], ['cobblestone', 64], ['oak_log', 2]], { y: 20 });
  bot.inventory.items = () => [{ name: 'stone_pickaxe', count: 1, durabilityUsed: 100 }, { name: 'cobblestone', count: 64 }, { name: 'oak_log', count: 2 }];
  await upkeepStep(bot, { check() {} }, { kind: 'win', step: { action: 'mine', block: 'iron_ore' } }, () => {}, client);
  assert.match(offered.wood_reserve, new RegExp(`a bot was under y 16 with no pickaxe and no wood ${NO_WOOD_DEEP.spells} times: a median ${NO_WOOD_DEEP.median} minutes each`));
});

test('a new block being dug is work under way; the same cell dug again is not (25589\'s stairs by hand)', () => {
  const { look, STALL_MS } = require('../src/stillness');
  const bot = walledBot([]);
  const goal = { step: { action: 'ascend_to_surface', target: { x: 115, y: 5, z: 22 } } };
  const t0 = Date.now();
  look(bot, goal, { now: t0 });
  // Fifty seconds on one stair, digging deepslate by hand: never idle.
  let seen;
  for (let i = 1; i <= 50; i++) {
    bot.targetDigBlock = { position: new Vec3(90, -30 + Math.floor(i / 16), 22) };
    if (i % 15 === 0) bot._stalls.marks.push(bot.targetDigBlock.position);
    seen = look(bot, goal, { now: t0 + i * 1000, dt: 1000 });
  }
  assert(seen.idle < STALL_MS, `digging new blocks is not standing still (${seen.idle} ms)`);
  // The same cell dug over and over: idle as before.
  const cell = new Vec3(90, -30, 22);
  bot._stalls.marks.push(cell); look(bot, goal, { now: t0 + 51000, dt: 1000 });
  bot.targetDigBlock = { position: cell };
  for (let i = 52; i <= 100; i++) seen = look(bot, goal, { now: t0 + i * 1000, dt: 1000 });
  assert(seen.idle >= STALL_MS, 'a cell dug again is going nowhere');
});

test('height gained on a climb to open sky is a new best for the rung', () => {
  const tried = require('../src/tried');
  const bot = walledBot([]);
  bot._rungLooked = null;
  const goal = { kind: 'win', gameProgress: { phase: 'stone_pickaxe' }, step: { action: 'ascend_to_surface' } };
  const t0 = Date.now();
  assert.equal(tried.watchRung(bot, goal, { now: t0 }), null, 'the record begins');
  tried.watchRung(bot, goal, { now: t0 + 1000 });
  // Nine minutes up a hand staircase, two blocks every ninety seconds.
  let asked = null;
  for (let m = 1; m <= 12; m++) {
    bot.entity.position = new Vec3(89.5 + m, -30 + Math.floor(m * 1.4), 22.5);
    asked = tried.watchRung(bot, goal, { now: t0 + m * 60000 }) || asked;
  }
  assert.equal(asked, null, 'a climb gaining height is not ten minutes without a new best');
  assert.match(goal.tried.rung.lastBest, /higher on the climb to open sky/);
});

test('smelt_stock says how much of the batch the ladder\'s next step smelts (25585)', () => {
  const { smeltNeedSays } = require('../src/work');
  const bot = walledBot([['raw_iron', 56], ['coal', 64], ['stone_pickaxe', 1], ['crafting_table', 1], ['stick', 4]], { y: 40 });
  const says = smeltNeedSays(bot, { kind: 'win' }, 56);
  assert.match(says, /The ladder's next step \([a-z ]+\) smelts (none of it: the whole batch, about 9\.3 minutes at one furnace, is stock for later|\d+ of it: about \d+ seconds for just those; the rest of the batch is stock for later)\./);
});

test('in the Nether with no pickaxe and no wood, the trip home for wood is offered beside the stems when a portal is known (25595)', async () => {
  const { upkeepOffers } = require('../src/work');
  const bot = walkedNether();
  const goal = { kind: 'win', portals: [{ dimension: 'nether', x: 200, y: 48, z: 60 }], survival: {} };
  const { options } = await upkeepOffers(bot, new Task('upkeep', 'upkeep'), goal, () => {});
  assert(options.return_for_wood, `offered: ${Object.keys(options)}`);
  assert.match(options.return_for_wood.description, /Go back through the portal \(the nearest known \d+ blocks off at 200, 48, 60\) for .*a pickaxe needs wood \(none carried/);
  // What carrying on costs is said beside it, whichever the way to a pickaxe (note 1096):
  // 25585 at 19:35Z was offered the walk home against "carry on ... asked again in five minutes" alone.
  const { upkeepStep } = require('../src/work');
  const asked = [];
  const client = { systemOne: async req => { asked.push(req.questions.branch_0.criteria); return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  const g = { ...goal, step: { action: 'find_fortress' } };
  // No stems known or to be looked for: the walk home is the only way to a pickaxe.
  const nw = require('../src/nether-wood'), offer = nw.fetchStemsOffer;
  nw.fetchStemsOffer = async () => null;
  try { await upkeepStep(bot, { check() {} }, g, () => {}, client); } finally { nw.fetchStemsOffer = offer; }
  assert.doesNotMatch(JSON.stringify(asked[0] || ''), /fetch_stems|make_pickaxe/);
  const said = JSON.stringify(asked[0] || '');
  assert.match(said, /a way chosen fails for want of a pickaxe/);
  assert.match(said, /No pickaxe is carried: for the next 5 minutes rock is dug by hand/);
  assert.equal(g.upkeepHold?.noPickaxe, true, 'the hold ends at the first way that fails for want of one');
  // With no portal known it is not offered.
  const none = await upkeepOffers(bot, new Task('upkeep', 'upkeep'), { ...goal, portals: [] }, () => {});
  assert(!none.options.return_for_wood);
});

test('the step\'s target is said in whole blocks (25595\'s raw float)', () => {
  const { aheadByHandSays } = require('../src/block-stock');
  const bot = walkedNether();
  const says = aheadByHandSays(bot, { step: { action: 'nether_gather', target: { x: 195.49999972280747, y: 48, z: 39.112767804520985 } } });
  assert.match(says, /heads for \(195, 48, 39\)/);
});

// 25595 in the Nether: netherrack round, 78 raw iron, no pickaxe, no wood.
function walkedNether() {
  const bot = walkedBotIn('nether', [['raw_iron', 64], ['raw_iron', 14], ['netherrack', 64], ['netherrack', 64], ['iron_sword', 1], ['cooked_beef', 8]]);
  return bot;
}
function walkedBotIn(dimension, items) {
  const bot = walledBot(items, { y: 48 });
  bot.game.dimension = dimension;
  bot.entity.position = new Vec3(180.5, 48, 40.5);
  const air = p => p.y >= 48 && p.y <= 52 && p.x >= 178 && p.x <= 183;
  bot.blockAt = p => {
    const q = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    const name = air(q) ? 'air' : 'netherrack', d = registry.blocksByName[name];
    return { name, type: d.id, position: new Vec3(q.x, q.y, q.z), boundingBox: name === 'air' ? 'empty' : 'block', diggable: name !== 'air', hardness: d.hardness, harvestTools: d.harvestTools, getProperties: () => ({}),
      digTime: () => 2000 };
  };
  bot.findBlock = () => null;
  return bot;
}
