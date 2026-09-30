'use strict';
// Note 719, item 1: a box, hole or wall chosen through hunt_target
// (mob-hunt.js) or empty_spawner (empty-spawner.js) never set bot._stance,
// so note 709's "a stance answers its own volleys" never saw it holding.
// 25597 mid-242-rg (2026-09-30 03:50:05 to 03:53:35Z) stood boxed beside a
// fortress with one blaze seven blocks off, 20 health, 0 of 7 rods:
// shot_answer was asked 23 times, about every 9 seconds, flipping
// shield_up and keep_on, no hits taken and no kills; hunt_target twice put
// none_good on top with only box_here and back_to_wall offered.
//
// Item 2: 25588 mid-243-id (2026-09-30 03:43 to 03:51Z) was asked
// survival_priority 76 times over 8 minutes chasing cows at full health,
// switching hunt_id most re-askings; note 702's 3-minute no-yield rest
// never caught it because a small gain kept coming, never absent a full
// three minutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const danger = require('../src/danger');
const reflex = require('../src/shot-reflex');

const registry = require('minecraft-data')('26.1');
const air = p => ({ position: p, name: 'air', boundingBox: 'empty' });
const BLAZE_FLAGS = registry.entitiesByName.blaze.metadataKeys.indexOf('flags');

// A minimal bot for danger.js's stanceHeld/standHeld: only health matters.
function healthBot(health = 20) { return { health }; }

test('a2a: standHeld: a box or hole chosen outside encounter_stance holds the same way, until enough health is lost', () => {
  const bot = healthBot(20);
  assert.equal(danger.stanceHeld(bot), null, 'nothing held yet');
  bot._standHold = { choice: 'box_here', at: Date.now(), health: 20 };
  const held = danger.stanceHeld(bot);
  assert.equal(held?.choice, 'box_here');
  assert.equal(danger.standHeld(bot)?.choice, 'box_here');
  bot.health = 20 - danger.STANCE_HEALTH; // exactly the cutoff: no longer held
  assert.equal(danger.stanceHeld(bot), null, 'six health gone since it was chosen ends the hold');
});

test('a2a: bot._stance (encounter_stance) still wins when both are set, as it always did', () => {
  const bot = healthBot(20);
  bot._stance = { choice: 'take_cover', at: Date.now(), running: true, health: 20 };
  bot._standHold = { choice: 'box_here', at: Date.now(), health: 20 };
  assert.equal(danger.stanceHeld(bot).choice, 'take_cover');
});

// A scene for shot-reflex.js: one blaze glowing, warned, seven blocks off.
function scene() {
  const here = new Vec3(0, 64, 0), floorY = 63;
  const bot = Object.assign(new EventEmitter(), {
    registry, _client: new EventEmitter(), game: { dimension: 'the_nether' }, health: 20, time: { timeOfDay: 6000 },
    entity: { id: 1, position: here, yaw: 0, pitch: 0, onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: {} },
    entities: {}, inventory: { slots: { 45: { name: 'shield' }, 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } }, items: () => [] },
    world: { raycast: () => null },
    blockAt: p => p.y === floorY ? { position: p, name: 'nether_bricks', boundingBox: 'block' } : p.y < floorY ? { position: p, name: 'netherrack', boundingBox: 'block' } : air(p),
    controlState: {}, pathfinder: { isBuilding: () => false, setGoal() {} },
    activateItem() { this._raised = (this._raised || 0) + 1; }, deactivateItem() {},
    setControlState(k, on) { this.controlState[k] = on; }, clearControlStates() { this.controlState = {}; },
    look() { return Promise.resolve(); }, lookAt() { return Promise.resolve(); }, attack() {},
  });
  bot.entities[775] = { id: 775, name: 'blaze', type: 'hostile', position: new Vec3(7, 64, 0), height: 1.8, width: 0.6, isValid: true, metadata: { [BLAZE_FLAGS]: 0 } };
  const asked = [];
  const survival = { client: {}, decide: async (task, goal, save, q) => { asked.push(q); return { path: ['keep_on'] }; } };
  return { bot, asked, survival, blaze: bot.entities[775] };
}

