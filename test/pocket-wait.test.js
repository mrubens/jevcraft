'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival, claim } = require('../src/survival');
const { claimSays } = require('../src/arbiter');

// mid-242-ac-nether-2-fortress-3 (25585, note 584): dug down against a ghast
// in sight 25 blocks off at 04:44:59, the ghast gone within a minute, and
// sealed in the corridor's floor for eleven minutes and more with a crossbow
// piglin heard 13 blocks off through the rock the whole time, never nearer,
// never in sight; stay answered every time, told nothing of the wait.
function netherPocket({ piglinAt = new Vec3(13.5, 30, 0.5), mob = 'piglin' } = {}) {
  const origin = new Vec3(0, 30, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const ghast = { id: 9, name: 'ghast', type: 'hostile', position: new Vec3(0.5, 40, 25.5), height: 4, width: 4, isValid: true };
  const piglin = { id: 7, name: mob, type: 'hostile', position: piglinAt, height: 1.95, width: 0.6, isValid: true, heldItem: mob === 'piglin' ? { name: 'crossbow' } : null };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 7: piglin, 9: ghast }, health: 20, food: 18,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 6000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 43 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : 'netherrack', boundingBox: open.has(`${p}`) ? 'empty' : 'block', position: p }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  return { bot, origin, ghast, piglin };
}

async function askAt(survival, goal, now) {
  const real = Date.now;
  let tree, state;
  survival.decide = async (task, g, save, { id, tree: t, state: s }) => { if (id === 'pocket_next') { tree = t; state = s; } return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  Date.now = () => now;
  try { await survival.step(new Task('wait'), goal, () => {}); } finally { Date.now = real; }
  delete survival.state.pocketPlan;
  return { tree, state };
}

test('a pocket in the Nether says how the wait has gone: its minutes, the ghast it was sealed against gone, a piglin heard five minutes never nearer and never in sight, no daylight, full health, the rung idle (note 584)', async () => {
  const { bot, origin } = netherPocket();
  const t0 = 1_800_000_000_000;
  const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'obtain_blaze_rods' },
    tried: { entries: [], escalations: [], rung: { rung: 'obtain_blaze_rods', since: t0 - 3600000, bestAt: t0 - 45 * 60000, lastBest: 'nearer the blazes (20 blocks)' } } };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'the_nether' }],
    // The stance that dug the pocket, chosen against the ghast in sight.
    stance: { choice: 'dig_down', kinds: ['ghast'], ids: [9], mobs: [{ name: 'ghast', distance: 24.7, visible: true }], at: t0 - 5000, health: 20 } }, client: { systemOne: async () => ({}) } });
  await askAt(survival, goal, t0);
  // The ghast drifts off; the piglin stays where it is.
  delete bot.entities[9];
  for (let s = 20; s < 300; s += 20) await askAt(survival, goal, t0 + s * 1000);
  const { tree, state } = await askAt(survival, goal, t0 + 5 * 60000);
  const stay = tree.stay.description, leave = tree.leave.description;
  assert.match(stay, /In this pocket 5 minutes so far\./);
  assert.match(stay, /It was sealed when dig down was chosen against a ghast in sight 25 blocks off; that ghast is not about now\./);
  assert.match(stay, /Of the mobs outside: the piglin 13 blocks off, about for 5 minutes of the wait, 13 blocks off all that time, never nearer\. None of them has come nearer or had the bot in sight while it waited\./);
  assert.match(stay, /No daylight comes here: nothing outside burns off or goes away with the hour, so a stay here ends only when the bot opens the pocket\./);
  assert.match(stay, /Health is full: staying heals nothing\./);
  assert.match(stay, /The obtain blaze rods has had no new best for 50 minutes \(the last: nearer the blazes \(20 blocks\)\)\./);
  assert.match(leave, /The pocket was sealed when dig down was chosen against a ghast in sight 25 blocks off; that ghast is not about now\./);
  // Held off five minutes, never nearer, never in sight, no hit: priced at
  // what it has done on the leave and the stay alike (note 599), not as
  // should they all come on the way out only.
  const heldOffSays = /Held off: the piglin 13 blocks off \(5 minutes, out of sight; about 8 a hit should it come\)\. It has been about that long without coming nearer, coming into sight or hurting the bot, so it is priced at what it has done, nothing, on every option here that does not go at it, the hold and the ways off alike; a fight that goes at it is priced as that fight\./;
  assert.match(leave, heldOffSays);
  assert.match(stay, heldOffSays);
  assert.doesNotMatch(leave, /Should they all come|Out among them, fighting them all/);
  assert.equal(state.pocketSoFar.minutes, 5);
  assert.match(state.pocketSoFar.sealedAgainst, /ghast in sight 25 blocks off \(dig down\); that ghast is not about now/);
  // The turn's own question says it too.
  const real = Date.now; Date.now = () => t0 + 5 * 60000;
  let c; try { c = claim(bot, { ...goal, survival: survival.state }, survival); } finally { Date.now = real; }
  assert.equal(c.action, 'pocket_next');
  assert.match(claimSays(c), /^In a sealed pocket, 5 minutes so far, sealed against a ghast in sight 25 blocks off \(dig down\); that ghast is not about now: whether to stay/);
});

