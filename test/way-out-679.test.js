'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival, claim } = require('../src/survival');
const { claimSays } = require('../src/arbiter');
const { wayOut } = require('../src/way-out');

// mid-242-dc-fortress-22 (25589, note 679, 18:54:35 to 18:59:23Z): sealed in
// at 12 health, hunger 16 and nothing to eat against a skeleton 9 blocks
// off. The leave was priced "out among them, fighting them all ... 59.5
// damage (more than the bot has)", a wither skeleton 12 blocks off behind
// the wall counted in it; the skeleton sealed against went off to 32 blocks
// and then out of hearing, and Jev chose stay three times, each held ninety
// seconds, nothing changing in any.

// A pocket at (0, 30, 0) in netherrack, a cobblestone door on its east side
// onto a corridor running east (x 2 to 24, z 0), floor under it.
function corridorPocket() {
  const origin = new Vec3(0, 30, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  for (let x = 2; x <= 24; x++) for (const y of [30, 31]) open.add(`${new Vec3(x, y, 0)}`);
  // A closed chamber in the rock to the west, three high, with no way out of it.
  for (let x = -13; x <= -10; x++) for (const y of [30, 31, 32]) open.add(`${new Vec3(x, y, 0)}`);
  const door = new Set([`${new Vec3(1, 30, 0)}`, `${new Vec3(1, 31, 0)}`]);
  const blockAt = p => {
    const q = p.floored(), k = `${q}`;
    const name = open.has(k) ? 'air' : door.has(k) ? 'cobblestone' : 'netherrack';
    return { name, boundingBox: name === 'air' ? 'empty' : 'block', position: q, diggable: true };
  };
  // A ray stepped a tenth of a block at a time: the first solid cell stops it.
  const raycast = (from, dir, length) => {
    for (let s = 0.05; s <= length; s += 0.1) {
      const at = from.plus(dir.scaled(s)), b = blockAt(at);
      if (b.boundingBox === 'block') return { position: at.floored(), intersect: at };
    }
    return null;
  };
  const skeleton = { id: 21, name: 'skeleton', type: 'hostile', position: new Vec3(6.5, 30, 0.5), height: 1.99, width: 0.6, isValid: true, heldItem: { name: 'bow' } };
  const wither = { id: 22, name: 'wither_skeleton', type: 'hostile', position: new Vec3(-11.5, 30, 0.5), height: 2.4, width: 0.7, isValid: true };
  const slots = []; slots[5] = { name: 'iron_helmet' }; slots[6] = { name: 'iron_chestplate' };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 21: skeleton, 22: wither }, health: 11.7, food: 16,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 0 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 20 }], emptySlotCount: () => 10, slots },
    blockAt, world: { raycast } });
  return { bot, origin, skeleton, wither };
}

async function askAt(survival, goal, now, { keepPlan = false, answer = 'stay' } = {}) {
  const real = Date.now;
  let tree, state, asked = 0;
  survival.decide = async (task, g, save, { id, tree: t, state: s }) => { if (id === 'pocket_next') { tree = t; state = s; asked++; } return { path: [answer], stale: false }; };
  survival.wait = async () => {};
  Date.now = () => now;
  try { await survival.step(new Task('wait'), goal, () => {}); } finally { Date.now = real; }
  if (!keepPlan) delete survival.state.pocketPlan;
  return { tree, state, asked };
}

test('the way out counts the mobs that can get at the bot on it: the skeleton with a line down the corridor the door opens onto, not the wither skeleton shut in the rock (note 679)', () => {
  const { bot, origin, skeleton, wither } = corridorPocket();
  const { threats } = require('../src/danger');
  const mobs = threats(bot, 16);
  const exit = { door: new Vec3(1, 30, 0), outside: new Vec3(2, 30, 0) };
  const way = wayOut(bot, { origin, exit, mobs, sightOf: () => 16 });
  assert.deepEqual(way.inWay.map(t => t.entity.id), [skeleton.id]);
  assert.deepEqual(way.apart.map(x => x.t.entity.id), [wither.id]);
  assert.equal(way.apart[0].why, 'no way to the door');
  // The same wither skeleton in the corridor, past the skeleton: in the way.
  wither.position = new Vec3(12.5, 30, 0.5);
  const again = wayOut(bot, { origin, exit, mobs: threats(bot, 16), sightOf: () => 16 });
  assert.deepEqual(again.inWay.map(t => t.entity.id).sort(), [skeleton.id, wither.id].sort());
});

