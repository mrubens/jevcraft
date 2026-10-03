'use strict';
// Note 601: mid-242-ah-fortress-1 (25587), 11:43 on 2026-09-28. In full iron
// with an iron sword and a shield, no pickaxe, a wither skeleton came at the
// bot across a warped cavern; it stood in a netherrack corner at
// (-239.5, 64, -142.4). It ate told "about 0 damage" and the skeleton's
// blow landed as the meal ended (14.5 to 10); the fight it chose then ran at
// the skeleton, knocked back to 3.6 blocks, found the route cut short and
// ended, and was left out of the next asking; it ate again, chose to retreat
// (none of these at 0.40), stood 2.7 seconds searching for a way with the
// skeleton at arm's length and the shield down, and was struck twice and
// withered, 9.1 to 0. Neither a low ceiling (a wither skeleton is 2.4 tall
// and cannot come under two blocks) nor the shield met between its blows
// was offered. The ground is the saved region, read from a copy
// (test/fixtures/cavern-wither-25587.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { walkersApart } = require('../src/walk-reach');
const wg = require('../src/wither-guard');

const ground = require('./fixtures/cavern-wither-25587.json');
const EMPTY = /^(air|crimson_roots|warped_roots|crimson_fungus|warped_fungus|weeping_vines|weeping_vines_plant|twisting_vines|twisting_vines_plant|nether_sprouts|fire|soul_fire|lava|water)$/;
function nameAt(x, y, z) {
  const { box, palette, rows } = ground;
  if (x < box.x[0] || x > box.x[1] || y < box.y[0] || y > box.y[1] || z < box.z[0] || z > box.z[1]) return null;
  const row = rows[(y - box.y[0]) * (box.z[1] - box.z[0] + 1) + (z - box.z[0])];
  const c = row.charCodeAt(x - box.x[0]);
  return palette[c >= 97 ? c - 97 : c - 65 + 26];
}
// The saved ground, and blocks put in or dug out since (placed, dug).
function world() {
  const placed = new Map(), dug = new Set();
  const k = p => `${p.x},${p.y},${p.z}`;
  const blockAt = p => {
    const f = p.floored();
    const name = placed.get(k(f)) || (dug.has(k(f)) ? 'air' : nameAt(f.x, f.y, f.z));
    if (!name) return null;
    const solid = !EMPTY.test(name);
    return { position: f, name, boundingBox: solid ? 'block' : 'empty', shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [], diggable: solid, digTime: () => 2000 };
  };
  const raycast = (from, dir, max) => {
    for (let t = 0; t <= max; t += 0.01) {
      const p = from.plus(dir.scaled(t)), b = blockAt(p);
      if (b?.boundingBox === 'block') return { ...b, intersect: p };
    }
    return null;
  };
  return { blockAt, raycast, placed, dug, k };
}
// As recorded at 11:43:42.6: the bot in its corner, the wither skeleton
// (entity 1086) across the cavern floor.
const AT = new Vec3(-239.50002390516758, 64, -142.4198159952764);
const SKELETON_AT = new Vec3(-237.50012612466887, 64, -134.16780444518434);
function cavernBot({ at = AT, skeletonAt = SKELETON_AT, health = 14.5, food = 16, extra = [] } = {}) {
  const w = world();
  const skeleton = { id: 1086, name: 'wither_skeleton', type: 'hostile', position: skeletonAt.clone(), height: 2.4, width: 0.7, isValid: true, heldItem: { name: 'stone_sword' } };
  const entities = { 1086: skeleton };
  for (const e of extra) entities[e.id] = e;
  const attacks = [], shield = [];
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'stone_axe', count: 1 }, { name: 'netherrack', count: 53 }, { name: 'dirt', count: 6 }, { name: 'mutton', count: 8 }, { name: 'warped_wart_block', count: 37 }];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food, foodSaturation: 0, oxygenLevel: 20,
    entities, time: { timeOfDay: 0 }, registry: require('minecraft-data')('26.1'),
    entity: { position: at.clone(), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, -0.08, 0), eyeHeight: 1.62, effects: {} },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt: w.blockAt, world: { raycast: w.raycast }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) },
    lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: e => attacks.push({ id: e.id, at: Date.now(), shield: !!bot._shieldRaised }),
    clearControlStates() {}, setControlState() {}, getControlState: () => false,
    activateItem(off) { if (off) shield.push(['up', Date.now()]); }, deactivateItem() { shield.push(['down', Date.now()]); } });
  const threat = () => ({ entity: skeleton, distance: skeleton.position.distanceTo(bot.entity.position), visible: true });
  return { bot, skeleton, threat, attacks, shield, w };
}
const cell = ([x, y, z]) => new Vec3(x, y, z);
// A floor and open air: plain ground.
const flat = p => { const f = p.floored(); const solid = f.y < 64; return { position: f, name: solid ? 'netherrack' : 'air', boundingBox: solid ? 'block' : 'empty', shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [], diggable: solid, digTime: () => 2000 }; };
const keys = cs => cs.map(c => `${c.x},${c.y},${c.z}`).sort();

