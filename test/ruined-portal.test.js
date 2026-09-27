'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { fitRuin, frameCells, adopt } = require('../src/ruined-portal');
const { reservedForConstruction } = require('../src/build-sites');

// A world of named blocks around a ruin, grass below y 64, air above.
const world = named => {
  const registry = require('minecraft-data')('26.1');
  const nameAt = p => named.get(`${p.x},${p.y},${p.z}`) || (p.y < 64 ? 'grass_block' : 'air');
  return { registry, blockAt: p => ({ name: nameAt(p), position: p }),
    findBlocks: ({ matching, point, maxDistance }) => [...named.entries()].filter(([, n]) => registry.blocksByName[n]?.id === matching)
      .map(([k]) => new Vec3(...k.split(',').map(Number))).filter(p => !point || p.distanceTo(point) <= maxDistance) };
};

test('a ruined portal along z is fitted: the obsidian standing, the slots to fill, what to dig from inside', () => {
  // The user (2026-09-26): the ways into the Nether without diamonds, as Jev's choices.
  const o = new Vec3(10, 64, 20), cells = frameCells(o, 'z'), named = new Map();
  cells.blocks.slice(0, 7).forEach(p => named.set(`${p.x},${p.y},${p.z}`, 'obsidian'));
  named.set(`${cells.interior[0].x},${cells.interior[0].y},${cells.interior[0].z}`, 'netherrack');
  const fit = fitRuin(world(named), o);
  assert.equal(fit.axis, 'z');
  assert.deepEqual(fit.origin, o);
  assert.equal(fit.have, 7);
  assert.equal(fit.fill.length, 3);
  assert.deepEqual(fit.digs.map(String), [String(cells.interior[0])]);
  const frame = adopt(fit);
  assert.equal(frame.ruin, true); assert.equal(frame.blocks.length, 10); assert.equal(frame.interior.length, 6);
});

test('crying obsidian in a slot needs a diamond pickaxe: without one, only a frame that leaves it be', () => {
  const o = new Vec3(0, 64, 0), cells = frameCells(o, 'x'), named = new Map();
  cells.blocks.slice(0, 8).forEach(p => named.set(`${p.x},${p.y},${p.z}`, 'obsidian'));
  named.set(`${cells.blocks[8].x},${cells.blocks[8].y},${cells.blocks[8].z}`, 'crying_obsidian');
  const without = fitRuin(world(named), o);
  assert(!without || (without.have < 8 && !without.needsDiamond), 'no fit that needs the crying obsidian out');
  const fit = fitRuin(world(named), o, { diamondPickaxe: true });
  assert.equal(fit.have, 8); assert.equal(fit.needsDiamond, true);
});

test('the frame being finished is kept from other work along whichever axis it runs', () => {
  const goal = { portalFrame: { origin: { x: 10, y: 64, z: 20 }, axis: 'z' } };
  assert(reservedForConstruction(goal, { x: 10, y: 66, z: 23 }), 'along z, in the frame');
  assert(!reservedForConstruction(goal, { x: 13, y: 66, z: 20 }), 'three across is not the frame');
});

test('a ruin short of obsidian says the missing blocks are obsidian and what making them takes', () => {
  // mid-218-a: three of ten standing, told the rest were "placed like any block"; three hours on the diamond route.
  const { ruinSays } = require('../src/work');
  const k = { distance: 142, landmark: { obsidian: 3 } };
  const short = ruinSays(k, { obsidian: 0, diamonds: 6, diamondPickaxe: false });
  assert.match(short, /7 of the frame's ten are missing and are obsidian/);
  assert.match(short, /7 short; those are made by pouring water on lava and mined with a diamond pickaxe \(none carried; three diamonds make one, 6 carried\)/);
  assert.match(ruinSays(k, { obsidian: 8, diamonds: 0, diamondPickaxe: false }), /8 carried, enough/);
});

// A frame cast in place from lava and water, no diamond pickaxe (trial
// notes 229: mid-218-a spent three hours on the diamond route).
const cast = require('../src/portal-cast');
const flatWorld = (named = new Map()) => {
  const nameAt = p => named.get(`${p.x},${p.y},${p.z}`) || (p.y < 64 ? 'stone' : 'air');
  const solidAt = p => !/^(air|water|lava)$/.test(nameAt(p));
  return { named, nameAt, name: nameAt, solidAt, openAt: p => nameAt(p) === 'air', blocksRay: solidAt,
    set: (p, n) => named.set(`${p.x},${p.y},${p.z}`, n) };
};
const newFrame = (axis, origin = new Vec3(10, 64, 20)) => ({ origin, axis, cast: true, castTemp: [], blocks: frameCells(origin, axis).blocks.map(p => ({ x: p.x, y: p.y, z: p.z })) });
const keys = cells => cells.map(String).sort();

test('the lava in a frame slot is walled in on every side and below: bottom, side and top slots, along x and along z', () => {
  for (const axis of ['x', 'z']) {
    const o = new Vec3(10, 64, 20), frame = newFrame(axis, o), cells = frameCells(o, axis);
    const A = axis === 'x' ? new Vec3(1, 0, 0) : new Vec3(0, 0, 1), X = axis === 'x' ? new Vec3(0, 0, 1) : new Vec3(1, 0, 0);
    const uy = (u, y) => o.plus(A.scaled(u)).offset(0, y, 0);
    const w = flatWorld();
    assert.deepEqual(cast.castOrder(frame).map(String), [[1, 0], [2, 0], [0, 1], [3, 1], [0, 2], [3, 2], [0, 3], [3, 3], [1, 4], [2, 4]].map(([u, y]) => String(uy(u, y))), `${axis}: bottom row, sides bottom to top, top row`);
    // Bottom: the corner, the other bottom slot, both cells across; the
    // ground is below.
    const bottom = uy(1, 0);
    assert.deepEqual(keys(cast.wallsFor(bottom, w.solidAt)), keys([uy(0, 0), uy(2, 0), bottom.plus(X), bottom.minus(X)]), `${axis} bottom`);
    for (const c of cast.wallsFor(bottom, w.solidAt)) w.set(c, 'cobblestone');
    w.set(bottom, 'obsidian'); w.set(uy(2, 0), 'obsidian');
    // Side: outside, inside and both across (the corner below is there now),
    // each placed against something already standing.
    const side = uy(0, 1), walls = cast.wallsFor(side, w.solidAt);
    for (const c of [uy(-1, 1), uy(1, 1), side.plus(X), side.minus(X)]) assert(walls.some(q => q.equals(c)), `${axis} side walls ${c}`);
    assert(!walls.some(q => q.equals(side) || q.equals(side.offset(0, 1, 0))), 'never the slot or its open top');
    const faces = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].map(([x, y, z]) => new Vec3(x, y, z));
    walls.forEach((c, i) => assert(faces.some(d => w.solidAt(c.plus(d)) || walls.slice(0, i).some(q => q.equals(c.plus(d)))), `${c} has something to be placed against`));
    // Top: the inside cell below it is one of its walls.
    const top = uy(1, 4);
    assert.deepEqual(keys(cast.containment(top)), keys([uy(1, 3), uy(0, 4), uy(2, 4), top.plus(X), top.minus(X)]), `${axis} top`);
    assert(cells.interior.some(p => p.equals(uy(1, 3))));
  }
});

