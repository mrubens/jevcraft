'use strict';
// Note 604: two creeper deaths in ten minutes, both after a retreat.
// mid-242-af-nether-3-fortress-1 (25586, 12:08:05 to 17): the way down dug
// its column to (-40, 14, -5), 3 blocks from a creeper on the cave floor it
// had not been told of; retreat was chosen twice, each told "passing none of
// them" with no word of the fuse, and the second dropped off the bridge to
// the floor 0.6 blocks from it, in its sight: it went off 3 blocks off, 6.9
// to none. mid-242-af-nether-2-fortress-2 (25583, 12:06:55): retreat with no
// way found yet, "tried before it moves, up to about 3 seconds standing
// still", while the creeper walked from 6 blocks to 2.8 and went off.
// The ground is the saved regions, read from copies (test/fixtures).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { Task } = require('../src/skills');
const { Survival, searchBudget } = require('../src/survival');
const { threats } = require('../src/danger');
const { creeperOnWay, timedWay, wayAgainstCreepers, creeperRunSays, RUN_PACE } = require('../src/creeper-run');
const { groundBot } = require('./fixtures/saved-ground');

const IRON = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
const WORN = require('../src/combat-estimate').armourOf(IRON);

// Open ground: stone at y 63 and air above, over a wide square.
function openGround({ walls = [] } = {}) {
  const rows = [], box = { x: [-30, 30], y: [62, 66], z: [-30, 30] };
  const wall = new Set(walls.map(p => `${p.x},${p.y},${p.z}`));
  for (let y = box.y[0]; y <= box.y[1]; y++) for (let z = box.z[0]; z <= box.z[1]; z++) {
    let r = '';
    for (let x = box.x[0]; x <= box.x[1]; x++) r += y <= 63 || wall.has(`${x},${y},${z}`) ? 'b' : 'a';
    rows.push(r);
  }
  return { box, palette: ['air', 'stone'], rows };
}

test('a lit creeper is outrun straight away, and goes off on a way that circles it at four blocks (the game\'s fuse, walked in time)', () => {
  const bot = groundBot(openGround(), { at: new Vec3(0.5, 64, 0.5) });
  const creeper = { name: 'creeper', position: new Vec3(-2, 64, 0.5), height: 1.7 };
  // Straight away along +x, a block a step.
  const away = Array.from({ length: 14 }, (_, i) => ({ x: i + 1, y: 64, z: 0 }));
  const run = creeperOnWay(bot, creeper, timedWay(bot.entity.position, away), { litFor: 0.2 });
  assert.equal(run.goesOff, false);
  assert.equal(run.why, 'seven');
  assert.ok(run.clearAt < 1.3, `past seven blocks ${run.clearAt} seconds in, before the 1.3 left of its fuse`);
  // Round it, four blocks off: never past seven, always in its sight.
  const round = Array.from({ length: 16 }, (_, i) => { const a = i / 16 * Math.PI * 2; return { x: Math.floor(-2 + 4 * Math.cos(a)), y: 64, z: Math.floor(4 * Math.sin(a)) }; });
  const circled = creeperOnWay(bot, creeper, timedWay(bot.entity.position, round), { litFor: 0.2 });
  assert.equal(circled.goesOff, true);
  assert.ok(circled.distance < 6, `goes off ${circled.distance} blocks from the bot`);
  assert.ok(circled.blast > 0);
});

test('within three blocks out of its sight a creeper stands unlit; the way that steps into its line lights it', () => {
  // A wall two high between them at x -1.
  const walls = [];
  for (let z = -3; z <= 3; z++) for (const y of [64, 65]) walls.push(new Vec3(-1, y, z));
  const bot = groundBot(openGround({ walls }), { at: new Vec3(0.5, 64, 0.5) });
  const creeper = { name: 'creeper', position: new Vec3(-1.5, 64, 0.5), height: 1.7 };
  const stay = creeperOnWay(bot, creeper, [{ at: bot.entity.position, t: 0 }, { at: bot.entity.position, t: 3 }]);
  assert.equal(stay.goesOff, false);
  assert.equal(stay.lights, null, 'out of its sight: its fuse never lights');
  // Round the wall's end at z 4, past it and back toward it.
  const round = [{ x: 0, y: 64, z: 1 }, { x: 0, y: 64, z: 2 }, { x: 0, y: 64, z: 3 }, { x: 0, y: 64, z: 4 }, { x: -1, y: 64, z: 4 }, { x: -2, y: 64, z: 4 }, { x: -2, y: 64, z: 3 }, { x: -2, y: 64, z: 2 }];
  const into = creeperOnWay(bot, creeper, timedWay(bot.entity.position, round));
  assert.equal(into.goesOff, true, 'stepped round the wall into its sight within three');
  assert.ok(into.lights > 0);
});

