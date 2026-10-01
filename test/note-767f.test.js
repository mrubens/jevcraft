'use strict';
// Note 767f: lava_way's answer is done as chosen (25588's lava layer), a
// lava held whose walks failed is weighed after the ways that go on, walks
// that arrived are not counted as failed, and the cast's water is scooped
// back from a place in sight of it (25597).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { setAside } = require('../src/progress');
const { frameCells } = require('../src/ruined-portal');
const cast = require('../src/portal-cast');
const registry = require('minecraft-data')('26.1');

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

test('25588: the lava layer chosen at lava_way is dug for, not a pool walked to, past the fetch\'s own hold', async () => {
  const { collectLava, LAVA_DEPTH } = require('../src/obsidian');
  const items = [{ name: 'bucket', count: 1 }, { name: 'iron_pickaxe', count: 1 }];
  const bot = { registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(-308.5, 70, 461.5) }, inventory: { items: () => items }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 70 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 70 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) }, chat: () => {} };
  const goal = { landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: -49, y: 23, z: 206 }, { kind: 'lava_pool', dimension: 'overworld', x: 99, y: 15, z: 234 }] };
  for (const k of ['lava_pool:-49,206', 'lava_pool:99,234']) setAside(goal, 'landmark_trip', k, 'no nearer', 1800000);
  const task = new Task('lava');
  let asked = 0;
  task.opportunityClient = { systemOne: async () => { asked++; return { answers: { branch_0: { choice: 'deep', confidence: 0.8 } } }; } };
  const walks = [], dug = [];
  const actions = { navigate: async (b, t, g) => { walks.push(g); }, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  const step = { action: 'fill_bucket', item: 'lava_bucket', count: 1 };
  await collectLava(bot, task, step, goal, () => {}, actions);
  // The fetch's own hold dropped (as a pass with nothing held does): the answer stays.
  delete goal.lavaFetch;
  require('../src/progress').attemptsFor(goal).clear('landmark_trip', 'lava_pool:-49,206');
  await collectLava(bot, task, step, goal, () => {}, actions);
  assert.equal(asked, 1);
  assert.equal(walks.length, 0, 'no pool walked to');
  assert(dug.length >= 1 && dug.every(d => d.y === LAVA_DEPTH), JSON.stringify(dug));
});

test('25595: the lava held whose walks failed is said with its distance and time and comes after other lava, which is offered with its time', async () => {
  const { portalMethod } = require('../src/work');
  const { bot } = castingBot({ water_bucket: 1, bucket: 3, cobblestone: 64 });
  bot.findBlocks = () => [];
  bot.entity.position = new Vec3(100.5, 64, 60.5);
  const goal = { landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 140, y: 63, z: 100 }],
    portalMethod: { kind: 'cast', near: { x: 140, y: -55, z: 65 }, activeMs: 0, reasked: 0, from: {}, nearFailed: { walks: 29, best: 117, now: 121, stopped: 'the walk ended short 29' } } };
  let offered = null, order = null;
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; order = Object.keys(offered); return { answers: { branch_0: { choice: 'other_lava', confidence: 0.7 } } }; } };
  await portalMethod(bot, task, goal, () => {});
  assert(offered.other_lava, order.join(','));
  assert.match(offered.other_lava, /\d+ blocks away \(a lava pool remembered\), at y 63, [^,]*, about \d+ (seconds|minutes) at the bot's measured pace/);
  assert.match(offered.cast_at_lava, /29 walks toward it came no nearer than 117 blocks.* The lava chosen before is \d+ blocks off, about \d+ (seconds|minutes) at the bot's measured pace had its walks got there\.$/);
  assert(order.indexOf('cast_at_lava') > order.indexOf('other_lava'));
});

test('25597: walks to the lava chosen that arrive are not counted as failed', () => {
  const src = fs.readFileSync(require.resolve('../src/work'), 'utf8');
  assert.match(src, /if \(bot\.entity\.position\.distanceTo\(at\) <= 12\) \{ delete goal\.portalMethod\.nearTries; delete goal\.portalMethod\.nearByStairs; save\(\); \}/);
});

test('25597: the cast\'s water is scooped back from a dry place in sight of it, not one behind the cast\'s walls', () => {
  const w = flatWorld();
  const water = new Vec3(10, 64, 20);
  w.set(water, 'water');
  // A wall between the near dry cells on one side and the water.
  for (let y = 64; y <= 66; y++) w.set(new Vec3(11, y, 20), 'cobblestone');
  const bot = { entity: { position: new Vec3(20.5, 64, 20.5) }, blockAt: p => { const q = p.floored(), n = w.nameAt(q); return { name: n, position: q, boundingBox: w.solidAt(q) ? 'block' : 'empty', getProperties: () => ({ level: 0 }) }; } };
  const stand = cast.dryReach(bot, water);
  assert(stand && stand !== 'here');
  const eye = stand.offset(0.5, 1.62, 0.5), aim = water.offset(0.5, 0.5, 0.5);
  assert.equal(cast.firstHit(p => !(p.equals(stand) || p.equals(stand.offset(0, 1, 0))) && w.blocksRay(p), eye, aim), null, `in sight from ${stand}`);
});
