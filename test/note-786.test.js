'use strict';
// Note 786. The Nether deaths after a blaze was known (scripts/blaze-deaths.js
// over the spans of 2026-09-30T06:08Z to 2026-10-01T05:00Z): 29 of 41 to a
// blaze's fire, 20 of those with no shield in the off hand at the death, 10
// broken in the last 30 seconds; 24 shields broke under blaze fire there and
// 13 of those bots were dead within two minutes, the stance chosen with the
// shield running on, nothing said of its wear. And the ways out of the fire
// failed at once: 111 of 901 chosen, 71 of them a walk to a cell the bot's
// own walk refused (25591, mid-242-vd, 07:33:40Z: leave_and_heal's cell a
// block off, "noPath", with 5 rods carried), 18 a cover begun in a block kind
// that ran out part way.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { groundBot } = require('./fixtures/saved-ground');
const wear = require('../src/shield-wear');
const { Task } = require('../src/skills');

function pocketBot({ shield = { name: 'shield', durabilityUsed: 0 }, items = [], dimension = 'the_nether', blazes = 1 } = {}) {
  const entities = {};
  for (let i = 0; i < blazes; i++) entities[80 + i] = { id: 80 + i, name: 'blaze', type: 'hostile', position: new Vec3(6 + i, 65, 0.5), height: 1.8, width: 0.6, isValid: true };
  return { game: { dimension }, registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 64, 0.5) }, entities,
    inventory: { items: () => items.map(([name, count], i) => ({ name, count, slot: 9 + i })), slots: shield ? { 45: shield } : {} } };
}

test('the shield\'s wear: its uses left, the fireballs and volleys they come to, the spare, and the record', () => {
  const fresh = wear.state(pocketBot());
  assert.deepEqual([fresh.held, fresh.max, fresh.left, fresh.fireballs, fresh.volleys], [true, 336, 336, 56, 18]);
  const worn = pocketBot({ shield: { name: 'shield', durabilityUsed: 300 }, items: [['iron_ingot', 1], ['crimson_planks', 6], ['crafting_table', 1]] });
  const s = wear.state(worn);
  assert.deepEqual([s.left, s.fireballs, s.volleys, s.spare, s.makeable], [36, 6, 2, 0, true]);
  const words = wear.says(worn);
  assert.match(words, /^The shield in the off hand has 36 of its 336 uses left: each blaze fireball blocked on it takes 6, so about 6 more fireballs blocked \(2 volleys of three\) before it breaks/);
  assert.match(words, /No spare carried; one can be made from what is carried \(an iron ingot and 6 planks at a crafting table, carried\)\./);
  assert.match(words, /24 shields broke under blaze fire in the Nether, and within two minutes of the break 13 of those bots were dead; deaths in the blazes' spans came 0\.7 a bot-hour with a shield in the off hand and 4\.1 a bot-hour without\./);
  assert.match(wear.says(pocketBot({ shield: null })), /^No shield in the off hand: every fireball that lands is taken whole/);
  assert.match(wear.says(pocketBot({ items: [['shield', 1]] })), /1 spare shield carried\./);
  assert.match(wear.says(pocketBot({ items: [['crimson_planks', 20]] })), /none can be made from what is carried \(no iron ingot\)/);
  // Said only in the Nether with a blaze about.
  assert.equal(wear.fact(pocketBot({ dimension: 'overworld' })), null);
  assert.equal(wear.fact(pocketBot({ blazes: 0 })), null);
  assert.ok(wear.fact(pocketBot()));
});

test('what ends a hold chosen with the shield: its break, or its last volley; nothing while it holds', () => {
  const then = wear.state(pocketBot({ shield: { name: 'shield', durabilityUsed: 200 } }));
  assert.equal(wear.changed(then, wear.state(pocketBot({ shield: { name: 'shield', durabilityUsed: 260 } }))), null, 'twelve fireballs left');
  assert.match(wear.changed(then, wear.state(pocketBot({ shield: null }))), /^the shield broke \(it had 22 fireballs of wear left when this was chosen\): every fireball that lands is taken whole now$/);
  assert.match(wear.changed(then, wear.state(pocketBot({ shield: { name: 'shield', durabilityUsed: 330 } }))), /^the shield is down to its last volley: about 1 more fireball blocked before it breaks \(6 of its 336 uses left\)$/);
  assert.equal(wear.changed(wear.state(pocketBot({ shield: null })), wear.state(pocketBot({ shield: null }))), null, 'chosen with none');
});

// A stance held with the shield, at the blazes: the shield breaks (25592,
// mid-242-xf, 09:42:26Z: broken under a volley, dead nine seconds later).
function blazeBot({ shield }) {
  const entities = { 70: { id: 70, name: 'blaze', type: 'hostile', position: new Vec3(5.5, 65, 0.5), height: 1.8, width: 0.6, isValid: true } };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 18, food: 20, oxygenLevel: 20,
    entities, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1, slot: 9 }, { name: 'netherrack', count: 40, slot: 10 }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, ...(shield ? { 45: shield } : {}) }, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'netherrack' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {},
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {} });
  const danger = () => Object.values(entities).map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true }));
  return { bot, danger };
}