// The second run of mid-242-af-nether-3-fortress-1, as the flight has it:
// the bot on its bridge at (-34.75, 14, -3.11), the creeper directly below on
// the cave floor at (-35.1, 11, -3.5), the bridge in the line between them;
// then off the bridge's side to the floor at (-34.5, 11, -3.5), 0.6 from it,
// and east along the floor (the route the pathfinder held at 12:08:17.57).
const BRIDGE = require('./fixtures/creeper-bridge-25586.json');
const ON_BRIDGE = new Vec3(-34.75, 14, -3.11), BELOW = new Vec3(-35.1, 11, -3.5);
const RAN = [[-34.5, 11, -3.5], [-33.5, 11, -3.5], [-32.5, 11, -3.5], [-31.5, 11, -3.5], [-30.5, 11, -3.5], [-29.5, 11, -4.5], [-28.5, 11, -5.5], [-27.5, 12, -5.5], [-26.5, 12, -6.5], [-25.5, 12, -6.5], [-24.5, 13, -6.5], [-23.5, 13, -6.5], [-22.5, 13, -7.5], [-21.5, 13, -7.5]].map(([x, y, z]) => ({ x, y, z }));
function bridgeBot() {
  return groundBot(BRIDGE, { at: ON_BRIDGE, health: 6.94, food: 10, held: 'stone_sword', worn: IRON,
    items: [['stone_sword', 1], ['cobblestone', 64], ['iron_pickaxe', 1]],
    mobs: [{ id: 4823, name: 'creeper', at: BELOW }, { id: 4535, name: 'skeleton', at: new Vec3(-45.2, 11, -4.5), height: 1.99 }, { id: 4412, name: 'skeleton', at: new Vec3(-35.7, 11, -14.7), height: 1.99 }] });
}

