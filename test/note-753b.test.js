'use strict';
// Note 753b: after note 753 went live (12:42Z, 2026-09-30), the live critic's
// report of 13:05Z, items 2 and 4.
// (a) 25589 (mid-243-jg) cast beside its lava at (21, 67, -4), but at 12:53:49Z
// took the climb for a site (0.76, told "about 15 seconds") over digging
// one where it stood (0.20, eleven blocks from the lava), neither told the
// bucket trips; the site came 43 blocks off and 18 up, and each bucket was
// a round trip of 45 s to 2.5 min.
// (b) On those trips the walk back up stalled at the same climb,
// (22-23, 77-80, -3 to -4), five times, 12:59:38 to 13:06:06Z.
// (c) 25597 (mid-241-ba) found a lava pool 30 blocks off at 13:04:32Z; the
// rung's step came to a rest and the detours offered explore, a river,
// earn_xp and more, never that pool.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

// Flat stone at y 63, open above; the floor cells a portal site can stand on.
function flatBot({ at = new Vec3(0.5, 64, 0.5), floors = [] } = {}) {
  const bot = {
    registry, game: { gameMode: 'survival', dimension: 'overworld' }, entities: {}, entity: { position: at },
    inventory: { items: () => [{ name: 'bucket', count: 1 }, { name: 'water_bucket', count: 1 }] },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 64 ? 'block' : 'empty' }),
    findBlocks: ({ useExtraInfo = () => true }) => floors.filter(p => useExtraInfo(bot.blockAt(p))).map(p => p.clone()),
  };
  return bot;
}

test('a cast frame\'s site is weighed with its bucket trips: beside the lava over nearer the bot (25589 mid-243-jg, note 753b)', () => {
  const { selectPortalSite } = require('../src/build-sites');
  const bot = flatBot({ floors: [new Vec3(4, 63, 0), new Vec3(40, 63, 0)] });
  // Before: the nearest to the bot.
  assert.equal(selectPortalSite(bot).x, 4);
  // A cast owing nine trips to lava at (46, 63, 0): the site beside it.
  const site = selectPortalSite(bot, { cast: { lava: { x: 46, y: 63, z: 0 }, trips: 9 } });
  assert.equal(site.x, 40);
  // One trip owed and the lava nearly as far from both: nearness decides.
  assert.equal(selectPortalSite(bot, { cast: { lava: { x: 22, y: 63, z: 60 }, trips: 1 } }).x, 4);
});

test('the dug site and the climb say the cast\'s bucket trips from each (25589, 12:53:49Z, note 753b)', () => {
  const { castSiteSays } = require('../src/work');
  const cast = { lava: { x: 21, y: 67, z: -4 }, trips: 9, toFetch: 9, carriers: 1 };
  const dug = castSiteSays(new Vec3(21, 78, -3), cast);
  assert.match(dug, /The cast still owes 9 lava buckets \(1 bucket carried\): 9 trips from a frame here to the lava at \(21, 67, -4\) and back, 11 blocks off and 11 down, about \d+ (seconds|minutes) a trip, \d+ (seconds|minutes) in all\./);
  const top = castSiteSays(new Vec3(21, 87, -3), cast, { atLeast: true });
  assert.match(top, /20 blocks off and 20 down, at least about/);
  const secs = s => { const m = s.match(/(\d+) (seconds|minutes) in all/); return m[2] === 'minutes' ? m[1] * 60 : +m[1]; };
  assert(secs(top) > secs(dug), `${top} | ${dug}`);
  // Not casting, or no lava: nothing said.
  assert.equal(castSiteSays(new Vec3(0, 0, 0), null), '');
});

