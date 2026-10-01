'use strict';
// Note 774. 25584 (mid-229-aa, 2026-10-01 00:55 to 01:07Z) stood ten minutes
// walled in five blocks from the cage at (209, 62, -270): 0 blazes killed,
// 30.9 health lost, then dead. hunt_target offered "Fight the blaze 4 blocks
// off ... in the open" from inside the walls and the fight's own route said
// "No dry combat route"; the box and the slit undid each other (the slit dug
// "the netherrack at (206, 62, -267), laid by the bot at 01:03Z" that cover
// had put in the box's window); every hold was cut by "Threat nearby: blaze
// at 4 to 6 blocks". 25585 (mid-227-aa, 01:23 to 01:28Z) chose box_here
// three times though its window saw none of where the blazes came, and was
// preempted "something that can push the bot" walled in on all eight sides.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const stand = require('../src/blaze-stand');
const T = require('../src/blaze-tactics');
const ch = require('../src/cage-hold');
const danger = require('../src/danger');

const CAGE = new Vec3(6, 64, 0);
// A nether-brick floor at y 63 everywhere, the cage at (6, 64, 0); `walls`
// adds solid cells; `own` the cells the bot laid.
function world({ walls = () => false, own = [], lava = () => false, bedrock = () => false, shield = true } = {}) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const set = new Map();
  const blockAt = p => {
    const f = p.floored(), key = `${f}`;
    if (!set.has(key)) {
      const name = f.equals(CAGE) ? 'spawner' : lava(f) ? 'lava' : bedrock(f) ? 'bedrock' : (f.y <= 63 || walls(f)) ? (own.some(c => c.equals(f)) ? 'netherrack' : 'nether_bricks') : 'air';
      const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f; set.set(key, b);
    }
    return set.get(key);
  };
  const items = ['iron_sword', 'iron_pickaxe', 'netherrack'];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], width: 0.6, height: 1.8 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => items.map(name => ({ name, type: registry.itemsByName[name].id, count: /pickaxe|sword/.test(name) ? 1 : 64, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, ...(shield ? { 45: { name: 'shield' } } : {}) } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {} },
    // A cell put in or dug out, as the world would.
    setBlock: (p, name) => { const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = p.floored(); set.set(`${p.floored()}`, b); } });
  bot.findBlocks = ({ matching, maxDistance = 16, count = 1, point }) => {
    const ids = [].concat(matching), at = point || bot.entity.position, out = [];
    for (let x = -14; x <= 14; x++) for (let y = -3; y <= 3; y++) for (let z = -14; z <= 14; z++) {
      const p = at.floored().offset(x, y, z);
      if (p.distanceTo(at) <= maxDistance && ids.includes(blockAt(p).type)) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(at) - b.distanceTo(at)).slice(0, count);
  };
  bot._laid = new Map(own.map(c => [`${c.x},${c.y},${c.z}`, { name: 'netherrack', at: Date.now() - 60000 }]));
  return bot;
}
const blazeAt = (id, x, y, z) => ({ id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } });
const rodsGoal = (extra = {}) => ({ kind: 'win', mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 }, fortressSearch: { map: { spawners: [{ x: CAGE.x, y: CAGE.y, z: CAGE.z }] } }, ...extra });
// The bot's own box round (0, 64, 0): every side at feet and head.
const BOX = [[1, 0], [-1, 0], [0, 1], [0, -1]].flatMap(([x, z]) => [new Vec3(x, 64, z), new Vec3(x, 65, z)]);

test('one reachability for every attack on a blaze: walled in by its own blocks, close_in, charge_nearest, fight and the hunt\'s own route all find none (25584, 01:05:27Z)', async () => {
  const bot = world({ walls: p => BOX.some(c => c.equals(p)), own: BOX });
  const blaze = blazeAt(7, 4.5, 64.5, 0.5);
  bot.entities = { 7: blaze };
  assert(stand.strikeCells(bot, blaze).length, 'ground beside the blaze is fine on its own');
  assert.equal(stand.blazeReach(bot, blaze), null, 'no walk out of the box');
  assert.deepEqual(require('../src/survival').chargeStopsAt(bot, blaze), { blocks: 0, left: 4 }, 'fight reads the same');
  const options = stand.blazeStands(bot, danger.threats(bot, 24), { dig: false, hunted: true });
  assert(!options.close_in && !options.charge_nearest, Object.keys(options).join(','));
  const { combatRoute } = require('../src/mob-hunt');
  assert.equal(await combatRoute(bot, { check() {} }, blaze, { allowed: () => true }), null, 'the hunt\'s fight reads it too');
  // Out of the box, the same blaze is reached, and the hunt's walk goes to
  // the cell the reach names.
  const open = world();
  open.entities = { 7: blaze };
  const reach = stand.blazeReach(open, blaze);
  assert(reach && reach.steps >= 1, JSON.stringify(reach));
  const route = await combatRoute(open, { check() {} }, blaze, { allowed: () => true });
  assert.equal(route.destination.constructor.name, 'GoalBlock');
  assert.deepEqual([route.destination.x, route.destination.y, route.destination.z], [reach.cell.x, reach.cell.y, reach.cell.z]);
});

