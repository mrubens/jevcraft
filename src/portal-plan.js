'use strict';
// One portal plan (trial note 782).
//
// Fable's check-in of 05:43Z on 2026-10-01, problem 2: building the portal
// was the main waste before the blazes (15.65 h of the top-25 waste rows on
// reach_nether), and notes 767d/e/f, 777 and 777b were five patches on one
// lava decision in a day. The way to a portal was asked in pieces:
// portal_method (with re-asks every twenty working minutes, at walks no
// nearer, at the lava a third farther, at slow trips, at a flip, at a frame
// out of reach, at a site failure), lava_way, the stall's portal detours
// (to_known_lava, to_other_lava, dig_to_lava, cast_at_pool), buckets first,
// and the fetch's own pick of lava past a held pool. scripts/portal-plan.js
// read 172 fresh trials' portal rungs from 2026-09-30T17:00Z to 04:58Z on
// 2026-10-01: 651 portal_method and lava_way asks and 244 stall answers that
// chose a portal route, 432 plan changes, 199 of them the fetch's own switch
// of lava with no answer in the minute before; 8.9 rung minutes a lava
// bucket and 9.1 an obsidian.
//
// Now the way to a portal is one question, portal_plan (work.js
// portalMethod): each option a whole route (where the frame stands, the lava
// it is cast from and how the lava is got there, the buckets, the water),
// priced end to end at the record's paces with its failures said. The answer
// is held, and the work follows it with no switching of its own, until one
// of the named facts below changes; then it is asked again with that fact
// said:
//   failed     the route failed: the walks to its lava came no nearer, its
//              frame cannot be got back to, the frame fails at its site, the
//              staircase to its lava rests, its pool is found with no lava
//              or its way rests, its deep headings fail from here, the
//              portal's own steps trade the turn, or a stall's answer said
//              the route had failed (replan_portal)
//   lava       lava found that was not known when the plan was made, nearer
//              the frame (or, no frame begun, the bot) than the plan's lava
//   frame      the frame begun lost blocks of obsidian, or is gone
//   buckets    buckets lost: fewer carried (empty, lava and water together)
//              than the plan has had
//   death      a death since the plan was made
//   minutes    its own stated minutes worked through, and the portal not lit
// Physical safety stays the body's: none of these is a rule about where to
// get lava; each is a fact the next asking says.
const { Vec3 } = require('vec3');
const PLAN_MIN_MS = 10 * 60000;
const SAME_LAVA = 8;
// The cast's own pace, from the record (scripts/portal-plan.js and
// portal-time.js, fresh trials 2026-09-30T17:00Z to 2026-10-01T04:58Z):
// cast_portal 121.3 minutes over 598 obsidian cast (about 12 seconds a
// block, walls, pour, water and scoop back); a lava bucket scooped beside
// its pool 46.4 minutes over 607 (about 5 seconds).
const CAST_RECORD = { secondsABlock: 12, scoopSeconds: 5, window: 'fresh trials 2026-09-30T17:00Z to 2026-10-01T04:58Z' };
// What the plans came to (scripts/plan-outcomes.py, the fresh trials of
// 2026-09-30T12:00Z to 2026-10-02T03:00Z that made a portal plan, 242 of
// them, by the plan each ended on, note 865): the trials and how many
// reached the Nether. Said on each route by its kind.
const PLAN_RECORD = { window: 'the fresh trials of 2026-09-30T12:00Z to 2026-10-02T03:00Z',
  beside_pool: [95, 31], here_pool: [87, 39], beside_deep: [27, 0], here_deep: [3, 0], beside_sight: [17, 8], here_sight: [3, 1], new_site_pool: [6, 1] };
function planRecordSays(site, kind) {
  const r = PLAN_RECORD[`${site}_${kind}`];
  if (!r) return '';
  const deep = kind === 'deep' ? [PLAN_RECORD.beside_deep[0] + PLAN_RECORD.here_deep[0], PLAN_RECORD.beside_deep[1] + PLAN_RECORD.here_deep[1]] : null;
  const [n, ok] = deep || r;
  const others = kind === 'deep' ? `; of those that ended on a known pool, ${PLAN_RECORD.beside_pool[1] + PLAN_RECORD.here_pool[1]} of ${PLAN_RECORD.beside_pool[0] + PLAN_RECORD.here_pool[0]} did` : '';
  return ` In ${PLAN_RECORD.window}, ${n} trial${n === 1 ? '' : 's'} ended on ${kind === 'deep' ? 'a plan cast from the deep lava layer' : 'this kind of plan'}: ${ok ? `${ok} reached the Nether (${Math.round(100 * ok / n)}%)` : 'none reached the Nether'}${others}.`;
}
// A frame cast beside its lava stands within a few blocks of it (work.js
// selectPortalSite near the lava): each trip there and back is that walk.
const BESIDE_BLOCKS = 6;