test('a wither skeleton cannot come under a ceiling two high: walk-reach reads each walker\'s own height (the saved cavern)', () => {
  const { bot, threat } = cavernBot();
  // As the ground was: it walks across the floor to the bot.
  assert.equal(walkersApart(bot, [threat()]).ids.size, 0);
  // With the ceiling two up over the bot's corner cell and the open cells
  // round it, the nearest it can stand is out of its reach of the bot.
  const roof = [[-241, 66, -143], [-240, 66, -143], [-241, 66, -142], [-240, 66, -142], [-239, 66, -142]].map(cell);
  const at = new Vec3(-239.5, 64, -142.5);
  assert.ok(walkersApart(bot, [threat()], { at, placed: roof }).ids.has(1086), 'kept off under the ceiling');
  // A zombie there is shorter than the ceiling and walks in under it.
  const zombie = { entity: { id: 7, name: 'zombie', position: SKELETON_AT.offset(1, 0, 0), height: 1.95, width: 0.6 }, distance: 9, visible: true };
  const both = walkersApart(bot, [threat(), zombie], { at, placed: roof });
  assert.ok(both.ids.has(1086));
  assert.ok(!both.ids.has(7), 'the zombie still gets to the bot');
});

test('the low ceiling found for the recorded corner: five blocks of netherrack two up, each against a face, quicker than digging in by hand', () => {
  const { bot, threat } = cavernBot();
  const plan = wg.lowCeilingPlan(bot, [threat()]);
  assert.ok(plan);
  assert.equal(plan.kind, 'roof');
  assert.deepEqual([plan.stand.x, plan.stand.y, plan.stand.z], [-240, 64, -143]);
  assert.deepEqual(keys(plan.placed), keys([[-241, 66, -143], [-240, 66, -143], [-241, 66, -142], [-240, 66, -142], [-239, 66, -142]].map(cell)));
  assert.equal(plan.material, 'netherrack');
  assert.equal(plan.seconds, 3);
  // Each goes against a face already there when its turn comes.
  assert.ok(wg.attachOrder(bot, plan.placed));
  // On open ground with nothing overhead there is no ceiling to put in.
  const open = cavernBot({ at: new Vec3(0.5, 64, 0.5), skeletonAt: new Vec3(0.5, 64, 8.5) });
  open.bot.blockAt = flat;
  assert.equal(wg.lowCeilingPlan(open.bot, [open.threat()]), null);
});

test('a blade reaches by the jar\'s box, not by distance: a block and a half across, sideways only', () => {
  const at = new Vec3(0.5, 64, 0.5);
  const mob = p => ({ name: 'wither_skeleton', position: p, width: 0.7, height: 2.4 });
  assert.ok(wg.bladeReaches(mob(new Vec3(1.9, 64, 0.5)), at));
  assert.ok(!wg.bladeReaches(mob(new Vec3(2.0, 64, 0.5)), at), '1.5 centre to centre is out of its reach');
  assert.ok(wg.bladeReaches(mob(new Vec3(1.8, 64, 1.8)), at), 'the diagonal is a box too');
  assert.ok(!wg.bladeReaches(mob(new Vec3(1.2, 61.5, 0.5)), at), 'its top under the feet');
});