test('the recorded run off the bridge: out of its sight up there, it lights as the bot drops into its line beside it, and goes off with the bot in the blast (12:08:15.968)', () => {
  const bot = bridgeBot();
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const creepers = survival.creepersOfRun(threats(bot, 24));
  assert.deepEqual(creepers.map(c => c.entity.id), [4823]);
  const stay = creeperOnWay(bot, creepers[0].entity, [{ at: ON_BRIDGE, t: 0 }, { at: ON_BRIDGE, t: 3 }]);
  assert.equal(stay.lights, null, 'on the bridge over it the bridge is in its line: 3 blocks off, it does not light');
  const ran = wayAgainstCreepers(bot, RAN, creepers);
  assert.equal(ran.worst.goesOff, true);
  assert.ok(ran.worst.lights < 1, `lit ${ran.worst.lights} seconds in, on the way down`);
  assert.ok(ran.worst.distance < 6 && ran.worst.blast > 0, `goes off ${ran.worst.distance} blocks from the bot`);
  assert.equal(ran.slow.goesOff, true);
  assert.ok(ran.slow.distance < ran.worst.distance, 'nearer at the slower pace');
  const said = creeperRunSays(ran, { worn: WORN, health: 6.94 });
  assert.match(said.says, /^ On this way, at the pace the bot's runs keep in their first seconds \(about 3\.9 blocks a second along the way on the median; one run in four is slower than 3\.2\), the creeper 3 blocks off lights about [\d.]+ seconds in, and goes off about [\d.]+ seconds in with the bot about [\d.]+ blocks from it and in its sight, about \d+ after the armour worn/);
  assert.match(said.says, /At the slower quarter's pace \(3\.2 blocks a second\) it goes off with the bot about [\d.]+ blocks from it/);
  assert.match(said.says, /past 7 or out of its sight it burns back down/);
  assert.ok(said.damage > 0);
});

test('the retreat asked on the bridge takes a way the creeper does not go off on over the recorded one, and says so; with only the recorded one, its blast is said and priced', async () => {
  const bot = bridgeBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const danger = threats(bot, 24);
  // The recorded way's end first, as the scout had it, by a way off the
  // bridge's side that keeps the 2 blocks from it the old check asked (the
  // recorded drop landed 0.6 from it, where the pathfinder's own way went
  // once the run had begun); then a footing the pathfinder finds its own
  // way to on the saved ground.
  const RECORDED = new Vec3(-22, 13, -8), OTHER = new Vec3(-27, 16, 7), WIDE = RAN.slice(2);
  const search = bot.pathfinder.getPathFromTo;
  bot.pathfinder.getPathFromTo = function * (m, start, goal, o) {
    if (goal.x === RECORDED.x && goal.z === RECORDED.z) { yield { result: { status: 'success', path: WIDE } }; return; }
    yield * search.call(this, m, start, goal, o);
  };
  const footings = only => () => ({ about: danger.map(t => t.entity), footing: [], far: [], near: only ? [RECORDED] : [RECORDED, OTHER], heavy: false, persistent: true, radius: 40 });
  // Walked in time, the recorded way is not the way: the other is.
  survival.escapeFootings = footings(false);
  const scout = await survival.scoutRetreat(new Task('x'), danger, { budgetMs: 5000 });
  assert.deepEqual(scout.destination, { x: -27, y: 16, z: 7 });
  assert.equal(scout.creeper.worst.goesOff, false);
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
  assert.match(options.retreat.description, /A way is found: \d+ blocks to footing/);
  assert.match(options.retreat.description, /On this way, at the pace the bot's runs keep in their first seconds \(.*?\), the creeper 3 blocks off is [\d.]+ blocks off at its nearest, or out of its sight while within 3, and does not light\./);
  // The first run, asked at 12:08:10.891 (the bot at (-39.42, 14, -4.59) on
  // the bridge, the creeper straight below at (-39.6, 11, -4)): east along
  // the bridge, then the way the pathfinder held at 12:08:14.6, down to the
  // floor and back west past where the creeper had stood, about 4 blocks
  // from it, "passing none of them" by the old check. The only way: taken,
  // and its blast said and priced.
  const first = groundBot(BRIDGE, { at: new Vec3(-39.42, 14, -4.59), health: 8.86, food: 10, held: 'stone_sword', worn: IRON,
    items: [['stone_sword', 1], ['cobblestone', 64], ['iron_pickaxe', 1]],
    mobs: [{ id: 4823, name: 'creeper', at: new Vec3(-39.6, 11, -4) }, { id: 4535, name: 'skeleton', at: new Vec3(-39.5, 11, -4.7), height: 1.99 }, { id: 4412, name: 'skeleton', at: new Vec3(-33.8, 11, -13.3), height: 1.99 }] });
  const FIRST = [[-39, 14, -5], [-38, 14, -5], [-37, 14, -5], [-36, 14, -4], [-35, 14, -4], [-34, 11, -4], [-34, 11, -3], [-35, 11, -2], [-36, 11, -1], [-37, 11, 0], [-38, 11, 0], [-39, 11, 0], [-40, 11, 1], [-41, 11, 1], [-42, 12, 1], [-43, 12, 2], [-44, 12, 2], [-44, 13, 3], [-45, 13, 4], [-46, 13, 4], [-47, 14, 4]].map(([x, y, z]) => ({ x, y, z }));
  first.pathfinder.getPathFromTo = function * () { yield { result: { status: 'success', path: FIRST } }; };
  const s2 = new Survival(first, { navigate: async () => {} }, { state: { shelters: [] } });
  const d2 = threats(first, 24);
  s2.escapeFootings = () => ({ about: d2.map(t => t.entity), footing: [], far: [], near: [new Vec3(-47, 14, 4)], heavy: false, persistent: true, radius: 40 });
  await s2.scoutRetreat(new Task('x'), d2, { budgetMs: 5000 });
  assert.deepEqual(s2.state.retreatScout.destination, { x: -47, y: 14, z: 4 });
  const retreat = s2.stanceOptions(new Task('x'), {}, () => {}, d2, false).retreat;
  assert.match(retreat.description, /the creeper 3 blocks off lights about [\d.]+ seconds in, and goes off about [\d.]+ seconds in with the bot about [\d.]+ blocks from it and in its sight, about \d+ after the armour worn/);
  const blast = creeperRunSays(s2.state.retreatScout.creeper, { worn: WORN, health: 8.86 }).damage;
  assert.ok(blast > 0);
  assert.ok(retreat.expects.damage >= blast, `priced ${retreat.expects.damage}, the blast ${blast} in it`);
});

test('the route search and the run are steered off the cells round a creeper, and the steer is put back after (the saved bridge)', async () => {
  const bot = bridgeBot();
  const moves = [];
  const survival = new Survival(bot, { navigate: async (b, t, goal) => { moves.push({ goal: [goal.x, goal.y, goal.z], steered: (b.pathfinder.movements.exclusionAreasStep || []).length }); } }, { state: { shelters: [] } });
  const danger = threats(bot, 24);
  const before = bot.pathfinder.movements.exclusionAreasStep.length;
  const creepers = survival.creepersOfRun(danger);
  // The steer prices a step under the bridge beside the creeper far above
  // one at the bridge's end.
  const unsteer = survival.steerFromCreepers(bot.pathfinder.movements, creepers);
  const steer = bot.pathfinder.movements.exclusionAreasStep.at(-1);
  assert.ok(steer({ position: new Vec3(-35, 11, -4) }) > 10);
  assert.equal(steer({ position: new Vec3(-26, 14, -4) }), 0);
  unsteer();
  assert.equal(bot.pathfinder.movements.exclusionAreasStep.length, before);
  // The same search from the bridge to the same footing, steered and not:
  // steered, the way does not bring it to light.
  const m = bot.pathfinder.movements;
  Object.assign(m, { canDig: false, allow1by1towers: false, allowSprinting: true });
  const to = new goals.GoalBlock(-27, 16, 7);
  const plain = bot.pathfinder.getPathTo(m, to, 3000);
  const un = survival.steerFromCreepers(m, creepers), steered = bot.pathfinder.getPathTo(m, to, 3000); un();
  assert.equal(steered.status, 'success');
  const near = path => Math.min(...path.map(p => BELOW.distanceTo(new Vec3(p.x + 0.5, p.y, p.z + 0.5))));
  assert.ok(near(steered.path) >= near(plain.path), `steered nearest ${near(steered.path).toFixed(1)}, plain ${near(plain.path).toFixed(1)}`);
  assert.equal(wayAgainstCreepers(bot, steered.path, creepers).worst.goesOff, false);
  // The run: navigated with the steer on, put back after.
  await survival.runAway(new Task('x'), {}, () => {}, danger);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].steered, before + 1);
  assert.equal(bot.pathfinder.movements.exclusionAreasStep.length, before);
});

// mid-242-af-nether-2-fortress-2 at 12:06:55.0: 6.5 health, the creeper 7.1
// blocks off on the cave floor coming on, "no way found yet: 2 of 24 spots
// tried"; the run stood searching while it walked in, 12:06:55.3 to 57.9.
// No armour was worn.
const CAVE = require('./fixtures/creeper-cave-25583.json');
function caveBot() {
  return groundBot(CAVE, { at: new Vec3(-199.06, 37, 64.48), health: 6.5, food: 17, held: 'iron_sword', worn: [],
    items: [['iron_sword', 1], ['cobblestone', 64], ['rotten_flesh', 3]], mobs: [{ id: 4286, name: 'creeper', at: new Vec3(-203.8, 36, 69.7) }] });
}

test('a run whose way is not found yet stands still only until the creeper coming on would be within three, and says so (12:06:55)', async () => {
  const bot = caveBot();
  const survival = new Survival(bot, { navigate: async () => { throw new Error('no way was found'); } }, { state: { shelters: [] } });
  const danger = threats(bot, 24);
  const creepers = survival.creepersOfRun(danger);
  const budget = searchBudget(bot, creepers);
  assert.ok(budget >= 1000 && budget <= 1500, `stands at most ${budget} ms: 7.1 blocks off, three at 2.7 a second, less a quarter second`);
  // Every search fails, each 150 ms by the clock: the run gives up by the
  // creeper's arrival, not after all 24.
  const real = Date.now; let now = real();
  Date.now = () => now;
  let searched = 0;
  bot.pathfinder.getPathFromTo = function * () { searched++; now += 150; yield { result: { status: 'noPath', path: [] } }; };
  const spots = Array.from({ length: 24 }, (_, i) => new Vec3(-180 + i, 37, 60));
  survival.escapeFootings = () => ({ about: danger.map(t => t.entity), footing: spots, far: spots.slice(0, 12), near: spots.slice(12), heavy: false, persistent: true, radius: 40 });
  const started = now;
  try { assert.equal(await survival.runAway(new Task('x'), {}, () => {}, danger), false); } finally { Date.now = real; }
  assert.ok(now - started <= budget + 150, `stood ${now - started} ms`);
  assert.ok(searched < 24, `${searched} searched`);
  // Said on the option, the scout having tried two.
  survival.state.retreatScout = { at: Date.now(), feet: `${bot.entity.position.floored()}`, radius: 40, spots: 111, tried: 2, candidates: 24 };
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
  assert.match(options.retreat.description, /No way found yet: 2 of 24 spots further from every mob tried and none has a route passing none of them; the rest are tried before it moves, for at most about 1\.\d seconds standing still, until the creeper would be within three blocks, and the run then fails and this is asked again unless one is found\./);
});

test('standing still a search\'s seconds by a creeper coming on: when it lights, and the blast where it goes off first (the standing figures)', () => {
  const bot = caveBot();
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const creepers = survival.creepersOfRun(threats(bot, 24));
  const { standingAgainstCreepers } = require('../src/creeper-run');
  // The old search's three seconds: it walks in, lights and goes off.
  const three = standingAgainstCreepers(bot, creepers, 3.3);
  assert.equal(three.worst.goesOff, true);
  assert.ok(three.worst.distance <= 3, `goes off ${three.worst.distance} blocks off`);
  const said = creeperRunSays(three, { health: 6.5, standing: true });
  assert.match(said.says, /^ Standing still meanwhile, the creeper 7 blocks off lights about [\d.]+ seconds from now, and goes off about [\d.]+ seconds from now with the bot about [\d.]+ blocks from it and in its sight, about \d+ after the armour worn, more than the bot has\.$/);
  assert.ok(said.damage > 6.5);
});

// The way down of 12:08:05: dig the column to (-40, 14, -5); the creeper on
// the cave floor at (-38.7, 11, -4.1), not in the question.
test('the way down says a creeper by where it ends: 3 blocks from it, and whether it sees the bot there (12:08:05)', () => {
  const { creepersAtEnd } = require('../src/way-down');
  const bot = groundBot(BRIDGE, { at: new Vec3(-39.38, 20, -4.63), health: 8.86, worn: IRON, mobs: [{ id: 4823, name: 'creeper', at: new Vec3(-38.7, 11, -4.1) }] });
  const says = creepersAtEnd(bot, { kind: 'dig_down', from: { x: -40, y: 20, z: -5 }, endsAt: { x: -40, y: 14, z: -5 } });
  // The bridge's own block is in its line there: it stood, and lit only
  // when the run brought the bot down into its sight.
  assert.match(says, /^ It ends 3\.1 blocks from a creeper at \(-39, 11, -5\), out of its sight there as the ground stands now \(a block in the line from its eyes\): at its walk it is within three in about 0\.1 seconds\. A creeper within 3 blocks of the bot lights if it sees the bot and goes off 1\.5 seconds later unless the bot is more than 7 blocks from it or out of its sight by then; past 3 it walks after the bot at about 2\.7 blocks a second; a blast 6 blocks off or more does nothing, three blocks off about 12 after the armour worn\.$/);
  assert.equal(creepersAtEnd(bot, { kind: 'dig_down', endsAt: { x: -40, y: 30, z: -5 } }), '', 'none within ten of an end far above it');
});

test('live, the way down is asked with the creeper by where the way ends', async () => {
  const { navigate } = require('../src/skills');
  // A dirt tower 65 to 71 over stone at 64, the bot on top at 72; a creeper
  // on the ground five blocks east of the column.
  const dug = new Set();
  const name = p => dug.has(`${p}`) ? 'air' : p.y <= 64 ? 'stone' : p.x === 0 && p.z === 0 && p.y < 72 ? 'dirt' : 'air';
  const creeper = { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(5.5, 65, 0.5), height: 1.7, width: 0.6, isValid: true };
  const bot = { entity: { position: new Vec3(0.5, 72, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, health: 20, food: 20, entities: { 9: creeper },
    game: { dimension: 'overworld', gameMode: 'survival' }, registry: { itemsByName: {} }, time: { timeOfDay: 6000 },
    inventory: { items: () => [], slots: {} }, clearControlStates() {}, chat() {}, emit() {}, setControlState() {}, getControlState() { return false; },
    blockAt: p => { const f = p.floored ? p.floored() : p, n = name(f), full = n !== 'air'; return { position: f, name: n, diggable: true, boundingBox: full ? 'block' : 'empty', shapes: full ? [[0, 0, 0, 1, 1, 1]] : [], digTime: () => 1 }; },
    dig: async b => { dug.add(`${b.position}`); let y = b.position.y; while (name(new Vec3(0, y - 1, 0)) === 'air' && y > 65) y--; bot.entity.position.y = y; } };
  bot.pathfinder = { movements: { allow1by1towers: true, scafoldingBlocks: [1] }, setGoal() {}, goto: async goal => { bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5); } };
  const asked = [];
  const task = new Task('test', 'test');
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'dig_down', confidence: 0.9 } } }; } };
  await navigate(bot, task, new goals.GoalBlock(40, 65, 0));
  assert.equal(asked.length, 1);
  assert.match(JSON.stringify(asked[0].dig_down), /It ends [\d.]+ blocks from a creeper at \(5, 65, 0\), in its sight there: at its walk it is within three in about [\d.]+ seconds\./);
});

