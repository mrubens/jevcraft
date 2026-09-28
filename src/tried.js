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
function prune(t, now) {
  t.entries = t.entries.filter(e => e.outcome === 'pending' ? now - e.at < 3 * WINDOW_MS : now - e.at < 2 * WINDOW_MS).slice(-KEEP);
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
  // A stall's answer that brought something home (a hunt's meat, a block
  // of ore) got somewhere, though not on the rung; its walk alone did not.
  const carried = e.mark ? cameOf(e.mark, mark(bot), e.at) : null;
  const came = byRung ? (rung.bestAt > e.at ? `a new best on the ${rungSays(rung.rung)} (${rung.lastBest || 'progress'})` : carried === 'what is carried changed' ? carried : null)
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
  else { e.outcome = 'blocked'; const why = error || whyItEnded(bot, goal, e.at); if (why) e.why = String(why).replace(/^Stalled: /, '').slice(0, 200); }
  e.settledAt = now; delete e.mark; delete e.scene;
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
function cut(goal, why, now = Date.now()) {
  for (const e of goal?.tried?.entries || []) if (e.outcome === 'pending' && !e.waiting && now - e.at < WINDOW_MS) e.cut = String(why).slice(0, 120);
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
  // Waits that came to nothing are said as waits: how often, how long in
  // all, and what stayed the same.
  if (blocked.every(e => e.wait)) {
    const first = Math.min(...blocked.map(e => e.at)), all = blocked.reduce((n, e) => n + (e.heldMs || 0), 0);
    return `Held from about here ${blocked.length === 1 ? 'once' : `${blocked.length} times`} in the last ${ago(now - first)}, ${ago(all)} in all, and nothing changed in any of them: ${String(blocked.at(-1).why || '').replace(/^held [^:]*: /, '').replace(/\.$/, '')}.`;
  }
  const first = Math.min(...blocked.map(e => e.at));
  const why = blocked.map(e => e.why).filter(Boolean).at(-1);
  return `Tried ${blocked.length === 1 ? 'once' : `${blocked.length} times`} ${toward ? 'toward the same place from about here' : 'from here'} in the last ${ago(now - first)}, and it came to nothing${why ? `: ${why.replace(/\.$/, '')}` : ' (no new ground, nothing gained, no block dug or placed)'}.`;
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
function read(bot, goal, q, tree, { target = null, sayOnly = false, now = Date.now() } = {}) {
  const here = P(bot?.entity?.position);
  if (!goal?.tried?.entries?.length || !here) return { tree, resting: [], allResting: false };
  const out = {}, resting = [];
  for (const [key, node] of Object.entries(tree)) {
    if (node?.children) { out[key] = node; continue; }
    const t = P(node?.target) || P(target);
    // A stance, the body's way out, the shield: only their waits are read
    // (note 521: failedHereJustNow says their failures).
    const list = about(goal, { q, method: key, target: t, here, now }).filter(e => !sayOnly || e.wait);
    const said = triedSays(list, { here, now, toward: !!t });
    const until = restsUntil(list, now);
    if (until) { resting.push({ key, until, wait: blockedOf(list).every(e => e.wait), said, says: `${label(key)}: ${said} It rests ${ago(until - now)} more from here.` }); out[key] = node; continue; }
    out[key] = said ? addSays(node, said) : node;
  }
  if (!resting.length) return { tree: out, resting: [], allResting: false };
  const ways = resting.filter(r => !r.wait), waits = resting.filter(r => r.wait);
  const open = Object.keys(out).filter(k => !resting.some(r => r.key === k));
  if (!sayOnly && !open.length && !waits.length) return { tree: out, resting: resting.map(r => r.says), allResting: true, until: Math.min(...resting.map(r => r.until)) };
  const left = [];
  if (!sayOnly && open.length) for (const r of ways) { delete out[r.key]; left.push(r); }
  // Waits: left out while two or more other ways, none of them resting,
  // stay on offer.
  const others = () => Object.keys(out).filter(k => k !== 'none_good' && !resting.some(r => r.key === k)).length;
  for (const r of waits) {
    if (others() >= 2) { delete out[r.key]; left.push(r); continue; }
    out[r.key] = addSays(out[r.key], `${r.said} It rests ${ago(r.until - now)} more from here, kept on offer: fewer than two other ways are open.`);
  }
  for (const r of resting) if (!left.includes(r) && !waits.includes(r) && out[r.key]) out[r.key] = addSays(out[r.key], `${r.said} It rests ${ago(r.until - now)} more from here.`);
  if (!sayOnly && !left.length && !Object.keys(out).some(k => !resting.some(r => r.key === k))) return { tree: out, resting: resting.map(r => r.says), allResting: true, until: Math.min(...resting.map(r => r.until)) };
  return { tree: out, resting: left.map(r => r.says), allResting: false };
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
    const g = groups.get(k) || { q: e.q, method: e.method, target: e.target, n: 0, blocked: 0, progressed: 0, cut: 0, why: null, last: 0 };
    g.n++; if (e.outcome === 'blocked') { g.blocked++; g.why = e.why || g.why; } if (e.outcome === 'progressed') g.progressed++; if (e.outcome === 'cut') g.cut++; g.last = Math.max(g.last, e.at);
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.last - a.last).slice(0, 12).map(g =>
    `${label(g.q)}: ${label(g.method)}${g.target ? ` toward (${Math.round(g.target.x)}, ${Math.round(g.target.y)}, ${Math.round(g.target.z)})` : ''}, ${plural(g.n, 'time')}${g.progressed ? `, ${g.progressed} of them getting somewhere` : ''}${g.blocked ? `, ${g.blocked} coming to nothing${g.why ? ` (last: ${g.why})` : ''}` : ''}${g.cut ? `, ${g.cut} cut short by the survival layer` : ''}, last ${ago(now - g.last)} ago`);
}

// How much the rung has had, in words, for the rung's question and its
// set_aside_rung: how long it has been worked (from when this ledger first
// saw it, its saved time judged by its own clock), how many answers were
// given and how they ended, how often the step failed, and the ways the
// questions below offered that have not been tried from here. On 25583
// the rods were set aside thirty seconds into a trial, told only that
// "every way ... has been tried" (note 583).
function workedOn(goal, { work = null, here = null, now = Date.now() } = {}) {
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
  const open = [];
  for (const q of [...new Set(answers.map(e => e.q))]) {
    if (['stillness_detour', 'rung_progress'].includes(q)) continue;
    const sp = spent(goal, q, { here, now });
    if (sp.at && sp.at >= from && sp.open.length) open.push({ q, at: sp.at, keys: sp.open });
  }
  const ms = since === null ? null : now - since;
  const before = rung?.beforeMs >= 60000 ? ` in this session (and ${Math.round(rung.beforeMs / 60000)} minutes before the save it was taken up from)` : '';
  const long = ms === null ? 'in the last ten minutes' : `in ${ms < 600000 ? (Math.round(ms / 6000) / 10).toFixed(1) : Math.round(ms / 60000)} minutes on it${before}`;
  const says = `${long}: ${plural(answers.length, 'answer')} given, ${n('blocked')} coming to nothing, ${n('progressed')} getting somewhere${n('cut') ? `, ${n('cut')} cut short by the survival layer` : ''}${n('pending') ? `, ${n('pending')} still under way` : ''}; the step failed ${plural(steps, 'time')}` +
    `${open.length ? `; not yet tried from here: ${open.map(o => `${label(o.q)} (asked ${ago(now - o.at)} ago): ${o.keys.map(label).join(', ')}`).join('; ')}` : ''}`;
  return { ms, answers: answers.length, cameToNothing: n('blocked'), progressed: n('progressed'), steps, open, says };
}

// A saved ledger taken up again (a restart, a trial begun from a stage's
// save): its times are its own, moved on by the time it lay saved, so what
// was tried a minute before the save is a minute old, not the half hour
// the save waited (note 583).
function resumed(goal, { savedAt, now = Date.now() } = {}) {
  const t = goal?.tried;
  if (!t || !Number.isFinite(savedAt)) return 0;
  const gap = now - savedAt;
  if (!(gap > 0)) return 0;
  const move = (o, keys) => { for (const k of keys) if (Number.isFinite(o?.[k]) && o[k] > 0) o[k] += gap; };
  for (const e of t.entries || []) move(e, ['at', 'settledAt', 'until']);
  for (const e of t.escalations || []) move(e, ['at', 'consumed']);
  if (t.rung) move(t.rung, ['since', 'lastAt', 'bestAt']);
  if (t.rung?.due) move(t.rung.due, ['at']);
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
  if (news.length) { b.idleMs = 0; b.bestAt = now; b.lastBest = news.join(', '); goal.struggles = 0; delete b.due; return null; }
  // A hold at its cap hands off here (holds.js): due at once.
  const due = b.due && b.due.at >= b.bestAt ? b.due : null;
  if (!due && waiting) return null;
  b.idleMs += dt;
  if (!due && b.idleMs < RUNG_MS) return null;
  b.idleMs = 0; b.asked++; delete b.due;
  const minutes = Math.round((now - b.bestAt) / 60000);
  const bestSays = `${minutes} minutes on the ${rungSays(rung)} without a new best: ${items.length ? `${have} ${items.map(label).join(' or ')} carried, none more` : 'nothing more of it'}${target ? `; ${target.what} ${Math.round(dist(target.at, here))} blocks off, the nearest yet ${Math.round(b.best.target[tkey])}` : ''}; the farthest from where it began ${Math.round(b.best.far)} blocks${b.lastBest ? `; the last new best was ${b.lastBest}` : ''}`;
  return { rung, says: due ? `${bestSays}; ${due.says}` : bestSays };
}
// The rung's question due at the next look, whatever its clock (a hold at
// its cap, holds.js): said with why.
function rungDue(goal, says, now = Date.now()) {
  const b = goal?.tried?.rung;
  if (!b || b.rung !== rungOf(goal)) return false;
  b.due = { says: String(says).slice(0, 300), at: now };
  return true;
}

module.exports = { begin, record, settle, cut, spent, owed, workedOn, resumed, hold, about, read, restsUntil, triedSays, escalate, escalationsFor, owner, markBlocked, latestOf, summary, placeBound, watchRung, rungDue, rungOf, rungSays,
  sceneOf, sceneChanges, NEAR, WINDOW_MS, REST_AFTER, REST_MS, RUNG_MS, SCENE_RADIUS, SCENE_NEARER, WAIT_JUDGED_MS };