test('a mob that has come nearer through the wait is said so, and leaving is priced among them as before when it is the mob the pocket was sealed against', async () => {
  const { bot, origin, piglin } = netherPocket({ mob: 'zombie', piglinAt: new Vec3(15.5, 30, 0.5) });
  delete bot.entities[9];
  const t0 = 1_800_000_000_000;
  const goal = { kind: 'win', request: 'beat the game' };
  // Sealed against this zombie, in sight: it may be after the bot still.
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'the_nether' }],
    stance: { choice: 'seal', kinds: ['zombie'], ids: [7], mobs: [{ name: 'zombie', distance: 15.2, visible: true }], at: t0 - 5000, health: 20 } }, client: { systemOne: async () => ({}) } });
  await askAt(survival, goal, t0);
  for (let s = 20; s <= 120; s += 20) { piglin.position = new Vec3(15.5 - 8 * s / 120, 30, 0.5); await askAt(survival, goal, t0 + s * 1000); }
  const { tree } = await askAt(survival, goal, t0 + 120000);
  assert.match(tree.stay.description, /In this pocket 2 minutes so far\./);
  assert.match(tree.stay.description, /Of the mobs outside: the zombie 7 blocks off, about for 2 minutes of the wait, come from 15 to 7 blocks off, never with the bot in sight\./);
  assert.match(tree.stay.description, /It was sealed when seal was chosen against a zombie in sight 15 blocks off; now the zombie 7 blocks off, out of sight\./);
  assert.match(tree.leave.description, /Out among them, fighting them all is estimated/);
  assert.doesNotMatch(tree.leave.description, /Should they all come/);
});

// mid-242-ab-nether-3-fortress-1 (25592, note 589): at its fortress with
// nothing left to eat, Jev chose to go back to the Overworld for food at
// 05:07; on the way to the portal a blaze 7 blocks off had it seal in at
// 05:08:56, and it sat there twenty-six minutes and more, pocket_next stay
// every time. The bot was restarted at 05:22 and the wait was said from
// there ("13 minutes so far"), the blaze it sealed against forgotten; the
// two blazes outside, drifting 4 to 24 blocks off and never seeing it, were
// said as "come from 23 to 8 blocks off" and leaving priced "out among
// them" at 27.5 damage; the leave said "go back to the obtain blaze rods
// step" while the trip back for food was the work; no way to food was on
// offer, and nothing said health could not come back in there.
function fortressPocket() {
  const origin = new Vec3(-180, 58, -191);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const blaze = (id, x) => ({ id, name: 'blaze', type: 'hostile', position: new Vec3(x, 60, -190.5), height: 1.8, width: 0.6, isValid: true });
  const a = blaze(4720, -156.5), b = blaze(5008, -157.5);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 4720: a, 5008: b }, health: 15.8, food: 16,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 0 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'netherrack', count: 64 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : 'netherrack', boundingBox: open.has(`${p}`) ? 'empty' : 'block', position: p }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  return { bot, origin, a, b };
}

