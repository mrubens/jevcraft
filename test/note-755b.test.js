'use strict';
// Note 755b: 25588 (mid-241-da, 18:14 to 18:23Z) sealed at full health
// beside a village at y 73, turn_priority giving survival the turn about
// thirty times while the option said "no reason to seal" and "under the
// rock"; its pocket, begun standing on farmland, read as a cell away from
// the bot, and every pass threw "Shelter verification failed"; its sleep
// failed as "bed.no sleep". 25581 (17:30Z) went from "Closing myself in till
// morning" to "staying up tonight" with nothing said of the seal that
// failed. 25590 (18:39 to 18:45Z) night-mined from a pocket and was climbed
// out three times by the sheep search, "Up I go, back to daylight", at night.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const shelter = require('../src/shelter');

const FARMLAND_SHAPE = [[0, 0, 0, 1, 0.9375, 1]];
function world({ at = new Vec3(0.5, 72.9375, 0.5), farmland = new Vec3(0, 72, 0), open = [], blocks = {}, sky = true, time = 13000, entities = {} } = {}) {
  const openSet = new Set(open.map(p => `${p.x},${p.y},${p.z}`));
  return {
    registry, entities, health: 20, food: 19, oxygenLevel: 20, time: { timeOfDay: time, age: 1000 },
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
    entity: { position: at, onGround: true, velocity: new Vec3(0, 0, 0), height: 1.8, width: 0.6 },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 30 }, { name: 'cooked_beef', count: 2 }], slots: [], emptySlotCount: () => 10 },
    heldItem: null,
    blockAt: p => {
      const q = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }, k = `${q.x},${q.y},${q.z}`;
      if (blocks[k]) return { name: blocks[k], boundingBox: 'empty', position: p };
      if (farmland && q.x === farmland.x && q.y === farmland.y && q.z === farmland.z) return { name: 'farmland', boundingBox: 'block', shapes: FARMLAND_SHAPE, position: p };
      const air = openSet.has(k) || (sky && q.y > 75);
      return { name: air ? 'air' : 'stone', boundingBox: air ? 'empty' : 'block', position: p, skyLight: air ? 15 : 0 };
    },
    findBlocks: () => [], world: { raycast: () => ({ intersect: new Vec3(0, 0, 0) }) }, on() {}, once() {}, removeListener() {}, emit() {}, chat() {},
  };
}

test('standing on farmland in its pocket, the bot is in it: the cell the body rests in, not the floored feet (note 755b, 25588)', () => {
  const bot = world({ open: [{ x: 0, y: 73, z: 0 }, { x: 0, y: 74, z: 0 }] });
  const refuge = { origin: { x: 0, y: 73, z: 0 }, dimension: 'overworld' };
  assert.equal(shelter.inside(bot, refuge), true);
  assert.equal(shelter.sealed(bot, refuge), true);
});

test('a shell with nothing left to place that is not sealed is said, rested and let go, not thrown and passed again every five seconds (note 755b, 25588)', async () => {
  const { Survival } = require('../src/survival');
  const { isSetAside } = require('../src/progress');
  const bot = world({ farmland: null, at: new Vec3(0.5, 73, 0.5), open: [{ x: 0, y: 73, z: 0 }], blocks: { '0,74,0': 'oak_wall_sign' } });
  const refuge = { origin: { x: 0, y: 73, z: 0 }, dimension: 'overworld' };
  const survival = new Survival(bot, {}, { state: { shelters: [refuge], nightPlan: { plan: 'shelter', until: Date.now() + 60000, method: 'saved_shelter' } } });
  const reports = [];
  survival.report = (goal, save, r) => reports.push(r);
  const out = await survival.refugeStep(new Task('wait'), { kind: 'win' }, () => {});
  assert.equal(out, false);
  assert.match(survival.state.shelterFailed.why, /^the pocket at \(0, 73, 0\) did not seal: its head cell holds oak wall sign|^the pocket at \(0, 73, 0\) did not seal: its head cell holds oak_wall_sign/);
  assert.equal(survival.state.nightPlan, undefined, 'the night\'s plan is let go, so the way is asked again');
  assert(isSetAside(survival, 'seal_here', '(0, 73, 0)'), 'the place rests');
  assert(refuge.avoidUntil > Date.now() + 500000);
  assert(reports.some(r => r.action === 'seal_failed'));
});