test('a1: a box held through hunt_target (bot._standHold, box_here) answers its own volleys: shot_answer is not asked', async () => {
  const { bot, asked, survival, blaze } = scene();
  bot._standHold = { choice: 'box_here', at: Date.now(), health: 20 };
  blaze.metadata[BLAZE_FLAGS] = 1; // glowing: warned
  reflex.tick(bot, survival, Date.now());
  await new Promise(r => setImmediate(r));
  assert.equal(asked.length, 0, 'the hold answers it, not a fresh question');
  const a = reflex.answerFor(bot, 775, Date.now());
  assert.equal(a?.by, 'stance');
  assert.equal(a?.stance, 'box_here');
});

test('a2: without a hold set, the same warning is asked (the gap note 719 found)', async () => {
  const { bot, asked, survival, blaze } = scene();
  blaze.metadata[BLAZE_FLAGS] = 1;
  reflex.tick(bot, survival, Date.now());
  await new Promise(r => setImmediate(r));
  assert.equal(asked.length, 1, 'no hold recognised: shot_answer goes out');
});

test('b: keep_on says plainly whether shots have actually landed here, not only their average cost', () => {
  const { bot, blaze } = scene();
  bot._standHold = { choice: 'box_here', at: Date.now(), health: 20 };
  blaze.metadata[BLAZE_FLAGS] = 1;
  const before = reflex.shotOptions(bot, [blaze]).keep_on.description;
  assert.doesNotMatch(before, /Held here/, 'nothing faced yet: no claim either way');
  // Three shots on the way, none landing (the box takes them).
  bot._shots = new Map();
  for (let i = 0; i < 3; i++) {
    const s = { id: 100 + i, name: 'small_fireball', at: Date.now(), from: blaze.position.clone(), v: new Vec3(-1, 0, 0), owner: 775, hitting: true, landed: false };
    reflex.settle(bot, s);
  }
  const after = reflex.shotOptions(bot, [blaze]).keep_on.description;
  assert.match(after, /Held here \(box here\) so far: none of 3 shots on the way has landed\./);
});

// Boxed already: the same box site's cells are already placed, so a fresh
// boxSite finds nothing left to build (blaze-stand.js tacticOptions).
function floorWorld({ spawner = null, solid = p => p.y <= 63, at = new Vec3(0.5, 64, 0.5) } = {}) {
  const Block = require('prismarine-block')(registry);
  const placed = new Map();
  const blockAt = p => {
    const f = p.floored(), key = `${f}`;
    const name = placed.get(key) || (spawner && f.equals(spawner) ? 'spawner' : solid(f) ? 'nether_bricks' : 'air');
    const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f;
    return b;
  };
  const stock = [['iron_sword', 1], ['cobblestone', 24]];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, entities: {},
    entity: { position: at.clone(), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => stock.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} }, placed });
  bot.findBlocks = ({ matching, maxDistance = 16, count = 1, point }) => {
    const ids = [].concat(matching), c = point || bot.entity.position, out = [];
    for (let x = -16; x <= 16; x++) for (let y = -4; y <= 4; y++) for (let z = -16; z <= 16; z++) {
      const p = c.floored().offset(x, y, z);
      if (p.distanceTo(c) <= maxDistance && ids.includes(blockAt(p).type)) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(c) - b.distanceTo(c)).slice(0, count);
  };
  return bot;
}
const blazeAt = (bot, id, x, y, z) => { const e = { id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } }; bot.entities[id] = e; return e; };

test('c: a box already whole holds it, said so, instead of "wall it in" again', () => {
  const T = require('../src/blaze-tactics'), standMod = require('../src/blaze-stand');
  const bot = floorWorld();
  // One blaze, seven blocks off: blazeStands' own box_here sites the window
  // toward it (bunker.centroid of the one blaze passed as `danger`), so the
  // site built here must face the same way for it to read as already whole.
  const blazePos = new Vec3(bot.entity.position.x - 7, 64.5, bot.entity.position.z);
  const site = T.boxSite(bot, { from: blazePos });
  for (const c of site.walls) bot.placed.set(`${c}`, 'cobblestone');
  blazeAt(bot, 775, blazePos.x, blazePos.y, blazePos.z);
  const stands = standMod.blazeStands(bot, require('../src/danger').threats(bot, 24));
  const here = stands.box_here;
  assert(here, 'box_here still offered');
  assert.match(here.description, /the box whole already/);
  assert.doesNotMatch(here.description, /wall it in at feet and head/);
});

