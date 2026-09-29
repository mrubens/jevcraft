'use strict';
// The four tactics of note 606 at a blaze spawner, each a stance Jev is
// offered with the game's rules it rests on: the box with a window, the
// spawner lit, the corner, and away to heal.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const T = require('../src/blaze-tactics');
// The box at the cage and the spawner lit are offered only where they are
// measured (note 606); these tests are that.
process.env.BLAZE_TACTICS_ALL = '1';
const stand = require('../src/blaze-stand');

// A fortress floor (y 63 and under) along a brick wall at z <= -5, as the
// arena's, a spawner at `spawner`; `extra` solid cells, `blocks` placed.
function floorWorld({ spawner = new Vec3(0, 64, 0), solid = p => p.y <= 63 || p.z <= -5, items = null, health = 20, food = 20, at = new Vec3(0.5, 64, 9.5) } = {}) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const placed = new Map();
  const blockAt = p => {
    const f = p.floored(), key = `${f}`;
    const name = placed.get(key) || (spawner && f.equals(spawner) ? 'spawner' : solid(f) ? 'nether_bricks' : 'air');
    const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f;
    return b;
  };
  const stock = items || [['iron_sword', 1], ['stone_pickaxe', 1], ['cobblestone', 24], ['coal', 16], ['stick', 8], ['cooked_beef', 6]];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food, entities: {},
    entity: { position: at.clone(), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => stock.filter(([, n]) => n > 0).map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} }, placed, stock });
  bot.findBlocks = ({ matching, maxDistance = 16, count = 1, point }) => {
    const ids = [].concat(matching), c = point || bot.entity.position, out = [];
    for (let x = -16; x <= 16; x++) for (let y = -4; y <= 4; y++) for (let z = -16; z <= 16; z++) {
      const p = c.floored().offset(x, y, z);
      if (p.distanceTo(c) <= maxDistance && ids.includes(blockAt(p).type)) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(c) - b.distanceTo(c)).slice(0, count);
  };
  return bot;
}
const blazeAt = (bot, id, x, y, z) => { const e = { id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } }; bot.entities[id] = e; return e; };
const near = bot => require('../src/danger').threats(bot, 24);

test('a blaze spawner\'s tries, as the 26.1.2 jar makes them: offsets weighted by the triangle (r - r) * 4 + 0.5, the middle far more often than the edge', () => {
  let sum = 0;
  for (let k = -4; k <= 4; k++) sum += T.tryWeight(k);
  assert(Math.abs(sum - 1) < 1e-9, 'every try lands within four');
  assert(Math.abs(T.tryWeight(0) - 0.234375) < 1e-9);
  assert(Math.abs(T.tryWeight(4) - 0.0078125) < 1e-9, 'the edge about one in a hundred and twenty-eight');
  assert.equal(T.tryWeight(2), T.tryWeight(-2));
});

test('light 12 or more stops a blaze spawner, spread a level a step through open cells and not through brick: a torch lights the open cells two steps off', () => {
  const bot = floorWorld();
  assert.equal(T.LIT, 12);
  const torch = new Vec3(2, 64, 2);
  const field = T.lightField(bot, [{ position: torch, emission: 14 }], { box: [torch.offset(-4, -4, -4), torch.offset(4, 4, 4)] });
  assert.equal(field.get(`${torch.offset(2, 0, 0)}`), 12, 'two steps: lit');
  assert.equal(field.get(`${torch.offset(2, 1, 0)}`), 11, 'three steps: a blaze can spawn there');
  assert.equal(field.get(`${torch.offset(0, -1, 0)}`), undefined, 'none into the brick');
});

