'use strict';
// Blazes as the arena measured them (note 577): the volley read from the
// glow, the flames at the feet, the stands at the spawner's cage and the
// close-in with the sword, each offered with what the drills measured.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const stand = require('../src/blaze-stand');
const { threats } = require('../src/danger');

function brickWorld(solid, { lava = () => false, spawner = null, fire = () => false, items = ['iron_sword', 'iron_pickaxe', 'netherrack'], shield = true } = {}) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const cache = new Map();
  const blockAt = p => {
    const f = p.floored(), key = `${f}`;
    if (!cache.has(key)) {
      const name = spawner && f.equals(spawner) ? 'spawner' : lava(f) ? 'lava' : fire(f) ? 'fire' : solid(f) ? 'nether_bricks' : 'air';
      const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f; cache.set(key, b);
    }
    return cache.get(key);
  };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [] }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => items.map(name => ({ name, type: registry.itemsByName[name].id, count: /pickaxe|sword/.test(name) ? 1 : 64, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, ...(shield ? { 45: { name: 'shield' } } : {}) } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {} } });
  bot.findBlocks = ({ matching, maxDistance = 16, count = 1, point }) => {
    const ids = [].concat(matching), at = point || bot.entity.position, out = [];
    for (let x = -14; x <= 14; x++) for (let y = -3; y <= 3; y++) for (let z = -14; z <= 14; z++) {
      const p = at.floored().offset(x, y, z);
      if (p.distanceTo(at) <= maxDistance && ids.includes(blockAt(p).type)) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(at) - b.distanceTo(at)).slice(0, count);
  };
  return bot;
}
const blazeAt = (id, x, y, z, glowing = false) => ({ id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: glowing ? 1 : 0 } });

test('a blaze\'s volley is read from its glow: due from 2.4 seconds into it until a second after it ends, and not in its rest', () => {
  const bot = new EventEmitter();
  stand.volleyWatch(bot);
  const blaze = blazeAt(1, 5, 64, 0);
  const t0 = Date.now();
  blaze.metadata[16] = 1; bot.emit('entityUpdate', blaze);
  assert.equal(stand.charged(blaze), true);
  assert.equal(stand.volleyDue(bot, blaze, t0 + 1000), false, 'a second into the glow: the shots are two seconds off');
  assert.equal(stand.volleyDue(bot, blaze, t0 + 2500), true, 'the shots at 3.0, 3.3 and 3.6 are coming');
  assert(Math.abs(stand.volleyIn(bot, blaze, t0 + 1000) - 2) < 0.1);
  blaze.metadata[16] = 0; bot.emit('entityUpdate', blaze);
  const rest = blaze._restAt;
  assert.equal(stand.volleyDue(bot, blaze, rest + 500), true, 'the last shot still in the air');
  assert.equal(stand.volleyDue(bot, blaze, rest + 2000), false, 'resting');
  assert(Math.abs(stand.volleyIn(bot, blaze, rest + 2000) - 6) < 0.1, 'five of rest and three of glow before the next');
  // A glow first seen part way through is due at once.
  const late = blazeAt(2, 5, 64, 3, true);
  assert.equal(stand.volleyDue(bot, late), true);
});

test('the flames the bot\'s body stands in are found in every column its box touches, and put out with a punch', async () => {
  const fire = p => p.x === 1 && p.y === 64 && p.z === 0;
  const bot = brickWorld(p => p.y <= 63, { fire });
  bot.entity.position = new Vec3(0.9, 64, 0.5);
  assert.deepEqual(stand.flamesTouching(bot).map(b => `${b.position}`), ['(1, 64, 0)'], 'the box reaches over into the fire\'s column');
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  assert.deepEqual(stand.flamesTouching(bot), [], 'the middle of its own cell: clear');
  bot.entity.position = new Vec3(0.9, 64, 0.5);
  const punched = [];
  Object.assign(bot, { dig: async b => { punched.push(`${b.position}`); }, clearControlStates() {}, deactivateItem() {} });
  const { Task } = require('../src/skills');
  assert.equal(await stand.putOutFlames(bot, new Task('x')), true);
  assert.deepEqual(punched, ['(1, 64, 0)']);
});