test('the recorded 11:43:42.6 question offers the shield guard and the low ceiling, priced, and says when the skeleton meets the meal\'s end', () => {
  const { bot, threat } = cavernBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat()], false);
  const guard = options.shield_guard, low = options.low_ceiling;
  assert.ok(guard, `offered: ${Object.keys(options)}`);
  assert.match(guard.description, /Face the wither skeleton 8 blocks off with the shield raised and let it come; strike it with the iron sword right after each of its blows lands on the shield, or while it is within the sword's reach \(three blocks from the eye\) and out of its own \(about a block and a half\)/);
  assert.match(guard.description, /a blow the shield takes whole does no harm/);
  assert.match(guard.description, /A wither skeleton's wither comes only with a blow that hurts: a blow the shield takes gives none\./);
  assert.match(guard.description, /To kill: about 4 swings that land/);
  assert.match(guard.description, /About 0 damage from the mobs here in the next fifteen seconds this way/);
  // What the drill built from this death measured, beside the fight as it was.
  assert.match(guard.description, /Measured in the arena with the kit of the death it is built from \(full iron, an iron sword, a shield, no pickaxe\): this way, against one wither skeleton coming across a cavern at the bot in a rock corner, from 14\.5 health, 5 runs: 5 of 5 killed, about 0 damage a run on the median over about 7\.4 seconds, no deaths; fought as Jev chose its stances before either was offered, [^;]*5 runs: 5 of 5 killed, about 2\.8 damage/);
  assert.ok(low, `offered: ${Object.keys(options)}`);
  assert.match(low.description, /Put 5 blocks of netherrack in two up over the bot and over each cell round it that is open there \(about 3 seconds of placing, the shield down meanwhile\), and fight from under that ceiling: a wither skeleton is 2\.4 blocks tall, and its body does not go under a ceiling two high/);
  // A race it loses from here: the skeleton is at arm's length in about
  // 1.8 seconds at its own speed, the cells round the bot in after 2.4; said
  // so and priced as the fight there.
  assert.match(low.description, /The wither skeleton 8 blocks off can be at the bot in about 1\.8 seconds at its own speed, before the blocks over the cells round the bot are in \(2\.4 seconds\): one there first stands where a block goes or at the mouth, the block does not go in \(the game puts none where a body is\), and it is fought there as in the fight, priced so\./);
  assert.doesNotMatch(low.description, /The others that bite/);
  const lowDamage = Number(low.description.match(/About ([\d.]+) damage from the mobs here in the next fifteen/)[1]);
  assert.ok(lowDamage > 15, `priced ${lowDamage}`);
  // From further off it is in first: said, and the skeleton out of the
  // figures once it is.
  const far = cavernBot({ skeletonAt: new Vec3(-235.5, 64, -129.5) });
  const farOptions = new Survival(far.bot, { navigate: async () => {} }, { state: { shelters: [] } }).stanceOptions(new Task('x'), {}, () => {}, [far.threat()], false);
  assert.match(farOptions.low_ceiling.description, /The blocks over the cells round the bot go in first, those toward it first: in after about 2\.4 seconds, before it can be at the bot\./);
  assert.match(farOptions.low_ceiling.description, /About 0 damage from the mobs here in the next fifteen seconds this way, the 3 seconds of putting the ceiling in included, from 14\.5 health\. Under it, none of them reaches it\./);
  // The meal: the skeleton is at the bot as it ends, said with its blow
  // and the wither after.
  assert.ok(options.eat);
  assert.match(options.eat.description, /The wither skeleton 8 blocks off, at its own speed, is at arm's length about 0\.\d seconds after the meal ends \([\d.]+ from now\), the sword not yet back in hand and the shield a quarter second from blocking once raised: its first blow, about 4\.5 after armour, and the wither after it, about 5 more over ten seconds that armour does not stop, can land as the meal ends\. It deals with none of them/);
});

test('a meal a wither skeleton\'s blow lands in is priced with the wither the blow leaves, not the tenth of it in the meal (11:43:45.5)', () => {
  // As recorded: the skeleton at 3.6 blocks, knocked back, 10 health.
  const { bot, threat } = cavernBot({ at: new Vec3(-239.8, 64, -142.4), skeletonAt: new Vec3(-238.4, 64, -139.1), health: 10.02, food: 18 });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat()], false);
  assert.ok(options.eat);
  const eaten = Number(options.eat.description.match(/About ([\d.]+) damage from the mobs here while it eats/)[1]);
  // Its blow (4.5 through iron) and the ten seconds of wither it leaves
  // (5): recorded, 5.3, the wither counted to the meal's end.
  assert.ok(eaten >= 9, `priced ${eaten}`);
});