const ROUTE = /^(here|beside|new_site)_(pool_\d+|deep|sight)$/;
const KEYS = /^(build_new|(?:here|beside|new_site)_(?:pool_\d+|deep|sight)|clear_blocker|other_stand|into_cave|ruin_\d+)$/;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sameLava = (a, b) => !!a && !!b && dist(a, b) <= SAME_LAVA;
const P = v => v && Number.isFinite(v.x) ? { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) } : null;
const countOf = (bot, name) => { try { return bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0); } catch (_) { return 0; } };
const carriersOf = bot => countOf(bot, 'bucket') + countOf(bot, 'lava_bucket') + countOf(bot, 'water_bucket');
const mins = s => s < 90 ? `about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : `about ${Math.round(s / 60)} minutes`;
const dimOf = bot => String(bot?.game?.dimension || 'overworld').replace(/^minecraft:/, '');

// The route's parts from its key: where the frame stands and the lava.
function parse(key) {
  const m = ROUTE.exec(String(key || ''));
  return m ? { site: m[1], lava: m[2] } : null;
}

// The price of a cast route, end to end: getting to where it works, the
// trips for the lava still owed (each carrying one lava a bucket), the
// buckets made first where they shorten it, and the cast of each block.
//   reach    seconds from the bot to where the work begins
//   trip     seconds of one trip for lava from the frame and back (beside
//            its lava: a scoop and a few blocks' walk)
//   cast     blocks still to cast; toFetch lava still to fetch; carriers
//            buckets carried (empty and full of lava)
//   iron     ingots, raw iron; furnace carried
// -> { seconds, trips, buckets, make, parts }
// `room`: the lava buckets the pockets hold at once (a full bucket does not
// stack: a slot each), where known. A plan of more buckets than that filled
// its pockets and asked what to drop at each fill: 25589 (mid-226-am,
// 2026-10-01 15:49-15:52Z) made 6 more for 10 with 3 slots free, and nine
// drop questions later had given up its cobblestone and its flint and
// steel, then needed cobblestone for the cast's walls (note 819).
function priceCast({ reach = 0, trip = 0, cast = 10, toFetch = 10, carriers = 0, ingots = 0, raw = 0, room = Infinity }) {
  const tripsWith = n => n > 0 ? Math.ceil(toFetch / Math.min(n, Math.max(1, room))) : Infinity;
  const castSeconds = cast * CAST_RECORD.secondsABlock;
  const makeSeconds = n => { const smelt = Math.max(0, 3 * n - ingots); return n ? 15 + smelt * 10 : 0; };
  const iron = ingots + raw;
  const most = Math.min(Math.floor(iron / 3), Math.max(0, toFetch - carriers), Math.max(0, room - carriers));
  let best = null;
  for (let more = carriers ? 0 : Math.min(1, most); more <= most; more++) {
    const trips = tripsWith(carriers + more);
    if (!Number.isFinite(trips)) continue;
    const seconds = reach + makeSeconds(more) + trips * trip + castSeconds;
    if (!best || seconds < best.seconds - 1) best = { seconds, trips, buckets: carriers + more, make: more, makeSeconds: makeSeconds(more) };
  }
  if (!best) return { seconds: null, trips: toFetch, buckets: 0, make: 0, makeSeconds: 0, castSeconds, reach, trip, noBucket: true };
  const carried = carriers ? { trips: tripsWith(carriers), seconds: reach + tripsWith(carriers) * trip + castSeconds } : null;
  return { ...best, castSeconds, reach, trip, carried, ...(Number.isFinite(room) ? { room } : {}) };
}
// A route's price in words: the parts and all of it.
function priceSays(p, { tripWhat = 'a trip for lava' } = {}) {
  if (p.seconds === null) return 'Not priced: no bucket is carried and no iron to make one (three ingots).';
  const parts = [];
  if (p.reach) parts.push(`getting there ${mins(p.reach)}`);
  if (p.make) parts.push(`${p.make} more bucket${p.make === 1 ? '' : 's'} made first, ${mins(p.makeSeconds)}`);
  if (Number.isFinite(p.room)) parts.push(`the pockets hold ${p.room} lava bucket${p.room === 1 ? '' : 's'} at once (a full one takes a slot of its own), so no more are carried a trip`);
  if (p.trips) parts.push(`${p.trips} trip${p.trips === 1 ? '' : 's'} with ${p.buckets} bucket${p.buckets === 1 ? '' : 's'}, ${tripWhat} ${mins(p.trip)} each`);
  parts.push(`casting the blocks ${mins(p.castSeconds)} (${CAST_RECORD.secondsABlock} seconds a block at the record's pace)`);
  const carried = p.make && p.carried ? ` With only the ${p.buckets - p.make} bucket${p.buckets - p.make === 1 ? '' : 's'} carried it would be ${p.carried.trips} trips, ${mins(p.carried.seconds)} in all.` : '';
  return `Priced end to end, ${mins(p.seconds)}: ${parts.join('; ')}.${carried}`;
}

