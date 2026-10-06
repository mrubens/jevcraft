'use strict';
// What has been tried, and what came of it: one ledger for every action.
//
// "Busy but going nowhere" had one shape under many names (the design
// review of note 571). On 25592 fortress_approach was answered other_way
// 4,423 times; note 560's repeat hold fired 589 times, and each hold went to
// the stall's detour, "differently", an eight-block walk that reset every
// counter, after which the planner derived the same failing way again. Each
// place that offered ways kept its own memory of what had failed (the
// approach's failed list, the legs' history and rests, the fortress
// shunned, the ways left, the detour log, the stance tried here, the
// answers that came to nothing), each with its own radius and clock, and
// none of them saw the others. A way left by one was offered by the next.
//
// Here every answer given (asked or the one way taken) is an entry:
//   q, method     the question and the answer (the option's key)
//   target        where the option was going, when it says so; else the
//                 entry is about the place it was tried from
//   place, at     where the bot stood and when
//   work          the work it was for (stillness.js actionOf key)
//   outcome       pending, progressed (something measurable came of it: for
//                 an answer under a rung a change in the rung's own measure,
//                 rung-measure.js and note 646; else repeats.js cameOf),
//                 blocked (nothing did, or it failed),
//                 waited (a wait chosen: its point is to stay), done or
//                 impossible
//   why, gained   what it ended with, or what came of it
// An entry is settled when its question is asked again (the answer before
// has ended), when the loop's pass ends in progress or a failure, or when a
// child question below it finds nothing left to try (escalate).
//
// What is read back, by every question about playing the game (decide):
// an option tried from within four blocks of here (or, for one with a
// target, toward the same target from within sixteen) in the last ten
// minutes and blocked is said on the option ("tried 2 times from here in
// the last 3 minutes, and it came to nothing: No path"); blocked twice, it
// rests five minutes from the last, left out and said in the state
// (waysResting). With every option resting, the question is not asked:
// the question above it is (escalate), with this one's failure said.
const { mark, cameOf, whyItEnded } = require('./decisions/repeats');
const RM = require('./rung-measure');

const NEAR = 4;             // "from here"
const TARGET_NEAR = 4;      // the same target
const TARGET_FROM = 16;     // toward a target, from about here
const WINDOW_MS = 10 * 60000;
const REST_AFTER = 2;
const REST_MS = 5 * 60000;
const KEEP = 160;
const RUNG_MS = 10 * 60000;

// A wait is an entry with an outcome too (note 599): a wait chosen (a
// pocket's stay, a pillar's top, a bunker, the back to a wall, the wait for
// day, a stance held to its estimate) is judged, when it ends, by what
// changed in its world while it lasted: the health, the food, the bot's
// place, the nearest mob within SCENE_RADIUS (come, gone, or nearer or
// farther by SCENE_NEARER), the mobs in sight, a swing. A wait of
// WAIT_JUDGED_MS or more whose world did not change came to nothing: it is
// blocked, and rests and escalates as a way does. The ledger had recorded
// every wait as `waited`, never come to nothing, so a pocket stayed in for
// thirty-three minutes (note 589) and a pillar held for twelve (note 590)
// were each a fresh answer every time they were asked.
const SCENE_RADIUS = 16, SCENE_NEARER = 4, WAIT_JUDGED_MS = 10000;
const P = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? { x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, z: Math.round(v.z * 10) / 10 } : null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ago = ms => ms < 90000 ? plural(Math.max(1, Math.round(ms / 1000)), 'second') : plural(Math.round(ms / 60000), 'minute');
const label = s => String(s || '').replaceAll('_', ' ');

function ledger(goal) {
  const t = goal.tried ||= { entries: [], escalations: [] };
  t.entries ||= []; t.escalations ||= [];
  return t;
}
// A hold still in force is kept whatever came after it: kept only among the
// last KEEP entries, it was dropped within a minute and a half by the one
// way taken at every pass after it, and the held answer was offered again
// (the replay of mid-243-af-fortress-4, note 611).
function prune(t, now) {
  const live = t.entries.filter(e => e.outcome === 'pending' ? now - e.at < 3 * WINDOW_MS : now - e.at < 2 * WINDOW_MS);
  const kept = new Set(live.slice(-KEEP));
  t.entries = live.filter(e => kept.has(e) || (e.held && e.until > now) || (e.noop && e.noop.until > now));
  t.escalations = t.escalations.filter(e => now - e.at < WINDOW_MS).slice(-20);
}
function workOf(goal, now) { try { return require('./stillness').actionOf(goal, now).key; } catch (_) { return null; } }

// The world a wait is judged by, now: `mobs` (danger.js threats' shape) may
// be given; else read within SCENE_RADIUS.
function sceneOf(bot, { now = Date.now(), mobs = null } = {}) {
  let list = mobs;
  if (!list) { try { list = require('./danger').threats(bot, SCENE_RADIUS) || []; } catch (_) { list = []; } }
  list = list.filter(t => t?.entity && t.distance <= SCENE_RADIUS).sort((a, b) => a.distance - b.distance);
  const n = list[0];
  return { at: now, health: Number.isFinite(bot?.health) ? Math.round(bot.health * 10) / 10 : null, food: Number.isFinite(bot?.food) ? bot.food : null, pos: P(bot?.entity?.position),
    nearest: n ? { id: n.entity.id ?? null, name: n.entity.name, distance: Math.round(n.distance * 10) / 10, visible: !!n.visible } : null,
    inSight: list.filter(t => t.visible).length, swingAt: bot?._defenseAttackAt || 0 };
}
// What changed between two scenes, in words; empty when nothing did.
function sceneChanges(a, b) {
  if (!a || !b) return [];
  const out = [];
  if (Number.isFinite(a.health) && Number.isFinite(b.health) && Math.abs(b.health - a.health) >= 1) out.push(`health ${a.health} to ${b.health}`);
  if (Number.isFinite(a.food) && Number.isFinite(b.food) && Math.abs(b.food - a.food) >= 1) out.push(`hunger ${a.food} to ${b.food}`);
  if (a.pos && b.pos && dist(a.pos, b.pos) >= 2) out.push(`moved ${Math.round(dist(a.pos, b.pos))} blocks`);
  const m = a.nearest, n = b.nearest;
  if (m && !n) out.push(`nothing within ${SCENE_RADIUS} blocks now (the ${label(m.name)} was ${Math.round(m.distance)} off)`);
  else if (!m && n) out.push(`a ${label(n.name)} come within ${Math.round(n.distance)} blocks`);
  else if (m && n && Math.abs(n.distance - m.distance) >= SCENE_NEARER) out.push(`the nearest mob ${n.distance < m.distance ? 'nearer' : 'farther'}, ${Math.round(m.distance)} to ${Math.round(n.distance)} blocks off`);
  if (a.inSight !== b.inSight) out.push(`${a.inSight} in sight to ${b.inSight}`);
  if (b.swingAt > a.at) out.push('a swing made');
  return out;
}
const sceneSays = s => `health ${s.health ?? '?'}${s.nearest ? `, the ${label(s.nearest.name)} ${Math.round(s.nearest.distance)} blocks off${s.nearest.visible ? ' in sight' : ' out of sight'}` : `, nothing within ${SCENE_RADIUS} blocks`}, no swing`;

// An answer given: pending until something is seen to come of it or not.
// offered: the options the question offered ({ key, target }), kept so a
// question above can tell whether this one has ways left (spent).
function begin(bot, goal, { q, method, target = null, waiting = false, offered = null, now = Date.now() }) {
  if (!bot || !goal || !q || !method) return null;
  const t = ledger(goal); prune(t, now);
  const here = P(bot.entity?.position);
  const entry = { q, method, ...(P(target) ? { target: P(target) } : {}), place: here, at: now, work: workOf(goal, now), outcome: 'pending', mark: mark(bot), ...(waiting ? { waiting: true, scene: sceneOf(bot, { now }) } : {}),
    ...(offered?.length ? { offered: offered.map(o => ({ key: o.key, ...(P(o.target) ? { target: P(o.target) } : {}) })) } : {}) };
  // An answer to a question below the rung is judged by the rung's own measure
  // (rung-measure.js, note 646), read as it began.
  const rung = waiting ? null : measuredBy(goal, q, now, { stall: true });
  const parts = rung ? measureOf(bot, goal, rung) : null;
  if (parts) { RM.observe(parts, bestsOf(t), now); entry.rung = rung; entry.measure = RM.values(parts); }
  t.entries.push(entry);
  return entry;
}

