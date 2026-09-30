'use strict';
// Note 720, from the critic's report of 2026-09-30T04:14Z:
//
// (1) 25594 (mid-242-sc) parked 18 minutes at a live cage, full health and
// food, 0 blazes killed: stand_by_spawner said "no covered cell found near
// it" and the only box offered (box_in_line) was 13.2 blocks off, seeing
// about 7 in 100 of the spawner's blazes. dig_in_at_spawner (a hole beside
// the cage) was never offered because it carried no pickaxe, though
// netherrack, basalt, blackstone and nether bricks all break by hand
// (hand-dig.js, note 705) — the gate was a hidden threshold, not a game
// fact. empty-spawner.js's lullOptions no longer gates the hole on a
// pickaxe carried, and prices it by the real dig time (hand or tool).
//
// (2) fortress_approach still fired at the cage (9 blocks off, and again
// four minutes later from a box 13.2 blocks off) although note 717 quiets
// it within the known fortress's own extent: the extent was never known,
// because findFortressStep's own bricks search (which sets
// state.fortressAt) only runs past the atCage early return, and a trial
// that reaches a live cage before ever falling through that gate (every
// early tick quieted by the flat eight-block rule) never learns the
// fortress's extent at all. mob-hunt.js now seeds it from bricks near the
// cage itself whenever the bot is at a known live spawner and the anchor
// is still unset.
//
// (3) 25592 (mid-243-ia) chose go_for_food's own ways (return_for_food,
// hoglin_food) five times in two seconds, sealed at 1.2 health with no
// food, and none of them ran: survival.js's "held" check for a chosen
// pocket_next answer read `options[plan.choice]`, but a food way chosen
// under go_for_food lives in `foodWays`, not `options`, so the check always
// failed for one and a fresh decide() was asked every tick instead of the
// 90 seconds every other answer holds for.
//
// (4) At 18 health with no shield Jev charged 14 blazes (to 1.2 in 28
// seconds): the record's rows (note 712) split charge from close_in but
// were not conditioned on the blazes in reach or the shield carried, so
// charging one blaze and charging fourteen, with a shield or without, were
// the same row. blaze-record.js's cellKeys now takes a shield-carried cell,
// finer than the plain spawner|blazes|health cell, where MIN_FIGHTS of one
// kind fall in it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

// ---- (1) the hole is offered without a pickaxe, priced by hand -----------
test('dig_in_at_spawner is offered with no pickaxe carried, priced by the real (hand) dig time (note 720)', () => {
  const es = require('../src/empty-spawner');
  const stand = require('../src/blaze-stand');
  const cage = new Vec3(-108, 77, 155);
  const hole = { hole: cage.offset(3, 0, 0), stand: cage.offset(2, 0, 0), side: new Vec3(1, 0, 0), blocks: 2,
    digMs: 20000, off: 3.5, rock: 'nether_bricks', with: 'by hand', spawner: cage, steps: 2, walkMs: 500, ms: 20500 };
  const orig = stand.spawnerHoleSite;
  stand.spawnerHoleSite = () => hole;
  try {
    // A flat netherrack room, floor at y 76, so the box/stand geometry (not
    // this test's own concern: spawnerHoleSite is stubbed above) has ground
    // to compute over instead of throwing on an absent bot.entity.
    const at = p => { const y = Math.floor(p.y); return y === 76 ? 'netherrack' : y > 76 && y < 79 ? 'air' : 'netherrack'; };
    const bot = { entity: { position: cage.offset(-6, 1, 0), height: 1.8, width: 0.6 },
      blockAt: p => ({ name: at(p), position: p, boundingBox: at(p) === 'air' ? 'empty' : 'block' }),
      inventory: { items: () => [{ name: 'netherrack', count: 40 }, { name: 'iron_sword', count: 1 }] } };
    const known = { cage, off: 6, lull: { within16: 0, says: 'quiet', next: { from: 5, to: 20, lastAgo: 10, lastBlazes: 1 } } };
    const task = { check() {} };
    const actions = { navigate: async () => {}, dig: async () => {} };
    const tree = es.lullOptions(bot, task, {}, () => {}, actions, known, known.lull, { now: Date.now() });
    assert(tree.dig_in_at_spawner, `offered: ${Object.keys(tree).join(', ')}`);
    // No pickaxe among the items above, and the option still names the real
    // (hand) dig time: 20 s for the 2 blocks (digMs), not a pickaxe's speed.
    assert.match(tree.dig_in_at_spawner.description, /nether bricks, dug by hand, about 20 s/);
    assert.equal(tree.dig_in_at_spawner.secs, 2 / 4.3 + 20);
  } finally { stand.spawnerHoleSite = orig; }
});