test('a box at the cage is cut with its slit: the window is where the line from the eyes to the cage leaves it, the blocks past it on that line dug with the build, and open_slit has nothing to dig after', () => {
  // A brick pillar two blocks east of the bot's cell, on the line to the cage.
  const pillar = [new Vec3(2, 64, 0), new Vec3(2, 65, 0)];
  const bot = world({ walls: p => pillar.some(c => c.equals(p)) });
  const site = T.boxFits(bot, T.boxPlan(bot, new Vec3(0, 64, 0), CAGE.offset(0.5, 0.5, 0.5), { cage: CAGE }));
  assert(site, 'the box fits where the bot stands');
  assert.equal(`${site.window}`, '(1, 65, 0)', 'the head-row wall toward the cage');
  assert.deepEqual(site.digs.map(String), ['(2, 65, 0)'], 'the brick past the window on the line, dug with the build');
  assert(!site.walls.some(w => w.equals(site.window)), 'the window is no wall');
  // Built: walls in, the window and the slit open.
  for (const w of site.walls) bot.setBlock(w, 'netherrack');
  for (const c of site.digs) bot.setBlock(c, 'air');
  const goal = rodsGoal();
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  assert.equal(ch.slitLine(bot, CAGE, goal), null, 'nothing on the line to dig: no slit offered over the box');
  // Its plan holds its openings: no slit through its walls, no cover in its window.
  ch.beginHold(bot, goal, () => {}, 'box_here', Date.now(), { site });
  assert(ch.openings(bot, goal).has('(1, 65, 0)'));
  assert(ch.openings(bot, goal).has('(2, 65, 0)'));
});

test('the cage\'s plan holds until it kills or fails, and meanwhile only a blaze inside the box or a hit through it is a threat that ends the step (25584: "Threat nearby: blaze at 4 to 6 blocks")', () => {
  const bot = world({ walls: p => BOX.some(c => c.equals(p)) && !p.equals(new Vec3(1, 65, 0)) });
  const goal = rodsGoal();
  bot._goal = goal;
  const out = blazeAt(8, 4.5, 65, 0.5);
  bot.entities = { 8: out };
  const t = danger.threats(bot, 24).find(x => x.entity === out);
  assert(t && t.visible, 'seen through the window');
  // At an owed cage a blaze past arm's length is already the work's (note
  // 731); the ones that cut 25584's holds were a stance's own mobs kept
  // against it (danger.js stanceMobs) and its fireballs.
  bot._stance = { choice: 'take_cover', ids: [8], at: Date.now(), running: true, health: 20 };
  assert(danger.immediateThreat(bot), 'without a plan, a blaze a stance was chosen against is a threat');
  const site = { cell: new Vec3(0, 64, 0), window: new Vec3(1, 65, 0), walls: BOX.filter(c => !c.equals(new Vec3(1, 65, 0))), slit: [] };
  ch.beginHold(bot, goal, () => {}, 'box_here', Date.now(), { site });
  assert(ch.holding(bot, goal), 'held');
  assert.equal(ch.shelterKeepsOff(bot, t), true);
  assert.equal(danger.immediateThreat(bot), undefined, 'held: the blaze at the window is the box\'s, not a threat');
  // A hit through it ends that.
  bot._hurtBy = { blaze: Date.now() + 1 };
  assert.equal(ch.shelterKeepsOff(bot, t), false);
  assert(danger.immediateThreat(bot), 'a hit through the box is');
  // And ends the plan, as its commitment says (note 810).
  assert.equal(ch.holding(bot, goal), null);
  assert.match(goal.cageHold.endedBy, /^a hit landed through it/);
  bot._hurtBy = {};
  ch.beginHold(bot, goal, () => {}, 'box_here', Date.now(), { site });
  assert(ch.holding(bot, goal), 'held again, begun anew');
  // A blaze inside the box is, and ends the plan.
  const inside = blazeAt(9, 0.6, 64.2, 0.4);
  bot.entities[9] = inside;
  assert.equal(ch.shelterKeepsOff(bot, { entity: inside, distance: 0.3 }), false);
  assert.equal(ch.holding(bot, goal), null);
  assert.equal(goal.cageHold.endedBy, 'a blaze came inside the box');
  delete bot.entities[9];
  // A kill ends it as done; six health gone ends it as failed.
  ch.beginHold(bot, goal, () => {}, 'box_here', Date.now(), { site });
  bot._kills = { blaze: 1 };
  assert.equal(ch.holding(bot, goal), null);
  assert.equal(goal.cageHold.endedBy, 'a blaze killed');
  ch.beginHold(bot, goal, () => {}, 'box_here', Date.now(), { site });
  bot.health = 13.5;
  assert.equal(ch.holding(bot, goal), null);
  assert.match(goal.cageHold.endedBy, /^6\.5 health gone since it began$/);
  bot.health = 20;
  ch.beginHold(bot, goal, () => {}, 'box_here', Date.now(), { site });
  assert.equal(ch.holding(bot, goal, Date.now() + ch.PLAN_MS + 1000), null, 'its time');
});

