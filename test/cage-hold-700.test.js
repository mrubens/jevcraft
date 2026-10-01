'use strict';
// The fight at the cage is the plan (note 700): a stay there is a wait, not
// a stall; the stall's question offers a slit toward the cage and a stay;
// the unstuck moves say where they leave the bot against the cage; the
// pickaxe is not put first where the rods need a sword; going on without
// stems fetched for a pickaxe is going without the pickaxe; and a quiet
// scene's answer holds the fifteen seconds it was priced over.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

// 25585 (mid-242-ca-fortress-13) at 23:01:20Z: at (-202.4, 53, -151.4), the
// cage at (-204, 57, -150), a box of its own netherrack round it and a roof,
// laid from 22:50Z; nether bricks under it. The 25585 flight record's frame.
const CAGE = new Vec3(-204, 57, -150);
const FEET = new Vec3(-203, 53, -152);
const LAID = Date.parse('2026-09-29T22:50:30Z');
function cageWorld() {
  const cells = new Map(), own = new Map();
  const put = (p, name) => cells.set(`${p.x},${p.y},${p.z}`, name);
  for (let x = -210; x <= -196; x++) for (let z = -158; z <= -144; z++) {
    for (let y = 40; y <= 52; y++) put(new Vec3(x, y, z), 'nether_bricks');
    for (let y = 53; y <= 62; y++) put(new Vec3(x, y, z), 'air');
  }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1]) { const p = FEET.offset(dx, dy, dz); put(p, 'netherrack'); own.set(`${p.x},${p.y},${p.z}`, { name: 'netherrack', at: LAID }); }
  const roof = FEET.offset(0, 2, 0); put(roof, 'netherrack'); own.set(`${roof.x},${roof.y},${roof.z}`, { name: 'netherrack', at: LAID });
  put(CAGE, 'spawner');
  const blockAt = p => {
    const f = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const name = cells.get(`${f.x},${f.y},${f.z}`) ?? 'netherrack', b = registry.blocksByName[name];
    return { name, position: f, boundingBox: name === 'air' ? 'empty' : 'block', hardness: b?.hardness, harvestTools: b?.harvestTools, type: b?.id };
  };
  return { cells, own, blockAt };
}
const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 });
function cageBot({ items = ['iron_sword', 'iron_pickaxe', ['netherrack', 70]], position = new Vec3(-202.42, 53, -151.39), mobs = [] } = {}) {
  const w = cageWorld();
  const inv = items.map(i => Array.isArray(i) ? stack(...i) : stack(i));
  const entities = {};
  mobs.forEach(([name, p], i) => { entities[i + 1] = { id: i + 1, name, type: 'hostile', position: p, height: 1.8, width: 0.6, isValid: true }; });
  const bot = Object.assign(new EventEmitter(), { registry, version: '26.1', health: 20, food: 19, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position, onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0) }, entities, inventory: { items: () => inv, slots: [] },
    world: { raycast: () => null }, blockAt: w.blockAt, findBlocks: () => [], chat() {},
    _laid: w.own });
  return { bot, w };
}
const rodsGoal = (extra = {}) => ({ kind: 'win', mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 }, fortressSearch: { map: { spawners: [{ x: CAGE.x, y: CAGE.y, z: CAGE.z }] } }, ...extra });

test('at 25585\'s box by the cage, the fight there is the plan: where the cage is, what was chosen there, and the sword', () => {
  const ch = require('../src/cage-hold');
  const { bot } = cageBot();
  const goal = rodsGoal({ emptySpawner: { built: { key: 'box_here', at: LAID } } });
  const f = ch.cageFight(bot, goal);
  assert(f, 'at the cage');
  assert.deepEqual([f.cage.x, f.cage.y, f.cage.z], [-204, 57, -150]);
  assert.equal(f.off, 5);
  assert.equal(f.need, 7);
  assert.equal(f.sword, 'iron_sword');
  assert.match(ch.workFreeSays(f), /^ It leads away from the spawner at \(-204, 57, -150\), 5 blocks off, where the rods are fought for; the walls round it are the box built there at 22:50Z\.$/);
  // No rods wanted, the Overworld, or the cage past sixteen: not this.
  assert.equal(ch.cageFight(bot, { ...goal, mobHunt: null }), null);
  bot.entity.position = new Vec3(-202.4, 53, -170.4);
  assert.equal(ch.cageFight(bot, goal), null, 'twenty blocks off: the spawner makes nothing');
});

