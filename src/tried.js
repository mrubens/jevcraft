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
//   outcome       pending, progressed (something measurable came of it:
//                 repeats.js cameOf), blocked (nothing did, or it failed),
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

const NEAR = 4;             // "from here"
const TARGET_NEAR = 4;      // the same target
const TARGET_FROM = 16;     // toward a target, from about here
const WINDOW_MS = 10 * 60000;
const REST_AFTER = 2;
const REST_MS = 5 * 60000;
const KEEP = 160;
const RUNG_MS = 10 * 60000;

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
function prune(t, now) {
  t.entries = t.entries.filter(e => e.outcome === 'pending' ? now - e.at < 3 * WINDOW_MS : now - e.at < 2 * WINDOW_MS).slice(-KEEP);
  t.escalations = t.escalations.filter(e => now - e.at < WINDOW_MS).slice(-20);
}
function workOf(goal, now) { try { return require('./stillness').actionOf(goal, now).key; } catch (_) { return null; } }

// An answer given: pending until something is seen to come of it or not.
function begin(bot, goal, { q, method, target = null, waiting = false, now = Date.now() }) {
  if (!bot || !goal || !q || !method) return null;
  const t = ledger(goal); prune(t, now);
  const here = P(bot.entity?.position);
  const entry = { q, method, ...(P(target) ? { target: P(target) } : {}), place: here, at: now, work: workOf(goal, now), outcome: 'pending', mark: mark(bot), ...(waiting ? { waiting: true } : {}) };
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
  return entry;
}