test('a Nether pocket with nothing to eat says its wait from the seal across a restart, the blazes drifting unseen, that neither daylight nor health comes, and offers the way back for food (note 589)', async () => {
  const { bot, origin, a, b } = fortressPocket();
  const t0 = 1_800_000_000_000, min = 60000;
  const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'obtain_blaze_rods' },
    portals: [{ x: 18, y: 58, z: 8, dimension: 'nether' }],
    // Jev's go_back for food, two minutes before the seal.
    leaveNether: { reason: 'food', pick: 'go_back', until: 0, at: t0 - 2 * min },
    tried: { entries: [], escalations: [], rung: { rung: 'obtain_blaze_rods', since: t0 - 60 * min, bestAt: t0 - 5 * min, lastBest: 'nearer the blazes (11 blocks)' } } };
  // As the trial left it: the stance record from before note 584 (kinds a
  // string, no mobs), and the seal pass's where and when.
  const persisted = { shelters: [{ origin: { ...origin }, dimension: 'the_nether', emergency: true }],
    stance: { choice: 'seal', kinds: 'blaze', ids: [3130], shooters: ['blaze'], at: t0 - 10, health: 15.8 },
    sealing: { origin: { ...origin }, at: t0 }, pocketOutAt: t0 - 30000 };
  const survival = new Survival(bot, {}, { state: JSON.parse(JSON.stringify(persisted)), client: { systemOne: async () => ({}) } });
  // Five minutes in, the trip back still held: the leave goes on with it.
  let { tree } = await askAt(survival, goal, t0 + 5 * min);
  assert.match(tree.leave.description, /^Open the pocket and go on with the way back to the Overworld for food, as Jev chose at \d\d:\d\d, before this pocket was sealed on it\./);
  assert.match(tree.leave.description, /The nearest portal remembered is 280 blocks off, about 65 seconds at a walk.*The obtain blaze rods step waits till the bot is fed and back\./);
  assert.ok(!tree.go_for_food?.children?.return_for_food, 'the trip back is the leave\'s, not offered twice');
  // The bot restarted at thirteen minutes, as the trial's was: its record
  // begun at the first look after the restart, the blaze sealed against
  // not in it, and no pocketOutAt (before this was kept). The clock still
  // runs from the seal.
  const saved = JSON.parse(JSON.stringify(survival.state));
  saved.pocketWait = { key: `${origin.x},${origin.y},${origin.z}`, since: t0 + 13 * min - 1000, against: null, mobs: {}, seenAt: t0 + 13 * min - 1000 };
  delete saved.pocketOutAt;
  const again = new Survival(bot, {}, { state: saved, client: { systemOne: async () => ({}) } });
  ({ tree } = await askAt(again, goal, t0 + 13 * min));
  assert.match(tree.stay.description, /In this pocket 13 minutes so far\. It was sealed when seal was chosen against a blaze; that blaze is not about now\./);
  // The two blazes drift about the fortress, never seeing the bot: A from
  // 22 in to 4 (5 with the height), out to 22 and back to 9; B from 21 in
  // to 5 and out to 11.
  const pathA = [22, 18, 12, 6, 4, 10, 18, 22, 20, 14, 9], pathB = [21, 16, 9, 5, 8, 12, 16, 14, 11, 11, 11];
  for (let i = 0; i < pathA.length; i++) {
    a.position = new Vec3(-179.5 + pathA[i], 60, -190.5); b.position = new Vec3(-179.5 + pathB[i], 58, -189.5);
    ({ tree } = await askAt(again, goal, t0 + (15 + i) * min));
  }
  const stay = tree.stay.description, leave = tree.leave.description;
  assert.match(stay, /In this pocket 25 minutes so far\./);
  assert.match(stay, /the blaze 9 blocks off, about for 12 minutes of the wait, come from 2\d to 9 blocks off, from 5 to 2\d over it, never with the bot in sight/);
  assert.match(stay, /the blaze 11 blocks off, about for 12 minutes of the wait, come from 2\d to 11 blocks off, from 5 to 2\d over it, never with the bot in sight/);
  assert.match(stay, /None of them has had the bot in sight while it waited, and a mob takes the bot as its target only once it has seen it\./);
  assert.match(stay, /Nothing carried is food: hunger 16 does not rise in here, so health does not come back in this pocket however long it waits\. Neither daylight nor health comes to this wait: the bot goes out at [\d.]+ health whenever it goes, so a stay buys only the chance that the mobs outside move off(, and blazes keep about the fortress they spawn in)?, and each minute of it is a minute of the run\./);
  assert.match(stay, /The obtain blaze rods has had no new best for 30 minutes/);
  // Held off unseen: the fight is what it costs should they all come.
  assert.match(leave, /Should they all come at the bot at once, fighting them is estimated at about/);
  assert.doesNotMatch(leave, /Out among them/);
  // Twenty-five minutes on, the trip chosen two minutes before the seal is
  // still held: the minutes sealed in are not the trip's (note 597).
  assert.match(leave, /^Open the pocket and go on with the way back to the Overworld for food, as Jev chose at \d\d:\d\d, before this pocket was sealed on it, past a blaze/);
  assert.ok(!tree.go_for_food?.children?.return_for_food, 'the trip back is the leave\'s, not offered twice');
  // Chosen more than ten minutes before the seal, it has lapsed: the leave
  // goes back to the rung, and the way back for food is offered, said with
  // the trip.
  goal.leaveNether.at = t0 - 11 * min;
  ({ tree } = await askAt(again, goal, t0 + 26 * min));
  assert.match(tree.leave.description, /^Open the pocket and go back to the obtain blaze rods step/);
  assert.match(tree.go_for_food.description, /off the Overworld the food is back through the portal/);
  assert.match(tree.go_for_food.children.return_for_food.description, /Go back through the portal to the Overworld.*The nearest portal remembered is 280 blocks off.*Health does not come back on the way: hunger 16, under eighteen, and nothing to eat/);
});