// ---- (2) the fortress's extent is seeded from bricks at the cage itself --
const CAGE = new Vec3(-204, 57, -150);
function cageWorld() {
  const cells = new Map();
  for (let x = -220; x <= -188; x++) for (let z = -166; z <= -134; z++) {
    for (let y = 40; y <= 52; y++) cells.set(`${x},${y},${z}`, 'nether_bricks');
    for (let y = 53; y <= 62; y++) cells.set(`${x},${y},${z}`, 'air');
  }
  cells.set(`${CAGE.x},${CAGE.y},${CAGE.z}`, 'spawner');
  const blockAt = p => {
    const f = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const name = cells.get(`${f.x},${f.y},${f.z}`) ?? 'netherrack', b = registry.blocksByName[name];
    return { name, position: f, boundingBox: name === 'air' ? 'empty' : 'block', hardness: b?.hardness, harvestTools: b?.harvestTools, type: b?.id };
  };
  return { blockAt, cells };
}
const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 });
function cageBot(position) {
  const w = cageWorld();
  // A real (if slow) bricks scan, near the position, unlike the other mob-
  // hunt tests' `findBlocks: () => []` stub: this is what tells
  // seedFortressAt there is a fortress here at all.
  const findBlocks = ({ matching, maxDistance = 128, count = 1 }) => {
    const ids = new Set(Array.isArray(matching) ? matching : [matching]);
    const r = Math.min(maxDistance, 20), out = [];
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -8; dy <= 8; dy++) {
      const p = position.offset(dx, dy, dz).floored();
      if (p.distanceTo(position) > maxDistance) continue;
      const b = w.blockAt(p);
      if (b && ids.has(b.type)) out.push(p);
    }
    out.sort((a, b) => a.distanceTo(position) - b.distanceTo(position));
    return out.slice(0, count);
  };
  const bot = Object.assign(new EventEmitter(), { registry, version: '26.1', health: 20, food: 19, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position, onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0) }, entities: {}, inventory: { items: () => [stack('iron_sword'), stack('iron_pickaxe')], slots: [] },
    world: { raycast: () => null }, blockAt: w.blockAt, findBlocks, chat() {} });
  return bot;
}
const rodsGoal = (extra = {}) => ({ kind: 'win', mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 }, fortressSearch: { map: { spawners: [{ x: CAGE.x, y: CAGE.y, z: CAGE.z }] } }, ...extra });

test('fortressAt is seeded from bricks at the cage itself when unknown, so the extent gate can hold from the first ask (25594, note 720)', async () => {
  const { findFortressStep, seedFortressAt } = require('../src/mob-hunt');
  // 13.2 blocks off, as 25594's box_in_line was: farther than the flat
  // GO_TO_NEAR (8) gate note 717 fell back to when the extent is unknown.
  const bot = cageBot(new Vec3(CAGE.x + 13, CAGE.y, CAGE.z));
  let asked = 0;
  const task = { check() {}, opportunityClient: { systemOne: async () => { asked++; return { answers: {} }; } } };
  // No fortressAt at all: a trial that reached this cage before ever
  // falling through the old bricks search below (every earlier tick
  // quieted by the flat eight-block gate) never learned it.
  const goal = rodsGoal({ step: { action: 'find_fortress' } });
  assert.equal(goal.fortressSearch.fortressAt, undefined, 'not known yet');
  await findFortressStep(bot, task, goal, () => {}, { navigate: async () => { throw new Error('no walk here'); } });
  assert.ok(goal.fortressSearch.fortressAt, 'seeded from the bricks scan at the cage');
  assert.equal(asked, 0, 'nothing about a fortress asked: the gate held on the seeded extent');
  assert.equal(goal.step.action, 'at_spawner');
  // Direct, on the unit: seedFortressAt does nothing once fortressAt is
  // already known (kept, not recomputed every tick).
  const state = goal.fortressSearch, before = state.fortressAt;
  assert.equal(seedFortressAt(bot, state, { x: CAGE.x, y: CAGE.y, z: CAGE.z }), before);
});