test('c2: the one nearby blaze out of a box\'s line is named plainly, not folded into "none of N about" (a spawner\'s window faces the cage, not this one blaze off to the side)', () => {
  const standMod = require('../src/blaze-stand');
  process.env.BLAZE_TACTICS_ALL = '1';
  const spawner = new Vec3(0, 64, 0);
  const bot = floorWorld({ spawner, at: new Vec3(0.5, 64, 3.5) });
  // Off to the side of the cage-facing window, out of the box's line.
  blazeAt(bot, 775, bot.entity.position.x, 65, bot.entity.position.z + 7);
  const stands = standMod.blazeStands(bot, require('../src/danger').threats(bot, 24));
  const at = stands.box_at_spawner;
  assert(at, 'box_at_spawner offered');
  assert.match(at.description, /the one blaze about, [\d.]+ blocks off, is not in line with the window now/);
});

// Item 2: the food errand's yield and the churn of animals chased.
const { forageChoices } = require('../src/foraging');
const { track, yieldSays } = require('../src/food-errand');
const { Task } = require('../src/skills');

function forageBot(items = []) {
  return { registry, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {},
    game: { minY: 0, height: 70 }, inventory: { items: () => items },
    world: { raycast: () => null }, food: 20, heldItem: null,
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    pathfinder: { movements: {}, getPathTo: () => ({ status: 'success', path: [] }), setGoal() {} },
    clearControlStates() {}, lookAt: async () => {}, time: { timeOfDay: 6000 },
  };
}

test('d1: yieldSays names how many animals were chased, once more than one, alongside the points (note 719)', () => {
  const now = Date.now();
  let e = track({}, { supply: 10, desired: 80, now });
  assert.equal(yieldSays(e, 10, now), '', 'the first ask says nothing yet');
  e.asks = 2;
  assert.doesNotMatch(yieldSays(e, 54, now), /chased/, 'one animal so far: not said');
  e.targetsChased = 4;
  assert.match(yieldSays(e, 54, now), /asked 2 times, 4 animals chased, 10 points carried/);
});

test('d2: a new animal chased is counted on the errand it belongs to; the same one again is not (25588\'s hunt_189, hunt_190, hunt_191 in a minute)', async () => {
  const items = [], bot = forageBot(items), goal = {}, state = { foodErrand: { since: Date.now(), start: 10, best: 10, asks: 1, desired: 80 } };
  const cow1 = { id: 1, name: 'cow', height: 1.4, isValid: true, position: new Vec3(2, 64, 0.5) };
  bot.entities[1] = cow1;
  bot.attack = () => { cow1.isValid = false; items.push({ name: 'beef', count: 1 }); };
  let choices = await forageChoices(bot, new Task('test', 'food'), goal, () => {}, {}, state);
  await choices.hunt_1.run();
  assert.equal(state.foodErrand.targetsChased, 1);
  assert.equal(state.foodErrand.lastTargetId, 1);
  const cow2 = { id: 2, name: 'cow', height: 1.4, isValid: true, position: new Vec3(2, 64, 0.5) };
  bot.entities[2] = cow2;
  bot.attack = () => { cow2.isValid = false; items.push({ name: 'beef', count: 1 }); };
  choices = await forageChoices(bot, new Task('test', 'food'), goal, () => {}, {}, state);
  await choices.hunt_2.run();
  assert.equal(state.foodErrand.targetsChased, 2, 'a different animal: counted');
  // The same target chosen again (a re-ask before it dies) is not a new chase.
  const cow3 = { id: 2, name: 'cow', height: 1.4, isValid: true, position: new Vec3(2, 64, 0.5) };
  bot.entities[2] = cow3;
  bot.attack = () => { cow3.isValid = false; items.push({ name: 'beef', count: 1 }); };
  choices = await forageChoices(bot, new Task('test', 'food'), goal, () => {}, {}, state);
  await choices.hunt_2.run();
  assert.equal(state.foodErrand.targetsChased, 2, 'the same id again: not counted twice');
});