test('a stance chosen with the shield is asked again when it breaks, said why (25592 mid-242-xf, 09:42:26Z)', async t => {
  const T0 = Date.parse('2026-09-30T09:42:20Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { Survival } = require('../src/survival');
  const run = async (shieldNow) => {
    const { bot, danger } = blazeBot({ shield: shieldNow });
    const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
    survival.state.stance = { choice: 'back_to_wall', kinds: 'blaze', ids: [70], mobs: [{ name: 'blaze', distance: 5, visible: true }], at: T0 - 6000, ranAt: T0 - 100, health: 18,
      expects: { damage: 4, seconds: 15, oneHit: 4 }, crowd: { n: 0 }, shield: wear.state({ registry: bot.registry, inventory: { items: () => [], slots: { 45: { name: 'shield', durabilityUsed: 250 } } } }),
      start: { swingAt: 0, blocks: 0, carried: 0, food: 20, pos: { x: 0.5, y: 64, z: 0.5 } } };
    let asked = null;
    survival.stanceOptions = () => ({ back_to_wall: { description: 'Wall.', expects: { damage: 4, seconds: 15 }, run: async () => true }, leave_and_heal: { description: 'Heal.', run: async () => true } });
    survival.decide = async (task, goal, save, q) => { asked = q.state; return { path: ['leave_and_heal'] }; };
    survival.scoutRetreat = async () => {};
    await survival.stanceStep(new Task('x'), {}, () => {}, danger(), false);
    return { asked, survival };
  };
  const broke = await run(null);
  assert(broke.asked, 'asked again');
  assert.match(broke.asked.previousStance.askedAgainFor, /^the shield broke \(it had 14 fireballs of wear left when this was chosen\): every fireball that lands is taken whole now, since the back to wall was chosen 6 seconds ago$/);
  assert.equal(broke.survival.state.stance.shield.held, false, 'the next stance is chosen with none');
  const last = await run({ name: 'shield', durabilityUsed: 334 });
  assert.match(last.asked?.previousStance?.askedAgainFor || '', /^the shield is down to its last volley/);
});

test('the cage\'s plan begun with the shield ends when it breaks', t => {
  const T0 = Date.parse('2026-10-01T03:40:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const cage = require('../src/cage-hold');
  const bot = { health: 20, inventory: { items: () => [], slots: { 45: { name: 'shield', durabilityUsed: 100 } } }, registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {} };
  const h = { choice: 'box_here', at: T0, until: T0 + cage.PLAN_MS, kills: 0, rods: 0, health: 20, shield: wear.state(bot) };
  assert.equal(cage.planEnd(bot, h, T0 + 1000), null);
  bot.inventory.slots = {};
  assert.match(cage.planEnd(bot, h, T0 + 2000), /^the shield broke/);
  assert(cage.planCommit().until.also.some(s => /shield breaks/.test(s)));
});

test('shieldWear goes with the questions at the blazes, with its guidance line; not with no blaze about', async () => {
  const decisions = require('../src/decisions');
  const said = [], asked = [];
  const client = { systemOne: async ({ state, questions }) => { said.push(state); asked.push(questions); return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.9 } } }; } };
  const bot = pocketBot({ shield: { name: 'shield', durabilityUsed: 300 } });
  Object.assign(bot, { health: 20, food: 20, inventory: { ...bot.inventory, emptySlotCount: () => 10 } });
  await decisions.decide('combat_kit', { client, bot, task: new Task('work'), goal: { kind: 'win' }, save: () => {}, tree: { fight_with_carried: { description: 'Go on.' }, make_kit_here: { description: 'Make it.' } }, state: { health: 20 } });
  assert.match(said[0].shieldWear || '', /^The shield in the off hand has 36 of its 336 uses left/);
  assert.match(JSON.stringify(asked[0]), /shieldWear is the shield's uses left against blaze fireballs/);
  said.length = 0;
  await decisions.decide('combat_kit', { client, bot: pocketBot({ blazes: 0 }), task: new Task('work'), goal: { kind: 'win' }, save: () => {}, tree: { fight_with_carried: { description: 'Go on.' }, make_kit_here: { description: 'Make it.' } }, state: { health: 20 } });
  assert.equal(said[0]?.shieldWear, undefined, 'no blaze about');
});

