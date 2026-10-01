'use strict';
// Note 767: the portal cast failing at its site, and the frame thrown away.
// The recorded cases replayed in a flat world whose buckets do what the
// game's do (the helpers of test/ruined-portal.test.js): 25595's stand
// search that threw with three stands beside the slot, 25591's water poured
// at one aim eleven times, the answer to a site failure held, the ways to
// repair the site, the lava's way asked again when its route fails, the
// route kinds offered when none good tops a stall, and the audit's label.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { setAside } = require('../src/progress');
const { frameCells } = require('../src/ruined-portal');
const cast = require('../src/portal-cast');

const flatWorld = (named = new Map()) => {
  const nameAt = p => named.get(`${p.x},${p.y},${p.z}`) || (p.y < 64 ? 'stone' : 'air');
  const solidAt = p => !/^(air|water|lava)$/.test(nameAt(p));
  return { named, nameAt, name: nameAt, solidAt, openAt: p => nameAt(p) === 'air', blocksRay: solidAt,
    set: (p, n) => named.set(`${p.x},${p.y},${p.z}`, n) };
};
const newFrame = (axis, origin = new Vec3(10, 64, 20)) => ({ origin, axis, cast: true, castTemp: [], blocks: frameCells(origin, axis).blocks.map(p => ({ x: p.x, y: p.y, z: p.z })) });
function castingBot(carried, { waterGoes = null } = {}) {
  const registry = require('minecraft-data')('26.1');
  const w = flatWorld();
  const items = Object.entries(carried).map(([name, count]) => ({ name, count }));
  const add = (name, n) => { const i = items.find(x => x.name === name); if (i) i.count += n; else items.push({ name, count: n }); };
  const log = { lava: [], water: [], steps: [] };
  let held = null, look = null;
  const bot = {
    registry, entities: {}, oxygenLevel: 20, health: 20, food: 20, game: { gameMode: 'survival', dimension: 'overworld' },
    entity: { position: new Vec3(11.5, 64, 22.5), height: 1.8, width: 0.6 },
    inventory: { items: () => items.filter(i => i.count > 0) },
    blockAt: p => { const q = p.floored(), name = w.nameAt(q); return { name, position: q, boundingBox: w.solidAt(q) ? 'block' : 'empty', getProperties: () => ({ level: 0 }) }; },
    world: { raycast: () => null }, findBlocks: () => [],
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
      const hit = cast.firstHit(w.blocksRay, eye, look);
      let into = hit.cell.plus(hit.face);
      if (held === 'lava_bucket') { log.lava.push(into); w.set(into, 'lava'); add('lava_bucket', -1); add('bucket', 1); }
      else if (held === 'water_bucket') {
        // The game's own placing, where it differs from the aim (25591's water).
        const elsewhere = waterGoes && waterGoes(into);
        if (elsewhere) into = elsewhere;
        log.water.push(into);
        w.set(into, 'water'); add('water_bucket', -1); add('bucket', 1);
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
    pourMs: 30,
  };
  return { bot, w, log, calls, actions, add };
}
const save = goal => () => { if (goal.step) (goal.steps ||= []).push(`${goal.step.phase}${goal.step.whole ? ':whole' : ''}`); };

test('25595: stands beside the slot whose half-second route searches ran out are walked to the whole way, not "nowhere to stand"', async () => {
  // 25595 (mid-243-ap, 2026-09-30 21:14:47-21:15:10Z): "Nowhere to stand to pour into the frame slot at (18, 73, -3):
  // 3 stands beside it a pour reaches it from, 0 to make, 0 to dig out" seven times in 23 seconds; the frame was left at 6 of ten.
  const { bot, w, log, actions } = castingBot({ water_bucket: 1, lava_bucket: 1, cobblestone: 64 });
  actions.surveyRoute = async () => ({ status: 'timeout' });
  bot.entity.position = new Vec3(13.5, 64, 21.5);
  const goal = { portalFrame: newFrame('x') };
  for (let pass = 0; pass < 4 && !log.lava.length; pass++) await cast.castFrame(bot, new Task('cast'), goal, save(goal), actions);
  assert.equal(log.lava.length, 1, 'the lava went in from a stand the whole walk reached');
  assert(goal.steps.includes('to_stand:whole'), goal.steps.join(' '));
  assert.equal(w.nameAt(log.lava[0]), 'obsidian');
  // Before, with the same searches: no stand walked to, the stand search threw. Now, with every walk failing, it says so.
  const b2 = castingBot({ water_bucket: 1, lava_bucket: 1, cobblestone: 0 });
  b2.actions.surveyRoute = async () => ({ status: 'timeout' });
  b2.actions.navigate = async (b, t, g) => { if (g.constructor.name === 'GoalBlock') throw new Error('Navigation ended before reaching the destination'); };
  const g2 = { portalFrame: newFrame('x') };
  b2.bot.entity.position = new Vec3(13.5, 64, 21.5);
  // The slot walled already, nothing to make a stand with.
  const slot = cast.castOrder(g2.portalFrame)[0];
  for (const c of cast.wallsFor(slot, b2.w.solidAt)) b2.w.set(c, 'stone');
  await assert.rejects(cast.castFrame(b2.bot, new Task('cast'), g2, () => {}, b2.actions),
    /^Error: No stand reached for the frame slot at \(11, 64, 20\): \d+ beside it a pour reaches it from, none reached: the whole walk ended \(Navigation ended before reaching the destination\) to 1, the route search ran out of its half second to \d+$/);
  assert(g2.portalFrame.standsTried['11,64,20'].length >= 1, 'the stands tried are kept for other_stand');
});

test('a walk that ends on a block under full height beside the slot is at the stand, not "could not be walked to" (25589 20:20:40Z, 25595 21:24:50Z)', async () => {
  const { bot, w, log, actions } = castingBot({ water_bucket: 1, lava_bucket: 1, cobblestone: 64 });
  const goal = { portalFrame: newFrame('x') };
  const slot = cast.castOrder(goal.portalFrame)[0];
  for (const c of cast.wallsFor(slot, w.solidAt)) w.set(c, 'stone');
  const stand = cast.standsFor(goal.portalFrame, slot, w).find(s => s.feet.y === 65);
  assert(stand, 'a stand a block up');
  goal.portalFrame.standsMade = { [`${slot.x},${slot.y},${slot.z}`]: [{ x: stand.feet.x, y: stand.feet.y, z: stand.feet.z }] };
  bot.entity.position = new Vec3(13.5, 64, 21.5);
  // The walk ends on the block's top a sixteenth under the stand's floor (a
  // path block), its feet's cell flooring a block below: "could not be
  // walked to from" that cell, before.
  actions.surveyRoute = async () => ({ status: 'noPath' });
  actions.navigate = async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y - 0.0625, g.z + 0.5); };
  await cast.castFrame(bot, new Task('cast'), goal, () => {}, actions);
  assert.equal(log.lava.length, 1, 'poured from it');
});