test('on open ground every slot of a new frame has somewhere beside it to pour lava in and water on from, wherever in the block the bot stops', () => {
  for (const axis of ['x', 'z']) {
    const frame = newFrame(axis), w = flatWorld(), X = axis === 'x' ? 'z' : 'x';
    for (const p of cast.castOrder(frame)) {
      w.named.delete(`${p.x},${p.y},${p.z}`);
      for (const c of cast.wallsFor(p, w.solidAt)) w.set(c, 'cobblestone');
      const stands = cast.standsFor(frame, p, w);
      assert(stands.length, `${axis}: a stand for ${p}`);
      for (const s of stands) {
        assert.notEqual(s.feet[X], frame.origin[X], 'beside the frame, across its axis');
        assert(!s.water.into.equals(p), 'water is never poured into the lava itself');
        assert(s.lava.into.equals(p));
      }
      w.set(p, 'obsidian');
    }
    assert(cast.plannedWalls(axis) > 0);
  }
});

test('the cast option says what it needs against what is carried, the trips to lava and how far it is', () => {
  const says = cast.castSays({ obsidian: 2, waterBucket: true, buckets: 3, lavaBuckets: 1, iron: 5, walls: cast.plannedWalls(), blocks: 20, lighter: false, lava: { distance: 43, how: 'a lava pool remembered' } });
  assert.match(says, /no diamond pickaxe/);
  assert.match(says, /pours a lava bucket into it, pours water on top and takes the water back, and the lava source turns to obsidian/);
  assert.match(says, /8 of the ten to cast \(2 obsidian carried/);
  assert.match(says, /a water bucket \(one carried\)/);
  assert.match(says, /3 empty buckets and 1 full of lava carried; a bucket is three iron ingots, 5 carried/);
  assert.match(says, new RegExp(`about ${cast.plannedWalls()} ordinary blocks for the temporary walls.*\\(20 carried\\)`));
  assert.match(says, /flint and steel or a fire charge \(none carried\)/);
  assert.match(says, /with 4 buckets that is about 2 trips to lava/, 'seven to fetch, four at a time');
  assert.match(says, /43 blocks away \(a lava pool remembered\): about 20 seconds there and back a trip, 40 seconds in all/);
  const bare = cast.castSays({ walls: 44 });
  assert.match(bare, /With no bucket carried one has to be made first; .* 10 trips to lava/);
  assert.match(bare, /No lava is known nearby/);
  assert.match(bare, /a water bucket \(none carried\)/);
});

// A bot in a flat world whose buckets do what the game's do: a filled
// bucket empties into the cell on the face its ray hits, water beside the
// cell over lava runs onto it and turns it to obsidian, an empty bucket
// takes a source back.
function castingBot(carried) {
  const registry = require('minecraft-data')('26.1');
  const w = flatWorld();
  const items = Object.entries(carried).map(([name, count]) => ({ name, count }));
  const add = (name, n) => { const i = items.find(x => x.name === name); if (i) i.count += n; else items.push({ name, count: n }); };
  const log = { lava: [], water: [], stoodAt: [], walled: [] };
  let held = null, look = null;
  const bot = {
    registry, entities: {}, oxygenLevel: 20, game: { gameMode: 'survival', dimension: 'overworld' },
    entity: { position: new Vec3(7.5, 64, 17.5), height: 1.8, width: 0.6 },
    inventory: { items: () => items.filter(i => i.count > 0) },
    blockAt: p => { const q = p.floored(), name = w.nameAt(q); return { name, position: q, boundingBox: w.solidAt(q) ? 'block' : 'empty', getProperties: () => ({ level: 0 }) }; },
    world: { raycast: () => null },
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
      const hit = cast.firstHit(w.blocksRay, eye, look), into = hit.cell.plus(hit.face);
      if (held === 'lava_bucket') {
        log.lava.push(into); log.stoodAt.push(bot.entity.position.floored());
        log.walled.push(cast.containment(into).every(w.solidAt));
        w.set(into, 'lava'); add('lava_bucket', -1); add('bucket', 1);
      } else if (held === 'water_bucket') {
        assert.notEqual(w.nameAt(into), 'lava', 'water is never poured on the lava source itself');
        log.water.push(into);
        w.set(into, 'water'); add('water_bucket', -1); add('bucket', 1);
        // Onto lava right below it; on solid ground, sideways into the open
        // cells beside it and onto lava below those.
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
  };
  return { bot, w, log, calls, actions, add };
}

test('casting a frame: each slot walled, lava poured in from beside the frame, water on top and taken back, ten obsidian', async () => {
  const { Task } = require('../src/skills');
  for (const axis of ['x', 'z']) {
    const { bot, w, log, calls, actions } = castingBot({ water_bucket: 1, lava_bucket: 10, cobblestone: 64, flint_and_steel: 1 });
    const goal = { portalFrame: newFrame(axis) };
    let done = false;
    for (let pass = 0; pass < 5 && !done; pass++) done = await cast.castFrame(bot, new Task('cast'), goal, () => {}, actions);
    assert(done, `${axis}: cast`);
    assert.deepEqual(calls, [], 'nothing fetched');
    assert(goal.portalFrame.blocks.every(p => w.nameAt(new Vec3(p.x, p.y, p.z)) === 'obsidian'), 'ten obsidian');
    assert.equal(log.lava.length, 10);
    assert(log.lava.every(p => goal.portalFrame.blocks.some(q => p.equals(new Vec3(q.x, q.y, q.z)))), 'lava only ever into a frame slot');
    assert(log.walled.every(Boolean), 'walled in before the lava went in');
    const X = axis === 'x' ? 'z' : 'x';
    assert(log.stoodAt.every(p => p[X] !== goal.portalFrame.origin[X]), 'stood beside the frame, never in its plane');
    assert(![...w.named.values()].some(n => n === 'water' || n === 'lava'), 'the water was taken back and no lava is left');
    assert.equal(bot.inventory.items().find(i => i.name === 'water_bucket')?.count, 1);
    assert.equal(bot.inventory.items().find(i => i.name === 'bucket')?.count, 10, 'the lava buckets are empty buckets again');
    assert(goal.portalFrame.castTemp.length > 0, 'the temporary blocks are recorded');
    assert(goal.portalFrame.castTemp.every(t => w.nameAt(new Vec3(t.x, t.y, t.z)) === t.material), 'every one recorded is standing');
    const cells = frameCells(goal.portalFrame.origin, axis);
    assert(goal.portalFrame.castTemp.some(t => cells.interior.some(q => q.equals(new Vec3(t.x, t.y, t.z)))), 'some inside the frame, to dig out before lighting');
    assert(!goal.portalFrame.castTemp.some(t => goal.portalFrame.blocks.some(q => q.x === t.x && q.y === t.y && q.z === t.z)), 'none left in a slot');
  }
});

test('with no lava carried the cast goes for lava, as many as the empty buckets hold, and resumes where it stopped', async () => {
  const { Task } = require('../src/skills');
  const { bot, w, calls, actions, add } = castingBot({ water_bucket: 1, bucket: 3, cobblestone: 64 });
  const goal = { portalFrame: newFrame('x') };
  assert.equal(await cast.castFrame(bot, new Task('cast'), goal, () => {}, actions), false);
  assert.deepEqual(calls, [['lava_bucket', 3]]);
  assert.equal(goal.step.action, 'cast_portal'); assert.equal(goal.step.phase, 'fetch_lava');
  // Back with three: three slots cast, then off for more.
  bot.inventory.items().find(i => i.name === 'bucket').count = 0;
  add('lava_bucket', 3);
  assert.equal(await cast.castFrame(bot, new Task('cast'), goal, () => {}, actions), false);
  const obsidian = () => goal.portalFrame.blocks.filter(p => w.nameAt(new Vec3(p.x, p.y, p.z)) === 'obsidian').length;
  assert.equal(obsidian(), 3);
  assert.deepEqual(calls.at(-1), ['lava_bucket', 3]);
  // Lava left standing in a slot (a pass that stopped between the pours)
  // gets its water, with no lava carried.
  const next = cast.castOrder(goal.portalFrame)[3];
  for (const c of cast.wallsFor(next, w.solidAt)) w.set(c, 'cobblestone');
  w.set(next, 'lava');
  bot.inventory.items().find(i => i.name === 'bucket').count = 0;
  await cast.castFrame(bot, new Task('cast'), goal, () => {}, actions);
  assert.equal(w.nameAt(next), 'obsidian');
  assert.equal(obsidian(), 4);
});

test('carried obsidian is placed in a cast frame, not cast', async () => {
  const { Task } = require('../src/skills');
  const { bot, w, log, actions } = castingBot({ obsidian: 10, cobblestone: 8 });
  const goal = { portalFrame: newFrame('x') };
  assert.equal(await cast.castFrame(bot, new Task('cast'), goal, () => {}, actions), true);
  assert.equal(log.lava.length, 0);
  assert(goal.portalFrame.blocks.every(p => w.nameAt(new Vec3(p.x, p.y, p.z)) === 'obsidian'));
});

test('the way into the Nether is asked with no ruin known, and a frame cast in place can be chosen', async () => {
  const { portalMethod } = require('../src/work');
  const { Task } = require('../src/skills');
  const { bot } = castingBot({ bucket: 2, water_bucket: 1, cobblestone: 30, iron_ingot: 4 });
  bot.findBlocks = () => [];
  bot.health = 20; bot.food = 20;
  let offered;
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cast_frame', confidence: 0.7 } } }; } };
  const goal = {};
  assert.equal(await portalMethod(bot, task, goal, () => {}), true);
  assert.equal(goal.portalMethod.kind, 'cast');
  assert(offered.build_new && offered.cast_frame, 'both ways offered');
  assert.match(offered.cast_frame, /2 empty buckets and 0 full of lava carried/);
  assert.match(offered.cast_frame, /No lava is known nearby/);
  // No client: a frame of its own, as before.
  const quiet = {};
  assert.equal(await portalMethod(bot, new Task('nether'), quiet, () => {}), true);
  assert.equal(quiet.portalMethod.kind, 'build');
});

test('the way into the Nether is asked again every twenty working minutes, with the minutes, what they made and the same facts for every way', async () => {
  // The decision review (2026-09-26): held for good, one trial cast for three hours (834 bucket passes) and
  // another spent a whole run on the diamond route. mid-237-d cast at y 68 with its lava at y -54 and one
  // bucket, eight iron ingots in its pockets, and had none cast after three hours.
  const { portalMethod, portalDue } = require('../src/work');
  const { Task } = require('../src/skills');
  const { bot } = castingBot({ bucket: 1, water_bucket: 1, cobblestone: 30, iron_ingot: 8 });
  bot.findBlocks = () => [];
  const goal = { landmarks: [{ kind: 'lava_pool', x: 20, y: -54, z: 40, dimension: 'overworld' }], portalFrame: newFrame('x'),
    portalMethod: { kind: 'cast', activeMs: 19 * 60000, reasked: 0, from: { obsidian: 0, diamonds: 0, diamondPickaxe: false } } };
  let offered = null, pick = 'cast_at_lava';
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: pick, confidence: 0.8 } } }; } };
  assert.equal(portalDue(goal.portalMethod), false);
  assert.equal(await portalMethod(bot, task, goal, () => {}), true);
  assert.equal(offered, null, 'under twenty working minutes the way held is not asked about');
  goal.portalMethod.activeMs = 21 * 60000;
  assert.equal(portalDue(goal.portalMethod), true);
  assert.equal(await portalMethod(bot, task, goal, () => {}), true);
  assert.match(offered.cast_frame, /This is the way chosen, worked on for 21 minutes so far\. Since it was chosen: obsidian carried 0 to 0, 0 of the frame's ten standing/);
  for (const key of ['build_new', 'cast_frame', 'cast_at_lava', 'craft_buckets']) {
    assert.match(offered[key], /the nearest known lava is 121 blocks away \(a lava pool remembered\)/, key);
    assert.match(offered[key], /Diamond ore lies between y -64 and 16, most around y -59: 123 blocks below here/, key);
    assert.match(offered[key], /Diamond ore needs an iron pickaxe or better \(none carried\)/, key);
    assert.match(offered[key], /1 empty bucket, 1 of water and 0 of lava, 8 iron ingots/, key);
  }
  assert.match(offered.build_new, /mined with a diamond pickaxe only \(none carried: three diamonds make one, 0 carried/);
  assert.match(offered.cast_at_lava, /at y -54, 118 blocks below here/);
  assert.match(offered.cast_frame, /each trip carries one lava per bucket held, so with 1 bucket that is about 10 trips/);
  assert.match(offered.cast_frame, /The 8 iron ingots carried make 2 more buckets, about 4 trips with them/);
  assert.match(offered.craft_buckets, /Make 2 more buckets first from the iron ingots carried \(three each, 6 of the 8\)/);
  // mid-244-j: each trip's time said, either way; from the frame, the climb in it (note 470).
  assert.match(offered.craft_buckets, /about 4 trips \(about \d+ minutes of trips\), against 10 \(about \d+ minutes of trips\).*A trip to the nearest known lava, 120 blocks from the frame, is about 7 minutes there and back, a staircase of about 6 minutes of it/);
  // Moved beside the lava: the frame up here is left, and the new one goes down there.
  assert.equal(goal.portalMethod.kind, 'cast');
  assert.deepEqual(goal.portalMethod.near, { x: 20, y: -54, z: 40 });
  assert.equal(goal.portalMethod.activeMs, 0, 'a new way starts its own clock');
  assert.equal(goal.portalFrame, undefined);
  // Buckets first, the way held going on with them.
  goal.portalMethod.activeMs = 20 * 60000; pick = 'craft_buckets';
  assert.equal(await portalMethod(bot, task, goal, () => {}), false);
  assert.deepEqual(goal.portalBuckets, { target: 3 });
  assert.equal(goal.portalMethod.reasked, 1); assert.deepEqual(goal.portalMethod.near, { x: 20, y: -54, z: 40 });
  // A frame begun by hand is finished as a cast when the cast is chosen.
  const built = { portalFrame: { ...newFrame('x'), cast: undefined }, portalMethod: { kind: 'build', activeMs: 20 * 60000, from: {} } };
  pick = 'cast_frame';
  assert.equal(await portalMethod(bot, task, built, () => {}), true);
  assert.equal(built.portalFrame.cast, true); assert.equal(built.portalMethod.kind, 'cast');
  // Jev unreachable: the way held is kept and its clock runs on to the next twenty minutes.
  const quiet = { portalMethod: { kind: 'build', activeMs: 25 * 60000, from: {} } };
  assert.equal(await portalMethod(bot, new Task('nether'), quiet, () => {}), true);
  assert.equal(quiet.portalMethod.kind, 'build'); assert.equal(quiet.portalMethod.reasked, 1);
  assert.equal(portalDue(quiet.portalMethod), false);
});

