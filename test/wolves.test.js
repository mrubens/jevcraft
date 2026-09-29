'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const wolves = require('../src/wolves');
const breeding = require('../src/breeding');

const keys = name => registry.entitiesByName[name].metadataKeys;
function wolf(id, x, { tamedBy = null, sit = false } = {}) {
  const m = [];
  m[keys('wolf').indexOf('flags')] = (tamedBy ? 0x04 : 0) | (sit ? 0x01 : 0);
  if (tamedBy) m[keys('wolf').indexOf('owneruuid')] = tamedBy;
  return { id, name: 'wolf', position: new Vec3(x, 64, 0), isValid: true, metadata: m };
}
function bot(entities, items) {
  const b = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, player: { uuid: 'aaaa-bbbb' }, entities, chat() {},
    inventory: { items: () => items }, heldItem: null, equip: async () => {}, unequip: async () => {}, lookAt: async () => {}, used: [] };
  b.useOn = e => { b.used.push(e.id); };
  return b;
}

test('a wild wolf is tamed with bones: fed until it takes, then kept and said', async () => {
  const w = wolf(5, 2);
  const items = [{ name: 'bone', count: 5 }];
  const b = bot({ 5: w }, items);
  const goal = {};
  assert(wolves.tameReady(b, goal));
  let fed = 0;
  b.useOn = e => { fed++; items[0].count--; if (fed === 2) e.metadata[keys('wolf').indexOf('flags')] = 0x04; };
  assert.equal(await wolves.tameWolf(b, new Task('tame'), goal, () => {}, { navigate: async () => {} }), true);
  assert.equal(fed, 2, 'fed until it took');
  assert.equal(goal.wolves.length, 1);
});

test('before a crossing the bot\'s own wolves sit; back home they stand, and another player\'s wolf is left alone', async () => {
  const mine = wolf(1, 3, { tamedBy: 'aaaabbbb' }), theirs = wolf(2, 4, { tamedBy: 'ccccdddd' });
  const b = bot({ 1: mine, 2: theirs }, []);
  const goal = {};
  assert.equal(await wolves.commandWolves(b, new Task('cross'), goal, () => {}, true), true);
  assert.deepEqual(b.used, [1], 'only its own');
  assert.equal(goal.wolfOrder.sit, true);
  mine.metadata[keys('wolf').indexOf('flags')] |= 0x01;
  assert.equal(await wolves.commandWolves(b, new Task('cross'), goal, () => {}, true), false, 'already sitting: nothing to do');
  assert.equal(await wolves.commandWolves(b, new Task('home'), goal, () => {}, false), true, 'stood up again');
});

test('two adult sheep and two wheat breed; not again for five minutes', async () => {
  const sheep = id => ({ id, name: 'sheep', position: new Vec3(id, 64, 0), isValid: true, metadata: [] });
  const b = bot({ 1: sheep(1), 2: sheep(2) }, [{ name: 'wheat', count: 4 }]);
  const goal = {};
  assert(breeding.breedReady(b, goal, 'sheep'));
  assert.equal(await breeding.breedNearby(b, new Task('breed'), goal, () => {}, 'sheep', { navigate: async () => {} }), true);
  assert.deepEqual(b.used, [1, 2]);
  assert.equal(breeding.breedReady(b, goal, 'sheep'), false, 'resting');
  assert.equal(breeding.breedReady(b, {}, 'chicken'), false, 'no chickens, no seeds');
});

test('two cows in the field and two wheat breed too, for the food', async () => {
  // The evening's deaths were mostly too hungry to heal; the base's pen never held two cows.
  const cow = id => ({ id, name: 'cow', position: new Vec3(id, 64, 0), isValid: true, metadata: [] });
  const b = bot({ 1: cow(1), 2: cow(2) }, [{ name: 'wheat', count: 2 }]);
  const goal = {};
  assert(breeding.breedReady(b, goal, 'cow'));
  assert.equal(await breeding.breedNearby(b, new Task('breed'), goal, () => {}, 'cow', { navigate: async () => {} }), true);
  assert.deepEqual(b.used, [1, 2]);
});

// Note 644: tame_wolf was a side trip only for a wolf in view within 24
// blocks, and 2026-09-28's fresh worlds were offered it once. A wolf seen
// within 64 blocks is remembered like a flock and is a trip, priced with the
// odds and with what a tamed wolf does and does not do.
test('a wild wolf is noted in the sightings and a tamed one, or a pup, is not', () => {
  const { noteSightings, sighted } = require('../src/sightings');
  const pup = wolf(3, 30); pup.metadata[keys('wolf').indexOf('baby')] = true;
  const b = bot({ 1: wolf(1, 40), 2: wolf(2, 41, { tamedBy: 'aaaabbbb' }), 3: pup }, []);
  const goal = {};
  noteSightings(b, goal, 1e12);
  assert.equal(goal.sightings.wolf.length, 1);
  assert.equal(goal.sightings.wolf[0].count, 1, 'the one wild adult');
  assert.equal(sighted(b, goal, 'wolf', 1e12 + 120000)[0].says, '1 wolf seen 2 minutes ago, 40 blocks east (40, 0)');
});