// mid-242-ab-nether-3-fortress-1 (25592, note 597): with nothing to eat it
// chose again to go back for food at 06:27:43, and at 06:28:18, on the way,
// sealed in against a blaze on the lip of a fortress pier at (-275, 56,
// -174), a blaze spawner at (-281, 63, -167), 12 blocks off and 7 above.
// It stayed twenty minutes and more, the mobs within 24 blocks growing from
// five to twenty. Every way out under rock surveyed level along one axis
// ran into the air short of the spawner's sixteen, so tunnel_out was never
// offered; the stay said "only the mobs outside moving off would change it"
// beside a spawner that makes more of them; and at 06:37, still sealed in,
// the trip back lapsed and the leave went back to the rung. The blocks are
// the region file's as saved at 06:48Z, the pocket's seal in them.
const PIER = require('./fixtures/spawner-pier-mid-242-ab.json');
function pierPocket() {
  const registry = require('minecraft-data')('26.1');
  const Block = require('prismarine-block')(registry);
  const [Y0, Y1] = PIER.y, cols = new Map(), dug = new Set();
  const nameAt = q => {
    const key = `${q.x},${q.z}`;
    if (!cols.has(key)) {
      const s = PIER.columns[key];
      let out = null;
      if (s) { out = []; for (const [, ch, n] of s.matchAll(/([a-z])(\d*)/g)) for (let i = 0; i < (n ? Number(n) : 1); i++) out.push(PIER.palette[ch.charCodeAt(0) - 97]); }
      cols.set(key, out);
    }
    const c = cols.get(key);
    return !c || q.y < Y0 || q.y > Y1 ? null : dug.has(`${q}`) ? 'air' : c[q.y - Y0];
  };
  const blockAt = p => { const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), n = nameAt(q); if (!n) return null; const b = Block.fromStateId(registry.blocksByName[n].defaultState, 0); b.position = q; return b; };
  const spawnerAt = new Vec3(-281, 63, -167), feet = new Vec3(-274.5, 56, -173.5);
  // Cells a blaze floats in about the spawner, air with air over it.
  const air = [];
  for (let r = 3; r <= 9 && air.length < 24; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    const c = spawnerAt.offset(dx, -3 + (Math.abs(dx + dz) % 4), dz);
    if (Math.max(Math.abs(dx), Math.abs(dz)) === r && nameAt(c) === 'air' && nameAt(c.offset(0, 1, 0)) === 'air' && !air.some(a => a.equals(c))) air.push(c);
  }
  const inv = [['stone_pickaxe', 1], ['iron_sword', 1], ['netherrack', 12], ['coal', 64], ['iron_ingot', 11], ['wheat_seeds', 17]].map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }));
  const slots = []; slots[5] = { name: 'iron_helmet' }; slots[6] = { name: 'iron_chestplate' }; slots[45] = { name: 'shield' };
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 12.76, food: 11,
    time: { timeOfDay: 0 }, entity: { position: feet.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => inv, emptySlotCount: () => 5, slots }, blockAt,
    findBlocks: ({ matching, point }) => [].concat(matching).includes(registry.blocksByName.spawner.id) && (point || bot.entity.position).distanceTo(spawnerAt) <= 17 ? [spawnerAt] : [],
    world: { raycast: from => ({ intersect: from.offset(0.3, 0, 0) }) } });
  let id = 2672;
  const add = (name, at) => { const e = { id: ++id, name, type: 'hostile', position: at.offset(0.5, 0, 0.5), height: name === 'blaze' ? 1.8 : 2, width: 0.6, isValid: true }; bot.entities[e.id] = e; return e; };
  return { bot, air, add, dug, spawnerAt, origin: new Vec3(-275, 56, -174) };
}