test('a spot walks stall at again and again is routed round on the next walks, not the goal itself (25589 12:59:38-13:06:06Z, note 753b)', async () => {
  const { noteStallSpot, badSteps, navigate, STALL_SPOT_COST } = require('../src/skills');
  const bot = flatBot({ at: new Vec3(22.5, 78, -3.5) });
  const far = { x: 21, y: 85, z: -47 };
  noteStallSpot(bot, new Vec3(22.8, 80.2, -2.4));
  assert.equal(badSteps(bot, far).length, 0, 'once is a stall, not a bad step');
  noteStallSpot(bot, new Vec3(22.5, 78.0, -3.6));
  assert.equal(badSteps(bot, far).length, 1, 'twice within three blocks');
  assert.equal(badSteps(bot, { x: 23, y: 79, z: -3 }).length, 0, 'not when it is where the walk is going');
  // A walk: the cells about the spot cost more while it runs, and not after.
  let seen = null;
  const movements = {};
  Object.assign(bot, { pathfinder: { movements, goto: async () => { seen = movements.exclusionAreasStep; }, setGoal: () => {}, isMoving: () => false },
    clearControlStates: () => {}, getControlState: () => false, setControlState: () => {}, food: 20 });
  const { goals } = require('mineflayer-pathfinder');
  await navigate(bot, new Task('walk'), new goals.GoalNear(far.x, far.y, far.z, 3), { timeoutMs: 2000 }).catch(() => {});
  assert(seen?.length, 'routed round while walking');
  assert.equal(seen.at(-1)({ position: new Vec3(23, 79, -3) }), STALL_SPOT_COST);
  assert.equal(seen.at(-1)({ position: new Vec3(30, 79, -3) }), 0);
  assert.equal(movements.exclusionAreasStep, undefined, 'put back after');
});

test('with a lava pool known and the rung on the portal, the detours name it first (25597 mid-241-ba 13:04:32Z, note 753b)', async () => {
  const { portalJobs, detourWork } = require('../src/work');
  const bot = flatBot({ at: new Vec3(-118.5, 65, -609.5) });
  bot.time = { timeOfDay: 13000 }; // dusk: the day work stays off, to keep this small
  const goal = { kind: 'win', gameProgress: { phase: 'reach_nether' }, landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: -149, y: 62, z: -611 }] };
  const jobs = portalJobs(bot, goal);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].key, 'to_known_lava');
  assert.match(jobs[0].description, /^The portal's own work: go to the lava pool found at \(-149, 62, -611\), 31 blocks off, about \d+ seconds\. A frame cast beside it makes each of the 10 lava buckets still owed a trip of seconds \(1 bucket carried\)/);
  const work = await detourWork(bot, new Task('detour'), goal, () => {}, {});
  assert.equal(work[0].key, 'to_known_lava', `first: ${work.map(w => w.key)}`);
  // Not on another rung, and not with the pool spent.
  assert.equal(portalJobs(bot, { ...goal, gameProgress: { phase: 'iron_pickaxe' } }).length, 0);
  assert.equal(portalJobs(bot, { ...goal, landmarks: [{ ...goal.landmarks[0], spent: 'x' }] }).length, 0);
  // A frame begun far off: back to it, before any lava.
  const framed = { ...goal, portalFrame: { origin: { x: -80, y: 64, z: -600 }, blocks: [{ x: -80, y: 64, z: -600 }], cast: true } };
  assert.equal(portalJobs(bot, framed)[0].key, 'to_portal_frame');
});

test('in the stall\'s question the portal job comes ahead of the stalled work\'s own answers (note 753b)', () => {
  const src = require('fs').readFileSync(require.resolve('../src/work'), 'utf8');
  const i = src.indexOf('for (const w of work.filter(w => PORTAL_JOB.test(w.key)))'), j = src.indexOf('for (const [key, answer] of Object.entries(answers)) offer(');
  assert(i > 0 && j > i);
});

test('with no site to dig at the feet, a flat floor cut a few blocks off is found and priced, the one nearer the lava for a cast (25598 mid-241-bc 13:24:25Z, note 753b)', () => {
  const { portalSiteDig } = require('../src/build-sites');
  // Stone below y 64, open above; water beside the feet's own sites.
  const water = new Set(['0,64,1', '0,64,-1', '-1,64,0', '1,64,0', '2,64,0', '-2,64,0', '3,64,0', '-3,64,0']);
  const bot = {
    registry, entity: { position: new Vec3(0.5, 64, 0.5) },
    blockAt: p => water.has(`${p.x},${p.y},${p.z}`) ? { name: 'water', position: p, boundingBox: 'empty', getProperties: () => ({}) }
      : { name: p.y < 64 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 64 ? 'block' : 'empty', diggable: true, getProperties: () => ({}) },
  };
  assert.equal(portalSiteDig(bot), null, 'before: the feet\'s own sites only, all beside water');
  const any = portalSiteDig(bot, { radius: 6 });
  assert(any, 'a site a few blocks off');
  assert(Math.abs(any.origin.x) > 1 || Math.abs(any.origin.z) > 1);
  const cast = portalSiteDig(bot, { radius: 6, cast: { lava: { x: 20, y: 63, z: 0 }, trips: 9 } });
  assert(cast.origin.x >= 3, `toward the lava: ${cast.origin}`);
});