// A fortress floor along a brick wall at z <= -1, the spawner four blocks
// out at (4, 64, 3), a blaze over the floor by it.
const floorByWall = p => p.y <= 63 || p.z <= -1;

test('by a spawner on an open floor, the cage is offered with rock at the back, and a hole in the wall beside it with the mouth toward it', () => {
  const bot = brickWorld(floorByWall, { spawner: new Vec3(4, 64, 3) });
  bot.entity.position = new Vec3(-4.5, 64, 2.5);
  const blaze = blazeAt(3, 5.5, 65, 4.5);
  bot.entities = { 3: blaze };
  const site = stand.spawnerSite(bot);
  assert(site, 'no ceiling, but a wall at the back');
  assert(bot.blockAt(site.cell.offset(0, 2, 0)).boundingBox === 'empty');
  const hole = stand.spawnerHoleSite(bot);
  assert(hole, 'a hole beside the cage');
  assert.equal(hole.hole.z, -1, 'dug into the wall');
  assert.deepEqual(hole.side, new Vec3(0, 0, -1), 'going away from the cage: the mouth faces it');
  assert(hole.off <= 4.5, `${hole.off} from the cage`);
  const options = stand.blazeStands(bot, threats(bot, 24), { hunted: true });
  assert(options.dig_in_at_spawner, Object.keys(options).join(','));
  assert.match(options.dig_in_at_spawner.description, /blocks from the blaze spawner's cage, dig a hole one wide and two high into it with the mouth toward the cage/);
  assert.match(options.dig_in_at_spawner.description, /every shot comes in through the mouth, from in front where the shield faces/);
  assert.match(options.fight_at_spawner.description, /with rock at its back/);
});

test('close_in is offered with a shield and a blaze over ground the sword reaches from, not over lava, and not without the shield', () => {
  // A floor to x = 6, lava past it.
  const solid = p => p.y <= 63 && p.x <= 6;
  const lava = p => p.y === 63 && p.x > 6;
  const bot = brickWorld(solid, { lava });
  const over = blazeAt(3, 5.5, 64.5, 0.5);
  bot.entities = { 3: over };
  const options = stand.blazeStands(bot, threats(bot, 24), { dig: false, hunted: true });
  assert(options.close_in, Object.keys(options).join(','));
  assert.match(options.close_in.description, /^Go at them with the sword: walk in on the nearest blaze ground reaches \(5 blocks off/);
  assert.match(options.close_in.description, /a shield raised and facing it as the glow ends takes all three whole, the fire with them/);
  // Over the lava ten out: no ground within the sword's reach of it.
  bot.entities = { 4: blazeAt(4, 11.5, 64.5, 0.5) };
  assert(!stand.blazeStands(bot, threats(bot, 24), { dig: false }).close_in, 'over lava');
  const bare = brickWorld(solid, { lava, shield: false });
  bare.entities = { 3: over };
  assert(!stand.blazeStands(bare, threats(bare, 24), { dig: false }).close_in, 'no shield');
});

test('a stand says what the arena measured of it, every fight measured, the one like this fight first and its figure', () => {
  const bot = brickWorld(p => p.y <= 63);
  bot.entities = { 3: blazeAt(3, 5.5, 64.5, 0.5) };
  const before = stand.MEASURED.close;
  stand.MEASURED.close = { spawner: { runs: 3, kills: 2, rods: 1, damage: 30, deaths: 2 }, one: { runs: 3, kills: 3, rods: 2, damage: 2.5, deaths: 0 } };
  try {
    const o = stand.blazeStands(bot, threats(bot, 24), { dig: false }).close_in;
    assert.match(o.description, /Measured in the arena with the same kit, this way: against one blaze in the open eight blocks off, 3 runs: 3 killed, 2 rods carried away, about 2\.5 damage a run on the median, no deaths; against three blazes by a live spawner [^,]+, 3 runs: 2 killed, 1 rod carried away, about 30 damage a run on the median, 2 deaths\./);
    assert.equal(o.expects.damage, 2.5, 'one blaze about: the one-blaze figure');
  } finally { if (before) stand.MEASURED.close = before; else delete stand.MEASURED.close; }
});