test('a sleep the game refuses is said in words, not its key, with the clock where it is the clock\'s (note 755b, 25588 "bed.no sleep")', () => {
  const { sleepRefusalSays } = require('../src/survival');
  assert.equal(sleepRefusalSays('block.minecraft.bed.no_sleep', { time: { timeOfDay: 12608 } }), 'the game lets a player sleep only at night or in a thunderstorm (12608 by the bot\'s clock; sleep from about 12541)');
  assert.equal(sleepRefusalSays('block.minecraft.bed.not_safe'), 'monsters are nearby');
  const { narrate, setRandom } = require('../src/narration');
  const said = [];
  const goal = { survivalAction: { action: 'sleep_failed', reason: 'The server refused the sleep: block.minecraft.bed.no_sleep', at: new Date().toISOString() } };
  setRandom(() => 0);
  narrate({ chat: m => said.push(m), game: { dimension: 'overworld' }, time: { timeOfDay: 13000 } }, goal);
  setRandom(null);
  assert.deepEqual(said, ['I can\'t sleep: the game lets a player sleep only at night or in a thunderstorm.']);
});

test('in its own pocket on the surface, the bot is not under the rock: the lid is its own (note 755b, 25588 at y 73)', () => {
  const { underRock } = require('../src/survival');
  const refuge = { origin: { x: 0, y: 73, z: 0 }, dimension: 'overworld' };
  // Stone to y 75 (its lid at 75), open sky above.
  const surface = world({ farmland: null, at: new Vec3(0.5, 73, 0.5), open: [{ x: 0, y: 73, z: 0 }, { x: 0, y: 74, z: 0 }] });
  assert.equal(underRock(surface, refuge), false);
  // Rock over the lid: under the rock.
  const below = world({ farmland: null, sky: false, at: new Vec3(0.5, 73, 0.5), open: [{ x: 0, y: 73, z: 0 }, { x: 0, y: 74, z: 0 }] });
  assert.equal(underRock(below, refuge), true);
});

test('the seal that failed is said on the next question, and the stay-up chat says it (note 755b, 25581)', () => {
  const { narrate, setRandom } = require('../src/narration');
  const said = [];
  setRandom(() => 0);
  narrate({ chat: m => said.push(m), game: { dimension: 'overworld' }, time: { timeOfDay: 13000 } },
    { survivalAction: { action: 'stay_up', shelterFailed: 'seal shelter failed: the server refused the dirt', at: new Date().toISOString() } });
  setRandom(null);
  assert.deepEqual(said, ['My shelter didn\'t work (seal shelter failed: the server refused the dirt), so I\'m staying up tonight.']);
});

test('climbing out at night is not "back to daylight" (note 755b, 25590)', () => {
  const { survivalLines } = require('../src/narration');
  const lines = survivalLines('return_to_surface', { morning: false });
  assert(lines.every(l => !/daylight/i.test(typeof l === 'function' ? l({}, {}) : l)));
  assert(lines.some(l => /night|dark/i.test(l)));
});

test('a night mine chosen from a pocket holds the turn under the rock until dawn, said as that, not left to the work (note 755b, 25590)', () => {
  const { claim } = require('../src/survival');
  const { claimSays } = require('../src/arbiter');
  const bot = world({ farmland: null, sky: false, at: new Vec3(0.5, 40, 0.5), open: [{ x: 0, y: 40, z: 0 }, { x: 0, y: 41, z: 0 }], time: 14000 });
  bot.food = 20;
  const state = { sleptAtAge: 1000, nightMine: { startedAt: Date.now() - 100000, origin: { x: 2, y: 40, z: 0 }, mined: 5, minedAt: Date.now() - 10000 } };
  const c = claim(bot, { kind: 'win' }, { state, currentShelter: () => null });
  assert.equal(c?.action, 'night_mine');
  assert.equal(c.urgency, 'routine');
  assert.match(claimSays(c), /^Go on with the night mine chosen from the pocket 2 minutes ago \(5 mined\), under the rock, until dawn about \d+ real minutes off/);
  // Far from where it began, it is no longer the mine under way.
  const far = { ...state, nightMine: { ...state.nightMine, origin: { x: 60, y: 40, z: 0 } } };
  assert.notEqual(claim(bot, { kind: 'win' }, { state: far, currentShelter: () => null })?.action, 'night_mine');
});

