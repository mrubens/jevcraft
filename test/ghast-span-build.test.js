'use strict';
// Note 582: mid-243-ad-nether-3 (25586), "tried to swim in lava" at
// 04:39:25. The bot stood on its own diagonal span of cobbled deepslate and
// dirt at y 50 over the lava sea (its top at y 31), no ground within twenty
// blocks, a ghast fifty to sixty-four blocks off to the south-east. Its
// cover went in the line through a flame the first fireball had lit and was
// refused "Placement obstructed by fire" twelve times; the next fireball set
// it in fire, it put a block of gravel under itself and was told it was
// still in fire, and rose four blocks in a second and a half; on that
// pillar it chose the rail, told only what a fireball costs once walled, and
// the ghast's fireball threw it off before a block was down.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');

// The span as the death snapshot's region file (04:38:56) has it, x 80 to 96,
// and the flames the fireball at 04:39:04 lit: one in the cover's cell
// beside the bot at (93, 51, 108), beside the planks of the cover before.
const SPAN = [
  [80, 119], [81, 119], [82, 118], [82, 119], [83, 117], [83, 118], [84, 116], [84, 117], [85, 115], [85, 116], [86, 114], [86, 115],
  [87, 113], [87, 114], [88, 112], [88, 113], [89, 111], [89, 112], [90, 110], [90, 111], [91, 109], [91, 110], [92, 108], [92, 109],
  [93, 107], [93, 108], [94, 106], [94, 107], [95, 105], [95, 106], [96, 104], [96, 105]];
const solid = new Map(SPAN.map(([x, z]) => [`${x},50,${z}`, x >= 94 ? 'dirt' : 'cobbled_deepslate']));
for (const y of [50, 51, 52]) solid.set(`94,${y},108`, 'oak_planks');
const world = (fire = new Set(['93,51,108'])) => p => {
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z), k = `${x},${y},${z}`;
  const position = new Vec3(x, y, z);
  if (solid.has(k)) return { position, name: solid.get(k), boundingBox: 'block' };
  if (fire.has(k)) return { position, name: 'fire', boundingBox: 'empty' };
  return y <= 31 ? { position, name: 'lava', boundingBox: 'empty' } : { position, name: 'air', boundingBox: 'empty' };
};
// The ghast at 04:39:12.8, 53 blocks off, in sight.
const ghastAt = (x = 113.6, y = 53.1, z = 156.4) => ({ id: 1096, name: 'ghast', type: 'hostile', position: new Vec3(x, y, z), height: 4, width: 4, isValid: true });
const carried = () => [{ name: 'iron_sword', count: 1 }, { name: 'oak_planks', count: 2 }, { name: 'oak_log', count: 3 }, { name: 'gravel', count: 16 }, { name: 'warped_wart_block', count: 5 }, { name: 'mutton', count: 4 }];
function spanBot({ items = carried(), ghast = ghastAt(), health = 18.1 } = {}) {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food: 20, oxygenLevel: 20,
    entity: { position: new Vec3(93.3, 51, 107.41), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), metadata: [0] }, entities: { [ghast.id]: ghast }, time: { timeOfDay: 0 },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'golden_boots' }, 45: { name: 'shield' } } },
    world: { raycast: () => null }, blockAt: world(), registry: require('minecraft-data')('26.1'),
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, getControlState: () => false,
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: () => {}, findBlocks: () => [] });
  return bot;
}
const threat = (bot, entity, visible = true) => ({ entity, distance: entity.position.distanceTo(bot.entity.position), visible });

test('a block is put in a flame\'s cell, as the game replaces fire, where it was refused as obstructed (mid-243-ad-nether-3, note 582)', async () => {
  const { place } = require('../src/work');
  const target = new Vec3(93, 51, 108);
  let placed = false;
  const bot = { game: { gameMode: 'survival' }, entity: { position: new Vec3(93.3, 51, 107.41) }, inventory: { items: () => [{ name: 'oak_planks', count: 2 }] }, equip: async () => {},
    blockAt: p => p.equals(target) ? { name: placed ? 'oak_planks' : 'fire', boundingBox: placed ? 'block' : 'empty', position: p } : world()(p),
    placeBlock: async ref => { assert.equal(`${ref.position}`, '(93, 50, 108)', 'on the floor under the flame'); placed = true; }, _syncWindow: async () => {} };
  await place(bot, new Task('cover'), target, 'oak_planks');
  assert.ok(placed, 'the block went into the flame\'s cell');
});