// ---- (3) a food way chosen under go_for_food holds, as any other answer does
function foodShaft() {
  const origin = new Vec3(0, 81, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const block = p => open.has(`${p}`) || p.y >= 84 ? 'air' : p.y < 78 ? 'stone' : 'snow_block';
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 }, entities: {}, health: 0.7, food: 3, registry,
    time: { timeOfDay: 4619 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'stone_axe', count: 1 }, { name: 'cobbled_deepslate', count: 62 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: block(p), boundingBox: block(p) === 'air' ? 'empty' : 'block', diggable: true, position: p }),
    pathfinder: { movements: {}, getPathTo: () => ({ status: 'success', path: [] }), setGoal() {} },
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  const refuge = { origin: { ...origin }, dimension: 'overworld', shaft: true, top: { x: 0, y: 84, z: 0 } };
  const { Survival } = require('../src/survival');
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => {}, explore: async () => {} }, { state: { shelters: [refuge] }, client: { systemOne: async () => ({}) } });
  // this.leave (survival.js) opens the pocket by digging and walking, which
  // takes the refuge out of state.shelters (note 548): the point of this
  // test is only the "held" check on go_for_food's own children, so leave
  // itself is stubbed to succeed without that side effect, as a leave that
  // opened and was forced shut again by a threat outside would leave it.
  survival.leave = async () => true;
  const seen = { rabbit: [{ x: 0, y: 82, z: 80, count: 2, at: Date.now() - 60000, dimension: 'overworld' }] };
  return { survival, goal: { kind: 'win', sightings: seen } };
}

test('a food way chosen under go_for_food (search_food) holds for its ninety seconds, not re-asked of Jev every tick (25592, note 720)', async () => {
  const { survival, goal } = foodShaft();
  let decideCalls = 0;
  survival.decide = async (task, g, save, { id }) => { if (id === 'pocket_next') decideCalls++; return { path: ['go_for_food', 'search_food'], stale: false }; };
  survival.wait = async () => assert.fail('Jev was not asked, so the search never runs');
  await survival.step(new Task('day'), goal, () => {});
  assert.equal(decideCalls, 1, 'asked once');
  await survival.step(new Task('day'), goal, () => {});
  assert.equal(decideCalls, 1, 'held: not asked again the very next tick, as any other pocket_next answer holds for ninety seconds');
});

const { Task } = require('../src/skills');

// ---- (4) the rows the stance sees are conditioned on the shield carried --
test('the answer rows take a shield-carried cell, finer than blazes-and-health alone (note 720)', () => {
  const record = require('../src/blaze-record');
  // cellKeys: unknown shield (the caller has none to say) behaves as before,
  // two keys; a known shield adds a finer one, first.
  assert.deepEqual(record.cellKeys({ spawner: true, blazes: 6, health: 20 }), ['spawner|4+|>16', 'spawner|4+|*']);
  assert.deepEqual(record.cellKeys({ spawner: true, blazes: 6, health: 20, shield: false }),
    ['spawner|4+|>16|no shield', 'spawner|4+|>16', 'spawner|4+|*']);
  // A real row: charging into four or more blazes at a live spawner over 16
  // health, with no shield, is worse than the plain (mostly-shielded) row
  // says: the critic's own case (18 health, no shield, 14 blazes).
  const noShield = record.rowOf({ spawner: true, blazes: 14, health: 18, shield: false }, 'charge');
  const plain = record.ANSWERS['spawner|4+|>16'].charge;
  assert.notEqual(noShield.n, plain[0], 'the no-shield cell is its own row, not the mixed one');
  assert.equal(noShield.rods, 0, "note 720's own finding: no rod at all charging into 4+ with no shield");
  assert(noShield.n >= record.MIN_FIGHTS, 'said only because it has enough fights of its own');
});

test('scripts/blaze-record.js groups the first stance by class, blazes and shield, and drops cells under its minimum (note 720)', () => {
  const script = require('../scripts/blaze-record');
  const fight = (first, firstN16, firstShield, { died = false, rod = false, rods = 0, secs = 10 } = {}) => ({ first, firstN16, firstShield, died, rod, rods, secs });
  const list = [
    ...Array.from({ length: 6 }, () => fight('charge_nearest', 1, true, { rod: true, rods: 1 })),
    ...Array.from({ length: 2 }, () => fight('charge_nearest', 10, false, { died: true })),
  ];
  const rows = script.firstStanceCells(list);
  assert.equal(rows['charge|0-1|shield'].n, 6);
  assert.equal(rows['charge|0-1|shield'].rodPct, 100);
  assert.equal(rows['charge|4+|no shield'].tooFew, true, 'only 2 fights: too few to say a rate, and it says so rather than rounding one');
  assert.equal(rows['charge|4+|no shield'].n, 2);
});