test('a village remembered with beds is offered for the night when no bed is in view or carried (note 755b, 25588)', async () => {
  const { Survival } = require('../src/survival');
  const bot = world({ farmland: null, at: new Vec3(0.5, 64, 0.5), open: [{ x: 0, y: 64, z: 0 }, { x: 0, y: 65, z: 0 }], time: 12000 });
  bot.blockAt = (orig => p => (Math.floor(p.y) >= 64 ? { name: 'air', boundingBox: 'empty', position: p, skyLight: 15 } : orig(p)))(bot.blockAt);
  const survival = new Survival(bot, {}, { state: {} });
  let tree;
  survival.decide = async (task, goal, save, { id, tree: t }) => { if (id === 'survival_priority') tree = t; return { path: ['continue_request'], stale: false, action: t?.continue_request || { run: async () => {} } }; };
  const goal = { kind: 'win', request: 'beat the game', villages: [{ x: 60, y: 64, z: 0, dimension: 'overworld', beds: 3, seenAt: Date.now() }] };
  await survival.step(new Task('wait'), goal, () => {});
  assert(tree?.village_bed, `village_bed was offered; options were ${Object.keys(tree || {}).join(', ')}`);
  assert.match(tree.village_bed.description, /^Walk to the village 60 blocks off \(seen with 3 beds\), about 14 seconds at a walk, and sleep in one of its beds from 12541/);
});

test('at night below, the sheep search says the time to dawn on the climb and offers leaving the sheep until day; chosen, the bed\'s search rests until dawn (note 755b, 25590)', async () => {
  const home = require('../src/home-base');
  const exploration = require('../src/exploration');
  const surface = require('../src/surface');
  const decisions = require('../src/decisions');
  const { isSetAside } = require('../src/progress');
  const realTrips = exploration.biomeTrips, realObs = surface.surfaceObserver, realClimb = surface.climbToSurface, realDecide = decisions.decide;
  try {
    let asked = null;
    decisions.decide = async (id, opts) => { asked = opts; return { path: ['until_day'], stale: false }; };
    exploration.biomeTrips = () => [{ x: 30, z: 0, biome: 'forest', distance: 32, direction: 'east', says: 'the forest 32 blocks east' }];
    surface.surfaceObserver = () => () => false; surface.climbToSurface = () => 20;
    const said = [];
    const bot = { entity: { position: new Vec3(0.5, 47, 0.5) }, game: { dimension: 'overworld', gameMode: 'survival' }, time: { timeOfDay: 16000 }, registry,
      inventory: { items: () => [] }, blockAt: () => null, findBlocks: () => [], chat: m => said.push(m) };
    const goal = {};
    await home.searchForSheep(bot, { check() {}, opportunityClient: {} }, goal, () => {}, { explore: async () => assert.fail('climbed') });
    assert.match(asked.tree.climb_first.description, /It is night: the surface's mobs are out until dawn, about 6 real minutes off, and the walk to look comes out among them\./);
    assert.match(asked.tree.until_day.description, /^Leave the sheep until day, about 6 real minutes to dawn/);
    assert(isSetAside(goal, 'bed_search', 'wool'));
    assert.deepEqual(said, ['The sheep can wait till morning.']);
  } finally { exploration.biomeTrips = realTrips; surface.surfaceObserver = realObs; surface.climbToSurface = realClimb; decisions.decide = realDecide; }
});