test('the cast\'s water left standing is walked back to and scooped, from out of reach too', async () => {
  // mid-229-d waited twenty minutes on a slot to drain while the water it had left ran into it, the scoop failing from fifty blocks off (2026-09-27).
  const { Task } = require('../src/skills');
  const { bot, w, actions } = castingBot({ bucket: 1, cobblestone: 64 });
  const goal = { portalFrame: newFrame('x') };
  const slot = cast.castOrder(goal.portalFrame)[0];
  const left = slot.offset(0, 1, 1);
  w.set(left, 'water');
  goal.portalFrame.castWater = { x: left.x, y: left.y, z: left.z };
  bot.entity.position = new Vec3(slot.x + 60.5, 64, slot.z + 0.5);
  const walked = [];
  const go = actions.navigate; actions.navigate = async (b, t, g) => { walked.push(g); await go(b, t, g); };
  await cast.castFrame(bot, new Task('cast'), goal, () => {}, actions);
  assert(walked.length && walked[0].x === left.x && walked[0].z === left.z, 'walked back to the water');
  assert.notEqual(w.nameAt(left), 'water', 'and scooped it');
  assert.equal(goal.portalFrame.castWater, undefined);
});

test('a cast that fails at its site three passes running, nothing cast, leaves the site for another', async () => {
  // mid-227-e's frame went down in a cave by the lava; every pass failed there until the stall watch ended the trial (2026-09-27).
  const { Task } = require('../src/skills');
  const { buildPortalFrame } = require('../src/work');
  const { bot, w } = castingBot({ water_bucket: 1, lava_bucket: 2, cobblestone: 64, flint_and_steel: 1 });
  const frame = newFrame('x');
  const goal = { portalFrame: frame };
  // Flowing lava in the first slot: its walls are not whole, every pass throws.
  const slot = cast.castOrder(frame)[0];
  w.set(slot, 'lava');
  const blockAt = bot.blockAt;
  bot.blockAt = p => { const b = blockAt(p); return p.floored().equals(slot) ? { ...b, getProperties: () => ({ level: 3 }) } : b; };
  for (let n = 1; n <= 2; n++) {
    await assert.rejects(buildPortalFrame(bot, new Task('cast'), goal, () => {}, frame), /Flowing lava/);
    assert.equal(goal.portalFrame, frame, `kept after ${n}`);
  }
  assert.equal(await buildPortalFrame(bot, new Task('cast'), goal, () => {}, frame), false);
  assert.equal(goal.portalFrame, undefined, 'left after three');
  // With obsidian cast in it, the site is kept longer, and left after ten.
  const cast2 = newFrame('x', new Vec3(8, 64, 23));
  const goal2 = { portalFrame: cast2 };
  w.set(new Vec3(cast2.blocks[0].x, cast2.blocks[0].y, cast2.blocks[0].z), 'obsidian');
  const slot2 = cast.castOrder(cast2).find(q => w.nameAt(q) !== 'obsidian');
  w.set(slot2, 'lava');
  const inner = bot.blockAt; bot.blockAt = p => { const b = inner(p); return p.floored().equals(slot2) ? { ...b, getProperties: () => ({ level: 3 }) } : b; };
  for (let n = 1; n <= 9; n++) await assert.rejects(buildPortalFrame(bot, new Task('cast'), goal2, () => {}, cast2), /Flowing lava/);
  assert.equal(goal2.portalFrame, cast2, 'kept through nine');
  assert.equal(await buildPortalFrame(bot, new Task('cast'), goal2, () => {}, cast2), false);
  assert.equal(goal2.portalFrame, undefined, 'left at ten');
  assert.equal(goal.portalSitesLeft.length, 1);
  // Failing far from the frame, on the way to lava, is the trip's, not the site's.
  const far = newFrame('x', new Vec3(40, 64, 20));
  const goal3 = { portalFrame: far };
  const slot3 = cast.castOrder(far)[0];
  w.set(slot3, 'lava');
  const inner3 = bot.blockAt; bot.blockAt = p => { const b = inner3(p); return p.floored().equals(slot3) ? { ...b, getProperties: () => ({ level: 3 }) } : b; };
  const home = bot.entity.position; bot.entity.position = new Vec3(40.5, 64, 60.5);
  for (let n = 1; n <= 4; n++) await assert.rejects(buildPortalFrame(bot, new Task('cast'), goal3, () => {}, far));
  assert.equal(goal3.portalFrame, far, 'kept: every failure was forty blocks off');
  assert.equal(far.siteFailures || 0, 0);
  bot.entity.position = home;
  const { selectPortalSite } = require('../src/build-sites');
  assert.equal(typeof selectPortalSite, 'function');
});