test('sealed on a fortress pier by a blaze spawner, nothing to eat: a way out under rock down the pier and away is offered, the stay says the mobs do not move off, and the trip back chosen before the seal holds through it (note 597)', async () => {
  const { bot, air, add, dug, spawnerAt, origin } = pierPocket();
  const t0 = 1790576898397, min = 60000;
  const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'obtain_blaze_rods' },
    portals: [{ x: 18, y: 58, z: 8, dimension: 'nether' }],
    leaveNether: { reason: 'food', pick: 'go_back', until: 0, at: t0 - 34846 } };
  for (const c of air.slice(0, 5)) add('blaze', c);
  const state = { shelters: [{ origin: { ...origin }, dimension: 'the_nether', emergency: true }],
    stance: { choice: 'seal', ids: [2672], mobs: [{ name: 'blaze', distance: 9.1, visible: false }], at: t0 - 10, health: 12.76 },
    sealing: { origin: { ...origin }, at: t0 }, pocketOutAt: t0 - 600 };
  const walked = [];
  const survival = new Survival(bot, { dig: async (b, t, p) => { dug.add(`${p}`); }, navigate: async (b, t, g) => { walked.push(new Vec3(g.x, g.y, g.z)); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } },
    { state, client: { systemOne: async () => ({}) } });
  await askAt(survival, goal, t0 + 8000);
  // The spawner goes on making them: fifteen more come in over the wait.
  for (let m = 2; m <= 18; m += 2) { for (const c of air.slice(5 + (m - 2), 5 + m)) add('blaze', c); await askAt(survival, goal, t0 + m * min); }
  const { tree, state: s } = await askAt(survival, goal, t0 + 19 * min);
  const stay = tree.stay.description;
  // The way a player digs there: down into the pier and away, beyond the
  // spawner's sixteen, under rock.
  const out = tree.tunnel_out?.description || '';
  assert.match(out, /^Dig a passage out through the pocket's north wall, away from the mob spawner: one wide and two high, 4 blocks, a stair down a block each step to 4 below the pocket's floor \(12 blocks dug\), about 15 seconds, ending 17 blocks from the spawner \(it is 12 off now\)/);
  assert.match(out, /then from its end go on with the way back to the Overworld for food, as Jev chose at \d\d:\d\d, before this pocket was sealed on it\. The nearest portal remembered is 344 blocks off/);
  assert.match(out, /Rock round it the whole way and the pocket's wall toward the blazes left standing/);
  // Nothing comes to this wait: not daylight, not health, and not the mobs
  // moving off, with a spawner making more.
  assert.match(stay, /Neither daylight nor health comes to this wait, and the mobs outside do not move off: the mob spawner 12 blocks off makes more of them while the bot is within its 16 blocks\./);
  assert.doesNotMatch(stay, /only the mobs outside moving off would change it/);
  assert.match(stay, /Within 24 blocks of the pocket: 5 mobs at the wait's first look 19 minutes ago, 2\d now\./);
  assert.deepEqual(s.pocketSoFar.mobsWithin24.firstLook, 5);
  // Nineteen minutes sealed in are not the trip's: the leave goes on with it.
  assert.match(tree.leave.description, /^Open the pocket and go on with the way back to the Overworld for food, as Jev chose at \d\d:\d\d, before this pocket was sealed on it/);
  // Chosen, the passage is dug as surveyed, three blocks a step down, and
  // the trip is chosen again from its end.
  survival.decide = async () => ({ path: ['tunnel_out'], stale: false });
  const real = Date.now; Date.now = () => t0 + 19 * min + 1000;
  try { await survival.step(new Task('wait'), goal, () => {}); } finally { Date.now = real; }
  assert.deepEqual(walked.map(p => [p.x, p.y, p.z]), [[-275, 55, -175], [-275, 54, -176], [-275, 53, -177], [-275, 52, -178]]);
  for (const c of ['-275,57,-175', '-275,56,-175', '-275,55,-175', '-275,54,-178']) assert(dug.has(`(${c.split(',').join(', ')})`), `dug ${c}`);
  const end = walked.at(-1);
  assert(Math.hypot(end.x + 0.5 - (spawnerAt.x + 0.5), end.y - (spawnerAt.y + 0.5), end.z + 0.5 - (spawnerAt.z + 0.5)) > 16, 'beyond the spawner\'s sixteen');
  assert.equal(goal.leaveNether.at, t0 + 19 * min + 1000, 'going on with the trip is choosing it again');
});

