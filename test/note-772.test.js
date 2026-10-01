'use strict';
// Note 772. Overworld deaths since 2026-09-30T12:00Z (scripts/overworld-
// deaths.js): of 50 trials that ended in one, 20 within 15 minutes, 12 of
// them on world 241, which starts at y -18 in deepslate caves. Two shapes
// led. (1) The climb out froze the bot: returnToSurface's search for a
// landing read about 2 million cells a call at 241's start (every cell of
// the sections round the bot, and each cave floor's column from the world's
// top down), and the event loop was held 13 to 21 seconds on
// ascend_to_surface while zombies bit (25597 mid-241-bg, 25598 mid-241-ca,
// 25597 mid-241-dd). (2) A run from a creeper within three blocks, priced
// "about 0" by its own walk against the fuse, was caught by the blast 42
// times in 124 and 5 died, while staying behind a block was caught 13 times
// in 329 and the shield raised toward it 0 in 6.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const surface = require('../src/surface');

// A world from a function of (x, y, z) to a block name, or null (unloaded).
function worldBot(nameAt, { at = new Vec3(0.5, 0, 0.5), minY = -64, height = 384 } = {}) {
  let reads = 0;
  const bot = {
    game: { minY, height, dimension: 'overworld' }, registry: require('minecraft-data')('26.1'), entities: {},
    entity: { position: at.clone() },
    blockAt(p) {
      reads++;
      const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
      const name = nameAt(x, y, z);
      if (name === null) return null;
      const solid = !/^(air|cave_air|water|lava|.*_leaves|short_grass)$/.test(name);
      return { name, type: bot.registry.blocksByName[name]?.id, position: new Vec3(x, y, z), boundingBox: solid ? 'block' : 'empty', diggable: solid, shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [] };
    },
    // mineflayer's order: every cell of the sections round the point read,
    // its kind, then useExtraInfo, then the distance.
    findBlocks({ matching, maxDistance = 16, count = 1, useExtraInfo }) {
      const point = bot.entity.position.floored(), r = Math.ceil((maxDistance + 8) / 16) * 16, out = [];
      for (let x = point.x - r; x < point.x + r; x++) for (let z = point.z - r; z < point.z + r; z++) for (let y = Math.max(minY, point.y - r); y < Math.min(minY + height, point.y + r); y++) {
        const c = new Vec3(x, y, z), b = bot.blockAt(c);
        if (b && matching.includes(b.type) && useExtraInfo(b) && c.distanceTo(point) <= maxDistance) out.push(c);
      }
      return out.sort((a, b) => a.distanceTo(point) - b.distanceTo(point)).slice(0, count);
    },
  };
  return { bot, reads: () => reads, reset: () => { reads = 0; } };
}

// The observer as it was: each column read down from the world's top.
function downwardObserver(bot) {
  const { swimmableWater } = require('../src/terrain');
  const heights = new Map(), minimum = bot.game.minY, maximum = minimum + bot.game.height;
  return point => {
    const x = Math.floor(point.x), z = Math.floor(point.z), key = `${x},${z}`;
    if (!heights.has(key)) {
      let top = minimum - 1;
      for (let y = maximum - 1; y >= minimum; y--) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) { top = Infinity; break; }
        if (/_leaves$|_log$|_wood$/.test(block.name)) continue;
        if (block.boundingBox === 'block' || swimmableWater(block) || ['lava', 'bubble_column', 'powder_snow'].includes(block.name)) { top = y; break; }
      }
      heights.set(key, top);
    }
    return point.y > heights.get(key);
  };
}