test('the guard strikes right after the blow the shield took, or while the skeleton is out of its own reach, and the shield is straight back up', async () => {
  const { bot, skeleton, attacks, shield } = cavernBot({ at: new Vec3(0.5, 64, 0.5), skeletonAt: new Vec3(1.8, 64, 0.5) });
  bot.blockAt = flat;
  bot.world.raycast = () => null;
  const task = new Task('x');
  const real = Date.now; let t = real();
  Date.now = () => (t += 20);
  try {
    // At its reach and not having struck: no swing, the shield up facing it.
    const first = wg.guard(bot, task, { until: t + 400, focus: 1086 });
    await first;
    assert.equal(attacks.length, 0, 'no swing into its blow');
    assert.ok(shield.some(([s]) => s === 'up'), 'the shield up');
    // Its blow lands on the shield (its arm swings): the sword answers.
    const second = wg.guard(bot, task, { until: t + 2000, focus: 1086 });
    setImmediate(() => bot.emit('entitySwingArm', skeleton));
    await second;
    assert.ok(attacks.length >= 1, 'struck after its blow');
    assert.ok(shield.at(-1)[0] === 'up', 'the shield back up after the swing');
    // Knocked back to two and a half blocks, out of its own reach: struck
    // as it comes in, its blow not waited for.
    attacks.length = 0; skeleton.position = new Vec3(3.0, 64, 0.5); bot._defenseAttackAt = 0;
    await wg.guard(bot, task, { until: t + 400, focus: 1086 });
    assert.ok(attacks.length >= 1, 'struck out of its reach');
  } finally { Date.now = real; }
});

test('a fight at a walker coming on is held facing it with the shield up when the run at it is cut short, not ended (11:43:45.1)', async () => {
  // Struck and knocked back to 3.6 blocks; the run's route came back partial.
  const { bot, threat, shield } = cavernBot({ at: new Vec3(-239.8, 64, -142.4), skeletonAt: new Vec3(-238.8, 64, -139.1), health: 10.02, food: 18 });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.charge = async (task, goal, save, nearest) => { bot._unreachable = { ids: [nearest.entity.id], until: Date.now() + 20000 }; return false; };
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat()], false);
  const real = Date.now; let t = real();
  Date.now = () => (t += 50);
  let ran;
  try { ran = await options.fight.run(); } finally { Date.now = real; }
  assert.equal(ran, true, `ended: ${survival.state.stanceWhy}`);
  assert.ok(shield.some(([s]) => s === 'up'), 'held behind the shield facing it');
});

test('the retreat\'s search for a way stands behind the shield facing a biter at arm\'s length, and lowers it for the run (11:43:48)', async () => {
  const { bot, threat } = cavernBot({ at: new Vec3(-239.8, 64, -142.4), skeletonAt: new Vec3(-239.5, 64, -141.0), health: 9.65, food: 20 });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const during = [];
  bot.pathfinder.getPathTo = () => { during.push(!!bot._shieldRaised); return { status: 'noPath', path: [] }; };
  const way = await survival.wayAway(new Task('x'), {}, { about: [threat().entity], heavy: false }, [new Vec3(-230, 64, -130), new Vec3(-250, 64, -135)]);
  assert.equal(way.p, null);
  assert.deepEqual(during, [true, true], 'the shield up through the search');
  assert.equal(!!bot._shieldRaised, false, 'down again for the run');
});