test('the spawner on an open floor: every open cell within four of its cage, one below to one above, lit by a plan of torches, and the option says the rule and that a dark cell keeps it spawning at the same pace', () => {
  const bot = floorWorld({ at: new Vec3(0.5, 64, 6.5) });
  const cells = T.spawnCells(bot, new Vec3(0, 64, 0));
  assert.equal(cells.length, 161, 'the floor\'s two layers over nine by nine, less the cage');
  const plan = T.lightPlan(bot, new Vec3(0, 64, 0));
  assert.equal(plan.dark.length, 0, 'every cell lit');
  assert(plan.torches.length >= 15 && plan.torches.length <= 26, `${plan.torches.length} torches`);
  blazeAt(bot, 1, 3.5, 65, 1.5); blazeAt(bot, 2, -2.5, 65, -1.5);
  const o = stand.blazeStands(bot, near(bot)).light_spawner;
  assert(o, 'offered with the coal and sticks to make them');
  assert.match(o.description, new RegExp(`^Stop the spawner with light: ${plan.torches.length} torches on and round its cage \\(0 carried and ${plan.torches.length} more made from the coal and sticks carried, four a pair\\)`));
  assert.match(o.description, /tries fail where the light is 12 or more/);
  assert.match(o.description, /a round in which every try fails is tried again the next tick: every open cell within four blocks of the cage, from one below it to one above, has to be lit, or the blazes come in the cells left dark at the same pace/);
  assert.match(o.description, /makes them again once they are taken down/);
  // Without coal or torches enough, it is not a way that stops the spawner.
  const poor = floorWorld({ at: new Vec3(0.5, 64, 6.5), items: [['iron_sword', 1], ['cobblestone', 24], ['coal', 2], ['stick', 2]] });
  blazeAt(poor, 1, 3.5, 65, 1.5);
  assert.equal(stand.blazeStands(poor, near(poor)).light_spawner, undefined);
});

test('the box: walled at feet and head, the window at head height toward the spawner, and a block on the back wall first for the roof to hang on (it meets the head row only edge to edge)', () => {
  const bot = floorWorld();
  const plan = T.boxPlan(bot, new Vec3(0, 64, 3), new Vec3(0.5, 64.5, 0.5));
  assert.equal(`${plan.window}`, '(0, 65, 2)', 'toward the cage');
  const roof = plan.walls.at(-1), holder = plan.walls.at(-2);
  assert.equal(`${roof}`, '(0, 66, 3)');
  assert.equal(`${holder}`, '(0, 66, 4)', 'over the back wall');
  assert(plan.walls.findIndex(c => c.equals(new Vec3(0, 65, 4))) < plan.walls.indexOf(holder), 'the back wall before the block on it');
  assert.equal(plan.walls.length, 9, 'four at the feet, three at the head, the holder and the roof');
  assert(!plan.walls.some(c => c.equals(plan.window)));
});