test('the lava said to the portal question is lava the fetch would use: not a pool whose staircase rests', () => {
  // mid-211-g was told of lava seven blocks off while every bucket went toward the deep lava (2026-09-27).
  const { nearestLava } = require('../src/work');
  const { setAside } = require('../src/progress');
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, game: { dimension: 'overworld' }, registry: require('minecraft-data')('26.1'), findBlocks: () => [] };
  const goal = { landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 5, y: 60, z: 5, firstAt: 1, seenAt: 1 }] };
  assert.equal(nearestLava(bot, goal)?.distance <= 8, true, 'known and open');
  setAside(goal, 'staircase', { x: 0, y: 56, z: 0 }, 'paced the same few cells', 600000);
  assert.equal(nearestLava(bot, goal), null, 'its way rests: not said');
});


test('a frame in a hillside with no open cell beside a slot has a stand dug out, never its own cells or walls', async () => {
  // mid-242-i's frame had rock on both sides of a slot: "nowhere to stand" a hundred and seven times (2026-09-27).
  const { Task } = require('../src/skills');
  const { bot, w, actions } = castingBot({ water_bucket: 1, lava_bucket: 2, cobblestone: 64 });
  const frame = newFrame('x');
  const goal = { portalFrame: frame };
  // Rock on both sides of the frame's plane, everywhere a stand could be.
  for (const dz of [-2, -1, 1, 2]) for (let x = frame.origin.x - 2; x <= frame.origin.x + 5; x++) for (let y = frame.origin.y; y <= frame.origin.y + 7; y++) w.set(new Vec3(x, y, frame.origin.z + dz), 'stone');
  // Standing just outside the rock, within reach of the first slot.
  bot.entity.position = new Vec3(frame.origin.x + 1.5, frame.origin.y, frame.origin.z - 2.5);
  const dug = [];
  const dig = actions.dig; actions.dig = async (b, t, p) => { dug.push(p.clone()); await dig(b, t, p); };
  await cast.castFrame(bot, new Task('cast'), goal, () => {}, actions);
  assert.equal(goal.step?.phase, 'dig_stand', `phase ${goal.step?.phase}`);
  assert(dug.length >= 1 && dug.length <= 2, `dug ${dug.join(' ')}`);
  assert(!dug.some(p => frame.blocks.some(q => q.x === p.x && q.y === p.y && q.z === p.z)), 'no frame cell dug');
});