test('a trip back for food chosen more than ten minutes before the seal has lapsed in the pocket too: the leave goes to the rung and go_for_food offers the way back (note 597)', async () => {
  const { bot, air, add, origin } = pierPocket();
  const t0 = 1790576898397, min = 60000;
  for (const c of air.slice(0, 5)) add('blaze', c);
  const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'obtain_blaze_rods' }, portals: [{ x: 18, y: 58, z: 8, dimension: 'nether' }],
    leaveNether: { reason: 'food', pick: 'go_back', until: 0, at: t0 - 11 * min } };
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => {} }, { state: { shelters: [{ origin: { ...origin }, dimension: 'the_nether', emergency: true }], sealing: { origin: { ...origin }, at: t0 }, pocketOutAt: t0 - 600 }, client: { systemOne: async () => ({}) } });
  const { tree } = await askAt(survival, goal, t0 + 2 * min);
  assert.match(tree.leave.description, /^Open the pocket and go back to the obtain blaze rods step/);
  assert.match(tree.go_for_food.children.return_for_food.description, /The nearest portal remembered is 344 blocks off/);
  assert.match(tree.tunnel_out.description, /then go back to the obtain blaze rods step from its end\./);
});

test('a pocket the bot was seen out of since its seal, and one sealed again, are new waits', async () => {
  const { bot, origin } = fortressPocket();
  bot.entities = {};
  const t0 = 1_800_000_000_000;
  const state = { shelters: [{ origin: { ...origin }, dimension: 'the_nether' }], sealing: { origin: { ...origin }, at: t0 - 20 * 60000 }, pocketOutAt: t0 - 60000 };
  const survival = new Survival(bot, {}, { state, client: { systemOne: async () => ({}) } });
  let { tree } = await askAt(survival, { kind: 'win' }, t0);
  assert.match(tree.stay.description, /In this pocket 1 second so far\./, 'out of it since the old seal: the wait begins now');
  await askAt(survival, { kind: 'win' }, t0 + 60000);
  survival.state.sealing = { origin: { ...origin }, at: t0 + 90000 };
  ({ tree } = await askAt(survival, { kind: 'win' }, t0 + 120000));
  assert.match(tree.stay.description, /In this pocket 30 seconds so far\./, 'sealed again: from the new seal');
});

test('in the Overworld at night the stay says its minutes and not the Nether\'s lack of day', async () => {
  const { bot, origin } = netherPocket();
  bot.game.dimension = 'overworld'; bot.time.timeOfDay = 16000; bot.entities = {};
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld' }] }, client: { systemOne: async () => ({}) } });
  const t0 = 1_800_000_000_000;
  await askAt(survival, { kind: 'win' }, t0);
  await askAt(survival, { kind: 'win' }, t0 + 30000); await askAt(survival, { kind: 'win' }, t0 + 60000);
  const { tree } = await askAt(survival, { kind: 'win' }, t0 + 90000);
  assert.match(tree.stay.description, /In this pocket 1\.5 minutes so far\./);
  assert.doesNotMatch(tree.stay.description, /No daylight comes here|staying heals nothing/);
});