// A thing that was done outright and ended (a step that failed, a way the
// code took unasked): written settled.
function record(bot, goal, { q, method, target = null, outcome, why = null, gained = null, now = Date.now() }) {
  if (!goal || !q || !method) return null;
  const t = ledger(goal); prune(t, now);
  const entry = { q, method, ...(P(target) ? { target: P(target) } : {}), place: P(bot?.entity?.position), at: now, work: workOf(goal, now), outcome, ...(why ? { why: String(why).slice(0, 200) } : {}), ...(gained ? { gained } : {}), settledAt: now };
  t.entries.push(entry);
  if (outcome === 'blocked') require('./block-stock').pickaxeWanted(bot, goal, entry);
  return entry;
}

// The stall's answers and the rung's are judged by the rung: a detour that
// walks eight blocks off is new ground by the three-block measure, and on
// 25592 each "differently" reset every counter while the rods came no
// nearer (note 571). Something came of one when the rung has a new best
// since.
const RUNG_JUDGED = new Set(['stillness_detour', 'rung_progress']);
// The rung an answer is for, when its question is one of the work's own (under
// the rung's, not the stall's): judged by the rung's measure. null otherwise:
// the survival layer's stances and the routing keep their own judgments.
// The stall's answers and the rung's are judged by the rung's best, and carry the
// measure too, so that one that comes to nothing says what did not change.
function measuredBy(goal, q, now = Date.now(), { stall = false } = {}) {
  if (RUNG_JUDGED.has(q) ? !stall : !workBelowRung(q)) return null;
  return rungOf(goal, now);
}
// The names the step in hand is for: its item, what it drops, its resource or block.
function stepItemsOf(goal) {
  const step = goal?.step?.action === 'combined_request' ? goal.step.detail : goal?.step;
  return [step?.item, step?.drops, step?.resource, step?.block].filter(n => typeof n === 'string' && n);
}
function measureOf(bot, goal, rung) {
  let target = null;
  try { target = require('./stillness').actionOf(goal).target; } catch (_) { /* none */ }
  try { return RM.parts(bot, goal, { rung, items: rungItems(goal, rung), target, stepItems: stepItemsOf(goal) }); } catch (_) { return null; }
}
const bestsOf = t => t.bests ||= {};
// The rung's measure now, as values, for the repeat rule's looks.
function measureMark(bot, goal, q) {
  const rung = measuredBy(goal, q);
  const parts = rung && bot?.entity?.position ? measureOf(bot, goal, rung) : null;
  return parts ? { rung, v: RM.values(parts) } : null;
}
// What a wait brought, by its mark: a walk off (cameOf's own measure), or
// more carried of what is worth keeping; a block laid or dug is its own
// building, and a block used up for its walls is not a gain either (a box
// of wool or planks lowers what is carried).
function waitBrought(before, bot) {
  if (!before) return null;
  const now = mark(bot);
  const moved = cameOf({ ...before, worth: now.worth, blocks: now.blocks, progressAt: 0 }, now, Infinity);
  if (moved) return moved;
  return now.worth > before.worth ? 'more carried' : null;
}
// A walk toward a place is judged by how near it came, not by how far it
// moved (note 629). On mid-243-af-nether-3-fortress-5 (25586) the bot dug a
// tunnel toward the crimson stems it needed, was taken 30 blocks back along it
// by the way to the portal, and walked to the stems again, eleven times in
// forty minutes; each walk was "moved 30 blocks" and so getting somewhere,
// the ledger said "cross to 1 toward (-178, 72, -112), 3 times, 3 of them
// getting somewhere", and nothing rested or went to the question above. An
// answer that had a place to go (option.target) is getting somewhere when it
// ends nearer that place than any answer of its question toward it did before
// (by NEARER blocks), or when it was brought from afar; one that began where
// an earlier one ended (the bot had been taken back) and ended no nearer than
// that one walked its own ground. What else came of it (something carried, a
// block dug in a new cell, the stall watch's progress) still counts.
const NEARER = 2;
// The walk began within this of where the nearest earlier one ended: the bot had been taken back, not brought from afar.
const TAKEN_BACK = 64;
function reachOf(goal, e, bot) {
  const here = P(bot?.entity?.position);
  if (!e.target || !here || e.waiting) return null;
  const reached = Math.round(dist(here, e.target) * 10) / 10;
  const earlier = (goal?.tried?.entries || []).filter(o => o !== e && o.q === e.q && o.target && o.at < e.at && Number.isFinite(o.reached) && dist(o.target, e.target) <= TARGET_FROM);
  const best = earlier.length ? earlier.reduce((m, o) => o.reached < m.reached ? o : m) : null;
  return { reached, best, here };
}
// What the rung's measure says of an answer under it, and where the bot is.
function judgeOwn(bot, goal, e, now) {
  const parts = measureOf(bot, goal, e.rung);
  if (!parts) return null;
  return { ...RM.judge({ before: e.measure, parts, store: bestsOf(ledger(goal)), since: e.at, at: now }), here: P(bot.entity?.position) };
}
function settleOne(bot, goal, e, { error = null, now = Date.now(), onlyIf = null } = {}) {
  if (e.outcome !== 'pending') return false;
  const rung = goal?.tried?.rung;
  const byRung = RUNG_JUDGED.has(e.q) && rung && rung.rung === rungOf(goal);
  // An answer under the rung is judged by the rung's measure over its life,
  // not by the ground it walked (note 646); a walk toward a place of its own
  // is judged by its nearest approach, below.
  const own = !e.waiting && e.rung && e.measure ? judgeOwn(bot, goal, e, now) : null;
  // A stall's answer that brought something home (a hunt's meat, a block
  // of ore) got somewhere, though not on the rung; its walk alone did not.
  const walked = e.mark ? cameOf(e.mark, mark(bot), e.at) : null;
  let carried = own ? own.came : walked;
  const reach = byRung ? null : reachOf(goal, e, bot);
  let noNearer = null;
  if (reach) {
    e.reached = reach.reached; e.endedAt = reach.here;
    const back = reach.best?.endedAt && e.place && dist(e.place, reach.best.endedAt) <= TAKEN_BACK;
    const noNearerThanBest = back && reach.reached >= reach.best.reached - NEARER;
    const sayNoNearer = () => `ended ${Math.round(reach.reached)} blocks from it, no nearer than the ${Math.round(reach.best.reached)} an answer toward it reached ${ago(Math.max(0, e.at - (reach.best.settledAt || reach.best.at)))} before this began`;
    if (own) {
      // Its own target is a position measure: nearer it than it began, and
      // than any answer toward it has come since it was left (note 629).
      const began = e.place ? dist(e.place, e.target) : Infinity;
      if (!carried && /^moved /.test(walked || '')) {
        if (noNearerThanBest) { noNearer = sayNoNearer(); e.noNearer = true; }
        else if (reach.reached < began - NEARER) carried = `${walked} toward its own target, ${Math.round(reach.reached)} blocks off it`;
      }
    } else if (noNearerThanBest && /^moved /.test(carried || '')) {
      noNearer = sayNoNearer();
      carried = cameOf({ ...e.mark, x: NaN }, mark(bot), e.at);
      if (!carried) e.noNearer = true;
    }
  }
  // A wait's own building is not something come of it: the walls of a box,
  // the blocks of a cover or a pocket, a window dug. Counted as getting
  // somewhere, a box by a blaze spawner was chosen sixteen times in
  // thirty-five minutes on mid-242-ba-fortress-5 and "2 of 3 getting
  // somewhere" each time its walls went back in, with no blaze killed and
  // nothing changed about it; it never came to nothing, never rested and was
  // never said so (note 620). A wait is judged by its world (sceneChanges)
  // and by what it brought (more carried, a walk off), not its blocks.
  const came = byRung ? (rung.bestAt > e.at ? `a new best on the ${rungSays(rung.rung)} (${rung.lastBest || 'progress'})` : own?.came || (walked === 'what is carried changed' ? walked : null))
    : e.waiting ? waitBrought(e.mark, bot)
    : carried;
  if (onlyIf === 'decided' && !came && !error) return false;
  if (came) { e.outcome = 'progressed'; e.gained = came; }
  else if (e.waiting && !error) {
    // Judged by what changed in its world while it lasted (note 599).
    const changes = e.scene ? sceneChanges(e.scene, sceneOf(bot, { now })) : ['not watched'];
    if (changes.length || now - e.at < WAIT_JUDGED_MS) { e.outcome = 'waited'; if (changes.length && e.scene) e.gained = changes.join(', '); }
    else { e.outcome = 'blocked'; e.wait = true; e.heldMs = now - e.at; e.why = `held ${ago(now - e.at)} and nothing changed: ${sceneSays(e.scene)} throughout`; }
    delete e.scene;
  }
  // Cut short by the survival layer (air, a threat) or a cancellation, with
  // nothing come of it: not a try that came to nothing (note 583).
  else if (e.cut && !error) { e.outcome = 'cut'; e.why = e.cut; }
  else {
    e.outcome = 'blocked';
    const said = own ? RM.says(own.nothing, e.place && own.here ? dist(e.place, own.here) : NaN, { food: /food/.test(e.q) }) : null;
    const why = [error || ownFailure(bot, goal, e) || noNearer, said].filter(Boolean).join('; ');
    if (why) e.why = String(why).replace(/^Stalled: /, '').slice(0, 200);
  }
  e.settledAt = now; delete e.mark; delete e.scene; delete e.measure;
  if (e.outcome === 'blocked') require('./block-stock').pickaxeWanted(bot, goal, e);
  return true;
}
// Settled: the pending answers to one question (it is being asked again),
// or all of them at a pass's end. At a pass's end an answer still under way
// (nothing come of it yet, and no failure) stays pending: a leg walks over
// many passes.
function settle(bot, goal, { q = null, error = null, now = Date.now(), passEnd = false } = {}) {
  const t = goal?.tried;
  if (!t?.entries) return 0;
  let n = 0;
  for (const e of t.entries) if (e.outcome === 'pending' && (!q || e.q === q) && settleOne(bot, goal, e, { error, now, onlyIf: passEnd ? 'decided' : null })) n++;
  return n;
}