test('the cover against the ghast is offered in the flame\'s cell, from the planks the logs make, and says the fraction of a second it stands open first', () => {
  const ghast = ghastAt();
  const bot = spanBot({ items: [{ name: 'iron_sword', count: 1 }, { name: 'oak_log', count: 3 }, { name: 'gravel', count: 16 }] });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {}, acquireStep: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'return_to_portal' } }, () => {}, [threat(bot, ghast)], false);
  assert.ok(options.take_cover, `no cover with only logs carried: ${Object.keys(options).join(',')}`);
  const cover = options.take_cover.description;
  assert.match(cover, /the oak planks for it made first from the logs carried \(12\), about a second more/);
  // The line is cut at head height, the block at the feet first under it; the planks are made first: 2.2 seconds,
  // at a fireball every 3 seconds.
  assert.match(cover, /Until the first block in the fireball's line stands, about 2\.2 seconds, the bot is open over the drop: the ghast 53 blocks off fires one fireball every 3 seconds while it has a line \(one may be on its way already\), so about 73 in 100 that a fireball lands first, and one that lands before then is the push over the drop: the bot's death/);
});

test('the rail and the span\'s hold say the seconds before the wall on the side a push goes stands, priced by the ghast\'s fire, not only what a fireball costs once walled', () => {
  const ghast = ghastAt(110.9, 46.3, 164.8);
  const bot = spanBot({ ghast, health: 15.7 });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {}, acquireStep: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'return_to_portal' } }, () => {}, [threat(bot, ghast)], false);
  assert.ok(options.rail_and_fight, Object.keys(options).join(','));
  const rail = options.rail_and_fight.description;
  // North and west are open over the drop, each a floor and a wall; the push goes north-west, away from the ghast:
  // both lee, 4 blocks, 2.4 seconds. The five warped wart blocks carried are blocks for them (note 619); before,
  // uncounted, the planks were made first and it was 3.4 seconds, more than the 3 between its fireballs.
  assert.match(rail, /Until the wall on the side a push goes stands, about 2\.4 seconds, the bot is open over the drop: the ghast 60 blocks off fires one fireball every 3 seconds while it has a line \(one may be on its way already\), so about 80 in 100 that a fireball lands first, and one that lands before then is the push over the drop: the bot's death/);
  assert.match(rail, /Carried that it can break: warped wart block \(5, blast resistance 1\), oak planks \(2, blast resistance 3\)/);
  assert.match(rail, /Walled, a fireball that lands here costs its 3\.4 damage and a push into the wall/, 'what it costs once the walls stand is still said');
  assert.ok(rail.indexOf('Until the wall') < rail.indexOf('Walled, a fireball'), 'the open seconds before the walled price');
});

test('on a one-wide span the hold says the same open seconds, the side a push goes walled first', () => {
  // A one-wide span along z at x 93, the ghast to the south-east: a push goes north-west, so west is walled first.
  const ghast = ghastAt();
  const bot = spanBot({ ghast, items: [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 20 }] });
  bot.entity.position = new Vec3(93.5, 51, 110.5);
  bot.blockAt = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z), position = new Vec3(x, y, z);
    if (x === 93 && y === 50 && z >= 100 && z <= 130) return { position, name: 'cobbled_deepslate', boundingBox: 'block' };
    return y <= 31 ? { position, name: 'lava', boundingBox: 'empty' } : { position, name: 'air', boundingBox: 'empty' };
  };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'return_to_portal' } }, () => {}, [threat(bot, ghast)], false);
  assert.ok(options.hold_on_span, Object.keys(options).join(','));
  // West: a floor and a wall, 1.2 seconds, against a fireball every 3.
  assert.match(options.hold_on_span.description, /Until the wall on the side a push goes stands, about 1\.2 seconds, the bot is open over the drop: the ghast 50 blocks off fires one fireball every 3 seconds while it has a line \(one may be on its way already\), so about 40 in 100 that a fireball lands first/);
  assert.match(options.rail_and_fight.description, /Until the wall on the side a push goes stands, about 1\.2 seconds/);
});