test('offered at the spawner, two to four and a half from its cage, and where the bot stands, each said with what comes to a window and what does not', () => {
  const bot = floorWorld();
  blazeAt(bot, 1, 3.5, 65, -1.5); blazeAt(bot, 2, -3.5, 65.5, 1.5);
  const stands = stand.blazeStands(bot, near(bot));
  const at = stands.box_at_spawner, here = stands.box_here;
  assert(at && here);
  const off = Math.hypot(at.site.cell.x + 0.5 - 0.5, at.site.cell.z + 0.5 - 0.5);
  assert(off >= 2 && off <= 4.5, `${off} from the cage`);
  assert.equal(`${here.site.cell}`, '(0, 64, 9)', 'where the bot stands');
  assert.match(at.description, /wall it in at feet and head on all four sides and roof it \(9 blocks to place of the 24 carried\)/);
  assert.match(at.description, /a blaze that sees the bot and is more than two blocks off hovers where it is and shoots \(the game's blaze does not come to a window\); one within two that sees in flies at it and swings, into the sword through the window/);
  assert.match(at.description, /Within four of the cage the spawner puts its blazes beside the box/);
  assert.match(here.description, /The spawner puts its blazes within four of its cage, not beside this box/);
  assert.match(here.description, /Food can be eaten in it/);
  // Too few blocks to wall it: not offered.
  const bare = floorWorld({ items: [['iron_sword', 1], ['cobblestone', 5]] });
  blazeAt(bare, 1, 3.5, 65, -1.5);
  const none = stand.blazeStands(bare, near(bare));
  assert.equal(none.box_at_spawner, undefined); assert.equal(none.box_here, undefined);
});

test('building the box: a cell a blaze is in holds its block out and is tried again once it has gone; the box is whole after', async () => {
  const bot = floorWorld({ at: new Vec3(0.5, 64, 9.5) });
  const site = T.boxSite(bot, { from: new Vec3(0.5, 64.5, 0.5) });
  const inCell = site.walls[0];
  const blaze = blazeAt(bot, 7, inCell.x + 0.5, inCell.y, inCell.z + 0.5);
  const work = require('../src/work');
  const { place, occupant } = work;
  const tries = [];
  // The blaze moves off once three other cells are walled.
  work.place = async (b, t, p, material) => {
    tries.push(`${p}`);
    if (occupant(b, p)) throw new Error('Placement obstructed');
    bot.placed.set(`${p}`, material);
    if (bot.placed.size === 3) { delete bot.entities[7]; blaze.isValid = false; }
  };
  const { Task } = require('../src/skills');
  Object.assign(bot, { lookAt: async () => {}, clearControlStates() {}, activateItem() {}, deactivateItem() {}, attack() {}, setControlState() {}, equip: async () => {} });
  try { await T.buildBox(bot, new Task('x'), {}, null, site, {}); }
  finally { work.place = place; }
  assert(T.boxWhole(bot, site), 'every wall in');
  assert.notEqual(tries[0], `${inCell}`, 'passed over while the blaze was in it');
  assert(tries.includes(`${inCell}`), 'the cell the blaze was in is walled once it has gone');
  assert.equal(bot.placed.has(`${site.window}`), false, 'the window left open');
});

test('the hold ends in a whole box with the shield up and facing the window: the next question takes seconds, and volleys come through it meanwhile', async () => {
  const bot = floorWorld({ at: new Vec3(0.5, 64, 9.5) });
  const site = T.boxSite(bot, { from: new Vec3(0.5, 64.5, 0.5) });
  for (const c of site.walls) bot.placed.set(`${c}`, 'cobblestone');
  const raised = [];
  let looked = null;
  Object.assign(bot, { lookAt: async p => { looked = p; }, activateItem: hand => raised.push(hand), deactivateItem() { raised.push('down'); }, equip: async () => {}, clearControlStates() {} });
  const { Task } = require('../src/skills');
  const stats = {};
  await T.holdBox(bot, new Task('x'), {}, null, site, { seconds: 0.3, stats });
  assert.equal(raised.at(-1), true, 'the off hand raised last');
  assert.equal(bot._shieldRaised, true);
  assert.equal(`${looked}`, `${site.window.offset(0.5, 0.5, 0.5)}`);
  // Out of the box, it is lowered.
  bot._shieldRaised = true; bot.entity.position = new Vec3(3.5, 64, 12.5);
  await T.holdBox(bot, new Task('x'), {}, null, site, { seconds: 0.1 }).catch(() => {});
  assert.equal(bot._shieldRaised, false);
});

test('in the box the shield meets a volley facing the window, not the blaze it comes from: every shot comes through the window (mid-242-bc, 25581, 18:01:44, note 623)', async () => {
  // Six blazes in line with the window, spread over some eighty degrees;
  // turned to the one glowing, 41 degrees west of the window, the shield
  // left those east of it 72 to 78 degrees off, and two fireballs came in.
  const bot = floorWorld({ at: new Vec3(0.5, 64, 9.5) });
  const site = T.boxSite(bot, { from: new Vec3(0.5, 64.5, 0.5) });
  for (const c of site.walls) bot.placed.set(`${c}`, 'cobblestone');
  const glowing = blazeAt(bot, 9, 4.5, 65.5, 5.5);
  glowing.metadata[16] = 1;
  const looks = [];
  Object.assign(bot, { lookAt: async p => { looks.push(`${p}`); }, activateItem() {}, deactivateItem() {}, equip: async () => {}, clearControlStates() {}, setControlState() {}, attack() {} });
  stand.volleyWatch(bot);
  bot.emit('entityUpdate', glowing);
  setTimeout(() => { glowing.metadata[16] = 0; bot.emit('entityUpdate', glowing); }, 150);
  const { Task } = require('../src/skills');
  await T.holdBox(bot, new Task('x'), {}, null, site, { seconds: 0.3 }).catch(() => {});
  const face = `${site.window.offset(0.5, 0.5, 0.5)}`;
  assert(looks.length > 3, `the volley was met: ${looks.length} looks`);
  assert.deepEqual([...new Set(looks)], [face], 'faced the window throughout');
});

test('the corner: behind rock a blaze has no line past, the cell beside it in their line; with no rock near, a corner of two blocks built where the bot stands; said with what a blaze out of sight does', () => {
  // A pillar of brick two wide at x 2..3, z 0, y 64..65, the blaze east.
  const pillar = p => p.y <= 63 || (p.y <= 65 && p.z === 0 && (p.x === 2 || p.x === 3));
  const bot = floorWorld({ spawner: null, solid: pillar, at: new Vec3(0.5, 64, 0.5) });
  const b = blazeAt(bot, 1, 9.5, 64.5, 0.5);
  const natural = T.cornerSite(bot, [b]);
  assert(natural && !natural.build, 'the rock round the pillar');
  assert.equal(T.seeing(bot, [b], natural.cell).length, 0);
  assert.equal(T.seeing(bot, [b], natural.edge).length, 1);
  const open = floorWorld({ spawner: null, solid: p => p.y <= 63, at: new Vec3(0.5, 64, 0.5) });
  const b2 = blazeAt(open, 1, 9.5, 64.5, 0.5);
  const built = T.cornerSite(open, [b2]);
  assert(built?.build?.length === 4, 'two wide and two high');
  const o = stand.blazeStands(open, near(open)).corner_ambush;
  assert.match(o.description, /^No rock to go round within ten blocks of walking: make a corner where the bot stands/);
  assert.match(o.description, /a blaze that loses sight of the bot flies toward it for a quarter of a second and then hovers where it is; it gives the bot up after three seconds unseen and wanders after that, and comes round the corner only by wandering/);
});

test('away to heal: offered hurt with food, the walk out of every line and the healing\'s pace said; not at full health', () => {
  const pillar = p => p.y <= 63 || (p.y <= 65 && p.z === 0 && p.x >= 2 && p.x <= 4);
  const bot = floorWorld({ spawner: null, solid: pillar, at: new Vec3(6.5, 64, 0.5), health: 9, food: 17 });
  blazeAt(bot, 1, 12.5, 64.5, 0.5);
  const o = stand.blazeStands(bot, near(bot)).leave_and_heal;
  assert(o, 'offered');
  assert.match(o.description, /^Go out of their sight to heal and come back: walk \d+ blocks? \(about [\d.]+ seconds in their fire, about [\d.]+ damage\) to \(\d, 64, 0\), where none of the 1 blaze about has a line to the bot/);
  assert.match(o.description, /eat the cooked beef \(about 1\.6 seconds\) and stay until the health is full: at hunger 20 with saturation a point comes back each half second, at 18 or 19 one each four seconds/);
  const full = floorWorld({ spawner: null, solid: pillar, at: new Vec3(6.5, 64, 0.5) });
  blazeAt(full, 1, 12.5, 64.5, 0.5);
  assert.equal(stand.blazeStands(full, near(full)).leave_and_heal, undefined);
});

// Note 638: the option was hidden at hunger under 18 with nothing to eat (`hp < 20 && about.length && (food || hunger >= 18)`),
// the one state where going out of every blaze's sight is the whole of it: no health comes back, but the fire and the
// volleys end. It is offered, with what it does said as it is.
const healPillar = p => p.y <= 63 || (p.y <= 65 && p.z === 0 && p.x >= 2 && p.x <= 4);
test('away to heal at hunger 14 with nothing to eat: offered, and says nothing comes back and that healing there would take never', () => {
  const bot = floorWorld({ spawner: null, solid: healPillar, at: new Vec3(6.5, 64, 0.5), health: 5, food: 14, items: [['iron_sword', 1], ['stone_pickaxe', 1], ['cobblestone', 24]] });
  blazeAt(bot, 1, 12.5, 64.5, 0.5);
  const o = stand.blazeStands(bot, near(bot)).leave_and_heal;
  assert(o, 'offered at hunger 14 with nothing to eat');
  assert.match(o.description, /^Go out of their sight \(no health comes back at this hunger\): walk \d+ blocks? /);
  assert.match(o.description, /stay only until the fire on the body is out: at hunger 14, under eighteen, no health comes back \(nothing carried is food\), so healing there would take never/);
  assert.match(o.description, /It gets the bot out of the fire and the volleys and no health back: it stays at about [\d.]+ health, and each point lost from here on stays lost until the bot has eaten to eighteen/);
  assert.match(o.description, /the fight after is asked again at the health it has now/);
  assert.doesNotMatch(o.description, /to 20 takes about|seconds to full|until the health is full/, 'no seconds to full where none comes back');
  assert.equal(o.expects.heals, 0);
  assert(o.expects.seconds < 10, `only the walk is counted: ${o.expects.seconds}`);
});

test('away to heal at hunger 14 with one cooked chicken: eating brings hunger to 20, so it heals; with a raw potato it does not', () => {
  const fed = floorWorld({ spawner: null, solid: healPillar, at: new Vec3(6.5, 64, 0.5), health: 9, food: 14, items: [['iron_sword', 1], ['cooked_chicken', 1]] });
  blazeAt(fed, 1, 12.5, 64.5, 0.5);
  const a = stand.blazeStands(fed, near(fed)).leave_and_heal;
  assert.match(a.description, /^Go out of their sight to heal and come back:/);
  assert.match(a.description, /eat the cooked chicken \(about 1\.6 seconds\) and stay until the health is full/);
  const thin = floorWorld({ spawner: null, solid: healPillar, at: new Vec3(6.5, 64, 0.5), health: 9, food: 10, items: [['iron_sword', 1], ['potato', 1]] });
  blazeAt(thin, 1, 12.5, 64.5, 0.5);
  const b = stand.blazeStands(thin, near(thin)).leave_and_heal;
  assert(b, 'offered');
  assert.match(b.description, /^Go out of their sight \(no health comes back at this hunger\)/);
  assert.match(b.description, /eat the potato \(it brings hunger only to 11\) and stay only until the fire on the body is out/);
});

test('away to heal with nothing that heals ends once out of sight and the fire is out, and says so: not sixty seconds', async () => {
  const bot = floorWorld({ spawner: null, solid: healPillar, at: new Vec3(3.5, 64, 0.5), health: 5, food: 14, items: [['iron_sword', 1], ['stone_pickaxe', 1]] });
  blazeAt(bot, 1, 12.5, 64.5, 0.5);
  const site = { cell: new Vec3(3, 64, 0), steps: 0, nearest: 9 };
  const stats = {}, task = { check() {} };
  // Alight for a second and a half on arrival: it waits for the fire, then ends.
  bot.entity.metadata = [1];
  setTimeout(() => { bot.entity.metadata = [0]; }, 1500);
  const began = Date.now();
  await T.leaveAndHeal(bot, task, {}, () => {}, site, { navigate: async () => {}, stats });
  const took = Date.now() - began;
  assert(took >= 1400 && took < 6000, `waited for the fire, no longer: ${took} ms`);
  assert.equal(stats.ended, 'out of their sight and the fire out; at hunger 14 nothing comes back');
  assert.equal(stats.outOfSight, true);
  assert.equal(stats.from, 5); assert.equal(stats.to, 5);
  // Not alight: it ends at once.
  bot.entity.metadata = [0];
  const s2 = {}, t0 = Date.now();
  await T.leaveAndHeal(bot, task, {}, () => {}, site, { navigate: async () => {}, stats: s2 });
  assert(Date.now() - t0 < 1500, 'at once');
  assert.match(s2.ended, /nothing comes back/);
});

test('every tactic offered is declared by the questions that offer it', () => {
  const { question } = require('../src/decisions');
  require('../src/decisions/combat'); require('../src/decisions/survival');
  const keys = ['box_at_spawner', 'box_here', 'light_spawner', 'corner_ambush', 'leave_and_heal'];
  for (const id of ['hunt_target', 'encounter_stance']) {
    const spec = question(id);
    assert(spec, id);
    for (const k of keys) assert(spec.options.some(o => o.key === k), `${id} declares ${k}`);
  }
});

// mid-208-k-fortress-5 (25592, 13:56:43): close_in chosen at 15.3 on the
// blazes' price alone; the walk went on to two wither skeletons and one
// struck it from 15.3 to 5.7 inside the stance, asked again only then.
const skeletonAt = (bot, id, x, y, z) => { const e = { id, name: 'wither_skeleton', type: 'hostile', position: new Vec3(x, y, z), height: 2.4, width: 0.7, isValid: true, metadata: {} }; bot.entities[id] = e; return e; };
test('the close-in is priced with the biters about too: a wither skeleton by the blazes gets to the bot and strikes meanwhile, said and counted', () => {
  const bot = floorWorld({ spawner: null, solid: p => p.y <= 63, at: new Vec3(0.5, 64, 0.5), health: 15.3 });
  blazeAt(bot, 1, 10.5, 65, 0.5);
  const alone = stand.closeInCost(bot, near(bot));
  skeletonAt(bot, 2, 8.5, 64, 2.5);
  const withIt = stand.closeInCost(bot, near(bot));
  assert(withIt.bite.damage > 0 && withIt.damage > alone.damage + 1, `${alone.damage} alone, ${withIt.damage} with the skeleton`);
  const o = stand.blazeStands(bot, near(bot)).close_in;
  assert.match(o.description, /The wither skeleton 8\.2 blocks off gets to the bot meanwhile and strikes until the sword, turning to it first, has killed it: about [\d.]+ of the damage below/);
  assert.equal(o.expects.damage, withIt.damage);
});

test('a close-in ends when a biter not there at its start comes to arm\'s length, said why, so the stance is asked again with it at hand', async () => {
  const bot = floorWorld({ spawner: null, solid: p => p.y <= 63, at: new Vec3(0.5, 64, 0.5), health: 15.3 });
  Object.assign(bot, { equip: async () => {}, heldItem: { name: 'iron_sword' }, lookAt: async () => {}, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {}, attack() {}, dig: async () => {} });
  blazeAt(bot, 1, 10.5, 65, 0.5);
  // The walk toward the blaze brings a wither skeleton round to 1.8 blocks.
  let walks = 0;
  const walkOn = async () => { walks++; await new Promise(r => setTimeout(r, 100)); bot.entity.position = bot.entity.position.offset(1, 0, 0); if (walks === 2) skeletonAt(bot, 2, bot.entity.position.x + 1.8, 64, bot.entity.position.z); };
  const { Task } = require('../src/skills');
  const started = Date.now();
  const r = await stand.closeIn(bot, new Task('t'), {}, () => {}, { navigate: walkOn, seconds: 10 });
  assert(Date.now() - started < 3000, `ended when it came, not at the run's ten seconds: ${Date.now() - started} ms`);
  assert.match(r.interrupted || '', /^a wither skeleton came to arm's length, 1\.8 blocks off$/);
  // One already at arm's length when the run began is the run's own.
  const box = floorWorld({ at: new Vec3(0.5, 64, 9.5) });
  skeletonAt(box, 3, 0.5, 64, 11.3);
  const watch = T.biterWatch(box);
  assert.equal(watch(), null);
  skeletonAt(box, 4, 2.3, 64, 9.5);
  assert.match(watch(), /wither skeleton came to arm's length, 1\.8 blocks off/);
});

// mid-243-ag-fortress-4 (25589, 14:26:54): close_in at 2.9 health, told
// "about 0 damage ... and the blaze killed", with four blazes ten to
// thirteen off out of sight; it walked in and two fireballs ended it.
test('the close-in counts the blazes out of sight within sixteen as seeing the bot, the walk in putting it in their sight', () => {
  const wall = p => p.y <= 63 || (p.x === 3 && p.y <= 67 && p.z >= -6 && p.z <= 6);
  const bot = floorWorld({ spawner: null, solid: wall, at: new Vec3(0.5, 64, 0.5), health: 2.9 });
  bot.world = { raycast(from, dir, max) { for (let t = 0; t <= max; t += 0.05) { const p = from.plus(dir.scaled(t)); const b = bot.blockAt(p); if (b && b.boundingBox === 'block') return Object.assign(b, { intersect: p }); } return null; } };
  for (const [i, z] of [[1, -2], [2, 0], [3, 2], [4, 3]]) blazeAt(bot, i, 9.5 + i, 65, z + 0.5);
  const danger = near(bot);
  assert(danger.filter(t => t.entity.name === 'blaze').every(t => !t.visible), 'all out of sight behind the wall');
  const c = stand.closeInCost(bot, danger);
  assert(c.damage >= 2.9 && c.deathAt != null, `priced ${c.damage}, death at ${c.deathAt}`);
  assert.match(stand.closeInSays(c, 2.9), /none of them sees the bot now; 4 more about out of sight within sixteen blocks are counted as seeing it, the walk in to strike putting the bot in their sight/);
});

test('in play only the tactics that worked in the arena are offered: the box where the bot stands, the corner and away to heal; not the box at the cage nor the spawner lit', () => {
  delete process.env.BLAZE_TACTICS_ALL;
  try {
    const bot = floorWorld({ health: 12 });
    blazeAt(bot, 1, 3.5, 65, -1.5); blazeAt(bot, 2, -3.5, 65.5, 1.5);
    const stands = stand.blazeStands(bot, near(bot));
    assert.equal(stands.box_at_spawner, undefined);
    assert.equal(stands.light_spawner, undefined);
    assert(stands.box_here, Object.keys(stands).join(','));
    assert.match(stands.box_here.description, /Measured in the arena with the same kit, this way: against four blazes nine to eleven off round the bot by a live spawner eleven off[^;]*5 runs: 0 killed, 0 rods carried away, about 31\.5 damage a run on the median over about 124\.9 seconds, 1 death/);
  } finally { process.env.BLAZE_TACTICS_ALL = '1'; }
});

// Note 647: the fire the landings light comes a second after each and climbs
// for four; the close-in priced every phase at the steady chance of being
// alight from its first second, five seconds long.
test('the close-in counts the fire its landings light as it comes, a second late, not a steady chance of being alight from the first second of the walk (note 647)', () => {
  const bot = floorWorld({ spawner: null, solid: p => p.y <= 63, at: new Vec3(0.5, 64, 0.5), health: 20 });
  blazeAt(bot, 1, 12.5, 65, 0.5);
  const c = stand.closeInCost(bot, near(bot));
  assert(c.phases.length >= 2, JSON.stringify(c.phases));
  // The first phase's damage a second is under what the steady rates come to (the hits and the chance of being alight 1 - e^(-4 x landings)).
  const steady = c.striking;
  assert(c.phases[0].perSecond < steady, `${c.phases[0].perSecond} a second in the first phase, ${steady} steady`);
  assert(c.phases[0].perSecond > 0);
  // And the burn counted for the whole run is the ramp's (combat-estimate burnBetween), not the old steady 5-second sum.
  const ce = require('../src/combat-estimate');
  assert(ce.burnBetween([{ from: 0, to: 4, perSecond: 0.2 }], 0, 4) < (1 - Math.exp(-5 * 0.2)) * 4);
});
