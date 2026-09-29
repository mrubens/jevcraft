'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { foodTripDrives } = require('../src/game-progress');
const { kitEndsTrip } = require('../src/nether-food');
const fx = require('./fixtures/pocket-fed-trip-mid-243-fa.json');

// mid-243-fa (25583, note 670): Jev chose the trip back for food at
// 10:58:19 (nether_food_kit return_for_food), its walk found no route, and
// at 10:58:31 chose go_on; it ate to 20 at 11:00 and sealed in against three
// magma cubes at 11:03, 19 blocks from its fortress. For thirteen minutes the
// leave was told as the trip back (84 blocks to the portal, 18 deaths in 181
// such walks) that leaving would not have made, fed, and stay was answered
// every time.
const T = s => Date.parse(s);
function pocket({ food = fx.bot.food, carried = fx.inventory, size = null } = {}) {
  const p = fx.bot.position, origin = new Vec3(Math.floor(p.x), p.y, Math.floor(p.z));
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const entities = Object.fromEntries(fx.mobs.map(m => [m.id, { id: m.id, name: m.name, type: 'hostile', position: new Vec3(m.position.x, m.position.y, m.position.z), height: 2, width: 2, isValid: true, ...(size ? { metadata: { 16: size } } : {}) }]));
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities, health: fx.bot.health, food,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 0 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => Object.entries(carried).map(([name, count]) => ({ name, count })), emptySlotCount: () => 10, slots: [] },
    blockAt: q => ({ name: open.has(`${q}`) ? 'air' : 'netherrack', boundingBox: open.has(`${q}`) ? 'empty' : 'block', position: q }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  return { bot, origin };
}
const goalOf = () => ({ kind: 'win', request: 'beat the game', rungTime: { phase: 'obtain_blaze_rods' },
  portals: [fx.portal], fortressSearch: { approach: { found: fx.fortressFound } },
  leaveNether: { reason: 'food', pick: 'go_back', until: 0, at: T(fx.tripChosenAt) } });
async function ask(bot, origin, goal, now) {
  const sealedAt = T(fx.sealedAt);
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'the_nether', emergency: true }],
    stance: { choice: 'seal', ids: fx.sealedAgainst.ids, mobs: fx.sealedAgainst.mobs, at: sealedAt - 1000 },
    sealing: { origin: { ...origin }, at: sealedAt }, pocketOutAt: sealedAt - 30000 }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, g, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  const real = Date.now; Date.now = () => now;
  try { await survival.step(new Task('wait'), goal, () => {}); } finally { Date.now = real; }
  return tree;
}

test('fed, the held trip back for food is not the pocket\'s leave: the leave goes back to the rung, says the fortress 19 blocks off and why the trip is not what leaving does (note 670)', async () => {
  const { bot, origin } = pocket();
  const goal = goalOf();
  const now = T(fx.askedAt);
  // The trip is held (chosen five minutes before the seal, the clock
  // stopped at the seal), but fed it is not the work.
  assert.equal(foodTripDrives(bot, goal, now, { sealedAt: T(fx.sealedAt) }), false);
  const tree = await ask(bot, origin, goal, now);
  const leave = tree.leave.description;
  assert.doesNotMatch(leave, /go on with the way back to the Overworld for food/);
  assert.match(leave, /^Open the pocket and go back to the obtain blaze rods step, past a magma cube 12 blocks off/);
  assert.match(leave, /From here that work is the fortress 19 blocks off\./);
  assert.match(leave, /The trip back to the Overworld for food Jev chose at 10:58 is not what leaving does now: hunger is 20, so the work goes on here/);
  assert.doesNotMatch(leave, /The nearest portal remembered/);
});

test('hungry with nothing to eat, the held trip is still the leave\'s work, as note 589 had it', async () => {
  const { bot, origin } = pocket({ food: 16, carried: { iron_pickaxe: 1, iron_sword: 1, cobblestone: 74 } });
  const goal = goalOf();
  const now = T(fx.askedAt);
  assert.equal(foodTripDrives(bot, goal, now, { sealedAt: T(fx.sealedAt) }), true);
  const tree = await ask(bot, origin, goal, now);
  assert.match(tree.leave.description, /^Open the pocket and go on with the way back to the Overworld for food, as Jev chose at 10:58, before this pocket was sealed on it/);
  assert.doesNotMatch(tree.leave.description, /From here that work is/);
  // Hungry with food carried, the hunt's rule would not go back: nor is the leave the trip.
  const fedLater = pocket({ food: 16 });
  assert.equal(foodTripDrives(fedLater.bot, goal, now, { sealedAt: T(fx.sealedAt) }), false);
  // Set aside by keep_on, neither.
  const aside = goalOf();
  require('../src/progress').setAside(aside, 'nether_return', 'food', 'kept on', 20 * 60000);
  assert.equal(foodTripDrives(bot, aside, Date.now()), false);
});

test('a magma cube outside is priced at its own size on the leave: the big one only when the size is not known (note 647 (g))', async () => {
  const now = T(fx.askedAt);
  const unknown = pocket();
  const big = (await ask(unknown.bot, unknown.origin, goalOf(), now)).leave.description;
  const small = pocket({ size: 1 });
  const little = (await ask(small.bot, small.origin, goalOf(), now)).leave.description;
  const dmg = s => Number(s.match(/seconds and ([\d.]+) damage/)?.[1]);
  assert.ok(dmg(big) > 40, `unknown size priced as the big one: ${dmg(big)}`);
  assert.ok(dmg(little) < 10, `a small one priced as small: ${dmg(little)}`);
});

test('the food kit answered go_on, restock_food or raid_bastion after a trip back ends the trip; return_for_food and the cauldron do not (note 670)', () => {
  for (const pick of ['go_on', 'restock_food', 'raid_bastion']) {
    const goal = goalOf(); kitEndsTrip(goal, pick); assert.equal(goal.leaveNether, undefined, pick);
  }
  for (const pick of ['return_for_food', 'top_up_cauldron']) {
    const goal = goalOf(); kitEndsTrip(goal, pick); assert.equal(goal.leaveNether?.pick, 'go_back', pick);
  }
  const rods = { leaveNether: { reason: 'obtain_blaze_rods', pick: 'go_back', until: 0, at: 1 } };
  kitEndsTrip(rods, 'go_on'); assert.equal(rods.leaveNether.pick, 'go_back', 'the rods\' go_back is not the kit\'s');
});