// The answers under way when the survival layer took the turn or the work
// was cancelled: said as cut short when next settled, not as tries that
// came to nothing (note 583).
// `before`: only those answered before then (a turn of the strategy cuts
// the work it leaves, not its own answer, note 854).
function cut(goal, why, now = Date.now(), { before = Infinity } = {}) {
  for (const e of goal?.tried?.entries || []) if (e.outcome === 'pending' && !e.waiting && now - e.at < WINDOW_MS && e.at < before) e.cut = String(why).slice(0, 120);
}

// The entries that bear on an option now: the same question and answer,
// from about here or toward about the same target, in the window.
function about(goal, { q, method, target = null, here, now = Date.now(), work = null, kinds = null, dimension = null }) {
  const t = goal?.tried;
  if (!t?.entries || !here) return [];
  const tp = P(target);
  // An answer whose run changed nothing (decisions/outcome.js, note 765)
  // bears on it from anywhere in the same stall: within its `near` of where
  // it was chosen, nothing new carried, whatever its target (the exit a
  // climb aimed at moves as the bot does).
  const noop = t.entries.filter(e => e.q === q && e.method === method && e.noop && require('./decisions/outcome').noopHolds(e, { here, kinds, dimension, now }));
  // A hold on answers that came back at once whatever the facts (repeats.js
  // quickBefore) holds from about here whatever their target: the target is
  // among the facts that moved between them (note 611).
  const same = t.entries.filter(e => e.q === q && e.method === method && now - e.at < WINDOW_MS && (!work || !e.work || e.work === work) &&
    (e.anyTarget && e.until > now ? e.place && dist(e.place, here) <= NEAR
      : e.target && tp ? dist(e.target, tp) <= TARGET_NEAR && e.place && dist(e.place, here) <= TARGET_FROM : !e.target && !tp && e.place && dist(e.place, here) <= NEAR));
  // Another way to the same place, from about here, that ended no nearer than an
  // earlier walk there (noNearer): the place came to nothing, not the way (note
  // 629). On foot and straight across were the same tunnel to the same stems, and
  // with the crossing resting the walk was taken six of six.
  const kin = tp ? t.entries.filter(e => e.q === q && e.method !== method && e.outcome === 'blocked' && e.noNearer && e.target && dist(e.target, tp) <= TARGET_NEAR && e.place && dist(e.place, here) <= TARGET_FROM && now - e.at < WINDOW_MS && (!work || !e.work || e.work === work)) : [];
  const all = kin.length ? [...same, ...kin] : same;
  for (const e of noop) if (!all.includes(e)) all.push(e);
  return all;
}
function blockedOf(list) { return list.filter(e => e.outcome === 'blocked'); }
// Resting: blocked REST_AFTER times in the window, until REST_MS after the
// last. -> the time it rests until, or 0
function restsUntil(list, now = Date.now()) {
  const blocked = blockedOf(list);
  // Held by the repeat rule (decisions/repeats.js): rests from the hold.
  const held = Math.max(0, ...blocked.filter(e => e.held && e.until > now).map(e => e.until));
  if (held) return held;
  if (blocked.length < REST_AFTER) return 0;
  const until = Math.max(...blocked.map(e => e.until || (e.settledAt || e.at) + REST_MS));
  return until > now ? until : 0;
}
function triedSays(list, { here, now = Date.now(), toward = false } = {}) {
  const blocked = blockedOf(list);
  if (!blocked.length) return null;
  // Waits that came to nothing are said as waits: how often, how long in
  // all, and what stayed the same.
  if (blocked.every(e => e.wait)) {
    const first = Math.min(...blocked.map(e => e.at)), all = blocked.reduce((n, e) => n + (e.heldMs || 0), 0);
    return `Held from about here ${blocked.length === 1 ? 'once' : `${blocked.length} times`} in the last ${ago(now - first)}, ${ago(all)} in all, and nothing changed in any of them: ${String(blocked.at(-1).why || '').replace(/^held [^:]*: /, '').replace(/\.$/, '')}.`;
  }
  const first = Math.min(...blocked.map(e => e.at));
  // The last reason said, and a run that changed nothing beside it (note
  // 765): the no-op's own words do not stand in for why an earlier try
  // ended.
  const NOOP_WORDS = /(^|; )its run changed nothing .*$/;
  const reason = blocked.map(e => String(e.why || '').replace(NOOP_WORDS, '')).filter(Boolean).at(-1);
  const noopSaid = blocked.filter(e => e.noop).map(e => String(e.why || '').match(NOOP_WORDS)?.[0]?.replace(/^; /, '')).filter(Boolean).at(-1);
  const why = [reason, noopSaid].filter(Boolean).join('; ') || null;
  // Runs that changed nothing (note 765): that the next such from here rests it.
  const noops = blocked.filter(e => e.noop).length;
  return `Tried ${blocked.length === 1 ? 'once' : `${blocked.length} times`} ${toward ? 'toward the same place from about here' : 'from here'} in the last ${ago(now - first)}, and it came to nothing${why ? `: ${why.replace(/\.$/, '')}` : ' (no new ground, nothing gained, no block dug or placed)'}.${noops === 1 && blocked.length < REST_AFTER ? ' Its run changed nothing; changing nothing again from about here, it rests.' : ''}`;
}