test('25591: water that goes elsewhere is taken back where it went and poured at another aim, and said with where it went at the third', async () => {
  // 25591 (2026-09-30 16:07:45-16:15:04Z): "The water went somewhere other than (9, 73, 25)" eleven times, the same aim
  // each time; the frame was left at 3 of ten.
  let misses = 0;
  const first = castingBot({ water_bucket: 1, lava_bucket: 1, cobblestone: 64 }, { waterGoes: into => (misses++ < 1 ? into.offset(0, 0, 3) : null) });
  const goal = { portalFrame: newFrame('x') };
  const slot = cast.castOrder(goal.portalFrame)[0];
  for (let pass = 0; pass < 5 && first.w.nameAt(slot) !== 'obsidian'; pass++) assert.equal(await cast.castFrame(first.bot, new Task('cast'), goal, () => {}, first.actions) === 'thrown', false);
  assert.equal(first.w.nameAt(slot), 'obsidian', 'cast at the next aim');
  assert.equal(goal.portalFrame.missedAims['11,64,20'].length, 1);
  assert.notDeepEqual(first.log.water[1], first.log.water[0], 'not the same aim again');
  assert.equal(first.w.nameAt(first.log.water[0]), 'air', 'the stray water taken back');
  // Every pour going elsewhere: the third is the cast's failure, with where each went and the aims.
  const lost = castingBot({ water_bucket: 1, lava_bucket: 1, cobblestone: 64 }, { waterGoes: into => into.offset(0, 0, 3) });
  const g2 = { portalFrame: newFrame('x') };
  let err = null;
  for (let pass = 0; pass < 8 && !err; pass++) { try { await cast.castFrame(lost.bot, new Task('cast'), g2, () => {}, lost.actions); } catch (e) { err = e; } }
  assert.match(String(err?.message), /^The water went somewhere other than \(\d+, \d+, \d+\): it stands at \(\d+, \d+, \d+\) \(3 pours of water here have gone elsewhere, from aims at \(.*\), \(.*\), \(.*\)\)$/);
});