test('before lighting, any block inside the frame is in the way, not only the recorded walls', () => {
  // mid-211-j: a cobblestone inside a cast frame, not among its recorded walls, and the flint and steel lit only fire, 125 times.
  const { portalInteriorBlockers } = require('../src/work');
  const origin = new Vec3(10, 64, 20);
  const cells = frameCells(origin, 'x');
  const names = new Map(cells.interior.map(p => [`${p}`, 'air']));
  const [a, b, c] = cells.interior;
  names.set(`${a}`, 'fire'); names.set(`${b}`, 'cobblestone'); names.set(`${c}`, 'cave_air');
  const bot = { blockAt: p => ({ name: names.get(`${p}`) || 'air', position: p }) };
  assert.deepEqual(portalInteriorBlockers(bot, cells).map(String), [`${b}`]);
});

test('a ruin that fails at its site ten times is marked no frame, and the way to a portal is asked again', async () => {
  // mid-218-f: a ruin's corner support with nothing to place against, 125 failures, until the loop watch ended the trial.
  const { Task } = require('../src/skills');
  const { buildPortalFrame } = require('../src/work');
  const { bot, w } = castingBot({ cobblestone: 64, flint_and_steel: 1 });
  const base = newFrame('x');
  const inside = frameCells(base.origin, 'x').interior[0];
  const frame = { ...base, cast: false, ruin: true, interior: [{ x: inside.x, y: inside.y, z: inside.z }] };
  w.set(inside, 'stone');
  const goal = { portalFrame: frame, portalMethod: { kind: 'ruin', at: { x: 10, z: 20 } }, landmarks: [{ kind: 'ruined_portal', x: 11, z: 20 }] };
  for (let n = 1; n <= 9; n++) await assert.rejects(buildPortalFrame(bot, new Task('ruin'), goal, () => {}, frame));
  assert.equal(goal.portalFrame, frame, 'kept through nine');
  assert.equal(await buildPortalFrame(bot, new Task('ruin'), goal, () => {}, frame), false);
  assert.equal(goal.portalFrame, undefined);
  assert.equal(goal.portalMethod, undefined, 'the way to a portal is asked again');
  assert.equal(goal.landmarks[0].noFrame, true, 'and the ruin is not on offer');
});