test('a Nether pocket\'s leave is priced among the ones in the way and says the rest as not in it (note 679)', async () => {
  const { bot, origin } = corridorPocket();
  const t0 = 1_800_000_000_000;
  const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'obtain_blaze_rods' } };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'the_nether' }],
    stance: { choice: 'seal', ids: [21], mobs: [{ name: 'skeleton', distance: 9, visible: true }], at: t0 - 5000, health: 11.7 }, sealing: { origin: { ...origin }, at: t0 - 1000 } }, client: { systemOne: async () => ({}) } });
  const { tree } = await askAt(survival, goal, t0);
  const leave = tree.leave.description;
  assert.match(leave, /Out among the ones in the way \(a skeleton 6 blocks off\), fighting them is estimated at about [\d.]+ seconds and [\d.]+ damage/);
  assert.match(leave, /Not in the way out: a wither skeleton 12 blocks off \(no way to the door\)\./);
  assert.doesNotMatch(leave, /fighting them all/);
});

test('a pocket wait for nothing says so, is not held its ninety seconds, and the turn above is told (note 679)', async () => {
  const { bot, origin, skeleton, wither } = corridorPocket();
  const t0 = 1_800_000_000_000;
  const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'obtain_blaze_rods' }, tried: { entries: [], escalations: [] } };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'the_nether' }],
    stance: { choice: 'seal', ids: [21], mobs: [{ name: 'skeleton', distance: 9, visible: true }], at: t0 - 5000, health: 11.7 }, sealing: { origin: { ...origin }, at: t0 - 1000 } }, client: { systemOne: async () => ({}) } });
  // The skeleton it sealed against is still 6 blocks off: the wait is for it.
  let { tree } = await askAt(survival, goal, t0);
  assert.doesNotMatch(tree.stay.description, /Nothing this wait could wait for/);
  assert.match(tree.stay.description, /Neither daylight nor health comes to this wait: the bot goes out at 11\.7 health whenever it goes/);
  // It goes off, out of hearing; the wither skeleton behind the rock stays.
  skeleton.position = new Vec3(24.5, 30, 20.5); delete bot.entities[21];
  ({ tree } = await askAt(survival, goal, t0 + 30000, { keepPlan: true }));
  const stay = tree.stay.description;
  assert.match(stay, /Nothing this wait could wait for is coming: the skeleton it was sealed against is gone, no daylight comes here, and health does not come back without food\. Staying is standing idle\./);
  assert.doesNotMatch(stay, /only the mobs outside moving off would change it/);
  // Stay chosen: asked again once the wait can be judged, not ninety seconds on.
  let r = await askAt(survival, goal, t0 + 35000, { keepPlan: true });
  assert.equal(r.asked, 0, 'held while the wait is too short to judge');
  r = await askAt(survival, goal, t0 + 42000, { keepPlan: true });
  assert.equal(r.asked, 1, 'asked again once the ledger can judge the wait');
  // With the wither skeleton about the wait is still for nothing: it is not
  // what the pocket was sealed against.
  assert.ok(bot.entities[wither.id]);
  // The turn's own question says it.
  const real = Date.now; Date.now = () => t0 + 42000;
  let c; try { c = claim(bot, { ...goal, survival: survival.state }, survival); } finally { Date.now = real; }
  assert.equal(c.action, 'pocket_next');
  assert.match(claimSays(c), /The wait there waits for nothing: what it was sealed against is gone, no daylight, and no health without food\./);
});