// The plan's failures, kept for half an hour and said on every route that
// goes to the same lava or frame: what was chosen and what ended it.
const FAIL_KEEP_MS = 30 * 60000;
function failuresFor(goal, { lava = null, key = null } = {}, now = Date.now()) {
  return (goal.portalPlanFailures || []).filter(f => now - f.at < FAIL_KEEP_MS && ((key && f.key === key) || (lava && f.lava && (lava.deep ? f.lava.deep : !f.lava.deep && sameLava(f.lava, lava)))));
}
function failuresSays(goal, target, now = Date.now()) {
  const fs = failuresFor(goal, target, now);
  if (!fs.length) return '';
  return ` Chosen before and failed: ${fs.slice(-3).map(f => `${Math.max(1, Math.round((now - f.at) / 60000))} minutes ago, ${f.why}`).join('; ')}.`;
}

// The route held has failed: said, and the plan asked again at the next
// pass. Kept on the plan (failed) and in the plan's failures (each route
// that goes to the same lava says it).
function planFailed(goal, why, now = Date.now()) {
  const m = goal.portalMethod;
  if (!m) return false;
  if (!m.routeFailed) m.routeFailed = { why: String(why).slice(0, 220), at: now };
  goal.portalPlanFailures = [...(goal.portalPlanFailures || []).filter(f => now - f.at < FAIL_KEEP_MS), { key: m.key || null, lava: m.lava ? (m.lava.way === 'deep' ? { deep: true } : P(m.lava.at)) : null, why: String(why).slice(0, 220), at: now }].slice(-8);
  return true;
}

// The facts the plan is held against, taken when it is chosen.
function planFacts(bot, goal, { lavaKnown = [], lavaDistance = null, frameAt = null } = {}) {
  const frame = goal.portalFrame && !goal.portalFrame.ruin ? goal.portalFrame : null;
  return { carriers: carriersOf(bot), deaths: (goal.survival?.deaths || []).length, lastDeathAt: lastDeathAt(goal), dimension: dimOf(bot),
    lavaKnown: lavaKnown.map(P).filter(Boolean), lavaDistance, frameAt: P(frameAt),
    frame: frame ? { origin: P(frame.origin), standing: standingOf(bot, frame) } : null };
}
function lastDeathAt(goal) {
  const d = (goal.survival?.deaths || []).at(-1);
  const t = d ? Date.parse(d.at) : NaN;
  return Number.isFinite(t) ? t : (d ? 1 : 0);
}
function standingOf(bot, frame) {
  if (!frame || typeof bot.blockAt !== 'function') return null;
  let n = 0;
  for (const p of frame.blocks || []) { const b = bot.blockAt(new Vec3(p.x, p.y, p.z)); if (!b) return null; if (b.name === 'obsidian') n++; }
  return n;
}