test('the stall at the cage offers a slit toward it through the bot\'s own roof and a stay; the stay is a wait for its minute, not a stall', async () => {
  const ch = require('../src/cage-hold'), stillness = require('../src/stillness');
  const { bot } = cageBot({ mobs: [['blaze', new Vec3(-205.5, 55, -148.5)], ['blaze', new Vec3(-201.5, 57, -148.5)]] });
  const goal = rodsGoal({ step: { action: 'stalk_mob', entity: 'blaze' } });
  const dug = [];
  const answers = ch.stallAnswers(bot, { check() {} }, goal, () => {}, ch.cageFight(bot, goal), { dig: async (b, t, p) => { dug.push(`${p}`); } });
  assert.deepEqual(Object.keys(answers), ['open_slit', 'stay_and_fight']);
  assert.match(answers.open_slit.description, /^Open a slit toward the cage: dig the block on the line from the eyes to it \(the netherrack at \(-203, 55, -152\), laid by the bot at 22:50Z\), then stay a minute and fight what comes into that line\./);
  assert.doesNotMatch(answers.open_slit.description, /spawn range/, '5 blocks off: outside the four-block spawn range');
  assert.match(answers.stay_and_fight.description, /^Stay here, 5 blocks from the cage, a minute and fight what comes\. No try of the spawner's has been seen since the bot came near, so the next can come any moment up to 40 seconds from now\. .*7 rods still needed\.$/);
  assert.equal(stillness.stepWait(bot, goal), null, 'nothing chosen yet');
  await answers.open_slit.run();
  assert.deepEqual(dug, ['(-203, 55, -152)']);
  assert.equal(goal.cageHold.choice, 'open_slit');
  assert.equal(stillness.stepWait(bot, goal), 'staying at the spawner');
  // The hunt's stalk and its cover trading names at the cage is that fight.
  const now = Date.now();
  bot._stalls = { records: {}, marks: [] };
  for (let i = 0; i < 6; i++) { goal.step = { action: i % 2 ? 'break_their_line' : 'stalk_mob', entity: 'blaze' }; assert.equal(stillness.flipWatch(bot, goal, now + i * 3000), null, 'not a flip while it stays'); }
  // Walked off the spot, or the minute run out: over.
  bot.entity.position = new Vec3(-202.4, 53, -157.4);
  assert.equal(stillness.stepWait(bot, goal), null);
  bot.entity.position = new Vec3(-202.42, 53, -151.39);
  // A slit is the cage's plan (note 774): held PLAN_MS unless it kills or fails.
  assert.equal(stillness.stepWait(bot, goal, Date.now() + ch.PLAN_MS + 1000), null);
  // Without the stay, the same trading is raised as it was.
  delete goal.cageHold;
  bot._stalls = { records: {}, marks: [] };
  let raised = null;
  for (let i = 0; i < 6 && !raised; i++) { goal.step = { action: i % 2 ? 'break_their_line' : 'stalk_mob', entity: 'blaze' }; raised = stillness.flipWatch(bot, goal, now + i * 3000); }
  assert.match(raised?.why || '', /^turning between stalk mob and break their line/);
  // The next offer of a stay says how the last went.
  goal.cageHold = { choice: 'stay_and_fight', at: Date.parse('2026-09-29T23:01:30Z'), until: 0, rods: 0 };
  assert.match(ch.stallAnswers(bot, { check() {} }, goal, () => {}, ch.cageFight(bot, goal), { dig: async () => {}, now: Date.parse('2026-09-29T23:03:00Z') }).stay_and_fight.description, /The last, stay and fight at 23:01Z: no rod since\.$/);
});

test('a box Jev chose to build by the cage is a stay for its first minute', () => {
  const ch = require('../src/cage-hold'), stillness = require('../src/stillness');
  const { bot } = cageBot();
  const now = Date.now();
  const goal = rodsGoal({ emptySpawner: { built: { key: 'box_here', at: now - 20000, from: { x: -203, y: 53, z: -152 } } } });
  assert.equal(stillness.stepWait(bot, goal, now), 'staying at the spawner');
  assert.equal(stillness.stepWait(bot, goal, now + ch.HOLD_MS), null);
});

test('each unstuck move says where it leaves the bot against the cage: 25585\'s dig down was away from it', () => {
  const u = require('../src/unstuck');
  const { bot } = cageBot();
  const view = u.liveView(bot);
  const toward = { at: { x: CAGE.x + 0.5, y: CAGE.y + 0.5, z: CAGE.z + 0.5 }, what: 'the spawner at (-204, 57, -150)' };
  const { moves } = u.localMoves(view, FEET, { goal: 'away', from: FEET, toward });
  const down = moves.find(m => m.key === 'dig_down');
  assert(down, `offered: ${moves.map(m => m.key)}`);
  assert.match(u.describeMove(down), /6 blocks from the spawner at \(-204, 57, -150\) after, 5 now: away from it\.$/);
  // Without the cage nothing is said of it.
  assert.doesNotMatch(u.describeMove(u.localMoves(view, FEET, { goal: 'away', from: FEET }).moves.find(m => m.key === 'dig_down')), /spawner/);
});

test('25591 at 22:58:06Z: beside a live cage with an iron sword and no pickaxe, the upkeep says the rods need the sword and does not put the pickaxe first; with note 783 the stems are not offered there at all', async () => {
  const { upkeepStep } = require('../src/work');
  const cage = new Vec3(158, 64, 356);
  const inv = Object.entries({ stone_axe: 1, mutton: 9, coal: 128, crafting_table: 2, gravel: 21, water_bucket: 1, oak_fence: 15, blaze_rod: 1, beef: 3, bucket: 1, white_wool: 4, iron_sword: 1, flint_and_steel: 1, netherrack: 15 }).map(([n, c]) => stack(n, c));
  const make = () => ({ bot: { registry, game: { gameMode: 'survival', dimension: 'the_nether' }, time: { timeOfDay: 3000 }, health: 20, food: 19,
    entity: { isInWater: false, position: new Vec3(157.5, 63, 353.5) }, entities: {}, inventory: { items: () => inv },
    blockAt: p => ({ name: p.x === cage.x && p.y === cage.y && p.z === cage.z ? 'spawner' : p.y < 63 ? 'netherrack' : 'air', position: p, boundingBox: p.y < 63 ? 'block' : 'empty' }), findBlocks: () => [] },
  goal: { kind: 'win', step: { action: 'break_their_line', entity: 'blaze' }, mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 },
    fortressSearch: { map: { spawners: [{ x: cage.x, y: cage.y, z: cage.z }] } } } });
  const asked = [];
  const client = { systemOne: async req => { const q = req.questions.branch_0; asked.push({ options: q.criteria, state: req.state }); return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  // Note 783: beside the live cage with rods owed, the stems are not offered
  // and carry on is taken unasked.
  { const { bot, goal } = make(); const log = console.log; console.log = () => {};
    try { await upkeepStep(bot, { check() {} }, goal, () => {}, client); } finally { console.log = log; } }
  assert.equal(asked.length, 0, 'not asked: the stems are not offered beside the cage');
  // The words as they are said where the rule does not apply (JEV_BLAZE_GOAL=0).
  process.env.JEV_BLAZE_GOAL = '0';
  try { const { bot, goal } = make(); await upkeepStep(bot, { check() {} }, goal, () => {}, client); } finally { delete process.env.JEV_BLAZE_GOAL; }
  assert.equal(asked.length, 1);
  const { options, state } = asked[0];
  assert.equal(Object.keys(options)[0], 'carry_on', `order: ${Object.keys(options)}`);
  assert.match(options.carry_on, /^Carry on with the fight at the spawner 4 blocks off, with the iron sword: a blaze needs a sword, not a pickaxe; asked again in five minutes/);
  assert(options.fetch_stems, `offered: ${Object.keys(options)}`);
  assert.match(options.fetch_stems, /It leaves the spawner 4 blocks off, where the rods are, and they need a sword, which is carried\.$/);
  assert.doesNotMatch(options.fetch_stems, /Wood carried is sticks/);
  assert.match(JSON.stringify(state), /No pickaxe is carried; the rods need a sword, not a pickaxe, and an iron sword is carried\./);
  assert.doesNotMatch(JSON.stringify(state), /gets one first/);
});

test('going on without stems fetched for a pickaxe is going without the pickaxe, not the rods set aside', async () => {
  const { withoutOption } = require('../src/nether-gather');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => [] }, _errand: { key: 'fetch_stems', stems: 2, for: 'a pickaxe' } };
  const goal = { kind: 'win', rungTime: { phase: 'obtain_blaze_rods' } };
  const o = withoutOption(bot, goal, () => {}, { forItem: null, resource: 'warped_stem' });
  assert.equal(o.description, 'Go on without the stems and a pickaxe: the fetch ends here and is not offered again for 10 minutes; the obtain blaze rods goes on as it is, with no pickaxe.');
  await assert.rejects(o.run(), /Going on without the stems/);
  assert(require('../src/progress').isSetAside(goal, 'fetch_stems', 'nether'));
  assert.equal(require('../src/progress').isSetAside(goal, 'rung', 'obtain_blaze_rods'), false, 'the rods are not set aside');
  assert(goal.stemsWithout?.at);
});