test('a fetch the cast makes is the trip\'s failure, not the site\'s; a failed fill tries the next place', async () => {
  const { bot, actions } = castingBot({ lava_bucket: 1, cobblestone: 64 });
  actions.acquireStep = async () => { throw new Error('Water source is outside visible interaction reach'); };
  await assert.rejects(cast.castFrame(bot, new Task('cast'), { portalFrame: newFrame('x') }, () => {}, actions), e => e.castTrip === true);
  const work = fs.readFileSync(require.resolve('../src/work'), 'utf8');
  assert.match(work, /if \(err\?\.castTrip\) throw err;/);
  const water = fs.readFileSync(require.resolve('../src/water'), 'utf8');
  assert.match(water, /await fillWaterBucket\(bot, task, p, \{ guard: \(\) => checkThreats\(bot\) \}\);\n\s*\} catch \(err\) \{ task\.check\(\); if \(\['NeedsAir', 'NeedsSafety', 'Cancelled'\]\.includes\(err\.name\)\) throw err; continue; \}/);
});

// A part-cast frame at its site failure, for portal_method.
function siteCase({ blocker = true } = {}) {
  const { bot, w, actions } = castingBot({ water_bucket: 1, lava_bucket: 2, bucket: 1, cobblestone: 64, flint_and_steel: 1 });
  const frame = newFrame('x');
  const order = cast.castOrder(frame);
  w.set(order[0], 'obsidian'); w.set(order[1], 'obsidian');
  const slot = order[2];
  for (const x of [8, 9, 10, 11, 12]) for (const z of [17, 18, 19, 21, 22, 23]) w.set(new Vec3(x, 64, z), 'stone');
  for (const c of cast.wallsFor(slot, w.solidAt)) w.set(c, 'stone');
  if (blocker) for (const c of [slot.offset(0, 1, 1), slot.offset(0, 1, -1), slot.offset(0, 2, 1), slot.offset(0, 2, -1)]) if (w.openAt(c)) w.set(c, 'dirt');
  frame.standsTried = { [`${slot.x},${slot.y},${slot.z}`]: [{ x: slot.x, y: slot.y + 1, z: slot.z + 2 }] };
  frame.siteFailed = { cast: 2, n: 1, whys: { [`No stand reached for the frame slot at ${slot}: 1 beside it`]: 1 }, slot: { x: slot.x, y: slot.y, z: slot.z }, kind: 'No stand reached for the frame slot' };
  const goal = { portalFrame: frame, landmarks: [{ kind: 'lava_pool', x: 40, y: 63, z: 20, dimension: 'overworld' }], portalMethod: { kind: 'cast', key: 'here_pool_0', lava: { way: 'pool', at: { x: 40, y: 63, z: 20 } }, activeMs: 0, reasked: 0, from: {}, siteFailed: true } };
  return { bot, w, actions, goal, frame, slot };
}

