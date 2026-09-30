'use strict';
// Note 756: 25589 (mid-242, 2026-09-30 09:40:27-09:44:31Z) sealed itself in
// against a ghast at a live blaze spawner, full health, 0 of 7 rods, and
// pocket_next was asked once (stay). Its wall was opened after that, and
// from then on turn_priority gave survival the turn again and again, the
// claim reading "In a sealed pocket: whether to stay, leave or do something
// else there is asked next" with pocketNotWhole "shut before, but not now",
// and no pocket_next ever came: claim() read a pocket sealed once and
// opened since as the pocket (note 736), but stepOnce's own sealedIn did
// not, so the step fell past the pocket and did nothing with the turn.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival, claim } = require('../src/survival');
const shelter = require('../src/shelter');

// A Nether pocket at the origin, sealed once (verifiedAt), its north wall at
// the feet now open (air, not a fluid); blazes 5 blocks off behind rock.
function openedPocket({ carried = 43, gap = 'air', verified = true } = {}) {
  const origin = new Vec3(0, 30, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`, ...(gap ? [`${origin.offset(0, 0, -1)}`] : [])]);
  const gapAt = `${origin.offset(0, 0, -1)}`;
  const blazes = Object.fromEntries([1, 2, 3].map(id => [id, { id, name: 'blaze', type: 'hostile', position: new Vec3(5.5, 31, id - 1.5), height: 1.8, width: 0.6, isValid: true }]));
  const placed = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: blazes, health: 20, food: 20,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 6000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }, ...(carried ? [{ name: 'cobblestone', count: carried }] : [])], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: !open.has(`${p}`) ? 'netherrack' : `${p}` === gapAt ? gap : 'air', boundingBox: open.has(`${p}`) ? 'empty' : 'block', position: p }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  const refuge = { kind: 'pocket', origin: { ...origin }, dimension: 'the_nether', ...(verified ? { verifiedAt: new Date(Date.now() - 60000).toISOString() } : {}) };
  const actions = { place: async (b, task, p) => { placed.push(`${p}`); open.delete(`${p}`); } };
  return { bot, origin, refuge, actions, placed };
}

test('a pocket sealed once and opened since is the pocket to the step as it is to the claim: survival given the turn for pocket_next asks pocket_next (25589, note 758)', async () => {
  const { bot, refuge, actions } = openedPocket();
  assert.equal(shelter.sealed(bot, refuge), false);
  assert.equal(shelter.closedIn(bot, refuge), null, 'air, not a fluid: not closedIn');
  const goal = { kind: 'win', request: 'beat the game' };
  const survival = new Survival(bot, actions, { state: { shelters: [refuge] }, client: { systemOne: async () => ({}) } });
  const c = claim(bot, goal, survival);
  assert.equal(c?.action, 'pocket_next', JSON.stringify(c));
  const asked = [];
  survival.decide = async (task, g, save, { id, tree, state }) => { asked.push({ id, tree, state }); return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  await survival.step(new Task('x'), goal, () => {});
  assert.deepEqual(asked.map(a => a.id), ['pocket_next'], 'the question the claim promised is the one asked');
  assert.match(asked[0].state.pocketNotWhole, /^shut before, but not now: a wall was opened since it was last sealed \(its own mining, or working free\): 1 cell of its wall is open \(0, 30, -1\)$/);
  assert.match(asked[0].tree.stay.description, /^Close the 1 open cell of the pocket's wall \(1 block, 43 carried\) and stay/);
});

test('stay in a pocket opened since it was sealed closes the opening before it waits, and the pocket reads sealed after (note 758)', async () => {
  const { bot, refuge, actions, placed } = openedPocket();
  const goal = { kind: 'win', request: 'beat the game' };
  const survival = new Survival(bot, actions, { state: { shelters: [refuge] }, client: { systemOne: async () => ({}) } });
  survival.decide = async () => ({ path: ['stay'], stale: false });
  let waited = 0;
  survival.wait = async () => { waited++; };
  await survival.step(new Task('x'), goal, () => {});
  assert.deepEqual(placed, ['(0, 30, -1)']);
  assert.equal(waited, 1);
  assert.equal(shelter.sealed(bot, refuge), true);
});

test('with nothing to close it with, stay in an opened pocket says the wall stays open (note 758)', async () => {
  const { bot, refuge, actions } = openedPocket({ carried: 0 });
  const goal = { kind: 'win', request: 'beat the game' };
  const survival = new Survival(bot, actions, { state: { shelters: [refuge] }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, g, save, q) => { tree = q.tree; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  await survival.step(new Task('x'), goal, () => {});
  assert.match(tree.stay.description, /^Stay in the pocket with 1 cell of its wall open \(no blocks carried to close it\)/);
});

test('the claim promises pocket_next exactly where the step asks it, for every pocket shape: sealed, shut but for lava, opened since sealed, and never sealed (note 758)', async () => {
  const shapes = { sealed: { gap: null }, lava: { gap: 'lava' }, opened: { gap: 'air' }, never_sealed: { gap: 'air', verified: false } };
  for (const [shape, opts] of Object.entries(shapes)) {
    const { bot, refuge, actions } = openedPocket(opts);
    const goal = { kind: 'win', request: 'beat the game' };
    const survival = new Survival(bot, actions, { state: { shelters: [refuge] }, client: { systemOne: async () => ({}) } });
    const promised = claim(bot, goal, survival)?.action === 'pocket_next';
    const asked = [];
    survival.decide = async (task, g, save, { id, tree }) => { asked.push(id); return { path: [Object.keys(tree)[0]], stale: false }; };
    survival.wait = async () => {};
    await survival.step(new Task('x'), goal, () => {});
    assert.equal(asked.includes('pocket_next'), promised, `${shape}: claim ${promised ? 'promised' : 'did not promise'} pocket_next, step asked ${JSON.stringify(asked)}`);
    assert.equal(promised, shape !== 'never_sealed', shape);
  }
});