test('a quiet scene (25581, 23:03:59Z: crossbow piglins 15 and 25 off, every way about 0 damage) holds its answer fifteen seconds; a piglin within eight or a hit ends it', async () => {
  const scenes = require('../src/stance-scene'), danger = require('../src/danger');
  const piglin = (id, d) => ({ entity: { id, name: 'piglin', heldItem: { name: 'crossbow' } }, distance: d, visible: true });
  const priced = { take_cover: { expects: { damage: 0 } }, seal: { expects: { damage: 0.1 } }, nook: { expects: { damage: 0 } }, keep_working: {} };
  const bot = { _recentHurtAt: 0 };
  const q = scenes.quietOf(bot, [piglin(1, 14.8), piglin(2, 25)], priced);
  assert.deepEqual(q.ids, [1, 2]);
  assert.match(q.says, /^Every way here is priced under 1 damage in the next fifteen seconds and no mob is within 8 blocks: whatever is chosen holds those fifteen seconds/);
  assert.equal(scenes.quietOf(bot, [piglin(1, 7)], priced), null, 'within eight');
  assert.equal(scenes.quietOf({ _recentHurtAt: Date.now() - 4000 }, [piglin(1, 14.8)], priced), null, 'hit four seconds ago');
  assert.equal(scenes.quietOf(bot, [piglin(1, 14.8)], { ...priced, fight: { expects: { damage: 1.2 } } }), null, 'a way priced over a point');
  // The stance step leaves them to the work for the fifteen seconds, beyond eight.
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const p1 = { id: 1, name: 'piglin', type: 'hostile', position: new Vec3(15.3, 64, 0.5), height: 1.95, isValid: true, heldItem: { name: 'crossbow' } };
  const sbot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 1: p1 }, health: 20, food: 20,
    inventory: { items: () => [], slots: {} }, world: { raycast: () => null }, blockAt: p => ({ name: p.y < 64 ? 'netherrack' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }) });
  const survival = new Survival(sbot, { navigate: async () => {} });
  let asked = 0;
  // The nook's walk found no route (23:04:08): it came to nothing, as most did.
  survival.stanceOptions = () => ({ nook: { description: 'nook', expects: { damage: 0, seconds: 15 }, run: async () => false }, seal: { description: 'in', expects: { damage: 0.1, seconds: 15 }, run: async () => true } });
  survival.decide = async () => { asked++; return { path: ['nook'] }; };
  await survival.stanceStep(new Task('t'), {}, () => {}, [{ entity: p1, distance: 14.8, visible: true }], false);
  assert.equal(asked, 1);
  assert.deepEqual(sbot._wavedOff.ids, [1]);
  assert.equal(sbot._wavedOff.beyond, 8);
  assert(sbot._wavedOff.until > Date.now() + 14000);
  // Left be: no threat while beyond eight and no hit; within eight, one again.
  assert.equal(sbot._stance, undefined, 'it came to nothing: no stance holds');
  sbot._recentHurtAt = 0;
  const leftBe = d => { p1.position = new Vec3(0.5 + d, 64, 0.5); return danger.immediateThreat(sbot); };
  assert.equal(leftBe(14.8) ?? null, null, 'beyond eight, left to the work');
  assert(leftBe(6), 'within eight: a threat again');
  sbot._recentHurtAt = Date.now();
  assert(leftBe(14.8), 'a hit: a threat again');
  sbot._recentHurtAt = 0; delete sbot._wavedOff;
  assert(leftBe(14.8), 'before note 700: the same piglin at 14.8 claimed the turn');
});

