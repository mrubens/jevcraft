'use strict';
// Note 767c: 25589's shuttle between a frame and lava 60 blocks off, two
// buckets a round trip with 33 raw iron carried; its crossing answered
// cross_now as the food ran out; 25593's climb for water from the water.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { frameCells } = require('../src/ruined-portal');
const cast = require('../src/portal-cast');

const flatWorld = (named = new Map()) => {
  const nameAt = p => named.get(`${p.x},${p.y},${p.z}`) || (p.y < 64 ? 'stone' : 'air');
  const solidAt = p => !/^(air|water|lava)$/.test(nameAt(p));
  return { named, nameAt, name: nameAt, solidAt, openAt: p => nameAt(p) === 'air', blocksRay: solidAt,
    set: (p, n) => named.set(`${p.x},${p.y},${p.z}`, n) };
};
const newFrame = (axis, origin = new Vec3(10, 64, 20)) => ({ origin, axis, cast: true, castTemp: [], blocks: frameCells(origin, axis).blocks.map(p => ({ x: p.x, y: p.y, z: p.z })) });
function castingBot(carried, { waterGoes = null } = {}) {
  const registry = require('minecraft-data')('26.1');
  const w = flatWorld();
  const items = Object.entries(carried).map(([name, count]) => ({ name, count }));
  const add = (name, n) => { const i = items.find(x => x.name === name); if (i) i.count += n; else items.push({ name, count: n }); };
  const log = { lava: [], water: [], steps: [] };
  let held = null, look = null;
  const bot = {
    registry, entities: {}, oxygenLevel: 20, health: 20, food: 20, game: { gameMode: 'survival', dimension: 'overworld' },
    entity: { position: new Vec3(11.5, 64, 22.5), height: 1.8, width: 0.6 },
    inventory: { items: () => items.filter(i => i.count > 0) },
    blockAt: p => { const q = p.floored(), name = w.nameAt(q); return { name, position: q, boundingBox: w.solidAt(q) ? 'block' : 'empty', getProperties: () => ({ level: 0 }) }; },
    world: { raycast: () => null }, findBlocks: () => [],
    pathfinder: { movements: {} },
    equip: async item => { held = item.name; },
    lookAt: async p => { look = p; },
    deactivateItem: () => {},
    activateItem: () => {
      const eye = bot.entity.position.offset(0, 1.62, 0);
      if (held === 'bucket') {
        const c = look.floored();
        if (w.nameAt(c) === 'water') { w.named.delete(`${c.x},${c.y},${c.z}`); add('bucket', -1); add('water_bucket', 1); }
        return;
      }
      const hit = cast.firstHit(w.blocksRay, eye, look);
      let into = hit.cell.plus(hit.face);
      if (held === 'lava_bucket') { log.lava.push(into); w.set(into, 'lava'); add('lava_bucket', -1); add('bucket', 1); }
      else if (held === 'water_bucket') {
        // The game's own placing, where it differs from the aim (25591's water).
        const elsewhere = waterGoes && waterGoes(into);
        if (elsewhere) into = elsewhere;
        log.water.push(into);
        w.set(into, 'water'); add('water_bucket', -1); add('bucket', 1);
        const below = c => c.offset(0, -1, 0);
        const reach = w.solidAt(below(into)) ? [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => into.offset(x, 0, z)).filter(w.openAt) : [into];
        for (const c of reach) if (w.nameAt(below(c)) === 'lava') w.set(below(c), 'obsidian');
      }
    },
  };
  const calls = [];
  const actions = {
    navigate: async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); },
    place: async (b, t, p, material) => { assert(!w.solidAt(p), `placing ${material} at ${p} over ${w.nameAt(p)}`); w.set(p, material); add(material, -1); },
    dig: async (b, t, p) => { const n = w.nameAt(p); w.named.delete(`${p.x},${p.y},${p.z}`); add(n, 1); },
    acquireStep: async (b, t, item, count) => { calls.push([item, count]); return false; },
    surveyRoute: async () => ({ status: 'success' }),
    pourMs: 30,
  };
  return { bot, w, log, calls, actions, add };
}

test('25589: a frame begun far from the lava its trips go to: the route beside that lava is offered against the route keeping the frame, each priced, the trips measured; raw iron makes buckets (note 767c, note 782)', async () => {
  const { portalMethod } = require('../src/work');
  const { bot, w } = castingBot({ water_bucket: 1, bucket: 3, cobblestone: 64, raw_iron: 33, furnace: 1, coal: 20 });
  const frame = newFrame('x', new Vec3(413, 64, 283));
  for (const b of frame.blocks.slice(0, 2)) w.set(new Vec3(b.x, b.y, b.z), 'obsidian');
  bot.entity.position = new Vec3(415.5, 64, 280.5);
  const lava = { x: 273, y: 64, z: 178 };
  const goal = { portalFrame: frame, landmarks: [{ kind: 'lava_pool', dimension: 'overworld', ...lava }],
    portalMethod: { kind: 'cast', key: 'here_pool_0', lava: { way: 'pool', at: { ...lava } }, minutes: 4, activeMs: 300000, reasked: 0, from: {}, lavaTrips: { n: 1, ms: 120000 } } };
  let offered = null;
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'beside_pool_0', confidence: 0.7 } } }; } };
  await portalMethod(bot, task, goal, () => {});
  assert.match(offered.beside_pool_0, /^A frame cast beside the lava, within a few blocks of it; the frame begun at \(413, 64, 283\), 2 of ten cast, left as it stands/);
  assert.match(offered.beside_pool_0, /4 trips with 3 buckets, a scoop and a few blocks' walk about \d+ seconds each/);
  assert.match(offered.here_pool_0, /trips? with \d+ buckets?, there and back about 2 minutes each/);
  assert.match(offered.here_pool_0, /more made first from the iron carried \(three ingots each, \d+ of the 33 raw iron carried smelted first in a furnace, one carried\)/);
  assert.equal(goal.portalFrame, undefined, 'the frame left');
  assert.deepEqual(goal.portalMethod.near, lava);
  assert.deepEqual(goal.portalSitesLeft.map(s => [s.x, s.y, s.z]), [[413, 64, 283]]);
});