// The same answer to the same question, come to nothing moments ago from
// wherever the bot then stood, said on its option at the next asking (not
// rested: a place can be the difference). Read from about here only, an
// answer carried out that took the bot away before it failed (a walk to a
// hoglin that found no way thirty blocks on) was offered back as untried:
// 25598 chose the hunt eight times in five minutes, each failing the same
// way from a new place (note 682). JUST_MS is the "same breath".
const JUST_MS = 2 * 60000;
function justNow(goal, { q, method, here, now = Date.now(), counted = [] }) {
  const had = new Set(counted);
  const recent = (goal?.tried?.entries || []).filter(e => e.q === q && e.method === method && e.outcome === 'blocked' && !e.held && !e.wait && !had.has(e) && now - (e.settledAt || e.at) < JUST_MS);
  if (!recent.length) return null;
  const last = recent.at(-1), off = last.place && here ? Math.round(dist(last.place, here)) : null;
  const where = off === null ? '' : off <= NEAR ? ' about here' : ` ${off} blocks from here`;
  const why = last.why ? `: ${String(last.why).replace(/\.$/, '')}` : ' (no new ground, nothing gained, no block dug or placed)';
  return recent.length === 1 ? `Chosen ${ago(now - last.at)} ago${where}, and it came to nothing${why}.`
    : `Chosen ${recent.length} times in the last ${ago(now - recent[0].at)}, the last ${ago(now - last.at)} ago${where}, and each came to nothing; the last${why}.`;
}

// The options as the ledger reads them, for decide: each option's blocked
// tries said on it; those resting left out while another is on offer, and
// said in the state. Questions whose answers are never left out (a stance,
// the body's way out of fire or lava) only say theirs (note 521).
// -> { tree, resting: [says], allResting: bool, said: n }
// A wait that came to nothing is read back on every question, a stance's
// too (note 599): its own options say a stance's failures, not its waits.
// A resting wait is left out only while two or more other ways stay on
// offer (note 596's rule: with fewer, leaving it out would be the code's
// choice taken unasked); else it stays on offer with its rest said. A
// say-only question is never escalated from here.
const addSays = (node, said) => ({ ...node, description: typeof node.description === 'string' ? `${node.description} ${said}` : { ...(node.description || {}), triedFromHere: said } });
// The options' leaves, each by its path as the ledger records an answer
// (decide's path joined): a nested answer, obtain_food/return_for_food, is
// read, rested and held as a top-level one is. The ledger read the top
// level only, so a repeat hold on a nested answer rested nothing and the
// next asking offered it again: on mid-243-af-fortress-4 survival_priority
// was held on obtain food/return for food 362 times and asked again with
// it on offer 769 times, each within seconds of its hold (note 611).
function leavesOf(tree, pre = []) {
  return Object.entries(tree || {}).flatMap(([k, n]) => n?.children ? leavesOf(n.children, [...pre, k]) : [{ key: [...pre, k].join('/'), node: n }]);
}
// The tree again with each leaf as `nodes` has it now: a leaf left out is
// gone, and a branch with nothing left goes with it.
function rebuilt(tree, nodes, pre = []) {
  const out = {};
  for (const [k, n] of Object.entries(tree || {})) {
    if (n?.children) { const kids = rebuilt(n.children, nodes, [...pre, k]); if (Object.keys(kids).length) out[k] = { ...n, children: kids }; continue; }
    const node = nodes.get([...pre, k].join('/'));
    if (node) out[k] = node;
  }
  return out;
}
// A leaf by its path key ('obtain_food/return_for_food'), or undefined.
function leafAt(tree, key) {
  let node = { children: tree };
  for (const k of String(key).split('/')) node = node?.children?.[k];
  return node && !node.children ? node : undefined;
}
// `leave`: which options leave what the question is about (fortress-hold.js
// isLeave, for the questions about the plan). A leave is not a way on: where
// the only options open leave, the resting ways stay on offer beside them,
// each with its rest said (`keptBesideLeave`), so leaving is chosen with the
// rest in view, not left as the one option the ledger did not rest. 25584
// (critic-20260930T0436Z item 1) had its walk and staircase resting and
// keep_searching taken as "the only way offered" (note 721).
function read(bot, goal, q, tree, { target = null, sayOnly = false, leave = null, now = Date.now() } = {}) {
  const here = P(bot?.entity?.position);
  // The walks' stall memory bears too (failed-places.js, note 777).
  if (!goal || (!goal.tried?.entries?.length && !bot?._stallSpots?.length && !bot?._walks?.length) || !here) return { tree, resting: [], allResting: false };
  const nodes = new Map(), resting = [], lastListed = new Set();
  let kinds = null;
  try { kinds = typeof bot?.inventory?.items === 'function' ? [...new Set(bot.inventory.items().map(i => i.name))] : null; } catch (_) { kinds = null; }
  const dimension = String(bot?.game?.dimension || '').replace(/^minecraft:/, '') || null;
  for (const { key, node } of leavesOf(tree)) {
    const t = P(node?.target) || P(target);
    // A stance, the body's way out, the shield: only their waits are read
    // (note 521: failedHereJustNow says their failures).
    const list = about(goal, { q, method: key, target: t, here, now, kinds, dimension }).filter(e => !sayOnly || e.wait);
    // A run that changed nothing from this stall is not listed first again
    // (note 765): it goes to the end of the list, said.
    if (!sayOnly && list.some(e => e.noop)) lastListed.add(key.split('/')[0]);
    const until = restsUntil(list, now);
    // A target the ways to have failed twice, whatever asked for them, or a
    // spot the ways from have failed to two other targets (failed-places.js,
    // note 777): said on the option going there, and resting it as its own
    // two failures would. One failed way there, of whatever kind, is said
    // with what coming at it straight would cost, and does not rest it
    // (note 785).
    const own = P(node?.target);
    const place = !sayOnly && !until && own ? require('./failed-places').read(bot, goal, own, { here, now, restMs: REST_MS }) : null;
    const said = [triedSays(list, { here, now, toward: !!t }), sayOnly ? null : justNow(goal, { q, method: key, here, now, counted: list }), place && !(place.until > now) ? place.says : null].filter(Boolean).join(' ') || null;
    if (place && place.until > now) {
      const both = [said, place.says].filter(Boolean).join(' ');
      resting.push({ key, until: place.until, held: false, wait: false, place: place.kind, said: both, says: `${label(key)}: ${both} It rests ${ago(place.until - now)} more from here.` });
      nodes.set(key, node); continue;
    }
    // Held by the repeat rule (decisions/repeats.js), and still held.
    const held = blockedOf(list).some(e => e.held && e.until > now);
    if (until) { resting.push({ key, until, held, wait: blockedOf(list).every(e => e.wait), said, says: `${label(key)}: ${said} It rests ${ago(until - now)} more from here.` }); nodes.set(key, node); continue; }
    nodes.set(key, said ? addSays(node, said) : node);
  }
  if (!resting.length) return { tree: listedLast(rebuilt(tree, nodes), lastListed), resting: [], allResting: false };
  const isResting = k => resting.some(r => r.key === k);
  const onOffer = () => [...nodes.keys()].filter(k => nodes.get(k) && k !== 'none_good');
  // Every way resting with nothing above to ask stays on offer, each with
  // its rest said (note 609), but not an answer the repeat rule holds while
  // one it does not hold stays on offer: a held answer holds until what it
  // depends on changes (the place, what is carried, a block dug or placed,
  // its five minutes). Kept on offer at the top, it was chosen again at
  // once: on mid-242-bb rung_progress was held on keep at it 31 times and
  // asked again with it on offer 91 times, each within seconds (note 611).
  const allResting = ({ say }) => {
    const heldOut = resting.some(r => !r.held && nodes.get(r.key)) ? resting.filter(r => r.held && nodes.get(r.key)) : [];
    for (const r of heldOut) nodes.delete(r.key);
    if (say) for (const r of resting) if (nodes.get(r.key)) nodes.set(r.key, addSays(nodes.get(r.key), `${r.said} It rests ${ago(r.until - now)} more from here.`));
    return { tree: rebuilt(tree, nodes), resting: resting.map(r => r.says), allResting: true, until: Math.min(...resting.map(r => r.until)), heldOut: heldOut.map(r => r.says) };
  };
  const ways = resting.filter(r => !r.wait), waits = resting.filter(r => r.wait);
  const open = onOffer().filter(k => !isResting(k));
  if (!sayOnly && leave && open.length && open.every(leave) && ways.length) {
    const kept = allResting({ say: true });
    return { tree: kept.tree, resting: kept.heldOut, allResting: false, keptBesideLeave: ways.map(r => r.key).filter(k => nodes.get(k)) };
  }
  // Every way resting: the question above is asked instead where there is
  // one; where there is none, all stay on offer, each with its rest said
  // (note 609).
  if (!sayOnly && !open.length && !waits.length) return allResting({ say: true });
  const left = [];
  if (!sayOnly && open.length) for (const r of ways) { nodes.delete(r.key); left.push(r); }
  // Waits: left out while two or more other ways, none of them resting,
  // stay on offer.
  const others = () => onOffer().filter(k => !isResting(k)).length;
  for (const r of waits) {
    if (others() >= 2) { nodes.delete(r.key); left.push(r); continue; }
    nodes.set(r.key, addSays(nodes.get(r.key), `${r.said} It rests ${ago(r.until - now)} more from here, kept on offer: fewer than two other ways are open.`));
  }
  for (const r of resting) if (!left.includes(r) && !waits.includes(r) && nodes.get(r.key)) nodes.set(r.key, addSays(nodes.get(r.key), `${r.said} It rests ${ago(r.until - now)} more from here.`));
  if (!sayOnly && !left.length && !onOffer().some(k => !isResting(k))) return allResting({ say: false });
  return { tree: listedLast(rebuilt(tree, nodes), lastListed), resting: left.map(r => r.says), allResting: false };
}
// The options with a run that changed nothing from here moved to the end of
// the list, none_good kept last of all (note 765).
function listedLast(tree, keys) {
  if (!keys?.size) return tree;
  const order = Object.keys(tree);
  const moved = order.filter(k => keys.has(k) && k !== 'none_good');
  if (!moved.length || moved.length === order.filter(k => k !== 'none_good').length) return tree;
  const rest = order.filter(k => !moved.includes(k) && k !== 'none_good');
  return Object.fromEntries([...rest, ...moved, ...(order.includes('none_good') ? ['none_good'] : [])].map(k => [k, tree[k]]));
}