test('a site failure is asked with the cost of leaving and the ways to repair the site; clear_blocker digs the line into the slot', async () => {
  const { portalMethod } = require('../src/work');
  const { bot, w, actions, goal, frame, slot } = siteCase();
  let offered = null;
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'clear_blocker', confidence: 0.7 } } }; } };
  assert.equal(await portalMethod(bot, task, goal, () => {}), true);
  assert.match(offered.new_site_pool_0, /left as it stands, its obsidian out only with a diamond pickaxe \(none carried\), and the 2 cast there are 2 lava buckets again here; cast from the lava pool known at \(40, 63, 20\)/);
  assert.match(offered.clear_blocker, /^Repair this site and keep the route: dig out what blocks the line into the frame slot at \(\d+, \d+, \d+\) from the open cells beside it, the dirt at/);
  assert.match(offered.other_stand, /^Repair this site and keep the route: pour into the frame slot at \(\d+, \d+, \d+\) from another stand than the 1 tried there/);
  assert.equal(frame.repair.kind, 'clear');
  assert(frame.repair.cells.length >= 1);
  // The cast digs them first, then looks for a stand.
  const before = frame.repair.cells.map(c => w.nameAt(new Vec3(c.x, c.y, c.z)));
  assert(before.every(n => n === 'dirt'));
  for (let pass = 0; pass < 6 && frame.repair; pass++) await cast.castFrame(bot, new Task('cast'), goal, () => {}, actions);
  assert.equal(frame.repair, undefined, 'the repair done');
  assert(before.length && frame.blocks.length);
  assert.equal(w.nameAt(slot) === 'obsidian' || w.nameAt(slot) === 'air' || w.nameAt(slot) === 'lava', true);
});

test('other_stand passes over the stands tried at the slot; the answer at a failure holds until a block goes in or another kind comes', async () => {
  const { portalMethod, buildPortalFrame } = require('../src/work');
  const { bot, goal, frame, slot } = siteCase({ blocker: false });
  const task = new Task('nether');
  let asked = 0;
  task.opportunityClient = { systemOne: async () => { asked++; return { answers: { branch_0: { choice: 'other_stand', confidence: 0.7 } } }; } };
  assert.equal(await portalMethod(bot, task, goal, () => {}), true);
  assert.equal(asked, 1);
  assert.deepEqual(frame.passStands[`${slot.x},${slot.y},${slot.z}`], [{ x: slot.x, y: slot.y + 1, z: slot.z + 2 }]);
  assert.equal(goal.portalMethod.siteAnswer.pick, 'other_stand');
  // Failures of the same kind: held, not asked (buildPortalFrame's site catch). One of another kind: asked.
  const C = require('../src/decisions/commit');
  assert(C.holding(bot, 'portal_plan'), 'held');
  const { siteHoldEnds } = require('../src/work');
  const answered = goal.portalMethod.siteAnswer, why = Object.keys(frame.siteFailed.whys)[0];
  assert.equal(siteHoldEnds(bot, frame, { ...answered }, answered.cast, why), null);
  assert.match(siteHoldEnds(bot, frame, { ...answered }, answered.cast + 1, why), /^a block went in since/);
  assert.match(siteHoldEnds(bot, frame, { ...answered, kind: 'another' }, answered.cast, why), /^a failure of another kind came/);
  assert.equal(typeof buildPortalFrame, 'function');
});