test('the cast option counts the frame already standing and says when the lava is far below', () => {
  // mid-207-i was told "10 of the ten to cast" with 3 standing, and 66 seconds a trip to lava 136 blocks down (2026-09-27).
  const cast = require('../src/portal-cast');
  const says = cast.castSays({ obsidian: 0, standing: 3, waterBucket: true, buckets: 1, iron: 0, walls: 44, blocks: 200, lighter: true,
    lava: { distance: 141, how: 'a lava pool remembered', at: { x: 0, y: -55, z: 0 } }, from: { x: 0, y: 81, z: 0 } });
  assert.match(says, /7 of the ten to cast \(3 standing, 0 obsidian carried/);
  assert.match(says, /about 7 trips to lava/);
  // The climb is in each trip, not beside it (note 470).
  assert.match(says, /136 blocks away \(a lava pool remembered\): about 8 minutes there and back a trip: the walk 63 seconds, and the lava 136 blocks below, a staircase of about 7 minutes each trip, 56 minutes in all/);
});

test('a stand no walk reaches is built up to with the blocks carried, as a player pillars beside a frame', async () => {
  // mid-244-r made a stand four blocks up for the top slot, no walk reached it, and "nowhere to stand" flipped with the way in until the loop watch ended it (2026-09-27).
  const { Task } = require('../src/skills');
  const { bot, w, actions } = castingBot({ water_bucket: 1, lava_bucket: 10, cobblestone: 64, flint_and_steel: 1 });
  const phases = [];
  actions.surveyRoute = async (b, t, movements, goal) => (goal.y <= 65 || movements.allow1by1towers ? { status: 'success' } : { status: 'noPath' });
  const goal = { portalFrame: newFrame('x') };
  const save = () => { if (goal.step?.phase === 'to_stand') phases.push(goal.step); };
  let done = false;
  for (let pass = 0; pass < 8 && !done; pass++) done = await cast.castFrame(bot, new Task('cast'), goal, save, actions);
  assert(done, 'cast');
  assert(goal.portalFrame.blocks.every(p => w.nameAt(new Vec3(p.x, p.y, p.z)) === 'obsidian'));
  assert(phases.some(s => s.built), 'a high stand reached by building up');
  assert.equal(bot.pathfinder.movements.allow1by1towers, undefined, 'the towering let go after');
});

test('a source feeding a slot that the bucket cannot scoop is filled with a block instead', async () => {
  // mid-242-r tried to scoop a source inside its own cast walls round after round until the loop watch ended the trial (2026-09-27).
  const { Task } = require('../src/skills');
  // No empty bucket to scoop with (and a scoop that fails is counted the same way, in the code).
  const { bot, w, actions } = castingBot({ water_bucket: 0, bucket: 0, lava_bucket: 1, cobblestone: 64, flint_and_steel: 1 });
  const goal = { portalFrame: newFrame('x') };
  const slot = cast.castOrder(goal.portalFrame)[0];
  const feeder = slot.offset(0, 1, 1);
  w.set(slot, 'water'); w.set(feeder, 'water');
  const base = bot.blockAt;
  bot.blockAt = p => { const b = base(p); return p.floored().equals(slot) ? { ...b, getProperties: () => ({ level: 1 }) } : b; };
  let passes = 0;
  const phases = [];
  while (passes++ < 3 && w.nameAt(feeder) === 'water') { await cast.castFrame(bot, new Task('cast'), goal, () => phases.push(goal.step?.phase), actions).catch(e => phases.push('ERR ' + e.message)); }
  if (process.env.DBG) console.log('DBG', phases, w.nameAt(feeder), JSON.stringify(goal.portalFrame.castTemp), `${slot}`, `${feeder}`);
  assert.notEqual(w.nameAt(feeder), 'water', 'the feeding source is filled');
  assert(goal.portalFrame.castTemp.some(t => t.x === feeder.x && t.y === feeder.y && t.z === feeder.z), 'and tracked as a temporary block');
});

test('at the lava with the frame far above, the cast beside the lava is offered and each trip is measured from the frame, climb and all; the diamond route says the same trip', async () => {
  // mid-244-v (note 470): at y -54 beside its lava, the frame at y 68 with 5 of 10 standing, told "about 5 seconds there
  // and back a trip" (the trips took 5 to 77 minutes), not offered the cast beside the lava, and the diamond route (three
  // diamonds carried) offered with no trip or time to set against it.
  const { portalMethod } = require('../src/work');
  const { Task } = require('../src/skills');
  const { bot, w } = castingBot({ bucket: 1, water_bucket: 1, cobblestone: 30, diamond: 3, flint_and_steel: 1 });
  bot.findBlocks = () => [];
  bot.entity.position = new Vec3(20.5, -53, 41.5);
  const frame = newFrame('x', new Vec3(10, 68, 20));
  frame.blocks.slice(0, 5).forEach(p => w.set(new Vec3(p.x, p.y, p.z), 'obsidian'));
  const goal = { landmarks: [{ kind: 'lava_pool', x: 20, y: -54, z: 40, dimension: 'overworld' }], portalFrame: frame,
    portalMethod: { kind: 'cast', activeMs: 21 * 60000, reasked: 0, lavaTrips: { n: 2, ms: 50 * 60000 }, from: { obsidian: 0, diamonds: 0, diamondPickaxe: false } } };
  let offered = null;
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cast_frame', confidence: 0.8 } } }; } };
  assert.equal(await portalMethod(bot, task, goal, () => {}), true);
  assert(offered.cast_at_lava, 'the cast beside the lava is offered, the frame being far from it');
  assert.match(offered.cast_at_lava, /and 124 blocks from the frame begun/);
  assert.match(offered.cast_at_lava, /The frame begun, 5 of ten standing, is left as it stands and all ten are cast down there/);
  assert.match(offered.cast_frame, /5 of the ten to cast \(5 standing/);
  assert.match(offered.cast_frame, /124 blocks from the frame \(a lava pool remembered\): about 7 minutes there and back a trip: the walk 58 seconds, and the lava 122 blocks below, a staircase of about 6 minutes each trip, 35 minutes in all/);
  assert.doesNotMatch(offered.cast_frame, /about \d+ seconds there and back a trip/);
  assert.match(offered.cast_frame, /So far 2 trips for lava have been made, about 25 minutes of working time each/);
  // The diamond route, with the same trip to set against the cast's.
  assert.match(offered.build_new, /the 5 obsidian wanted are about 60 seconds of pouring and mining there, all carried to the frame at once: the bot is beside that lava now, so one way to the frame, about 6 minutes with a staircase of about 6 minutes/);
  assert.match(offered.build_new, /The cast fetches a bucket a block: 5 trips of the same, about 35 minutes/);
});

test('three walks to the lava Jev chose that come no nearer ask the way again, the walks said, and the lava is kept if Jev keeps it', async () => {
  // mid-244-v (note 470): survival pulled the bot back up on each walk down, and after three the lava was dropped without
  // a word and the frame cast 122 blocks above it.
  const { portalStep } = require('../src/work');
  const { Task } = require('../src/skills');
  const { bot } = castingBot({ bucket: 1, water_bucket: 1, cobblestone: 64, flint_and_steel: 1 });
  bot.findBlocks = () => [];
  bot.on = () => {}; bot.removeListener = () => {}; bot.off = () => {};
  bot.pathfinder.setGoal = () => {};
  bot.pathfinder.goto = async () => { const e = new Error('a creeper'); e.name = 'NeedsSafety'; throw e; };
  const near = { x: 20, y: -54, z: 40 };
  const goal = { landmarks: [{ kind: 'lava_pool', ...near, dimension: 'overworld' }],
    portalMethod: { kind: 'cast', near: { ...near }, activeMs: 0, reasked: 0, from: { obsidian: 0, diamonds: 0, diamondPickaxe: false } } };
  let offered = null;
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cast_at_lava', confidence: 0.8 } } }; } };
  const pass = async () => {
    goal.survivalAction = { action: 'climb_to_surface', at: new Date(Date.now() + 60000).toISOString() };
    await portalStep(bot, task, goal, () => {}, task.opportunityClient).catch(err => { if (err.name !== 'NeedsSafety') throw err; });
  };
  for (let i = 0; i < 4; i++) await pass();
  assert.deepEqual(goal.portalMethod.near, near, 'the lava Jev chose is not dropped unasked');
  assert.equal(offered, null);
  assert.equal(goal.portalMethod.nearFailed.walks, 3);
  await pass();
  assert.match(offered.cast_at_lava, /The walk there has failed: 3 walks toward it came no nearer than \d+ blocks \(what ended them: survival: climb to surface 3\)/);
  assert.deepEqual(goal.portalMethod.near, near, 'kept, as Jev chose');
  assert.equal(goal.portalMethod.nearFailed, undefined);
  assert.equal(goal.portalMethod.reasked, 1);
});

test('the lava held with its staircase resting says the rest, not that the walk goes on, and kept, every way to it resting is said', async () => {
  // mid-214-f (note 488): the stairs to its lava were refused ("Refusing to open a drop") and set aside ten minutes; the
  // cast_at_lava option said "Kept, the walk goes on by staircase" and "the walk ended short", Jev kept it, and the rest
  // was met every half second, asked again every few, twenty-six stalls and more.
  const { portalStep } = require('../src/work');
  const { setAside } = require('../src/progress');
  const { Task } = require('../src/skills');
  const { bot } = castingBot({ bucket: 1, water_bucket: 1, cobblestone: 64, flint_and_steel: 1, stone_pickaxe: 1 });
  bot.findBlocks = () => [];
  bot.on = () => {}; bot.removeListener = () => {}; bot.off = () => {};
  bot.pathfinder.setGoal = () => {}; bot.pathfinder.stop = () => {};
  bot.pathfinder.goto = async () => { throw new Error('No path to the goal'); };
  const near = { x: 20, y: -54, z: 40 };
  const goal = { landmarks: [{ kind: 'lava_pool', ...near, dimension: 'overworld' }],
    portalMethod: { kind: 'cast', near: { ...near }, nearByStairs: true, activeMs: 0, reasked: 0, from: { obsidian: 0, diamonds: 0, diamondPickaxe: false } } };
  // The staircase toward it set aside, as it was (by the eight-block area of the lava's block).
  setAside(goal, 'staircase', { x: 16, y: -56, z: 40 }, 'refusing to open a drop beside the feet', 10 * 60000);
  let offered = null, asked = 0;
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { asked++; offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cast_at_lava', confidence: 0.7 } } }; } };
  const pass = () => { delete goal.step; return portalStep(bot, task, goal, () => {}, task.opportunityClient).then(() => null, err => { if (err.name !== 'StaircaseStalled') return err; }); };
  let kept = null;
  for (let i = 0; i < 6 && !asked; i++) kept = await pass();
  assert.equal(asked, 1, 'the way is asked again');
  assert.match(offered.cast_at_lava, /set aside \(refusing to open a drop.*\), taken up again in \d+ minute/);
  assert.doesNotMatch(offered.cast_at_lava, /goes on by staircase/);
  assert.match(offered.cast_at_lava, /what ended them: the staircase set aside: refusing to open a drop/, 'the stall is what ended the walks');
  // Kept while it rests: every way to it resting, said, not the staircase tried again.
  assert.equal(kept?.name, 'WaysResting', `kept: ${kept?.message}`);
  assert.notEqual(goal.step?.action, 'tunnel');
  assert.deepEqual(goal.portalMethod.near, near, 'kept, as Jev chose');
  // And the next pass says the same, not asked again nor the staircase tried.
  const again = await pass();
  assert.equal(again?.name, 'WaysResting');
  assert.notEqual(goal.step?.action, 'tunnel');
  assert.equal(asked, 1);
});

// mid-215-h (note 481): 137 blocks from its cast frame at (212, 69, -393) with a lava bucket, the walk there failed, the
// staircase was set aside ("paced the same few cells"), and both were done again every pass, flipping with the stall.
const farFromFrame = () => {
  const { setAside } = require('../src/progress');
  const { bot, w } = castingBot({ bucket: 1, lava_bucket: 1, water_bucket: 1, cobblestone: 64, flint_and_steel: 1, stone_pickaxe: 1 });
  bot.findBlocks = () => [];
  bot.on = () => {}; bot.removeListener = () => {}; bot.off = () => {};
  bot.pathfinder.setGoal = () => {}; bot.pathfinder.stop = () => {};
  bot.pathfinder.goto = async () => { throw new Error('No path to the goal'); };
  bot.entity.position = new Vec3(75.5, 69, -392.5);
  const frame = newFrame('x', new Vec3(212, 69, -393));
  frame.blocks.slice(0, 3).forEach(p => w.set(new Vec3(p.x, p.y, p.z), 'obsidian'));
  const goal = { portalFrame: frame, portalMethod: { kind: 'cast', activeMs: 0, reasked: 0, from: { obsidian: 0, diamonds: 0, diamondPickaxe: false } } };
  // The staircase toward the frame set aside, as it was (by its eight-block area).
  setAside(goal, 'staircase', { x: 208, y: 64, z: -400 }, 'paced the same few cells round where the round began, 137 blocks from it', 10 * 60000);
  return { bot, goal, frame };
};

test('neither the walk nor the staircase gets back to the cast frame: the way is asked again with the frame said, a cast here offered, and kept, every way resting is said', async () => {
  const { portalStep } = require('../src/work');
  const { Task } = require('../src/skills');
  const { bot, goal } = farFromFrame();
  let offered = null, asked = 0;
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { asked++; offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cast_frame', confidence: 0.8 } } }; } };
  const pass = () => portalStep(bot, task, goal, () => {}, task.opportunityClient);
  assert.equal(await pass(), false);
  assert(goal.portalMethod.frameFailed, 'the failure is kept to be asked about, not tried again unasked');
  assert.equal(goal.portalMethod.frameFailed.distance, 137);
  await pass().catch(err => { if (err.name !== 'WaysResting') throw err; });
  assert.equal(asked, 1, 'the portal way is asked again');
  const said = /The frame at \(212, 69, -393\) is 137 blocks off and cannot be got back to: the walk there failed \([^)]*\), legs of thirty-two blocks on foot made no ground, and the staircase toward it is set aside \(paced the same few cells round where the round began, 137 blocks from it\), taken up again in \d+ minutes/;
  for (const key of ['cast_frame', 'build_new', 'cast_here']) assert.match(offered[key], said, `${key} is weighed with the frame out of reach`);
  assert.match(offered.cast_here, /Cast a new frame of its own here, where the bot stands/);
  assert.match(offered.cast_here, /The frame at \(212, 69, -393\) is left behind as it stands, 3 of ten standing/);
  assert.match(offered.cast_frame, /Kept, the frame is made for again/);
  assert.equal(goal.portalMethod.frameFailed, undefined, 'answered');
  assert(goal.portalFrame, 'kept, as Jev chose');
  // Kept, and the walk fails again with the staircase still resting: every way resting, said, not a pass repeated.
  await assert.rejects(pass(), err => err.name === 'WaysResting' && /The frame at \(212, 69, -393\)/.test(err.message));
  assert.equal(asked, 1);
});

test('a cast here, chosen with the frame out of reach, leaves the frame begun behind', async () => {
  const { portalMethod } = require('../src/work');
  const { Task } = require('../src/skills');
  const { bot, goal } = farFromFrame();
  goal.portalMethod.frameFailed = { at: { x: 212, y: 69, z: -393 }, distance: 137, walk: 'No path to the goal', legs: null, stairs: 'paced', until: Date.now() + 600000 };
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async () => ({ answers: { branch_0: { choice: 'cast_here', confidence: 0.8 } } }) };
  await portalMethod(bot, task, goal, () => {});
  assert.equal(goal.portalFrame, undefined, 'the frame begun is left');
  assert.equal(goal.portalMethod.kind, 'cast');
  assert.equal(goal.portalMethod.near, undefined);
  assert.equal(goal.portalMethod.here, undefined);
});

test('a kept resting way, answered with other work until the rest ends, is not met again and asked every pass until then', async () => {
  // mid-226-f (note 490): the stairs to its lava at (363, 66, 230) were refused at the roof of a cave and rested ten
  // minutes; Jev kept the way, and every pass after met the rest, threw WaysResting, and the stall question was asked
  // again: "differently" forty-two times, each an eight-block walk of seconds, until the rest ended.
  const { portalStep, persist } = require('../src/work');
  const { setAside } = require('../src/progress');
  const { Task } = require('../src/skills');
  const { bot } = castingBot({ bucket: 1, water_bucket: 1, cobblestone: 64, flint_and_steel: 1, stone_pickaxe: 1 });
  bot.findBlocks = () => [];
  bot.on = () => {}; bot.removeListener = () => {}; bot.off = () => {};
  bot.chat = () => {}; bot.clearControlStates = () => {};
  bot.pathfinder.setGoal = () => {}; bot.pathfinder.stop = () => {};
  bot.pathfinder.goto = async () => { throw new Error('No path to the goal'); };
  const near = { x: 20, y: -54, z: 40 };
  const goal = { landmarks: [{ kind: 'lava_pool', ...near, dimension: 'overworld' }],
    portalMethod: { kind: 'cast', near: { ...near }, nearByStairs: true, activeMs: 0, reasked: 0, from: { obsidian: 0, diamonds: 0, diamondPickaxe: false } } };
  const REST_MS = 2500;
  setAside(goal, 'staircase', { x: 16, y: -56, z: 40 }, 'refusing to open a drop beside the feet', REST_MS);
  const until = Date.now() + REST_MS;
  const asked = { portal: 0, stall: 0, hold: 0 }, offered = {};
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => {
    const keys = Object.keys(questions.branch_0.criteria);
    if (keys.includes('cast_at_lava')) { asked.portal++; return { answers: { branch_0: { choice: 'cast_at_lava', confidence: 0.7 } } }; }
    if (keys.includes('until_rest_ends')) { asked.stall++; offered.stall = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'until_rest_ends', confidence: 0.8 } } }; }
    asked.hold++; return { answers: { branch_0: { choice: keys[0], confidence: 0.6 } } };
  } };
  let resting = 0;
  for (let pass = 0; pass < 400 && Date.now() < until; pass++) {
    delete goal.step;
    try { await portalStep(bot, task, goal, () => {}, task.opportunityClient); }
    catch (err) {
      if (err.name === 'WaysResting') { resting++; await persist(bot, task, goal, () => {}, err, () => {}, { client: task.opportunityClient }).catch(() => {}); }
    }
    await new Promise(r => setTimeout(r, 5));
  }
  assert.equal(asked.portal, 1, 'the way is asked once and kept');
  assert.equal(resting, 1, `the rest met once, not every pass: ${resting} times`);
  assert.equal(asked.stall, 1, 'the stall question asked once');
  assert.match(offered.stall.until_rest_ends, /Leave the .* for the 1 minute until its rest ends and do other work meanwhile/);
  assert.match(offered.stall.differently || '', /meets the same rest until then/);
  assert(Date.now() >= until, 'held until the rest ended');
  assert.equal(goal.restHeld, undefined, 'the hold ends with the rest');
});