// A repeat hold (decisions/index.js): the answers held rest from here for
// REST_MS, whatever was said between. The hold had been forgotten as it
// fired (repeats.held drops the run), and the next asking began a new run:
// on 25592, 1,266 of 1,272 other_way answers came within two minutes of
// one of its 589 holds (note 573's audit, for note 571).
// anyTarget: the answers held came back at once whatever the facts said
// between (repeats.js quickBefore), their targets among them: held from
// about here whatever the target. On mid-242-bb fortress_approach was held
// on tunnel, keep searching and cross level with the fortress place found
// moving 15 to 40 blocks at each asking, the bot standing still, and each
// place found anew was a way not held, asked again within a second (note
// 611).
function hold(bot, goal, q, methods, why, { target = null, targets = {}, anyTarget = false, now = Date.now() } = {}) {
  settle(bot, goal, { q, now });
  for (const method of new Set(methods)) {
    const e = record(bot, goal, { q, method, target: P(targets[method]) || target, outcome: 'blocked', why, now });
    if (e) Object.assign(e, { held: true, until: now + REST_MS, ...(anyTarget ? { anyTarget: true } : {}) });
  }
}

// The question to ask next up, when one finds nothing left to try (every
// option resting), a repeat hold fires, or a step keeps failing: its parent
// (define's `parent`), the child's answer marked blocked with why, and the
// failure kept to be said when the parent is asked (escalationsFor).
// Asked of a parent that is still owed an asking (an escalation to it not
// yet said to it), the escalation goes past it only when that parent is
// spent: every option it offered at its last asking has come to nothing
// from here. A parent with ways left is asked, not passed: on 25583 a
// failed walk of the fortress's floors escalated to fortress_leg, the step
// walked the same floor again without asking it, and the next failure went
// past fortress_leg (its heights, the blocks to dig, the Overworld's stone
// never tried) to the rung, which was set aside thirty seconds into the
// trial (note 583). A parent the work cannot ask (a plan held without a
// question) is passed once it has been owed REST_AFTER times, said.
// -> { to, says, climbed, passed }
function escalate(goal, { from, to, why, parentOf = () => null, here = null, now = Date.now() }) {
  const t = ledger(goal); prune(t, now);
  let target = to, climbed = 0;
  const passed = [];
  const owed = p => t.escalations.filter(e => e.to === p && !e.consumed && now - e.at < WINDOW_MS).length;
  while (target && climbed < 6) {
    const n = owed(target), up = parentOf(target);
    if (!n || !up) break;
    const sp = spent(goal, target, { here, now });
    if (!sp.spent && n < REST_AFTER) break;
    passed.push(sp.spent ? `${label(target)}: every way it offered ${ago(now - sp.at)} ago has come to nothing from here (${sp.keys.map(label).join(', ')})`
      : `${label(target)}: not asked since ${plural(n, 'failure')} below were sent to it; the work carried on without asking it`);
    target = up; climbed++;
  }
  const says = `${label(from)}: ${why}${passed.length ? `; passed over ${passed.join('; ')}` : ''}`;
  t.escalations.push({ from, to: target || null, why: says, at: now });
  return { to: target || null, says, climbed, passed };
}
// Whether a question has any way left from here: the options of its last
// asking in the window, each come to nothing from here at least once, or
// not. Unknown (never asked lately) is not spent.
// -> { spent, keys, open, at }
function spent(goal, q, { here = null, now = Date.now() } = {}) {
  const last = (goal?.tried?.entries || []).filter(e => e.q === q && e.offered?.length && now - e.at < WINDOW_MS).at(-1);
  if (!last) return { spent: false, keys: [], open: [], at: null };
  const from = here || last.place;
  const keys = last.offered.map(o => o.key).filter(k => k !== 'none_good');
  const open = from ? keys.filter(k => !blockedOf(about(goal, { q, method: k, target: last.offered.find(o => o.key === k)?.target, here: from, now })).length) : keys;
  return { spent: !open.length && keys.length > 0, keys, open, at: last.at };
}
// An escalation owed to a question, not yet said to it: the work holding an
// answer of that question (a walk of the fortress's floors, a leg) ends it
// and asks the question. Not consumed here.
function owed(goal, q, now = Date.now()) {
  const list = (goal?.tried?.escalations || []).filter(e => e.to === q && !e.consumed && now - e.at < WINDOW_MS);
  return list.length ? list.map(e => e.why) : null;
}
// Said to the parent when it is next asked, and consumed.
function escalationsFor(goal, q, now = Date.now()) {
  const list = (goal?.tried?.escalations || []).filter(e => e.to === q && !e.consumed && now - e.at < WINDOW_MS);
  for (const e of list) e.consumed = now;
  return list.length ? list.map(e => e.why) : null;
}

// The latest answer still running, or ended blocked just now, of any
// question but the step's own: the one whose answer a failing step was
// carrying out (persist's owner).
function owner(goal, { now = Date.now(), withinMs = WINDOW_MS, skip = new Set(), work = null } = {}) {
  const list = (goal?.tried?.entries || []).filter(e => e.q !== 'step' && !skip.has(e.q) && now - e.at < withinMs && (!work || !e.work || e.work === work) && (e.outcome === 'pending' || (e.outcome === 'blocked' && now - (e.settledAt || e.at) < 5000)));
  return list.at(-1) || null;
}
function markBlocked(e, why, now = Date.now()) {
  if (!e) return;
  if (e.outcome === 'pending' || e.outcome === 'blocked') { e.outcome = 'blocked'; e.why = String(why).slice(0, 200); e.settledAt = now; delete e.mark; delete e.measure; }
}
// The latest entry of a question, pending or blocked, in the window.
function latestOf(goal, q, now = Date.now()) {
  return (goal?.tried?.entries || []).filter(e => e.q === q && now - e.at < WINDOW_MS && ['pending', 'blocked'].includes(e.outcome)).at(-1) || null;
}

