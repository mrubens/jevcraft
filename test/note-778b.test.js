'use strict';
// Note 778b. block_creeper did not hold the creeper's distance: each step it
// came nearer, and each line it found round the block, asked the stance
// again. 25598 (mid-241, 04:11 to 04:12Z) went block_creeper and fight turn
// about some eight times (10.7 stance asks a minute); 25592 (04:15:37 to
// 45Z) block_creeper, creeper_dance and fight in eight seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Survival } = require('../src/survival');
const { Task } = require('../src/skills');

function standoffBot({ dropBehind = false } = {}) {
  const creeper = { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(4.5, 64, 0.5), height: 1.7, width: 0.6, isValid: true, metadata: [] };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, health: 20, registry: require('minecraft-data')('26.1'), entities: { 9: creeper },
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, pitch: 0, onGround: true, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [], slots: { 45: { name: 'shield' } } },
    // A floor everywhere, or with dropBehind none west of x 0.
    blockAt: p => { const f = p.floored(); const solid = f.y < 64 && !(dropBehind && f.x < 0); return { position: f, name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty', shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    lookAt: async () => {}, look: async () => {}, activateItem() {}, deactivateItem() {}, controlState: {},
    // Held back, the bot steps a block and a half west, away from the creeper.
    setControlState(key, on) { this.controlState[key] = on; if (key === 'back' && on) this.entity.position = this.entity.position.offset(-1.5, 0, 0); },
    getControlState(key) { return !!this.controlState[key]; }, clearControlStates() { this.controlState = {}; } });
  return { bot, creeper };
}

test('behind the block, a creeper closing is kept at its distance by a step back, not asked about (25598 04:11Z, note 778b)', async () => {
  const { bot, creeper } = standoffBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const stance = { choice: 'block_creeper', at: Date.now(), blockCreeper: { id: 9, creeperAt: new Vec3(6, 64, 0.5), distance: 5.5, at: Date.now() } };
  assert.equal(await survival.keepCreeperOff(new Task('x'), creeper, stance), 'stepped');
  assert.equal(stance.blockCreeper.steps, 1);
  assert.ok(creeper.position.distanceTo(bot.entity.position) >= 5.5);
  assert.equal(await survival.keepCreeperOff(new Task('x'), creeper, stance), 'held', 'at its distance: nothing to do');
});

test('with a drop behind, no step back: the hold says so and its closing is asked (note 778b)', async () => {
  const { bot, creeper } = standoffBot({ dropBehind: true });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const stance = { choice: 'block_creeper', at: Date.now(), blockCreeper: { id: 9, creeperAt: new Vec3(6, 64, 0.5), distance: 5.5, at: Date.now() } };
  const sight = require('../src/creeper-sight'), line = sight.sightLine;
  sight.sightLine = () => ({ stoppedBy: { name: 'stone', cell: '(2, 64, 0)' } });
  try {
    assert.equal(await survival.keepCreeperOff(new Task('x'), creeper, stance), 'cannot');
    assert.equal(stance.blockCreeper.cannotBack, true);
    assert.match(survival.blockCreeperHeld(stance), /^the creeper is coming nearer, from 5\.5 to 4 blocks off, and there is no backing from it here/);
  } finally { sight.sightLine = line; }
});

test('a line found round the block outside where it lights, not lit, is no new question; lit, it is (25592 04:15:41Z, note 778b)', () => {
  const { bot, creeper } = standoffBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const stance = { choice: 'block_creeper', at: Date.now(), blockCreeper: { id: 9, creeperAt: new Vec3(6, 64, 0.5), distance: 5.5, at: Date.now() } };
  const sight = require('../src/creeper-sight'), line = sight.sightLine;
  sight.sightLine = () => ({ stoppedBy: null });
  try {
    creeper.position = new Vec3(6.3, 64, 0.5);
    assert.equal(survival.blockCreeperHeld(stance), null);
    creeper.metadata = [];
    creeper.metadata[bot.registry.entitiesByName.creeper.metadataKeys.indexOf('swell_dir')] = 1;
    assert.match(survival.blockCreeperHeld(stance), /^the creeper is lit, with a line to the bot, 5\.8 blocks off$/);
  } finally { sight.sightLine = line; }
});