test('the climb for a cast says its trips even with no site to dig offered, and gives up the cast beside the lava; the climb for water says the water known (25598, 25584, note 753b)', () => {
  const src = require('fs').readFileSync(require.resolve('../src/work'), 'utf8');
  assert.match(src, /if \(cast\?\.lava && cost\) \{/);
  assert.match(src, /Casting beside the lava was chosen so each bucket is a short trip; a frame up there gives that up\./);
  assert.match(src, /Water known from here: \$\{known\.says\}/);
  assert.match(src, /portalSiteDig\(bot, \{ avoid, radius: 6, cast \}\)/);
});

// A frame's slot at (1, 64, 0) on the x axis, in a world given by `solid`.
function slotWorld(solid, items = []) {
  const bot = { registry, entity: { position: new Vec3(1.5, 64, 3.5) }, inventory: { items: () => items },
    blockAt: p => ({ name: solid(p) ? 'stone' : 'air', position: p.clone(), boundingBox: solid(p) ? 'block' : 'empty', diggable: true }) };
  const frame = { origin: { x: 0, y: 64, z: 0 }, axis: 'x', cast: true, blocks: [{ x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }], castTemp: [] };
  return { bot, frame, p: new Vec3(1, 64, 0) };
}

test('the ways to a stand for a slot are counted and said, for the failure and for the check before a lava fetch (25581, 25593, note 753b)', () => {
  const { standWays, view } = require('../src/portal-cast');
  const flat = slotWorld(p => p.y < 64);
  const open = standWays(flat.bot, flat.frame, flat.p, view(flat.bot));
  // Walls not yet up: no stand a pour reaches yet, but open floored cells beside it.
  assert(open.stands + open.blocked > 0, open.says);
  // In the rock: no stand, but cells to dig out.
  const rock = slotWorld(p => !(p.x === 1 && p.z === 0 && p.y >= 64));
  const dug = standWays(rock.bot, rock.frame, rock.p, view(rock.bot));
  assert.equal(dug.stands, 0); assert(dug.cut > 0, dug.says);
  // Nothing under anything and no block carried: none of any, said.
  const air = slotWorld(p => p.y === 63 && p.x === 1 && p.z === 0);
  const none = standWays(air.bot, air.frame, air.p, view(air.bot));
  assert.deepEqual([none.stands, none.make, none.cut, none.blocked], [0, 0, 0, 0]);
  assert.match(none.says, /^0 stands beside it a pour reaches it from, 0 to make with a block put under, 0 to dig out, and 0 open cells with a floor that are not yet a stand \(the slot's walls not up, or the line into it blocked\)$/);
});

test('a frame kept at its failure is held for the next few of the same kind, a failure from under the frame is the trip\'s, and the site is checked before the lava fetch (note 753b)', () => {
  const work = require('fs').readFileSync(require.resolve('../src/work'), 'utf8');
  assert.match(work, /const heldOn = kept && kept\.cast === castIn && frame\.siteFailed\.n - kept\.n < 3/);
  assert.match(work, /\/\^No route from here\/\.test\(String\(err\.message\)\) && \(bot\.entity\.position\.y < frame\.origin\.y - 2/);
  assert.match(work, /keptAtFailure: method\.keptAtFailure/);
  const cast = require('fs').readFileSync(require.resolve('../src/portal-cast'), 'utf8');
  assert.match(cast, /found before fetching lava: \$\{ways\.says\}/);
  assert.match(cast, /stepIs\(p, 'clear_line'/);
});