// What has been tried for a piece of work lately, in words, for the rung's
// question and the stall's: each question and answer with how often, how it
// ended, and whether it rests.
function summary(goal, { work = null, now = Date.now(), withinMs = 2 * WINDOW_MS, here = null } = {}) {
  const list = (goal?.tried?.entries || []).filter(e => now - e.at < withinMs && (!work || e.work === work) && e.outcome !== 'pending');
  if (!list.length) return null;
  const groups = new Map();
  for (const e of list) {
    const k = `${e.q}|${e.method}|${e.target ? `${Math.round(e.target.x)},${Math.round(e.target.y)},${Math.round(e.target.z)}` : ''}`;
    const g = groups.get(k) || { q: e.q, method: e.method, target: e.target, n: 0, blocked: 0, progressed: 0, cut: 0, why: null, last: 0 };
    g.n++; if (e.outcome === 'blocked') { g.blocked++; g.why = e.why || g.why; } if (e.outcome === 'progressed') g.progressed++; if (e.outcome === 'cut') g.cut++; g.last = Math.max(g.last, e.at);
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.last - a.last).slice(0, 12).map(g =>
    `${label(g.q)}: ${label(g.method)}${g.target ? ` toward (${Math.round(g.target.x)}, ${Math.round(g.target.y)}, ${Math.round(g.target.z)})` : ''}, ${plural(g.n, 'time')}${g.progressed ? `, ${g.progressed} of them getting somewhere` : ''}${g.blocked ? `, ${g.blocked} coming to nothing${g.why ? ` (last: ${g.why})` : ''}` : ''}${g.cut ? `, ${g.cut} cut short (the survival layer taking the turn, or the strategy turning to other work)` : ''}, last ${ago(now - g.last)} ago`);
}

// How much the rung has had, in words, for the rung's question and its
// set_aside_rung: how long it has been worked (from when this ledger first
// saw it, its saved time judged by its own clock), how many answers were
// given and how they ended, how often the step failed, and the ways the
// questions below offered that have not been tried from here. On 25583
// the rods were set aside thirty seconds into a trial, told only that
// "every way ... has been tried" (note 583).
// How little is said as well as how much: on 25590 the rods were set aside
// at the rung's question 3.2 minutes into a trial from a fortress save,
// told "17 answers given, 1 coming to nothing, 0 getting somewhere", where
// the seventeen were two answers given eight times each and counted as
// waits, of the sixteen ways the fortress's questions had offered, and the
// question had come by a failure below, not the rung's ten minutes (note
// 605). Now the different ways tried of those offered, the waits, and how
// far into its budget an escalation brought it are said, and `openBelow`
// is the work's own questions with ways not yet tried from here (not the
// stall's question and those under it).
function workedOn(goal, { work = null, here = null, now = Date.now(), escalated = false } = {}) {
  const t = goal?.tried;
  const rung = t?.rung && t.rung.rung === rungOf(goal) ? t.rung : null;
  const since = rung?.since ?? null;
  const from = since ?? now - WINDOW_MS;
  const list = (t?.entries || []).filter(e => e.at >= from && (!work || !e.work || e.work === work));
  const answers = list.filter(e => e.q !== 'step');
  const n = o => answers.filter(e => e.outcome === o).length;
  const steps = list.filter(e => e.q === 'step' && e.outcome === 'blocked').length;
  // The latest asking of each question below the rung, with its options
  // not yet come to nothing from here.
  const open = [], offered = new Set();
  for (const q of [...new Set(answers.map(e => e.q))]) {
    if (['stillness_detour', 'rung_progress'].includes(q)) continue;
    const sp = spent(goal, q, { here, now });
    if (sp.at && sp.at >= from) for (const k of sp.keys) offered.add(`${q}|${k}`);
    if (sp.at && sp.at >= from && sp.open.length) open.push({ q, at: sp.at, keys: sp.open });
  }
  const ways = new Set(answers.filter(e => !['stillness_detour', 'rung_progress'].includes(e.q)).map(e => `${e.q}|${e.method}`));
  for (const w of ways) offered.add(w);
  const openBelow = open.filter(o => workBelowRung(o.q));
  const ms = since === null ? null : now - since;
  const before = rung?.beforeMs >= 60000 ? ` in this session (and ${Math.round(rung.beforeMs / 60000)} minutes before the save it was taken up from)` : '';
  const minutes = x => (Math.round(x / 6000) / 10).toFixed(1);
  const long = ms === null ? 'in the last ten minutes' : `in ${ms < 600000 ? minutes(ms) : Math.round(ms / 60000)} minutes on it${before}`;
  const different = answers.length ? ` to ${plural(ways.size, 'different way')}${offered.size > ways.size ? ` of the ${offered.size} its questions offered` : ''}` : '';
  const early = escalated && ms !== null && ms < RUNG_MS ? `; brought to this question by a failure below ${minutes(ms)} minutes into the rung's ten, not by its ten minutes running out` : '';
  const says = `${long}: ${plural(answers.length, 'answer')} given${different}, ${n('blocked')} coming to nothing, ${n('progressed')} getting somewhere${n('waited') ? `, ${n('waited')} counted as waits` : ''}${n('cut') ? `, ${n('cut')} cut short (the survival layer taking the turn, or the strategy turning to other work)` : ''}${n('pending') ? `, ${n('pending')} still under way` : ''}; the step failed ${plural(steps, 'time')}` +
    `${open.length ? `; not yet tried from here: ${open.map(o => `${label(o.q)} (asked ${ago(now - o.at)} ago): ${o.keys.map(label).join(', ')}`).join('; ')}` : ''}${early}`;
  return { ms, answers: answers.length, ways: ways.size, offered: offered.size, cameToNothing: n('blocked'), progressed: n('progressed'), steps, open, openBelow, says };
}
// The answer being carried out when a failure is noted: the latest given
// (work.js noteError keeps it on goal.lastFailure.by).
function answerNow(goal) {
  const e = goal?.tried?.entries?.at(-1);
  return e ? { q: e.q, method: e.method, at: e.at } : null;
}
// Whether `q` is `above` or asked under it (a question below the one it
// answered, fortress_approach under fortress_leg).
function under(q, above) {
  if (q === above) return true;
  let parentOf;
  try { parentOf = require('./decisions').parentOf; } catch (_) { return false; }
  const seen = new Set();
  for (let p = parentOf(q); p && !seen.has(p); p = parentOf(p)) { if (p === above) return true; seen.add(p); }
  return false;
}
// The failure an answer ended with: the last one noted since it began, if it
// was noted while this answer or one under its question was the latest
// given. 25585's return_for_blocks, overtaken in the same second by the
// stall's questions and the stems' gathering, was said to have "came to
// nothing: The leg east came no nearer", the gathering's leg, and Jev was
// steered off the one way home there was (note 687).
function ownFailure(bot, goal, e) {
  const f = goal?.lastFailure;
  if (f?.why && f.at >= e.at && f.by && !(f.by.at === e.at && f.by.q === e.q && f.by.method === e.method) && !(f.by.at > e.at && under(f.by.q, e.q))) {
    const w = bot?._survivalState?.walkFailed;
    return w?.says && w.at >= e.at ? w.says : null;
  }
  return whyItEnded(bot, goal, e.at);
}
// A question of the rung's own work: under the rung's question, and not the
// stall's question or one under it (its moves, working free).
function workBelowRung(q) {
  let parentOf;
  try { parentOf = require('./decisions').parentOf; } catch (_) { return false; }
  const seen = new Set();
  for (let p = parentOf(q); p && !seen.has(p); p = parentOf(p)) {
    if (p === 'stillness_detour') return false;
    if (p === 'rung_progress') return true;
    seen.add(p);
  }
  return false;
}
// The rung's question sending the work back to a question below it that
// still has ways from here: owed to it, said when it is next asked, and the
// work that holds its answer ends it and asks it (the fortress search's leg,
// mob-hunt.js).
function sendBack(goal, q, why, now = Date.now()) {
  const t = ledger(goal); prune(t, now);
  t.escalations.push({ from: 'rung_progress', to: q, why: String(why).slice(0, 300), at: now, back: true });
}