test('at the cage no fortress visit, approach or leg is asked: 25589 was asked fortress_approach two blocks from it and left the fortress (23:24:46Z)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = cageBot({ position: new Vec3(-203.5, 54, -150.5) });
  let asked = 0;
  const task = { check() {}, opportunityClient: { systemOne: async () => { asked++; return { answers: {} }; } } };
  const goal = rodsGoal({ step: { action: 'find_fortress' } });
  await findFortressStep(bot, task, goal, () => {}, { navigate: async () => { throw new Error('no walk here'); } });
  assert.equal(asked, 0, 'nothing asked');
  assert.equal(goal.step.action, 'at_spawner');
  assert.deepEqual(goal.step.target, { x: -204, y: 57, z: -150 });
});

test('the heal box says a blaze standing in its cells: no block goes in there, and it has the bot at arm\'s length (25589, 23:25:51Z)', () => {
  const T = require('../src/blaze-tactics');
  const floor = 76;
  const inv = [stack('netherrack', 13), stack('iron_sword')];
  const blazeAt = (id, p) => ({ id, name: 'blaze', type: 'hostile', position: p, height: 1.8, width: 0.6, isValid: true });
  const bot = { registry, health: 11, food: 20, game: { dimension: 'the_nether' }, entity: { position: new Vec3(-104.5, 77, 156.5), height: 1.8 }, inventory: { items: () => inv },
    blockAt: p => { const f = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); const solid = f.y <= floor; return { name: solid ? 'nether_bricks' : 'air', position: f, boundingBox: solid ? 'block' : 'empty' }; },
    entities: {}, world: { raycast: () => null }, findBlocks: () => [] };
  const far = [blazeAt(2, new Vec3(-99.5, 78, 160.5)), blazeAt(3, new Vec3(-110.5, 78, 150.5))];
  const clear = T.healSite(bot, far);
  assert(clear, 'a box where it stands');
  assert.equal(clear.inCells, undefined);
  // One blaze beside the bot, in a cell of the box to be.
  const beside = clear.build.find(c => c.y === 77) || clear.build[0];
  const inside = blazeAt(4, new Vec3(beside.x + 0.5, beside.y, beside.z + 0.5));
  const site = T.healSite(bot, [...far, inside]);
  assert.equal(site.inCells, 1);
});