test('a hold is asked again when a biter it was chosen against comes to arm\'s length, not only four blocks nearer (mid-242-ah-fortress-3, 12:13:00)', () => {
  const holds = require('../src/holds');
  const skeleton = { id: 5, name: 'wither_skeleton', position: new Vec3(0, 64, 0) };
  const hold = holds.begin({ choice: 'retreat', at: 0, health: 15.5, mobs: [{ entity: skeleton, distance: 4.2, visible: true }], offered: ['retreat', 'fight'] });
  // Run from at 4.2, 6.7 blocks off after the run: nothing new.
  assert.equal(holds.diverged(hold, { now: 3000, health: 14.5, mobs: [{ entity: skeleton, distance: 6.7, visible: true }], offered: ['retreat', 'fight'] }), null);
  // Back at 2 blocks: at arm's length, 2.2 nearer than chosen against.
  assert.match(holds.diverged(hold, { now: 4000, health: 14.5, mobs: [{ entity: skeleton, distance: 2, visible: true }], offered: ['retreat', 'fight'] }), /came to arm's length, 2 blocks off/);
  // One chosen against at arm's length already is not news.
  const close = holds.begin({ choice: 'fight', at: 0, health: 15.5, mobs: [{ entity: skeleton, distance: 1.5, visible: true }], offered: ['fight'] });
  assert.equal(holds.diverged(close, { now: 1000, health: 15.5, mobs: [{ entity: skeleton, distance: 1.2, visible: true }], offered: ['fight'] }), null);
});

test('a retreat is not held on past its run: asked again when the run is done (mid-242-ah-fortress-3 and nether-1)', async () => {
  const { bot, threat } = cavernBot({ at: new Vec3(-239.8, 64, -142.4), skeletonAt: new Vec3(-236.5, 64, -134.5), health: 15.5, food: 20 });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.scoutRetreat = async () => {};
  const asked = [];
  survival.decide = async (task, goal, save, q) => { asked.push(Date.now()); return { path: [q.tree.retreat ? 'retreat' : Object.keys(q.tree)[0]] }; };
  const build = survival.stanceOptions.bind(survival);
  survival.stanceOptions = (...a) => { const o = build(...a); for (const v of Object.values(o)) v.run = async () => true; if (o.retreat) o.retreat.expects = { damage: 0, seconds: 3, oneHit: 4.5 }; return o; };
  const real = Date.now, t0 = real();
  try {
    for (let s = 0; s <= 8; s++) { Date.now = () => t0 + s * 1000; await survival.stanceStep(new Task('x'), {}, () => {}, [threat()], false); }
  } finally { Date.now = real; }
  // Chosen, then asked again once its three seconds were over, not held on
  // for fifteen more.
  assert.ok(asked.length >= 2, `asked ${asked.length} times`);
  assert.ok(asked[1] - asked[0] <= 4000, `asked again after ${(asked[1] - asked[0]) / 1000} seconds`);
});

test('a run from a wither skeleton at arm\'s length is priced with the blow as it turns, the blow on its arrival and the wither (mid-242-ah-nether-1, 12:14:33.7)', () => {
  // As recorded: 5.1 health, the skeleton at 0.6 blocks, the way past its
  // reach 17 blocks, about 3 seconds at a run.
  const { bot, threat } = cavernBot({ at: new Vec3(-239.5, 64, -142.5), skeletonAt: new Vec3(-239.5, 64, -141.9), health: 5.1, food: 20 });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.state.retreatScout = { at: Date.now(), feet: `${bot.entity.position.floored()}`, radius: 20, spots: 12, tried: 12, candidates: 12,
    pastReach: { destination: { x: -239, y: 64, z: -159 }, blocks: 17, from: [{ id: 1086, name: 'wither_skeleton', blocks: 17, follows: 16 }] } };
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat()], false);
  const leave = options.leave_reach;
  assert.ok(leave, `offered: ${Object.keys(options)}`);
  assert.match(leave.description, /About [\d.]+ damage from those that follow in the next fifteen seconds this way, from 5\.1 health \(more than the bot has\): the wither skeleton 2 blows \(as the bot turns to run, being at its reach now, on reaching the bot again [\d.]+ seconds after the run\), about 4\.5 each after armour, and the wither/);
  assert.ok(leave.expects.damage >= 9, `priced ${leave.expects.damage}`);
});