// Whether the plan held is to be asked again, and why: the named facts.
// `lavaNow` is the lava known now, each { at, distance } from the frame (or
// the bot); `standing` the frame's obsidian now (null where not loaded).
function planDue(bot, goal, { lavaNow = [], standing = null, planDistance = null } = {}, now = Date.now()) {
  const m = goal.portalMethod;
  if (!m) return { kind: 'none', why: 'no plan is held' };
  const f = m.facts;
  if (m.routeFailed) return { kind: 'failed', why: `the route failed: ${m.routeFailed.why}` };
  if (m.nearFailed) return { kind: 'failed', why: `the route failed: ${m.nearFailed.walks} walks toward its lava came no nearer than ${m.nearFailed.best} blocks` };
  if (m.frameFailed) return { kind: 'failed', why: 'the route failed: its frame cannot be got back to' };
  if (m.siteFailed) return { kind: 'failed', why: 'the route failed: the frame fails at its site' };
  if (m.flipped) return { kind: 'failed', why: `the route failed: the portal's own steps were ${m.flipped.why}` };
  // A plan from before the plan (a held way with no facts): asked as one.
  if (!f) return m.kind === 'ruin' ? null : { kind: 'none', why: 'the way held was chosen before the plan question' };
  // The deaths are kept ten deep (recovery.js): read by the last one's time.
  if (lastDeathAt(goal) > (f.lastDeathAt ?? 0) || (f.lastDeathAt === undefined && (goal.survival?.deaths || []).length > (f.deaths || 0))) return { kind: 'death', why: 'a death since the plan was chosen' };
  const carriers = carriersOf(bot);
  if (carriers > (f.carriers || 0)) f.carriers = carriers;
  else if (carriers < (f.carriers || 0)) return { kind: 'buckets', why: `buckets lost: ${carriers} carried (empty, lava and water), ${f.carriers} before` };
  // The frame begun losing obsidian, or gone with obsidian in it.
  const frame = goal.portalFrame && !goal.portalFrame.ruin ? goal.portalFrame : null;
  if (f.frame?.standing) {
    if (!frame || !sameLava(frame.origin, f.frame.origin)) return { kind: 'frame', why: `the frame at (${f.frame.origin.x}, ${f.frame.origin.y}, ${f.frame.origin.z}), ${f.frame.standing} of ten cast, is gone` };
  }
  if (frame && Number.isFinite(standing)) {
    if (f.frame && sameLava(frame.origin, f.frame.origin)) {
      if (Number.isFinite(f.frame.standing) && standing < f.frame.standing) return { kind: 'frame', why: `the frame at (${frame.origin.x}, ${frame.origin.y}, ${frame.origin.z}) has lost obsidian: ${standing} of ten standing, ${f.frame.standing} before` };
      if (!Number.isFinite(f.frame.standing) || standing > f.frame.standing) f.frame.standing = standing;
    } else f.frame = { origin: P(frame.origin), standing };
  }
  // Lava not known when the plan was made, nearer than the plan's (from the
  // same place, now): `lavaNow` is the lava the caller reads as new.
  const planAt = Number.isFinite(planDistance) ? planDistance : f.lavaDistance;
  if (Number.isFinite(planAt)) {
    const fresh = lavaNow.filter(l => l?.at && !(m.lava?.at && sameLava(m.lava.at, l.at)));
    const nearer = fresh.filter(l => l.distance < planAt).sort((a, b) => a.distance - b.distance)[0];
    // Known from here on: one place for each sixteen blocks of it (a lake in
    // sight is many cells), the plan's own first and never dropped.
    for (const l of fresh) if (!f.lavaKnown.some(k => Math.hypot(k.x - l.at.x, k.z - l.at.z) <= 16 && Math.abs(k.y - l.at.y) <= 16)) f.lavaKnown.push(P(l.at));
    if (f.lavaKnown.length > 128) f.lavaKnown.splice(0, f.lavaKnown.length - 128);
    if (nearer) return { kind: 'lava', why: `lava found at (${Math.round(nearer.at.x)}, ${Math.round(nearer.at.y)}, ${Math.round(nearer.at.z)}) (${nearer.how || 'known'}), ${nearer.distance} blocks ${frame ? 'from the frame' : 'off'}, nearer than the plan's lava (${planAt})` };
  }
  // Its own stated minutes worked through.
  const stated = Math.max(PLAN_MIN_MS, (m.minutes || 0) * 60000);
  if ((m.activeMs || 0) >= stated) return { kind: 'minutes', why: `its own stated ${m.minutes ? `${m.minutes} minutes` : 'time'} worked through (${Math.round((m.activeMs || 0) / 60000)} minutes worked) and no portal lit` };
  return null;
}

// What the plan held says when it is asked again: the fact and what it
// made since.
function askedAgainSays(due) {
  return due && due.kind !== 'none' ? ` Asked again because ${due.why}.` : '';
}

module.exports = { planRecordSays, PLAN_RECORD, priceCast, priceSays, planFailed, planFacts, planDue, askedAgainSays, failuresFor, failuresSays, parse, standingOf, carriersOf, CAST_RECORD, BESIDE_BLOCKS, PLAN_MIN_MS, ROUTE, KEYS, sameLava };