// Every wall-clock time in a record moved on by `gap`: a key that names a
// time (at, since, until, and their ...At, ...Since, ...Until), holding an
// epoch in milliseconds. Durations (ms, seconds) are left.
const CLOCK_KEY = /^(at|since|until)$|(At|Since|Until)$/;
function shiftClocks(o, gap, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 6) return;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' && CLOCK_KEY.test(k) && v > 1e12) o[k] = v + gap;
    else if (v && typeof v === 'object') shiftClocks(v, gap, depth + 1);
  }
}
// A saved ledger taken up again (a restart, a trial begun from a stage's
// save): its times are its own, moved on by the time it lay saved, so what
// was tried a minute before the save is a minute old, not the half hour
// the save waited (note 583).
function resumed(goal, { savedAt, now = Date.now() } = {}) {
  if (!Number.isFinite(savedAt)) return 0;
  const gap = now - savedAt;
  if (!(gap > 0)) return 0;
  // The fortress search's own clocks too (when it began, the time in the
  // fortress, the rests, the walks' starts): 25589's keep_searching said
  // "1146 minutes searching" 20 minutes into a trial begun from a save made
  // the day before (note 703).
  if (goal?.fortressSearch) shiftClocks(goal.fortressSearch, gap);
  const t = goal?.tried;
  if (!t) return gap;
  const move = (o, keys) => { for (const k of keys) if (Number.isFinite(o?.[k]) && o[k] > 0) o[k] += gap; };
  for (const e of t.entries || []) move(e, ['at', 'settledAt', 'until']);
  for (const e of t.escalations || []) move(e, ['at', 'consumed']);
  if (t.rung) move(t.rung, ['since', 'lastAt', 'bestAt']);
  if (t.rung?.due) move(t.rung.due, ['at']);
  for (const left of Object.values(t.left || {})) move(left, ['since', 'lastAt', 'bestAt', 'leftAt']);
  // A save that lay unplayed longer than the rung's own budget is a new
  // session on it (a trial begun from a stage's save), not a restart: the
  // rung's budget and its count of what was given start here, and the
  // minutes before the save are kept and said beside them. On 25583 the
  // rods were brought to the rung's question 58 seconds into a trial from a
  // fortress save, told "worked on this rung in 31 minutes on it: 48
  // answers given", 30 of those minutes and all but a handful of the
  // answers from before the save, and set aside (note 600).
  if (t.rung && gap >= RUNG_MS) {
    const before = Math.max(0, savedAt + gap - t.rung.since) + (t.rung.beforeMs || 0);
    Object.assign(t.rung, { since: now, lastAt: now, bestAt: now, idleMs: 0, asked: 0, beforeMs: before });
    delete t.rung.due;
  }
  return gap;
}
// Whether any blocked way for this work rests by place alone (a step off
// could leave it behind), or none is known: the stall's "differently".
function placeBound(goal, { work = null, now = Date.now() } = {}) {
  const list = (goal?.tried?.entries || []).filter(e => now - e.at < WINDOW_MS && (!work || e.work === work) && e.outcome === 'blocked' && e.q !== 'step');
  return { any: list.length > 0, byPlace: list.filter(e => !e.target).length, byTarget: list.filter(e => e.target).length };
}