test('a wolf seen within 64 blocks and out of view is a trip; farther, set aside, or with no bone it is not', () => {
  const at = (x, ago = 60000) => ({ sightings: { wolf: [{ x, y: 64, z: 0, count: 1, at: Date.now() - ago, dimension: 'overworld' }] } });
  const b = bot({}, [{ name: 'bone', count: 2 }]);
  assert.equal(wolves.tameReady(b, at(50)), true, 'seen a minute ago, 50 blocks off');
  assert.equal(wolves.tameReady(b, at(70)), false, 'past a trip');
  assert.equal(wolves.tameReady(bot({}, []), at(50)), false, 'no bone');
  const away = at(50); away.wolves = [{ id: 1 }, { id: 2 }];
  assert.equal(wolves.tameReady(b, away), false, 'two kept already');
  const resting = at(50); require('../src/progress').setAside(resting, 'tame_wolf', '50,0', 'gone from where it was seen', 60000);
  assert.equal(wolves.tameReady(b, resting), false, 'it was not there');
  const there = bot({ 9: wolf(9, 12) }, [{ name: 'bone', count: 1 }]);
  assert.equal(wolves.tameReady(there, {}), true, 'in view, as before');
});

test('the wolf option says where it is, the odds the bones give, what a wolf does and does not do, and what the Overworld cost (note 644)', () => {
  const goal = { sightings: { wolf: [{ x: 0, y: 64, z: -48, count: 1, at: Date.now() - 3 * 60000, dimension: 'overworld' }] } };
  const b = bot({}, [{ name: 'bone', count: 1 }]);
  const said = wolves.tameSays(b, goal, { walk: d => ` About ${Math.round(d)} blocks.` });
  assert.match(said, /Tame the wolf seen 3 minutes ago, 48 blocks north \(0, -48\), out of view now: walked to, and forgotten if it is not there, with the 1 bone carried/);
  assert.match(said, /one bone takes in 33 of tries \(three bones, 70; skeletons drop bones\)/);
  assert.match(said, /fights whatever attacks the bot or whatever the bot strikes, goes for skeletons on its own, and does not attack a creeper/);
  assert.match(said, /Zombies \(8\), creepers \(5\), skeletons \(3\) and spiders \(2\) were 18 of the 23 deaths before the Nether in 2026-09-28's 62 fresh worlds/);
  assert.match(said, /Costs the bones and the walk, nothing to keep\. About 48 blocks\.$/);
  const view = wolves.tameSays(bot({ 5: wolf(5, 9) }, [{ name: 'bone', count: 4 }]), { wolves: [{ id: 1 }] }, {});
  assert.match(view, /Tame the wolf in view, 9 blocks off, with the 4 bones carried: .* 4 bones take in 80 of tries/);
  assert.match(view, /1 tamed already; two at most\./);
});

test('a remembered wolf is walked to and tamed; gone from where it was seen, it is forgotten and set aside', async () => {
  const goal = { sightings: { wolf: [{ x: 30, y: 64, z: 0, count: 1, at: Date.now() - 60000, dimension: 'overworld' }] } };
  const items = [{ name: 'bone', count: 5 }];
  const b = bot({}, items);
  const w = wolf(5, 32);
  const walked = [];
  const navigate = async (bb, t, g) => { walked.push([g.x, g.z]); bb.entities[5] = w; bb.entity.position = new Vec3(30, 64, 0); };
  b.useOn = e => { items[0].count--; e.metadata[keys('wolf').indexOf('flags')] = 0x04; };
  assert.equal(await wolves.tameWolf(b, new Task('tame'), goal, () => {}, { navigate }), true);
  assert.deepEqual(walked[0], [30, 0], 'to where it was seen');
  assert.equal(goal.wolves.length, 1);
  // Nothing there: forgotten, and not walked to again for twenty minutes.
  const goal2 = { sightings: { wolf: [{ x: 30, y: 64, z: 0, count: 1, at: Date.now() - 60000, dimension: 'overworld' }] } };
  const b2 = bot({}, [{ name: 'bone', count: 2 }]);
  assert.equal(await wolves.tameWolf(b2, new Task('tame'), goal2, () => {}, { navigate: async (bb) => { bb.entity.position = new Vec3(30, 64, 0); } }), false);
  assert.equal(goal2.sightings.wolf.length, 0, 'forgotten');
  assert.equal(wolves.tameReady(b2, goal2), false);
});