test('the surface observer reads up from the point and says what reading down from the world\'s top said', () => {
  // Columns of every kind: open ground, a cave under rock, a lake, leaves
  // over the ground, an overhang, a column unloaded over y 100.
  const nameAt = (x, y, z) => {
    const k = ((x * 7 + z * 13) % 6 + 6) % 6;
    if (k === 5 && y > 100) return null;
    if (y <= 60) return (k === 1 && y >= 20 && y <= 23) ? 'cave_air' : 'stone';
    if (k === 2 && y <= 63) return 'water';
    if (k === 3 && y >= 66 && y <= 68) return 'oak_leaves';
    if (k === 4 && y === 80) return 'stone';
    return 'air';
  };
  const { bot } = worldBot(nameAt);
  const up = surface.surfaceObserver(bot), down = downwardObserver(bot);
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) for (const y of [-10, 20, 21.5, 23, 60, 61, 63, 64, 64.5, 66, 70, 79, 80, 81, 99, 101]) {
    const p = new Vec3(x + 0.5, y, z + 0.5);
    assert.equal(up(p), down(p), `(${x}, ${y}, ${z})`);
  }
  // A cave's point stops at its roof: two reads, not the 250 of air over
  // the ground the downward read went through first.
  const w = worldBot(nameAt);
  const obs = surface.surfaceObserver(w.bot);
  w.reset();
  assert.equal(obs(new Vec3(1.5, 21, 0.5)), false);
  assert(w.reads() <= 4, `${w.reads()} reads`);
});

// The landing search as it was: the sky over each cell read down from the
// world's top.
function oldCandidates(w, start) {
  const { bot } = w;
  const { dryPassable } = require('../src/terrain');
  const isSurface = downwardObserver(bot);
  return bot.findBlocks({ matching: ['grass_block', 'dirt', 'stone', 'sand', 'gravel', 'deepslate'].map(n => bot.registry.blocksByName[n].id), maxDistance: 48, count: 128,
    useExtraInfo: b => { const p = b.position.offset(0, 1, 0); return p.y >= start.y - 3 && dryPassable(bot.blockAt(p)) && dryPassable(bot.blockAt(p.offset(0, 1, 0))) && isSurface(p); } })
    .map(p => p.offset(0, 1, 0));
}

test('the landing search finds the landings it found before, reading the sky over a cave floor up to its roof (mid-241\'s start, y -18)', () => {
  // Rock to y 70 with a ravine open to the sky down to y 30 twenty blocks
  // east, and a cave round the bot at y -18 with a floor of air pockets.
  const nameAt = (x, y, z) => {
    if (x >= 18 && x <= 22 && z >= -3 && z <= 3 && y >= 30) return y === 30 ? 'stone' : 'air';
    if (y >= -18 && y <= -15 && Math.abs(x) <= 6 && Math.abs(z) <= 6) return 'cave_air';
    if (y < 0) return 'deepslate';
    if (y <= 70) return 'stone';
    return 'air';
  };
  for (const y of [-18, 10]) {
    const before = worldBot(nameAt, { at: new Vec3(0.5, y, 0.5) }), after = worldBot(nameAt, { at: new Vec3(0.5, y, 0.5) });
    const start = before.bot.entity.position.floored();
    const want = oldCandidates(before, start).map(String);
    const have = surface.surfaceCandidates(after.bot, start, {}).map(String);
    assert.deepEqual(have, want, `from y ${y}`);
    if (y === 10) assert(have.length > 0, 'the ravine floor within reach from y 10');
    assert(after.reads() < before.reads(), `y ${y}: ${after.reads()} reads against ${before.reads()}`);
    if (y === -18) assert(before.reads() - after.reads() > 169 * 200, `y -18: the cave floor's columns read up to the roof (${before.reads()} -> ${after.reads()})`);
  }
});

test('a slow world search is said by its caller', () => {
  const lines = [];
  const bot = { findBlocks: () => { const t = Date.now(); while (Date.now() - t < 30); return [1, 2]; } };
  require('../src/slow-calls').install(bot, { log: l => lines.push(l), slowMs: 10 });
  assert.deepEqual(bot.findBlocks({ maxDistance: 48 }), [1, 2]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[slow\] findBlocks \d+ ms \(.*\): 2 found, maxDistance 48$/);
  // Installed once.
  require('../src/slow-calls').install(bot, { log: l => lines.push(l), slowMs: 10 });
  bot.findBlocks({});
  assert.equal(lines.length, 2);
});

