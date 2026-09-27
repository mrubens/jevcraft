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
  assert.match(says, /43 blocks away \(a lava pool remembered\): about 20 seconds there and back a trip, 40 in all/);
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
  assert.match(offered.craft_buckets, /Make 2 more buckets first from the 8 iron ingots carried/);
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