test('the plan\'s lava whose way fails since it was chosen is the route failing: the plan asked again, the failure on its record (the reviewer\'s rule, note 782)', async () => {
  const { collectLava } = require('../src/obsidian');
  const { lavaWay } = require('../src/tunneling');
  const items = [{ name: 'bucket', count: 1 }, { name: 'stone_pickaxe', count: 1 }];
  const registry = require('minecraft-data')('26.1');
  const bot = { registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(36.5, 22, 39.5) }, inventory: { items: () => items }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 22 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 22 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) }, chat: () => {} };
  const goal = { landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 70, y: 21, z: 39 }, { kind: 'lava_pool', dimension: 'overworld', x: 36, y: 21, z: 120 }] };
  for (const k of ['lava_pool:70,39', 'lava_pool:36,120']) setAside(goal, 'landmark_trip', k, 'no nearer', 1800000);
  const chosen = { x: 70, y: 21, z: 39 };
  goal.portalMethod = { kind: 'cast', key: 'here_pool_0', lava: { way: 'pool', at: { ...chosen } }, chosenAt: Date.now() + 1, facts: { dimension: 'overworld' } };
  const asked = [];
  const task = new Task('lava');
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.7 } } }; } };
  const dug = [], actions = { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  const step = { action: 'fill_bucket', item: 'lava_bucket', count: 1 };
  await collectLava(bot, task, step, goal, () => {}, actions);
  await collectLava(bot, task, step, goal, () => {}, actions);
  assert.equal(asked.length, 0, 'the fetch asks nothing');
  assert.equal(dug.length, 2, 'dug toward the plan\'s pool while its way holds');
  assert(dug.every(d => Math.hypot(d.x - 70, d.z - 39) <= 2));
  // Its staircase set aside: the route failed, said, and nothing dug toward any other lava.
  const area = t => ({ x: Math.floor(t.x / 8) * 8, y: Math.floor(t.y / 8) * 8, z: Math.floor(t.z / 8) * 8 });
  setAside(goal, 'staircase', area(lavaWay(new Vec3(chosen.x, chosen.y, chosen.z))), '3 rounds without getting closer', 600000);
  await collectLava(bot, task, step, goal, () => {}, actions);
  assert.equal(asked.length, 0);
  assert.equal(dug.length, 2, 'no other lava taken here');
  assert.match(goal.portalMethod.routeFailed.why, /^the pool at \(70, 21, 39\): the way into it rests \(3 rounds without getting closer\)/);
  assert.match(require('../src/portal-plan').planDue(bot, goal).why, /^the route failed: the pool at \(70, 21, 39\)/);
  const { lavaRecord } = require('../src/obsidian');
  assert.match(lavaRecord(goal, { x: chosen.x, y: chosen.y, z: chosen.z }), /Its record: the staircase toward it is set aside \(3 rounds without getting closer\).*a plan's route to it chosen \d+ minutes? ago failed: the pool at \(70, 21, 39\)/);
});

test('none good on top at the stall: a surface search is offered with the pools\' records; another pool or a cast beside one is the plan\'s, asked again (note 767, note 782)', () => {
  const { portalJobs } = require('../src/work');
  const registry = require('minecraft-data')('26.1');
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'bucket', count: 2 }] },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }), findBlocks: () => [] };
  const goal = { gameProgress: { phase: 'reach_nether' }, landmarks: [
    { kind: 'lava_pool', dimension: 'overworld', x: 40, y: 64, z: 0, lastWalk: { at: Date.now(), began: 40, ended: 30, why: 'Took to long to decide path to goal!' } },
    { kind: 'lava_pool', dimension: 'overworld', x: -60, y: 64, z: 10 }],
    portalMethod: { kind: 'cast', key: 'beside_pool_0', near: { x: 40, y: 64, z: 0 }, lava: { way: 'pool', at: { x: 40, y: 64, z: 0 } }, minutes: 5, activeMs: 0, facts: { dimension: 'overworld', carriers: 2, deaths: 0, lavaKnown: [] } } };
  assert.deepEqual(portalJobs(bot, goal).map(j => j.key), ['replan_portal'], 'as before without none good on top: the plan asked again');
  bot._spells = { stillness_detour: { last: Date.now(), tops: [false, true] } };
  const jobs = portalJobs(bot, goal);
  assert.deepEqual(jobs.map(j => j.key), ['replan_portal', 'search_lava']);
  assert.match(jobs[1].description, /2 pools known within 256 blocks: 0 found spent, 0 whose way rests, 2 open: \(40, 64, 0\), 40 blocks off: the last walk there ended 30 blocks off \(from 40\): Took to long to decide path to goal!/);
});