test('each way from within three blocks of a creeper says its record for its cell; a run priced below its cell\'s mean is priced at it (conditioned by note 778)', () => {
  const record = require('../src/creeper-record');
  const options = () => ({
    retreat: { description: 'Run.', expects: { damage: 0, seconds: 3 } },
    block_creeper: { description: 'Block.', expects: { damage: 0, seconds: 1 } },
    shield_the_blast: { description: 'Shield.', expects: { damage: 0, seconds: 1.5 } },
    pillar: { description: 'Pillar.' },
  });
  // 1.5 to 3 blocks, no other mob within four: the bulk of the answers.
  const at2 = options();
  record.sayOn(at2, { distance: 2.2 });
  assert.match(at2.retreat.description, /This way's record from 1\.5 to 3 blocks of a creeper, no other mob within 4: answered 106 times, caught by its blast in 6 seconds 36 times \(a median 3\.6 health\), 3 died\./);
  assert.equal(at2.retreat.expects.damage, 1.9);
  assert.match(at2.block_creeper.description, /answered 298 times, caught by its blast in 6 seconds 12 times/);
  assert.match(at2.shield_the_blast.description, /answered 11 times, caught by its blast in 6 seconds none of those times\./);
  assert.equal(at2.pillar.description, 'Pillar.', 'three answers in its cell: no record said');
  // Within 1.5, alone: only the retreat has six answers there.
  const at1 = options();
  record.sayOn(at1, { distance: 1.2 });
  assert.match(at1.retreat.description, /record within 1\.5 blocks of a creeper, no other mob within 4: answered 9 times, caught by its blast in 6 seconds 5 times/);
  assert.equal(at1.retreat.expects.damage, 4.3);
  assert.equal(at1.block_creeper.description, 'Block.', 'three answers within 1.5: not said');
  // With another mob within four: that cell's own answers, not the lone creeper's.
  const crowd = options();
  record.sayOn(crowd, { distance: 2.2, others: 1 });
  assert.equal(crowd.retreat.description, 'Run.', 'three answers with others about: not said');
  assert.match(crowd.block_creeper.description, /of a creeper, another mob within 4: answered 9 times/);
  // Past three blocks, nothing said.
  const far = { retreat: { description: 'Run.', expects: { damage: 0, seconds: 3 } } };
  record.sayOn(far, { distance: 4.2 });
  assert.equal(far.retreat.description, 'Run.');
  assert.equal(far.retreat.expects.damage, 0);
});

test('the stance question with a creeper 1.5 blocks off says each way\'s record from there (25598 mid-241-bb 12:44:57Z)', () => {
  const entities = { 1: { id: 1, name: 'creeper', type: 'hostile', height: 1.7, width: 0.6, isValid: true, metadata: [], position: new Vec3(2.0, 64, 0.5) } };
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 19, oxygenLevel: 20,
    entities, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, eyeHeight: 1.62, velocity: new Vec3(0, 0, 0), metadata: [0] },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {}, activateItem() {}, deactivateItem() {} });
  const danger = Object.values(entities).map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true }));
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
  assert(options.shield_the_blast, Object.keys(options).join(','));
  // Within 1.5 of the creeper (1.5 blocks), alone: the run's cell (note 778).
  if (options.retreat) assert.match(options.retreat.description, /within 1\.5 blocks of a creeper, no other mob within 4: answered 9 times/);
  for (const k of ['shield_the_blast', 'block_creeper', 'fight']) if (options[k]) assert.doesNotMatch(options[k].description, /This way's record (within|from) [\d.]+ (to 3 )?blocks of a creeper/, `${k}: too few answers within 1.5`);
  // In the Nether, not said: the record is the Overworld's.
  bot.game.dimension = 'the_nether';
  for (const o of Object.values(survival.stanceOptions(new Task('x'), {}, () => {}, danger, false))) assert.doesNotMatch(o.description, /This way's record (within|from) [\d.]+ (to 3 )?blocks of a creeper/);
});