test('on the bridge over the creeper, out of its sight, staying behind the bridge is offered (12:08:10.891)', () => {
  const bot = groundBot(BRIDGE, { at: new Vec3(-39.42, 14, -4.59), health: 8.86, food: 10, held: 'stone_sword', worn: IRON,
    items: [['stone_sword', 1], ['cobblestone', 64], ['iron_pickaxe', 1]],
    mobs: [{ id: 4823, name: 'creeper', at: new Vec3(-39.6, 11, -4) }, { id: 4535, name: 'skeleton', at: new Vec3(-39.5, 11, -4.7), height: 1.99 }, { id: 4412, name: 'skeleton', at: new Vec3(-33.8, 11, -13.3), height: 1.99 }] });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  const stay = survival.stanceOptions(new Task('x'), {}, () => {}, threats(bot, 24), false).block_creeper;
  assert.ok(stay, 'offered');
  assert.match(stay.description, /^Stay behind the netherrack at \(-40, 13, -5\), in the line from the eyes of the creeper \(3\.1 blocks off\) to the bot's\./);
  assert.match(stay.description, /within 3 blocks of the bot the creeper stands where it is, lit or not, and out of its sight it does not light/);
  assert.equal(stay.expects.damage, 0);
});

test('a creeper 7.1 blocks off walking in: the block in its line is offered, and the meal says its fuse when it is done (12:06:55)', () => {
  const bot = caveBot();
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, threats(bot, 24), false);
  assert.match(options.block_creeper?.description || '', /^Put \d blocks?(, two high,)? in the line from the eyes of the creeper \(7\.1 blocks off\) to the bot's/);
  assert.match(options.block_creeper.description, /The line is cut about [\d.]+ seconds before it would go off\./);
  assert.match(options.eat.description, /While it eats, the creeper 7 blocks off, coming on at about 2\.7 blocks a second, is within three about 1\.\d seconds in and lights there: done eating, about 1\.\d seconds of its fuse are left, and with the bot still there it goes off [\d.]+ blocks from it, about \d+ after the armour worn, more than the bot has, unless the bot is more than 7 blocks from it or out of its sight by then\./);
});