test('the audit names a run of the crossing\'s label for the question asked under it, and a brief one is skipped', () => {
  const { analyse } = require('../scripts/lib/audit');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-767-'));
  const t0 = Date.parse('2026-09-30T21:14:00Z');
  const lines = [];
  const at = s => new Date(t0 + s * 1000).toISOString();
  const obs = (s, step) => lines.push(JSON.stringify({ kind: 'observation', label: 'observation', snapshot: { position: { x: 19.5, y: 71, z: -4.5 }, step }, at: at(s) }));
  const cast = { action: 'cast_portal', item: 'obsidian', slot: { x: 18, y: 73, z: -3 }, phase: 'dig_stand' }, label = { action: 'enter_nether', phase: 'reach_nether' };
  for (let k = 0; k < 4; k++) {
    obs(k * 8, cast); obs(k * 8 + 2, cast);
    obs(k * 8 + 4, label); obs(k * 8 + 5, label);
    lines.push(JSON.stringify({ kind: 'decision', label: 'cast_frame', snapshot: { decision: { id: 'portal_method', path: ['cast_frame'] } }, at: at(k * 8 + 4.5) }));
  }
  obs(33, label); obs(34, cast); obs(36, cast);
  fs.writeFileSync(path.join(dir, '127_0_0_1-25595-Jev-2026-09-30T21-13-00-000Z.jsonl'), lines.join('\n') + '\n');
  const r = analyse({ identity: '127_0_0_1-25595-Jev', from: t0 - 1000, to: t0 + 60000, dir });
  assert.deepEqual(r.flips.map(f => f.between), ['cast_portal <-> enter_nether (asking)']);
});

test('25585: trips for lava from a frame begun are measured, long or hurtful, and price the plan\'s routes next asked; a slow trip does not ask it by itself (note 782)', async () => {
  const { planDueNow } = require('../src/work');
  const { bot, log, actions } = castingBot({ water_bucket: 1, lava_bucket: 1, cobblestone: 64 });
  bot.entity.position = new Vec3(13.5, 64, 21.5);
  const goal = { portalFrame: newFrame('x'), portalMethod: { kind: 'cast', key: 'here_deep', lava: { way: 'deep' }, minutes: 40, activeMs: 200000, reasked: 0, from: {}, tripFrom: 50000, tripHealth: 20 } };
  goal.portalMethod.facts = require('../src/portal-plan').planFacts(bot, goal, {});
  bot.health = 12;
  for (let pass = 0; pass < 3 && !log.lava.length; pass++) await cast.castFrame(bot, new Task('cast'), goal, () => {}, actions);
  assert.equal(log.lava.length, 1);
  assert.deepEqual({ ...goal.portalMethod.lavaTrips }, { n: 1, ms: 150000, hurt: 8 });
  assert.equal(goal.portalMethod.tripsFar, undefined);
  assert.equal(planDueNow(bot, goal), null, 'not asked again for the trip alone: its stated minutes are what ask it');
});

test('25585: where the ground hurt the bot or its air ran low is remembered, and the walks after go round it', () => {
  const { noteHazard, hazardSpots, HAZARD_COST } = require('../src/skills');
  const bot = { game: { dimension: 'overworld' } };
  noteHazard(bot, new Vec3(-106.3, -10, -499.6), 'hurt by stalagmite');
  noteHazard(bot, new Vec3(-106.1, -10.2, -498.7), 'its air ran low');
  assert.equal(bot._hazardSpots.length, 1, 'one spot');
  assert.equal(bot._hazardSpots[0].n, 2);
  assert.equal(hazardSpots(bot, { x: 0, y: 64, z: 0 }).length, 1);
  assert.equal(hazardSpots(bot, { x: -107, y: -10, z: -500 }).length, 0, 'not where the walk is going');
  assert.equal(HAZARD_COST, 200);
  const src = fs.readFileSync(require.resolve('../src/skills'), 'utf8');
  assert.match(src, /near\.some\(s => s\.hazard\) \? HAZARD_COST/);
});