// The stall's answers and the rung's are judged by the rung: a detour that
// walks eight blocks off is new ground by the three-block measure, and on
// 25592 each "differently" reset every counter while the rods came no
// nearer (note 571). Something came of one when the rung has a new best
// since.
const RUNG_JUDGED = new Set(['stillness_detour', 'rung_progress']);
function settleOne(bot, goal, e, { error = null, now = Date.now(), onlyIf = null } = {}) {
  if (e.outcome !== 'pending') return false;
  const rung = goal?.tried?.rung;
  const byRung = RUNG_JUDGED.has(e.q) && rung && rung.rung === rungOf(goal);
  const came = byRung ? (rung.bestAt > e.at ? `a new best on the ${rungSays(rung.rung)} (${rung.lastBest || 'progress'})` : null)
    : e.mark ? cameOf(e.mark, mark(bot), e.at) : null;
  if (onlyIf === 'decided' && !came && !error) return false;
  if (came) { e.outcome = 'progressed'; e.gained = came; }
  else if (e.waiting) e.outcome = 'waited';
  else { e.outcome = 'blocked'; const why = error || whyItEnded(bot, goal, e.at); if (why) e.why = String(why).replace(/^Stalled: /, '').slice(0, 200); }
  e.settledAt = now; delete e.mark;
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

// The entries that bear on an option now: the same question and answer,
// from about here or toward about the same target, in the window.
function about(goal, { q, method, target = null, here, now = Date.now(), work = null }) {
  const t = goal?.tried;
  if (!t?.entries || !here) return [];
  const tp = P(target);
  return t.entries.filter(e => e.q === q && e.method === method && now - e.at < WINDOW_MS && (!work || !e.work || e.work === work) &&
    (e.target && tp ? dist(e.target, tp) <= TARGET_NEAR && e.place && dist(e.place, here) <= TARGET_FROM : !e.target && !tp && e.place && dist(e.place, here) <= NEAR));
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
  const first = Math.min(...blocked.map(e => e.at));
  const why = blocked.map(e => e.why).filter(Boolean).at(-1);
  return `Tried ${blocked.length === 1 ? 'once' : `${blocked.length} times`} ${toward ? 'toward the same place from about here' : 'from here'} in the last ${ago(now - first)}, and it came to nothing${why ? `: ${why.replace(/\.$/, '')}` : ' (no new ground, nothing gained, no block dug or placed)'}.`;
}

// The options as the ledger reads them, for decide: each option's blocked
// tries said on it; those resting left out while another is on offer, and
// said in the state. Questions whose answers are never left out (a stance,
// the body's way out of fire or lava) only say theirs (note 521).
// -> { tree, resting: [says], allResting: bool, said: n }
function read(bot, goal, q, tree, { target = null, sayOnly = false, now = Date.now() } = {}) {
  const here = P(bot?.entity?.position);
  // A stance, the body's way out, the shield: recorded, and their own
  // options say their failures already (note 521: failedHereJustNow).
  if (sayOnly || !goal?.tried?.entries?.length || !here) return { tree, resting: [], allResting: false };
  const out = {}, resting = [];
  for (const [key, node] of Object.entries(tree)) {
    if (node?.children) { out[key] = node; continue; }
    const t = P(node?.target) || P(target);
    const list = about(goal, { q, method: key, target: t, here, now });
    const said = triedSays(list, { here, now, toward: !!t });
    const until = !sayOnly && restsUntil(list, now);
    if (until) { resting.push({ key, until, says: `${label(key)}: ${said} It rests ${ago(until - now)} more from here.` }); out[key] = node; continue; }
    out[key] = said ? { ...node, description: typeof node.description === 'string' ? `${node.description} ${said}` : { ...(node.description || {}), triedFromHere: said } } : node;
  }
  const open = Object.keys(out).filter(k => !resting.some(r => r.key === k));
  if (!resting.length) return { tree: out, resting: [], allResting: false };
  if (!open.length) return { tree: out, resting: resting.map(r => r.says), allResting: true };
  for (const r of resting) delete out[r.key];
  return { tree: out, resting: resting.map(r => r.says), allResting: false };
}

// A repeat hold (decisions/index.js): the answers held rest from here for
// REST_MS, whatever was said between. The hold had been forgotten as it
// fired (repeats.held drops the run), and the next asking began a new run:
// on 25592, 1,266 of 1,272 other_way answers came within two minutes of
// one of its 589 holds (note 573's audit, for note 571).
function hold(bot, goal, q, methods, why, { target = null, targets = {}, now = Date.now() } = {}) {
  settle(bot, goal, { q, now });
  for (const method of new Set(methods)) {
    const e = record(bot, goal, { q, method, target: P(targets[method]) || target, outcome: 'blocked', why, now });
    if (e) Object.assign(e, { held: true, until: now + REST_MS });
  }
}

// The question to ask next up, when one finds nothing left to try (every
// option resting), a repeat hold fires, or a step keeps failing: its parent
// (define's `parent`), the child's answer marked blocked with why, and the
// failure kept to be said when the parent is asked (escalationsFor). Asked
// of the same parent again before it has been asked since, the escalation
// climbs to that parent's own parent: a parent never asked (a way held, a
// plan derived without a question) cannot keep a child going round.
// -> { to, says, climbed }
function escalate(goal, { from, to, why, parentOf = () => null, now = Date.now() }) {
  const t = ledger(goal); prune(t, now);
  let target = to, climbed = 0;
  const unasked = p => t.escalations.some(e => e.to === p && !e.consumed && now - e.at < WINDOW_MS);
  while (target && unasked(target) && climbed < 6) { target = parentOf(target); climbed++; }
  const says = `${label(from)}: ${why}`;
  t.escalations.push({ from, to: target || null, why: says, at: now });
  return { to: target || null, says, climbed };
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
  if (e.outcome === 'pending' || e.outcome === 'blocked') { e.outcome = 'blocked'; e.why = String(why).slice(0, 200); e.settledAt = now; delete e.mark; }
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
    const g = groups.get(k) || { q: e.q, method: e.method, target: e.target, n: 0, blocked: 0, progressed: 0, why: null, last: 0 };
    g.n++; if (e.outcome === 'blocked') { g.blocked++; g.why = e.why || g.why; } if (e.outcome === 'progressed') g.progressed++; g.last = Math.max(g.last, e.at);
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.last - a.last).slice(0, 12).map(g =>
    `${label(g.q)}: ${label(g.method)}${g.target ? ` toward (${Math.round(g.target.x)}, ${Math.round(g.target.y)}, ${Math.round(g.target.z)})` : ''}, ${plural(g.n, 'time')}${g.progressed ? `, ${g.progressed} of them getting somewhere` : ''}${g.blocked ? `, ${g.blocked} coming to nothing${g.why ? ` (last: ${g.why})` : ''}` : ''}, last ${ago(now - g.last)} ago`);
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
// rung began, by sixteen). Ten working minutes without a new best, the
// rung's question is asked (answerStall, rung_progress): keep at it with
// the ways left, change the plan, or set the rung aside, with the ledger.
const RUNG_ITEMS = { obtain_blaze_rods: ['blaze_rod'], obtain_ender_pearls: ['ender_pearl', 'ender_eye'], craft_eyes: ['ender_eye'], reach_nether: ['obsidian', 'flint_and_steel'] };
const RUNG_KINDS = new Set(['win', 'nether', 'obtain', 'craft']);
function rungOf(goal) {
  if (!RUNG_KINDS.has(goal?.kind)) return null;
  if (goal.kind === 'win') return goal.rungTime?.phase || goal.gameProgress?.phase || null;
  return `${goal.kind}${goal.item ? `:${goal.item}` : ''}`;
}
// A rung in words: the game's rung by name, a request by what it is for.
const rungSays = rung => /:/.test(rung) ? `${label(rung.split(':').slice(1).join(':'))} request` : label(rung);
function rungItems(goal, rung) {
  if (RUNG_ITEMS[rung]) return RUNG_ITEMS[rung];
  if (goal.kind !== 'win') return [goal.item].filter(Boolean);
  const step = goal.step?.action === 'combined_request' ? goal.step.detail : goal.step;
  return [step?.item, step?.drops, rung].filter(Boolean);
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
    b = t.rung = { rung, since: now, lastAt: now, idleMs: 0, bestAt: now, origin: P(here), best: { items: have, milestones, far: 0, target: {} }, asked: 0 };
    if (tkey) b.best.target[tkey] = dist(target.at, here);
    return null;
  }
  const dt = Math.min(30000, Math.max(0, now - b.lastAt)); b.lastAt = now;
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
  if (news.length) { b.idleMs = 0; b.bestAt = now; b.lastBest = news.join(', '); goal.struggles = 0; return null; }
  if (waiting) return null;
  b.idleMs += dt;
  if (b.idleMs < RUNG_MS) return null;
  b.idleMs = 0; b.asked++;
  const minutes = Math.round((now - b.bestAt) / 60000);
  const bestSays = `${minutes} minutes on the ${rungSays(rung)} without a new best: ${items.length ? `${have} ${items.map(label).join(' or ')} carried, none more` : 'nothing more of it'}${target ? `; ${target.what} ${Math.round(dist(target.at, here))} blocks off, the nearest yet ${Math.round(b.best.target[tkey])}` : ''}; the farthest from where it began ${Math.round(b.best.far)} blocks${b.lastBest ? `; the last new best was ${b.lastBest}` : ''}`;
  return { rung, says: bestSays };
}

module.exports = { begin, record, settle, hold, about, read, restsUntil, triedSays, escalate, escalationsFor, owner, markBlocked, latestOf, summary, placeBound, watchRung, rungOf, rungSays,
  NEAR, WINDOW_MS, REST_AFTER, REST_MS, RUNG_MS };