test('a meal with a wither skeleton at the bot within it is priced with its blow and the wither, more than 6.4 health, and said so (mid-243-af-fortress-3, 12:26:06.7)', () => {
  // As recorded: 6.4 health, hunger 17, the skeleton 6.4 blocks off, at
  // arm's length in 1.3 seconds of a 1.6-second meal; told "about 5 damage".
  const { bot, threat } = cavernBot({ at: new Vec3(-239.5, 64, -142.5), skeletonAt: new Vec3(-237.5, 64, -136.4), health: 6.4, food: 17 });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat()], false);
  assert.ok(options.eat);
  assert.match(options.eat.description, /About [\d.]+ damage from the mobs here while it eats, from 6\.4 health \(more than the bot has\)/);
  assert.match(options.eat.description, /The wither skeleton 6 blocks off, at its own speed, is at arm's length about 1\.3 seconds into the meal, the hand busy and the shield down: its blow, about 4\.5 after armour, and the wither after it, about 5 more over ten seconds that armour does not stop, lands before the meal is eaten\. It deals with none of them/);
});

// mid-242-ba-nether-2 (25590, 14:09:52): shield_guard chosen at 11.1 facing
// a wither skeleton four off, blazes five to nine off on the other side;
// they set it alight from 7.1 to none while the shield faced the skeleton
// (note 606).
test('the shield guard faces the biter: a blaze off its side is priced as if the shield were down, its fire with it, and said so', () => {
  const { threats } = require('../src/danger');
  const blazeOn = (id, x, z) => ({ id, name: 'blaze', type: 'hostile', position: AT.offset(x, 1, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } });
  const behind = cavernBot({ health: 11.1, skeletonAt: AT.offset(0, 0, -4), extra: [blazeOn(2, 0, 5), blazeOn(3, 1, 7)] });
  behind.bot.blockAt = flat; behind.bot.world = { raycast: () => null };
  const ahead = cavernBot({ health: 11.1, skeletonAt: AT.offset(0, 0, -4), extra: [blazeOn(2, 0.5, -5), blazeOn(3, 1, -7)] });
  ahead.bot.blockAt = flat; ahead.bot.world = { raycast: () => null };
  const guardOf = ({ bot }) => {
    const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
    return survival.stanceOptions(new Task('x'), {}, () => {}, threats(bot, 24), false).shield_guard;
  };
  const back = guardOf(behind), front = guardOf(ahead);
  assert.ok(back && front);
  assert.match(back.description, /The shield faces the wither skeleton: 2 blazes here are more than 60 degrees off that way, so their shots land as if it were down, each fireball with five seconds alight, counted below\./);
  assert.doesNotMatch(front.description, /more than 60 degrees off/);
  assert.ok(back.expects.damage > front.expects.damage + 1, `${front.expects.damage} with the blazes in front, ${back.expects.damage} behind`);
});

test('the guard faces a biter out of sight within five, as the stance was offered over, not ending at once twenty times a second (mid-242-bb, 15:06:19, note 613)', async () => {
  // A piglin 3.3 blocks off out of sight: shield_guard was offered over it (a biter unseen within five) and chosen at 0.78;
  // the guard's own look took unseen biters only within two, found none, and ended at once, twenty times in a second.
  const piglin = { id: 77, name: 'piglin', type: 'hostile', position: new Vec3(3.8, 64, 0.5), height: 1.95, width: 0.6, isValid: true, heldItem: { name: 'golden_sword' } };
  const { bot, skeleton, shield } = cavernBot({ at: new Vec3(0.5, 64, 0.5), skeletonAt: new Vec3(40.5, 64, 0.5), extra: [piglin] });
  bot.blockAt = flat;
  bot.world.raycast = (from, dir) => ({ position: from.plus(dir).floored(), intersect: from.plus(dir.scaled(0.5)) });
  delete bot.entities[skeleton.id];
  const { threats } = require('../src/danger');
  const seen = threats(bot, 16).find(t => t.entity.id === 77);
  assert.ok(seen && !seen.visible && seen.distance > 2 && seen.distance <= 5, 'out of sight, 3.3 off');
  assert.ok(wg.inGuard(seen), 'one the stance is offered over');
  const real = Date.now; let t = real();
  Date.now = () => (t += 20);
  let r;
  try { r = await wg.guard(bot, new Task('x'), { until: t + 400, focus: 77, radius: 16 }); } finally { Date.now = real; }
  assert.equal(r.ended, 'time', `held its time facing it, not ${r.ended}`);
  assert.ok(shield.some(([s]) => s === 'up'), 'the shield up facing it');
});