test('the rail walls first the sides a push goes toward, away from what pushes', async () => {
  const ghast = ghastAt(110.9, 46.3, 164.8);
  const bot = spanBot({ ghast, items: [{ name: 'iron_sword', count: 1 }, { name: 'cobbled_deepslate', count: 20 }] });
  const placed = [];
  const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p}`); }, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  assert.equal(await survival.railSpan(new Task('rail'), {}, () => {}, { blast: true }), false, 'nothing stands in the mock');
  // The ghast south-east: north (z 106) first, then west (x 92), each floor then wall.
  assert.deepEqual(placed.slice(0, 2), ['(93, 50, 106)', '(93, 51, 106)'], placed.join(' '));
  assert.deepEqual(placed.slice(2, 4), ['(92, 50, 107)', '(92, 51, 107)'], placed.join(' '));
});

test('out of the fire on a block put in its cell, the bot is not told it is still in fire by the hurt before the rise or the flame beside the block under it', async () => {
  // At 04:39:16.5 the bot, alight, stood at (93, 51, 107) in the fire the fireball lit; a flame burned in the cover's
  // cell beside it at (93, 51, 108). Each rise was followed by another: the in-fire hurt of 04:39:16.46 counted for a
  // second and a half, and the flame beside the gravel it stood on counted as fire beside the body.
  const vitals = require('../src/vitals');
  const bot = spanBot();
  bot.entity.position = new Vec3(93.3, 51, 107.3);
  bot.entity.metadata = [1];
  const fire = new Set(['93,51,107', '93,51,108']);
  bot.blockAt = world(fire);
  bot._inFireAt = Date.now() - 100;
  assert.equal(vitals.inFire(bot), true, 'in the fire at the feet');
  const rise = vitals.fireWays(bot, new Task('t')).rise_on_block;
  assert.ok(rise, 'the block to stand on is a way');
  const pillar = require('../src/pillar-recovery'), pillarUp = pillar.pillarUp;
  pillar.pillarUp = async (b, task, y) => { solid.set('93,51,107', 'gravel'); fire.delete('93,51,107'); b.entity.position = new Vec3(93.3, y, 107.3); return 1; };
  try { await rise.run(); }
  finally { pillar.pillarUp = pillarUp; solid.delete('93,51,107'); }
  assert.equal(bot.entity.position.y, 52);
  assert.equal(vitals.inFire(bot), false, 'a block up, the flame beside the block under it does not touch the body, and the hurt before the rise is about where it was');
  assert.equal(vitals.fireWays(bot, new Task('t')).rise_on_block, undefined, 'no second rise');
  // A new in-fire hurt after the rise is the server's word again.
  bot._inFireAt = Date.now() + 1;
  assert.equal(vitals.inFire(bot), true);
});

test('walled already on the sides a push goes toward, the stances say a fireball costs its damage and a push into the wall, not the fall (the rail it had put up by 04:39:06)', () => {
  // mid-243-ad-nether-3 walled north and west of its cell (the rail at 04:39:03 and :06); at 04:39:12.8 every stance
  // was still "the bot's death", Jev answered none_good, and the fireball at 04:39:15.7 pushed it a tenth of a block.
  const ghast = ghastAt();
  const walled = new Map([['92,50,107', 'oak_planks'], ['92,51,107', 'oak_planks'], ['93,50,106', 'oak_planks'], ['93,51,106', 'oak_planks']]);
  const bot = spanBot({ ghast });
  const base = bot.blockAt;
  bot.blockAt = p => { const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`; return walled.has(k) ? { position: p.floored(), name: walled.get(k), boundingBox: 'block' } : base(p); };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'return_to_portal' } }, () => {}, [threat(bot, ghast)], false);
  for (const [k, o] of Object.entries(options)) {
    assert.doesNotMatch(o.description, /Open here to the ghast/, k);
    assert.match(o.description, /Walled here toward the push: a fireball from the ghast 53 blocks off \(in sight\) pushes the bot away from it, north and west, and on those sides a block stands at the feet or ground with no drop beside it, so one that lands costs its 3\.4 damage and a push into the wall, not the fall\./, k);
  }
  assert.match(options.keep_working.description, /Off this cell the walls are behind it: walked out from here, a fireball that lands is the push over the drop north and west of it again\./);
  assert.doesNotMatch(options.return_fireball.description, /the first that lands is the push over the drop/);
  // West open again: the push can go over it, and the stances say so.
  walled.delete('92,51,107'); walled.delete('92,50,107');
  const open = survival.stanceOptions(new Task('x'), { step: { action: 'return_to_portal' } }, () => {}, [threat(bot, ghast)], false);
  assert.match(open.keep_working.description, /Open here to the ghast 53 blocks off \(in sight\)/);
});