test('the lava held, its staircase resting over a cave, is asked with the ways on: down into the cave, another lava, a cast here', async () => {
  // mid-226-f (note 490): the only thing said was "set aside (refusing to open a drop)"; the cave under the stair, its
  // depth, and the other ways a player has from there were not.
  const { portalMethod } = require('../src/work');
  const { setAside } = require('../src/progress');
  const { Task } = require('../src/skills');
  const { bot } = castingBot({ bucket: 1, water_bucket: 1, flint_and_steel: 1, stone_pickaxe: 1 });
  bot.findBlocks = () => []; bot.health = 20;
  const near = { x: 20, y: -54, z: 40 };
  const why = 'refusing to open a drop beside the feet: a cave under the stair at (21, -52, 41), a fall of 3 to its floor at y -55 (the target at y -54); no building block carried to floor the stair';
  const goal = { landmarks: [{ kind: 'lava_pool', ...near, dimension: 'overworld' }, { kind: 'lava_pool', x: 60, y: 12, z: 17, dimension: 'overworld' }],
    portalMethod: { kind: 'cast', near: { ...near }, nearByStairs: true, nearFailed: { walks: 3, best: 90, now: 90, stopped: `the staircase set aside: ${why}`.slice(0, 80) }, activeMs: 0, reasked: 0, from: { obsidian: 0, diamonds: 0, diamondPickaxe: false } },
    staircaseStalled: { why, at: Date.now(), target: { ...near },
      cave: { at: { x: 21, y: -52, z: 41 }, landing: { x: 20, y: -51, z: 41 }, depth: 2, fall: 3, floorY: -55, standY: -54, into: 'ground', targetY: -54, target: { ...near } } } };
  setAside(goal, 'staircase', { x: 16, y: -56, z: 40 }, why, 10 * 60000);
  let offered = null;
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'into_cave', confidence: 0.8 } } }; } };
  assert.equal(await portalMethod(bot, task, goal, () => {}), false);
  assert.match(offered.cast_at_lava, /a cave under the stair at \(21, -52, 41\), a fall of 3 to its floor at y -55/, 'the rest says the cave');
  assert.match(offered.into_cave, /the stair at \(21, -52, 41\) is dug open and the bot drops 3 blocks to its floor at y -55, a fall that does no harm/);
  assert.match(offered.into_cave, /level with the lava/);
  assert.match(offered.other_lava, /another lava instead, its way not resting: \d+ blocks away \(a lava pool remembered\), at y 12/);
  assert.match(offered.cast_here, /Cast a new frame of its own here, where the bot stands, the lava chosen before left while its way rests/);
  assert.deepEqual(goal.portalMethod.intoCave.at, { x: 21, y: -52, z: 41 }, 'chosen, the way goes down into the cave');
  assert.deepEqual(goal.portalMethod.near, near, 'the lava held is kept');
});