// The ways out read the walk the bot takes. An upper floor (x 0 to 8, y 30)
// a step over a lower one (x 9 to 16, y 29); a netherrack pillar at x 9
// stands between a blaze on the upper floor and the lower floor behind it,
// and lava lies level with the lower floor's feet along its north side (z 1
// and 2). The spots out of the blaze's line nearest the bot are at the
// lava's edge, where the bot's own walk in the Nether does not step.
function scene(box, fn) {
  const palette = [], rows = [];
  const letter = n => { let i = palette.indexOf(n); if (i < 0) { palette.push(n); i = palette.length - 1; } return String.fromCharCode(97 + i); };
  for (let y = box.y[0]; y <= box.y[1]; y++) for (let z = box.z[0]; z <= box.z[1]; z++) {
    let r = ''; for (let x = box.x[0]; x <= box.x[1]; x++) r += letter(fn(x, y, z)); rows.push(r);
  }
  return { box, palette, rows };
}
const EDGE = scene({ x: [0, 16], y: [25, 36], z: [0, 6] }, (x, y, z) => {
  if (y === 25 || z === 0 || z === 6) return y <= 33 ? 'netherrack' : 'air';
  if (x === 9 && z <= 3 && y <= 32) return 'netherrack';
  if (x >= 10 && z <= 2 && y === 29) return 'lava';
  if (x <= 8) return y <= 29 ? 'netherrack' : 'air';
  return y <= 28 ? 'netherrack' : 'air';
});
function edgeBot({ movements = true } = {}) {
  const bot = groundBot(EDGE, { dimension: 'the_nether', at: new Vec3(4.5, 30, 3.5), items: [['iron_sword', 1], ['blaze_rod', 5]] });
  bot.game.minY = 0;
  Object.assign(bot.pathfinder.movements, { canDig: false, allow1by1towers: false, scafoldingBlocks: [] });
  if (!movements) bot.pathfinder.movements.getNeighbors = undefined;
  const blaze = { id: 5, name: 'blaze', type: 'hostile', position: new Vec3(0.5, 31, 2.5), height: 1.8, width: 0.6, isValid: true, metadata: {} };
  bot.entities = { ...(bot.entities || {}), 5: blaze };
  return { bot, blaze };
}

test('a way out names only a spot the bot\'s own walk takes: not the lava\'s edge it refuses (25591 mid-242-vd, 07:33:40Z)', () => {
  const stand = require('../src/blaze-stand');
  const bunker = require('../src/bunker');
  const tactics = require('../src/blaze-tactics');
  // Before: the walks of their own named the cell at the lava's edge.
  const old = edgeBot({ movements: false });
  const before = bunker.coverWithin(old.bot, [old.blaze], { steps: 10 });
  assert.equal(`${before?.cell}`, '(10, 29, 3)');
  assert(tactics.walkCells(old.bot, { steps: 10 }).some(c => `${c.cell}` === '(10, 29, 3)'));
  // With the bot's movements, that cell is not taken, and the spot named is one the walk reaches.
  const now = edgeBot();
  const takes = stand.walkTakes(now.bot);
  assert.equal(takes(new Vec3(10, 29, 3)), false, 'the lava\'s edge');
  assert.equal(takes(new Vec3(12, 29, 4)), true);
  const after = bunker.coverWithin(now.bot, [now.blaze], { steps: 10 });
  assert.equal(`${after?.cell}`, '(12, 29, 4)');
  assert(!tactics.walkCells(now.bot, { steps: 10 }).some(c => c.cell.z === 3 && c.cell.x >= 10), 'heal, corner and box cells read the same walk');
  // With no pathfinder (a world read without one) every cell is taken.
  assert.equal(stand.walkTakes({ entity: { position: new Vec3(0, 0, 0) } })(new Vec3(9, 9, 9)), true);
});

test('take_cover lays each cell from what is still carried: one kind running out part way does not end the cover', async () => {
  const { Survival } = require('../src/survival');
  // One nether brick block (the most-preferred kind) and netherrack: the cover is two blocks.
  const inv = [{ name: 'iron_sword', count: 1 }, { name: 'nether_bricks', count: 1 }, { name: 'netherrack', count: 20 }];
  const placed = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival' }, health: 6.6, food: 18, entities: {},
    entity: { position: new Vec3(0.5, 72, 0.5), onGround: true }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => inv.filter(i => i.count > 0), slots: {} },
    blockAt: p => { const f = p.floored(); const solid = f.y < 72 || placed.some(([c]) => c === `${f}`); return { position: f, name: solid ? 'netherrack' : 'air', boundingBox: solid ? 'block' : 'empty' }; },
    world: { raycast: () => null }, findBlocks: () => [] });
  const place = async (b, t, p, material) => {
    const it = inv.find(i => i.name === material && i.count > 0);
    if (!it) throw new Error(`Need more ${material}`);
    it.count--; placed.push([`${p.floored()}`, material]);
  };
  const survival = new Survival(bot, { place, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const blaze = { entity: { id: 9, name: 'blaze', position: new Vec3(20.5, 74, 0.5), height: 1.8 }, distance: 20, visible: true };
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [blaze], false);
  assert(options.take_cover, Object.keys(options).join(','));
  assert.equal(await options.take_cover.run(), true);
  assert.equal(placed.length, 2, JSON.stringify(placed));
  assert.equal(new Set(placed.map(([, m]) => m)).size, 2, `both kinds laid: ${JSON.stringify(placed)}`);
});