// Progress against the goal, not the last three blocks (the rung's budget).
// The rung's own measures: more of what it is for, a milestone, a new best
// distance to what it is going to (the fortress, the blazes, the portal,
// the step's own target), or new country (a new farthest from where the
// rung began, by sixteen). Ten minutes without a new best, the rung's
// question is asked (answerStall, rung_progress): keep at it with the ways
// left, change the plan, or set the rung aside, with the ledger.
// The minutes are the wall clock's, whoever holds the turn (note 599): a
// wait was not counted, so a bot sealed in a pocket for thirty-three
// minutes (note 589), on a pillar for twelve (note 590) or at a stance for
// twenty (note 596) was never asked after its rung. `waiting` is now only
// a wait that something is bringing to an end (stillness.js waitEnds:
// sleep, a batch cooking, health coming back, daylight coming).
const RUNG_ITEMS = { obtain_blaze_rods: ['blaze_rod'], obtain_ender_pearls: ['ender_pearl', 'ender_eye'], craft_eyes: ['ender_eye'], reach_nether: ['obsidian', 'flint_and_steel'] };
// The kit rungs (crossing-kit.js KIT_PHASES) are not counted by a pseudo
// item named after themselves: nether_food's own measure is food points
// (rung-measure.js always carries `food`), and a phantom "nether food"
// item, forever zero, only muddied its no-yield words with "no nether
// food" beside the real "no food gained" (note 728).
const RUNG_NO_ITEMS = new Set(['nether_pickaxe', 'nether_blocks', 'nether_food', 'nether_chest']);
const RUNG_KINDS = new Set(['win', 'nether', 'obtain', 'craft']);
// A rung set aside is not the rung in hand while its rest lasts: the ladder
// is on other work, or waits it out (the rods' rods_waiting). Its budget
// does not run, and its question is not asked: on 25584 the rods, set
// aside at 11:37:00, were brought to the rung's question again at 11:40:00
// and 11:42:33 while they waited, and set aside again each time (note 600).
function rungOf(goal, now = Date.now()) {
  if (!RUNG_KINDS.has(goal?.kind)) return null;
  if (goal.kind !== 'win') return `${goal.kind}${goal.item ? `:${goal.item}` : ''}`;
  const rung = goal.rungTime?.phase || goal.gameProgress?.phase || null;
  return rung && require('./progress').isSetAside(goal, 'rung', rung, now) ? null : rung;
}
// A rung in words: the game's rung by name, a request by what it is for.
const rungSays = rung => /:/.test(rung) ? `${label(rung.split(':').slice(1).join(':'))} request` : label(rung);
function rungItems(goal, rung) {
  if (RUNG_ITEMS[rung]) return RUNG_ITEMS[rung];
  if (goal.kind !== 'win') return [goal.item].filter(Boolean);
  const step = goal.step?.action === 'combined_request' ? goal.step.detail : goal.step;
  return [step?.item, step?.drops, RUNG_NO_ITEMS.has(rung) ? null : rung].filter(Boolean);
}
function rungTarget(bot, goal) {
  const fs = goal.fortressSearch;
  const blazes = (goal.mobHunt?.sightings || []).filter(s => Number.isFinite(s.x));
  const here = bot.entity?.position;
  if (goal.rungTime?.phase === 'obtain_blaze_rods' || goal.gameProgress?.phase === 'obtain_blaze_rods') {
    const b = here && blazes.slice().sort((a, c) => dist(a, here) - dist(c, here))[0];
    const t = P(b) || P(fs?.approach?.found) || P(fs?.found) || P(fs?.target);
    if (t) return { what: b ? 'the nearest place blazes were seen' : 'the fortress', at: t };
  }
  if (goal.portalFrame?.origin) return { what: 'the portal frame', at: P(goal.portalFrame.origin) };
  try { const t = require('./stillness').actionOf(goal).target; if (P(t)) return { what: 'the step\'s target', at: P(t) }; } catch (_) { /* none */ }
  return null;
}
const count = (bot, names) => (bot.inventory?.items?.() || []).filter(i => names.includes(i.name)).reduce((n, i) => n + i.count, 0);
// The minutes since the rung was last looked at that count toward its ten.
// The look is made once a pass, and a pass can be one await of minutes (a
// crossing dug by hand, a walk of sixty blocks): the look caps what one
// credits, so as not to count a restart's downtime or a suspended machine,
// and at thirty seconds a four-and-a-half-minute pass counted half a minute.
// On mid-243-af-nether-3-fortress-5 (25586) the bot went from a crossing of
// the portal way to a walk to the crimson stems and back for 71 minutes,
// each leg a pass of one to five minutes, and the rung's ten minutes without
// a new best (note 599) were never reached: 16.8 minutes passed between two
// new bests, about 9 of them credited, and the question was asked 0 times
// (note 629). Within one process the gap is what passed, up to the rung's
// budget; the first look after a start credits thirty seconds at most, and a
// gap that began in a wait something was bringing to an end (asleep, a batch
// cooking, health coming back) credits nothing.
const LOOK_FIRST_MS = 30000;
function idleSince(bot, b, now, waiting) {
  const gap = Math.max(0, now - b.lastAt);
  const seen = bot?._rungLooked;
  if (bot && typeof bot === 'object') bot._rungLooked = { at: now, waiting: !!waiting };
  if (!seen) return Math.min(LOOK_FIRST_MS, gap);
  if (seen.waiting) return 0;
  return Math.min(RUNG_MS, gap);
}
// On the way up to open sky: the step or the survival layer's climb out.
function climbingOut(goal, now = Date.now()) {
  const step = goal?.step?.action === 'combined_request' ? goal.step.detail : goal?.step;
  if (step?.action === 'ascend_to_surface') return true;
  const sa = goal?.survivalAction;
  return sa?.action === 'return_to_surface' && now - Date.parse(sa.at || 0) < 8000;
}
// -> null, or { rung, says, facts } when the rung's question is due
function watchRung(bot, goal, { now = Date.now(), waiting = null } = {}) {
  // Not in Creative, nor in the End, whose fight owns its turn (as the
  // stall watch, stillness.js).
  if (!bot?.entity?.position || bot.game?.gameMode === 'creative' || /end/.test(String(bot.game?.dimension || ''))) return null;
  const rung = rungOf(goal);
  if (!rung) return null;
  const t = ledger(goal);
  const here = bot.entity.position;
  const items = rungItems(goal, rung), have = count(bot, items);
  const milestones = Object.values(goal.gameProgress?.milestones || {}).filter(Boolean).length;
  const target = rungTarget(bot, goal);
  const tkey = target ? `${Math.round(target.at.x / 4)},${Math.round(target.at.y / 4)},${Math.round(target.at.z / 4)}` : null;
  let b = t.rung;
  if (!b || b.rung !== rung) {
    // A rung the ladder turned from and came back to keeps its record: its
    // best, where it began and the minutes it has gone without a new one. The
    // ladder turns to a pickaxe rung and back many times an hour (a pickaxe
    // wanted for the nether, made, worn or dropped), and a record begun anew
    // at each return never ran ten minutes: mid-243-bd spent seventy minutes
    // on reaching the Nether, in stints each cut short by a turn to a pickaxe
    // rung before ten quiet minutes ran, and the rung's question was never
    // asked (note 630). The
    // minutes away are not counted (lastAt begins again here), and a record
    // left for longer than the rung's own budget times three is a new one.
    if (b?.rung && b.rung !== rung) { (t.left ||= {})[b.rung] = { ...b, leftAt: now }; for (const k of Object.keys(t.left)) if (now - t.left[k].leftAt > 3 * RUNG_MS) delete t.left[k]; }
    const back = t.left?.[rung];
    if (back && now - back.leftAt <= 3 * RUNG_MS) {
      delete t.left[rung]; delete back.leftAt;
      b = t.rung = { ...back, lastAt: now };
      // The rung's new best measures are read from here, not from before.
      if (tkey && b.best.target[tkey] === undefined) b.best.target[tkey] = dist(target.at, here);
    } else {
      b = t.rung = { rung, since: now, lastAt: now, idleMs: 0, bestAt: now, origin: P(here), best: { items: have, milestones, far: 0, target: {} }, asked: 0 };
      if (tkey) b.best.target[tkey] = dist(target.at, here);
      return null;
    }
  }
  const dt = idleSince(bot, b, now, waiting); b.lastAt = now;
  const news = [];
  if (have > b.best.items) news.push(`${plural(have - b.best.items, 'more')} ${items.map(label).join(' or ')}`);
  b.best.items = Math.max(b.best.items, have);
  if (milestones > b.best.milestones) news.push('a milestone reached');
  b.best.milestones = Math.max(b.best.milestones, milestones);
  if (tkey) {
    const d = dist(target.at, here), best = b.best.target[tkey];
    if (best === undefined) b.best.target[tkey] = d;
    else if (d < best - 2) { b.best.target[tkey] = d; news.push(`nearer ${target.what} (${Math.round(d)} blocks)`); }
  }
  const far = b.origin ? dist(b.origin, here) : 0;
  if (far > b.best.far + 16) { b.best.far = far; news.push(`new country, ${Math.round(far)} blocks from where the rung began`); }
  // A climb out to open sky gaining height is the way to whatever the rung
  // wants from the surface (wood, the sky): a new height on it is a new
  // best. 25589 climbed by hand from y -27 to y -13 in nine minutes while
  // "16 minutes on the stone pickaxe without a new best" was said over it
  // (note 754).
  if (climbingOut(goal, now)) {
    if (!Number.isFinite(b.best.upY)) b.best.upY = here.y;
    else if (here.y >= b.best.upY + 2) { b.best.upY = here.y; news.push(`higher on the climb to open sky (y ${Math.floor(here.y)})`); }
  }
  if (news.length) { b.idleMs = 0; b.bestAt = now; b.lastBest = news.join(', '); goal.struggles = 0; delete b.due; return null; }
  // A hold at its cap hands off here (holds.js): due at once.
  const due = b.due && b.due.at >= b.bestAt ? b.due : null;
  if (!due && waiting) return null;
  b.idleMs += dt;
  if (!due && b.idleMs < RUNG_MS) return null;
  b.idleMs = 0; b.asked++; delete b.due;
  const minutes = Math.round((now - b.bestAt) / 60000);
  const bestSays = `${minutes} minutes on the ${rungSays(rung)} without a new best: ${items.length ? `${have} ${items.map(label).join(' or ')} carried, none more` : 'nothing more of it'}${target ? `; ${target.what} ${Math.round(dist(target.at, here))} blocks off, the nearest yet ${Math.round(b.best.target[tkey])}` : ''}; the farthest from where it began ${Math.round(b.best.far)} blocks${b.lastBest ? `; the last new best was ${b.lastBest}` : ''}`;
  // The End portal near with its eyes (note 1347): 25593 (2026-10-06 03:53Z)
  // was asked this six blocks from its frames with all twelve eyes, the
  // portal unsaid, and answered work_free: it climbed away and died.
  const endNear = require('./end-portal').endPortalNearSays(bot, goal);
  return { rung, says: `${due ? `${bestSays}; ${due.says}` : bestSays}${endNear}` };
}
// The rung's question due at the next look, whatever its clock (a hold at
// its cap, holds.js): said with why.
function rungDue(goal, says, now = Date.now()) {
  const b = goal?.tried?.rung;
  if (!b || b.rung !== rungOf(goal)) return false;
  b.due = { says: String(says).slice(0, 300), at: now };
  return true;
}

module.exports = { answerNow, ownFailure, begin, record, settle, cut, spent, owed, workedOn, workBelowRung, sendBack, resumed, hold, about, read, leavesOf, leafAt, restsUntil, triedSays, escalate, escalationsFor, owner, markBlocked, latestOf, summary, placeBound, watchRung, rungDue, rungOf, rungSays, measuredBy, measureMark, measureOf, rungItems, sceneOf, sceneChanges, NEAR, WINDOW_MS, REST_AFTER, REST_MS, RUNG_MS, SCENE_RADIUS, SCENE_NEARER, WAIT_JUDGED_MS, justNow, JUST_MS };