test('walled at feet and head on every side, no push puts the bot over (25585, 01:24:10 and 01:27:33Z)', () => {
  const bot = world({ walls: p => BOX.some(c => c.equals(p)), lava: p => p.y <= 40 && Math.abs(p.x) >= 2 });
  assert.equal(danger.walledRound(bot), true);
  assert.equal(danger.pushOverDrop(bot), null);
  const open = world({ walls: p => BOX.some(c => c.equals(p)) && !p.equals(new Vec3(1, 64, 0)) });
  assert.equal(danger.walledRound(open), false, 'one side open at the feet');
});

test('cover goes in no cell of the held box\'s window (25584\'s cover laid its window shut at 01:03Z)', () => {
  const bot = world({ walls: p => BOX.some(c => c.equals(p)) && !p.equals(new Vec3(1, 65, 0)) });
  const goal = rodsGoal();
  bot._goal = goal;
  const blaze = blazeAt(8, 5.5, 65, 0.5);
  bot.entities = { 8: blaze };
  const sight = require('../src/creeper-sight');
  const before = sight.blockPlan(bot, blaze);
  assert(before.cells.some(c => `${c}` === '(1, 65, 0)'), JSON.stringify(before));
  const site = { cell: new Vec3(0, 64, 0), window: new Vec3(1, 65, 0), walls: BOX.filter(c => !c.equals(new Vec3(1, 65, 0))), slit: [] };
  ch.beginHold(bot, goal, () => {}, 'box_here', Date.now(), { site });
  const plan = sight.blockPlan(bot, blaze);
  assert.equal(plan.cells.length, 0);
  assert.match(plan.why, /held box's window at \(1, 65, 0\)/);
});

test('an answer at the cage is judged by what it killed, not by blocks laid or the bot moving; and holds as a commitment until a kill (notes 764, 765)', () => {
  const outcome = require('../src/decisions/outcome');
  const commit = require('../src/decisions/commit');
  const bot = world();
  bot._kills = { blaze: 0 };
  const spec = { id: 'empty_spawner' };
  const goal = { tried: { entries: [] } };
  outcome.begin(bot, goal, spec, ['box_here'], ch.planNode());
  assert.equal(bot._outcome.empty_spawner.wait, null, 'not a wait, whatever box_here is elsewhere');
  bot._stalls = { marked: 3 };
  bot.entity.position = new Vec3(3.5, 64, 0.5);
  const j = outcome.judge(bot, goal, 'empty_spawner', { asked: true });
  assert(j.failed, JSON.stringify(j));
  assert.match(j.failed.says, /no blaze killed and no rod carried/);
  outcome.begin(bot, goal, spec, ['box_here'], ch.planNode());
  bot._kills.blaze = 1;
  assert.deepEqual(outcome.judge(bot, goal, 'empty_spawner', { asked: true }), { changed: 'a blaze killed' });
  // The commitment ends on a kill.
  const def = { id: 'empty_spawner' };
  const tree = { box_here: ch.planNode() };
  bot._kills.blaze = 1;
  commit.after(bot, {}, def, ['box_here'], tree.box_here, tree);
  assert(commit.before(bot, {}, def, tree).held, 'held');
  bot._kills.blaze = 2;
  assert.match(commit.before(bot, {}, def, tree).ended, /a blaze was killed/);
});

test('with twenty or more stacked within sixteen, pulling back out of their sight is offered with the spawner\'s cap against the blazes it already made', () => {
  // A brick wall at x = -10 (z -30 to 30, open at z 0): the far side of it
  // is out of their line.
  const bot = world({ walls: p => p.x === -10 && p.y <= 72 && Math.abs(p.z) <= 30 && p.z !== 0 });
  const goal = rodsGoal();
  bot.entity.position = new Vec3(4.5, 64, 0.5);
  const blazes = Array.from({ length: 22 }, (_, i) => blazeAt(100 + i, 6.5 + (i % 5) - 2, 65 + Math.floor(i / 5), 0.5 + ((i * 3) % 7) - 3));
  bot.entities = Object.fromEntries(blazes.map(b => [b.id, b]));
  const fight = ch.cageFight(bot, goal);
  assert(fight, 'at the cage');
  const pb = ch.pullBackOption(bot, { check() {} }, goal, () => {}, fight, { navigate: async () => {} });
  assert(pb, 'offered');
  assert.match(pb.description, /^Pull back out of their sight: walk \d+ blocks/);
  assert.match(pb.description, /22 blazes are within 16 \(0 out of sight\); \d+ of them within the spawner's own range of the cage, which it caps at 6/);
  assert.match(pb.description, /past 16 of the cage the spawner makes none and its delay stops; a blaze shoots only with a line to the bot; a monster with no player within 32 blocks for 30 seconds is removed at random/);
  bot.entities = Object.fromEntries(blazes.slice(0, 12).map(b => [b.id, b]));
  assert.equal(ch.pullBackOption(bot, { check() {} }, goal, () => {}, fight, { navigate: async () => {} }), null, 'twelve: not stacked');
});

test('a box whose window sees none of where the blazes come is not offered to the hunt as a way to the rods, and is said as cover alone elsewhere (25585, 01:23 to 01:28Z)', () => {
  // Bedrock between every cell near the bot and the cage's spawn cells (x =
  // 2, full height): no slit comes through it. (Brick there, the box's slit
  // is cut through it with the build, and the box sees them.)
  const brick = world({ walls: p => p.x === 2 && p.y <= 70 });
  brick.entities = { 7: blazeAt(7, 0.5, 66, 6.5) };
  const cut = stand.blazeStands(brick, danger.threats(brick, 24), { dig: false, hunted: true, goal: rodsGoal() });
  assert(cut.box_here, 'through brick the box is cut with its slit');
  assert.match(cut.box_here.description, /the rod farm players build/);
  assert.equal(cut.box_here.judgeBy, 'kills', 'at an owed cage: the cage\'s plan, judged by what it kills');
  const bot = world({ bedrock: p => p.x === 2 && p.y <= 70 });
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  const blaze = blazeAt(7, 0.5, 66, 6.5);
  bot.entities = { 7: blaze };
  const hunted = stand.blazeStands(bot, danger.threats(bot, 24), { dig: false, hunted: true, goal: rodsGoal() });
  assert(!hunted.box_here, 'the hunt (the rods) is not offered a box that sees none of them');
  const asStance = stand.blazeStands(bot, danger.threats(bot, 24), { dig: false, goal: rodsGoal() });
  assert(asStance.box_here, Object.keys(asStance).join(','));
  assert.match(asStance.box_here.description, /stay in it as cover, not as a rod farm/);
  assert.doesNotMatch(asStance.box_here.description, /the rod farm players build/);
});

test('a blaze no walk reaches is not priced as a kill by fight, and is offered a rise to its height on placed blocks and a hold behind the shield for it to come in (25584, 02:07:18Z)', () => {
  // The bot on a ledge at y 63 (x <= 2); past it a drop to y 52: the blaze
  // hovers over the drop at the bot's height, no ground within reach of it
  // that a walk gets to; but the ledge's edge cell under a two-block pillar
  // puts the eyes within its reach.
  const bot = world({ walls: p => false });
  const floor = p => (p.x <= 2 ? p.y <= 63 : p.y <= 52);
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  bot.blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[floor(f) ? 'nether_bricks' : 'air'].defaultState); b.position = f; return b; };
  bot.findBlocks = () => [];
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  const blaze = blazeAt(9, 5.5, 66.2, 0.5);
  bot.entities = { 9: blaze };
  assert.equal(stand.blazeReach(bot, blaze), null, 'no strike cell a walk reaches');
  assert.deepEqual(require('../src/survival').chargeStopsAt(bot, blaze)?.blocks, 0, 'fight says no step: not a kill estimate');
  const options = stand.blazeStands(bot, danger.threats(bot, 24), { dig: false, hunted: true });
  assert(!options.close_in && !options.charge_nearest);
  assert(options.rise_to_strike, Object.keys(options).join(','));
  assert.equal(options.rise_to_strike.kind, 'rise');
  assert.match(options.rise_to_strike.description, /^Rise to the blaze \d(\.\d)? blocks off, which no walk on the ground reaches within the sword's reach: walk \d blocks? to \(2, 64, 0\) and pillar [1-3] blocks? up/);
  assert(options.await_in_reach, 'with a shield, the hold for it to come in');
  assert.match(options.await_in_reach.description, /It comes only as it chooses: nothing here brings it in\./);
});