// Note 663: the arena's rows (wither skeletons, a rock corner, no deaths)
// were the whole record the guard was offered with; the overnight trials of
// 2026-09-29 ran it 107 times against wither skeletons (4 deaths) and five
// against a piglin brute (every run took a blow, 2 deaths).
test('the guard is said with what the bot\'s own runs of it came to, by the kind faced (note 663)', () => {
  const wg = require('../src/wither-guard');
  const brute = wg.recordSays('piglin_brute');
  assert.match(brute, /5 runs, every one took a blow \(7 blows in all, 58 health lost/);
  assert.match(brute, /2 ended in death/);
  assert.match(brute, /golden axe, not a sword/);
  assert.match(wg.recordSays('wither_skeleton'), /107 runs, 14 of them took a blow \(17 blows in all, 188 health lost in those runs\), 4 ended in death/);
  assert.match(wg.recordSays('hoglin'), /none ended in death/);
  assert.equal(wg.recordSays('spider'), '');
});

test('with no rock beside the bot, a hole in the rock within six blocks is planned, walked to (note 987)', () => {
  const far = cavernBot({ at: new Vec3(5.5, 64, 0.5), skeletonAt: new Vec3(14.5, 64, 0.5) });
  // Plain ground, and a rock wall from x <= 1: four blocks west of the bot.
  far.bot.blockAt = p => { const f = p.floored(); return f.y >= 64 && f.x <= 1 ? flat(new Vec3(f.x, 60, f.z)) && { ...flat(new Vec3(f.x, 60, f.z)), position: f } : flat(p); };
  const plan = wg.lowCeilingPlan(far.bot, [far.threat()]);
  assert.ok(plan, 'a plan');
  assert.equal(plan.kind, 'dig');
  assert.deepEqual([plan.mouth.x, plan.mouth.y, plan.mouth.z], [2, 64, 0]);
  assert.deepEqual([plan.stand.x, plan.stand.y, plan.stand.z], [0, 64, 0]);
  assert.equal(plan.off, 3);
  assert.equal(plan.blocks, 4);
  assert.match(wg.holeSays(), /10 runs, 40 of 40 killed from its end/);
});

// Note 1030: the shield guard held a block from a drop into lava says first
// that the shield's blows still knock the bot, and what that came to.
test('the shield guard at a drop into lava leads with the knock over it; with no drop it does not (note 1030)', () => {
  const { bot, threat } = cavernBot();
  const plain = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } }).stanceOptions(new Task('x'), {}, () => {}, [threat()], false);
  assert.doesNotMatch(plain.shield_guard.description, /does not hold the bot's ground/);
  const edge = cavernBot(), feet = edge.bot.entity.position.floored(), was = edge.bot.blockAt;
  // The column one block east is open down to lava ten blocks under the feet.
  edge.bot.blockAt = p => {
    const c = p.floored();
    if (c.x === feet.x + 1 && c.z === feet.z && c.y <= feet.y + 1 && c.y > feet.y - 10) return { name: 'air', position: c, boundingBox: 'empty', type: 0 };
    if (c.x === feet.x + 1 && c.z === feet.z && c.y === feet.y - 10) return { name: 'lava', position: c, boundingBox: 'empty', type: 1 };
    return was(p);
  };
  const options = new Survival(edge.bot, { navigate: async () => {} }, { state: { shelters: [] } }).stanceOptions(new Task('x'), {}, () => {}, [edge.threat()], false);
  assert.match(options.shield_guard.description, /^Held here, the shield does not hold the bot's ground: a drop of 9 blocks into lava is a block off, each blow the shield takes still knocks the bot about half a block with a hop, and the second or third puts it over\. In the trials of 2026-10-03 \(00:00Z to 09:20Z\), of 6 falls into lava that began with the shield held at a drop \(4 from this guard, 2 from the shield raised at a shot\), 5 were deaths\. /);
});