test('25589: a cast beside the lava does not take a site more than 32 blocks from it, and walks back to the lava', () => {
  const work = fs.readFileSync(require.resolve('../src/work'), 'utf8');
  assert.match(work, /const SITE_NEAR_LAVA = 32;/);
  assert.match(work, /if \(site && !dug && lavaOff\(site\) > SITE_NEAR_LAVA\) site = null;/);
  assert.match(work, /action: 'to_lava_for_portal', at: \{ \.\.\.near \}, distance: Math\.round\(lavaOff\(bot\.entity\.position\)\), siteFar: true/);
});

test('25589: the crossing counts a food kit gone empty since it last looked, and offers its step back', async () => {
  const { crossingKitReady } = require('../src/work');
  const registry = require('minecraft-data')('26.1');
  let items = [{ name: 'cobblestone', count: 128 }, { name: 'cooked_beef', count: 1 }, { name: 'iron_pickaxe', count: 2 }, { name: 'golden_boots', count: 1 }, { name: 'oak_log', count: 8 }, { name: 'crafting_table', count: 1 }, { name: 'chest', count: 1 }];
  const bot = { registry, health: 20, food: 20, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {},
    inventory: { items: () => items, slots: [] }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }), findBlocks: () => [] };
  const goal = { kitFood: { choice: { pick: 'go_without', at: Date.now() } } };
  require('../src/progress').setAside(goal, 'rung', 'nether_food', 'went without', 1800000);
  let offered = null;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; const k = Object.keys(offered).find(x => x.startsWith('take_up_')) || 'cross_now'; return { answers: { branch_0: { choice: k, confidence: 0.6 } } }; } };
  await crossingKitReady(bot, new Task('win'), goal, () => {}, client);
  assert(!offered || !Object.keys(offered).some(k => k.startsWith('take_up_')), 'some food then: not offered');
  items = items.filter(i => i.name !== 'cooked_beef');
  offered = null;
  assert.equal(await crossingKitReady(bot, new Task('win'), goal, () => {}, client), false);
  assert(offered.take_up_food, 'the food step offered back once it is empty');
  assert.match(offered.cross_now, /No food at all is carried: in the Nether hunger falls about 40 an hour with nothing to eat, and at hunger 20 health stops coming back in about 5 minutes/);
  assert.equal(require('../src/progress').isSetAside(goal, 'rung', 'nether_food'), false, 'its rest lifted');
  assert.equal(goal.kitFood.choice, undefined);
});

test('25593: in the water, the water bucket is filled from a source in reach, not climbed for', async () => {
  const { collectWater } = require('../src/water');
  const registry = require('minecraft-data')('26.1');
  const items = [{ name: 'bucket', count: 1 }];
  const add = (n, c) => { const i = items.find(x => x.name === n); if (i) i.count += c; else items.push({ name: n, count: c }); };
  let held = null, explored = false;
  const src = new Vec3(25, 68, -2);
  const bot = { registry, entity: { position: new Vec3(25.5, 68, -3.5) }, game: { dimension: 'overworld' }, entities: {},
    inventory: { items: () => items.filter(i => i.count > 0) }, oxygenLevel: 20,
    blockAt: p => { const q = p.floored(); return q.y >= 66 && q.y <= 69 ? { name: 'water', position: q, boundingBox: 'empty', getProperties: () => ({ level: 0 }) } : { name: 'stone', position: q, boundingBox: 'block' }; },
    findBlocks: () => [src], world: { raycast: () => null },
    equip: async i => { held = i.name; }, lookAt: async () => {}, deactivateItem: () => {},
    activateItem: () => { if (held === 'bucket') { add('bucket', -1); add('water_bucket', 1); } },
    pathfinder: { movements: {} } };
  const goal = {};
  await collectWater(bot, new Task('water'), goal, () => {}, { navigate: async () => {}, explore: async () => { explored = true; } });
  assert.equal(items.find(i => i.name === 'water_bucket')?.count, 1);
  assert.equal(explored, false);
  assert.equal(goal.step.swimming, true);
});

test('win_strategy asked as its hold runs out says the errand still under way (25593 01:24:21Z, mid-cast)', () => {
  const src = fs.readFileSync(require.resolve('../src/strategy'), 'utf8');
  assert.match(src, /errandUnderWay: `\$\{underWay\} is under way/);
});