test('defer says this cage\'s own record, not only an arena row from elsewhere (note 740, the coordinator\'s 25585: 16 blazes in sword reach, defer priced from "1 killed, 21 damage" with nothing said of 32 minutes of nothing at this cage)', async () => {
  const { huntObserved } = require('../src/mob-hunt');
  const { bot } = cageBot({ mobs: [['blaze', new Vec3(-205.5, 55, -148.5)]] });
  bot.oxygenLevel = 20;
  bot.pathfinder = { movements: { canDig: true, allow1by1towers: true, scafoldingBlocks: [1] }, setGoal: () => {}, getPathTo: () => ({ status: 'success', path: [] }) };
  bot.clearControlStates = () => {}; bot.lookAt = async () => {}; bot.activateItem = () => {}; bot.deactivateItem = () => {};
  bot.equip = async () => {}; bot.attack = () => {};
  const goal = rodsGoal();
  // Held at this cage 32 minutes already, nothing gained: cage-yield's own
  // record, seeded as it would be by that long a stay.
  goal.cageYield = { cage: { x: -204, y: 57, z: -150 }, since: Date.now() - 32 * 60000, lastAt: Date.now() - 1000,
    kills: 0, rods: 0, lost: 0, spent: 0, health: 20, yieldAt: Date.now() - 32 * 60000, lastKills: 0, lastRods: 0 };
  let asked = null;
  const client = { systemOne: async req => { asked = req.questions.branch_0.criteria; return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
  await huntObserved(bot, { check() {} }, goal, () => {}, { navigate: async () => {} }, client);
  assert(asked, 'asked');
  assert.match(asked.defer, /At this cage 32 minutes so far: 0 blazes killed, 0 rods, 0 health lost\./);
});

test('open_slit inside the spawner\'s own spawn range says a blaze can spawn already at the wall behind it (note 740)', () => {
  const ch = require('../src/cage-hold');
  const { bot } = cageBot({ mobs: [['blaze', new Vec3(-205.5, 55, -148.5)]] });
  const goal = rodsGoal({ step: { action: 'stalk_mob', entity: 'blaze' } });
  const fight = ch.cageFight(bot, goal);
  const dug = [];
  const close = ch.slitOption(bot, { check() {} }, goal, () => {}, { ...fight, off: 3 }, { dig: async (b, t, p) => { dug.push(`${p}`); } });
  assert.match(close.description, /It is inside the spawner's own spawn range \(up to four blocks across\): a blaze can spawn already at the wall behind the slit, not only come into the line dug through it\./);
  const far = ch.slitOption(bot, { check() {} }, goal, () => {}, { ...fight, off: 6 }, { dig: async () => {} });
  assert.doesNotMatch(far.description, /spawn range/);
});