// While Jev cannot be reached (TypeSafe's credits out from 04:57Z): 25598
// (mid-241-bs) held a fight chosen at full health from 20 to none; 25597
// (mid-236-af) took the rule's fight at 12.9 among zombies and backed only
// at 6.
function zombieBot({ health = 9 } = {}) {
  const zombie = { id: 5, name: 'zombie', type: 'hostile', position: new Vec3(1.7, 64, 0.5), height: 1.95, width: 0.6, isValid: true };
  const { bot } = standoffBot();
  Object.assign(bot, { health, food: 14, entities: { 5: zombie } });
  bot.inventory = { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cooked_beef', count: 4 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 10 };
  bot.world = { raycast: () => null };
  bot._jevDown = { since: Date.now() - 5000, lastAt: Date.now(), questions: ['encounter_stance'], asks: 3 };
  return { bot, zombie };
}

test('Jev down, a held fight at the floor of 10 ends and is asked again with why (25598 mid-241-bs 04:57:38Z, note 778b)', async () => {
  const { bot, zombie } = zombieBot({ health: 9 });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.state.stance = { choice: 'fight', kinds: 'zombie', ids: [5], at: Date.now() - 4000, health: 20, expects: { damage: 30, seconds: 15 }, crowd: { n: 1 }, start: { swingAt: Date.now(), blocks: 0, carried: 0, food: 14, pos: { x: 0.5, y: 64, z: 0.5 } } };
  let asked = null;
  survival.stanceOptions = () => ({ fight: { description: 'Fight.', expects: { damage: 30, seconds: 15 }, run: async () => true }, retreat: { description: 'Run.', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { asked = q.state; return { stale: true }; };
  survival.scoutRetreat = async () => {};
  survival.outageFloorReflex = async () => false;
  await survival.stanceStep(new Task('x'), {}, () => {}, [{ entity: zombie, distance: 1.2, visible: true }], false);
  assert(asked, 'asked again');
  assert.match(asked.previousStance.askedAgainFor, /^Jev could not be reached and health came down to 9, the floor of 10: the fight held ended there/);
  // Above the floor, or Jev up: held.
  const up = zombieBot({ health: 15 }), s2 = new Survival(up.bot, { navigate: async () => {} }, { state: { shelters: [] } });
  assert.equal(await s2.outageFloorReflex(new Task('x'), {}, () => {}), false);
});

test('Jev down at the floor: the body backs off from what bites, shield up; with nothing biting near, it eats (note 778b)', async () => {
  const { bot, zombie } = zombieBot({ health: 8 });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.report = () => {};
  assert.equal(await survival.outageFloorReflex(new Task('x'), {}, () => {}), true);
  assert.ok(bot.entity.position.x < 0.5, 'backed off west, away from the zombie to the east');
  zombie.position = new Vec3(12, 64, 0.5);
  let ate = null;
  survival.eatChosen = async (task, meal) => { ate = meal.name; return true; };
  assert.equal(await survival.outageFloorReflex(new Task('x'), {}, () => {}), true);
  assert.equal(ate, 'cooked_beef');
  // Jev up: nothing.
  delete bot._jevDown;
  assert.equal(await survival.outageFloorReflex(new Task('x'), {}, () => {}), false);
});

test('no stance or its book outlives a death (25598 mid-241-bs 04:58:25Z, note 778b)', () => {
  const { recordDeath, STANCE_KEYS } = require('../src/recovery');
  const { bot } = zombieBot();
  bot.game = { dimension: 'overworld' }; bot.entity.id = 1;
  const state = { stance: { choice: 'fight' }, stanceScene: { key: 'x', answers: [{ choice: 'fight' }] }, stanceFailed: [], creeperStandoff: { id: 9 }, standing: {} };
  bot._stance = state.stance;
  recordDeath(bot, state);
  for (const k of STANCE_KEYS) assert.equal(state[k], undefined, k);
  assert.equal(bot._stance, undefined);
  assert.ok(state.recovery);
});
