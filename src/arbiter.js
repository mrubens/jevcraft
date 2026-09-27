'use strict';
// One arbiter for the turn. Three layers each took it by their own rules:
// the survival step, then the meal, then the work, each falling through to
// the next when it returned false. A plan that failed or was set aside
// returned false, and mid-231-o's turn fell to the work at 0.9 health with
// a creeper coming from eight blocks to three (notes 465, 466). A creeper
// does no damage until it blows, so the hurt watchdog never saw it; and a
// shelter plan renewed each tick kept the meal waiting behind it.
//
// Here each layer says what it would do as a claim, with what it observed,
// and one place gives the turn:
//   claim   null, or { layer, action, urgency: 'reflex'|'pressing'|'routine',
//           facts: {observed values}, run: async task => bool, preemptible,
//           minHoldMs, reflex (the key below, for a reflex), cost }
// A reflex is physical safety and never asked: the first in REFLEXES wins.
// Otherwise one claim is taken as it is, and two or more go to Jev as one
// question (turn_priority), one option per claim, its facts and cost said.
// The ruling is held until something changes it: a reflex, a newcomer, the
// health falling, the food crossing a band, its winner doing nothing, or a
// minute.
//
// Two modes (JEV_ARBITER): shadow, the default, where the old layers keep
// the turn and the arbiter's ruling is only logged beside theirs; and live,
// where the ruling gives the turn (take below, runGoal and runIdle) and the
// watch stops a holder that a reflex or a newcomer outranks.
const { STANCE_HEALTH, STANCE_NEWCOMER } = require('./danger');
const { LIGHTS_AT, APPROACH, FUSE } = require('./combat-estimate');

// Out of a reflex two past where it began, not at the same line: a creeper
// drifting at seven and a half blocks would otherwise flip the turn between
// the back off and the work every tick.
const HYSTERESIS = 2;
// A creeper that can walk to its lighting distance and go off within its
// own fuse: danger.js leaves one be only beyond this, a second and a half's
// walk past its reach (mid-231-i).
const CREEPER_REACH = LIGHTS_AT + APPROACH * FUSE;
// Arm's length, as survival.js stepOnce's atArm.
const ARM = 3;
// The air bar at which vitals.js surfaces.
const AIR = 12;
const RULING_MS = 60000;
// A winner that did nothing this long is asked about again, with that said:
// a shelter plan that rests returns false every pass, and held a minute it
// would stand the bot still in the dark.
const IDLE_MS = 10000;
// The watch looks four times a second: a creeper at its lighting distance
// goes off in a second and a half.
const WATCH_MS = 250;
// Or live for the trial ports listed in .bot-state/arbiter-live (one a
// line): a bot restarted by its supervisor or the quiet restart does not
// carry the env, and half the trials live beside half in shadow is the
// comparison (note 485). Read at most every ten seconds.
let listed = { at: 0, ports: new Set() };
const livePorts = () => {
  if (Date.now() - listed.at < 10000) return listed.ports;
  let ports = new Set();
  try { ports = new Set(require('fs').readFileSync(require('path').join(__dirname, '..', '.bot-state', 'arbiter-live'), 'utf8').split(/\s+/).filter(Boolean)); } catch (_) {}
  listed = { at: Date.now(), ports };
  return ports;
};
const mode = () => process.env.JEV_ARBITER === 'live' || (process.env.JEV_ARBITER !== 'shadow' && livePorts().has(String(process.env.MC_PORT || ''))) ? 'live' : 'shadow';
// Hunger six and under, no sprinting; under eighteen, no healing (vitals.js).
const FOOD_BANDS = [6, 17];
const foodBand = food => FOOD_BANDS.filter(b => (food ?? 20) > b).length;

// The reflexes, in the order they win. Kept in step with stillness.js
// EMERGENCIES: each one's action is an emergency there, never set aside.
const REFLEXES = [
  { key: 'lava', layer: 'survival', action: 'leave_lava' },
  { key: 'fire', layer: 'vitals', action: 'out_of_fire' },
  { key: 'head_in_block', layer: 'vitals', action: 'dig_out_of_block' },
  { key: 'air', layer: 'vitals', action: 'swim_up' },
  { key: 'creeper', layer: 'survival', action: 'creeper_back_off' },
  { key: 'arm', layer: 'survival', action: 'escape_threat' },
];
const REFLEX_RANK = Object.fromEntries(REFLEXES.map((r, i) => [r.key, i]));
// Of these, the creeper and the mob at arm's length are alerts, not rules:
// the watch still stops what is running for them, since a creeper's fuse
// is a second and a half, but who acts next is Jev's, the claim said with
// its facts beside the others (the user, 2026-09-27: "go to Jev on the
// routing too"). Only the body's own physics (lava, fire, the head in a
// block, air) is taken by rule.
const ALERTS = new Set(['creeper', 'arm']);
// Without Jev (the question's fallback, and the shadow's pick): the more
// urgent claim, and among equals the layer that keeps the bot alive first.
const LAYERS = ['survival', 'vitals', 'hunt', 'work'];
const URGENCY = { reflex: 0, pressing: 1, routine: 2 };

// What the reflexes read, injectable for the tests.
const probe = {
  inLava: bot => require('./terrain').bodyInLava(bot),
  burning: bot => { const v = require('./vitals'); return !!(bot.entity?.metadata?.[0] & 1) || v.inFire(bot); },
  headInBlock: bot => require('./vitals').headInBlock(bot),
  mobs: (bot, radius) => require('./danger').threats(bot, radius),
};

// The reflexes that hold now, as { key, layer, action, facts }. `held` is
// the set that held last time: one of them lasts to its line plus two.
function observeReflexes(bot, held = bot?._arbiter?.reflexes || [], look = probe) {
  if (!bot?.entity?.position) return [];
  const was = new Set(held), out = [];
  const add = (key, facts) => { const r = REFLEXES.find(x => x.key === key); out.push({ key, layer: r.layer, action: r.action, facts }); };
  if (look.inLava(bot)) add('lava', { inLava: true, health: bot.health });
  if (look.burning(bot)) add('fire', { burning: true, health: bot.health });
  if (look.headInBlock(bot)) add('head_in_block', { headInBlock: true, health: bot.health });
  const air = bot.oxygenLevel ?? 20;
  if (air <= AIR + (was.has('air') ? HYSTERESIS : 0)) add('air', { air });
  const mobs = look.mobs(bot, CREEPER_REACH + HYSTERESIS + 1) || [];
  // In sight, or within four unseen: it comes round the corner already at
  // its fuse's distance (danger.js immediateThreat, mid-79-b).
  const creeperLine = CREEPER_REACH + (was.has('creeper') ? HYSTERESIS : 0);
  const creeper = mobs.filter(t => t.entity?.name === 'creeper' && t.distance <= creeperLine && (t.visible || t.distance <= 4 || was.has('creeper')))
    .sort((a, b) => a.distance - b.distance)[0];
  if (creeper) add('creeper', { creeper: Math.round(creeper.distance * 10) / 10, seen: !!creeper.visible, lightsAt: LIGHTS_AT, blocksASecond: APPROACH, fuse: FUSE });
  const armLine = ARM + (was.has('arm') ? HYSTERESIS : 0);
  const close = (bot.health ?? 20) <= STANCE_HEALTH && mobs.filter(t => t.entity && t.distance <= armLine && (t.visible || t.distance <= 2))
    .sort((a, b) => a.distance - b.distance)[0];
  if (close) add('arm', { mob: close.entity.name, distance: Math.round(close.distance * 10) / 10, health: bot.health });
  return out;
}

// The rules' pick among claims that are not reflexes.
function rulesPick(claims) {
  return [...claims].sort((a, b) => (URGENCY[a.urgency] ?? 3) - (URGENCY[b.urgency] ?? 3) ||
    (LAYERS.indexOf(a.layer) + 1 || 99) - (LAYERS.indexOf(b.layer) + 1 || 99))[0] || null;
}
// The work's own step changing (mine, craft, mine) is not a new question:
// mid-218-n was asked eight times in a minute for it (note 490). The other
// layers' actions are: a creeper in place of a shelter is.
const fingerprintOf = claims => claims.map(c => `${c.layer}:${c.layer === 'work' ? '' : c.action}`).sort().join('|');
// When a claim's last run was stopped, as a time.
const stoppedAt = c => { const t = c?.facts?.lastErrorAt; return typeof t === 'number' ? t : Date.parse(t || '') || 0; };
const STOPPED_BY_THREAT = /Threat nearby|Preempted|hurt|NeedsSafety/i;

// What the ruling was made against: the mobs within STANCE_NEWCOMER, the
// health and the food band.
function observe(bot, ctx) {
  const mobs = ctx.mobs || (() => { try { return probe.mobs(bot, STANCE_NEWCOMER); } catch (_) { return []; } })();
  return { ids: mobs.filter(t => t.distance <= STANCE_NEWCOMER).map(t => t.entity?.id), health: bot?.health ?? 20, band: foodBand(bot?.food) };
}

// Why a held ruling no longer holds, or null while it does.
function broken(ruling, claims, seen, now) {
  if (!ruling) return 'no ruling';
  const winner = claims.find(c => c.layer === ruling.winner);
  if (!winner) return 'its winner no longer claims';
  // A winner that asked not to be cut short keeps the turn for its hold,
  // whatever else comes; only a reflex takes it.
  if (winner.preemptible === false && now - ruling.at < (winner.minHoldMs || 0)) return null;
  if (now >= ruling.until) return 'a minute passed';
  // Its winner stopped by a mob since the ruling: the ruling was made
  // before it, and giving it the turn back only stops it again. mid-218-n's
  // work was stopped by a drowned eleven times in four seconds, handed back
  // each time on the ruling held, at seven health (note 490).
  if (stoppedAt(winner) > ruling.at && STOPPED_BY_THREAT.test(winner.facts?.lastError || '')) return `its winner was stopped: ${winner.facts.lastError}`;
  if (ruling.idleSince && now - ruling.idleSince >= IDLE_MS) return `its winner did nothing for ${IDLE_MS / 1000} seconds`;
  if (fingerprintOf(claims) !== ruling.fingerprint) return 'the claims changed';
  if (seen.ids.some(id => !ruling.ids.includes(id))) return 'a newcomer within six blocks';
  if (seen.health <= ruling.health - STANCE_HEALTH) return `health fell ${STANCE_HEALTH}`;
  if (seen.band !== ruling.band) return 'food crossed a band';
  return null;
}

// What Jev reads for one claim: its facts, and for the layer that has the
// turn, how long it has had it and how long it has done nothing with it.
const optionOf = (c, held = null, now = Date.now()) => {
  const mine = held?.layer === c.layer;
  const facts = { ...(c.facts || {}), ...(mine ? { hasHadTheTurnSeconds: Math.round((now - held.since) / 1000) } : {}),
    ...(mine && held.idleSince ? { didNothingWithItSeconds: Math.round((now - held.idleSince) / 1000) } : {}) };
  return { description: { does: claimSays(c), action: c.action, urgency: c.urgency, facts, ...(c.cost ? { cost: c.cost } : {}) }, run: c.run };
};
// What giving a layer the turn does, in words: mid-218-n chose the work
// ("recover_before_nether") over "escape_threat" at seven health with a
// drowned five blocks off, the options named by their code (note 490).
function claimSays(c) {
  const f = c.facts || {}, mob = t => t ? `the ${String(t.name).replaceAll('_', ' ')} ${t.distance} blocks off${t.seen === false ? ' (out of sight)' : ''}` : 'the mobs about';
  const hp = f.health !== undefined ? ` Health ${Math.round(f.health * 10) / 10}.` : '';
  switch (c.action) {
    case 'escape_threat': return `Answer ${f.threat ? mob(f.threat) : f.atArm ? `${f.atArm.map(mob).join(', ')}, at arm's length` : f.mob ? mob({ name: f.mob, distance: f.distance }) : 'the mob about'}: the stance is asked next (fight, back off, pillar, a pocket, dig down, eat, and the rest). The work waits.${hp}`;
    case 'creeper_back_off': return `Answer the creeper ${f.creeper} blocks off${f.seen === false ? ' (out of sight)' : ''}: it lights about ${f.lightsAt} blocks off and goes off ${f.fuse} seconds after, walking about ${f.blocksASecond} blocks a second; the stance is asked next. The work waits.`;
    case 'surface': return `Swim up for air: the head is under water, air ${f.air} of 20; at none, drowning takes 2 health a second.${hp}`;
    case 'eat': return `Eat ${f.item ? String(f.item).replaceAll('_', ' ') : 'food'} now, about ${c.cost?.seconds || 1.6} seconds.${hp} Hunger ${f.food}.`;
    case 'leave_lava': return 'Get out of the lava.';
    case 'out_of_fire': return 'Put out the fire on the bot.';
    case 'dig_out_of_block': return 'Dig the head out of the block it is in.';
    case 'swim_up': return `Swim up: air ${f.air} of 20.`;
    case 'pocket_next': return `In a sealed pocket: whether to stay, leave or do something else there is asked next.${hp}`;
    case 'secure_shelter': return `Shelter for the night: the way (a room, a pocket here, a shaft, the bed) is asked next.${hp}`;
    case 'obtain_food': return `Find food: where is asked next. Hunger ${f.food}${f.foodCarried !== undefined ? `, ${f.foodCarried} food points carried` : ''}.${hp}`;
    default:
      if (c.layer === 'work') return `Go on with the work: ${f.doing || String(c.action).replaceAll('_', ' ')}${f.request ? ` (toward "${f.request}")` : ''}.${f.lastError ? ` Its last try ended: ${f.lastError}.` : ''}`;
      return `${c.layer}: ${String(c.action).replaceAll('_', ' ')}.${hp}`;
  }
}
// The hostile mobs about, for the question's state.
const mobsSaid = mobs => (mobs || []).slice(0, 5).map(t => ({ name: t.entity?.name, distance: Math.round(t.distance * 10) / 10, seen: !!t.visible }));

// arbitrate(bot, claims, ctx) -> { winner, by, ask, why, ruling, acted }
//   ctx.state   where the ruling and the held reflexes live (bot._arbiter)
//   ctx.dry     compute only: nothing is run and Jev is not asked; `ask`
//               says whether he would be, and the rules' pick stands in
//   ctx.decide  the question runner (decisions.decide), for the tests
//   ctx.run     false: rule (and ask) but leave the winner to the caller
//   ctx.now, ctx.mobs, ctx.task, ctx.goal, ctx.save, ctx.client
async function arbitrate(bot, claims, ctx = {}) {
  const result = rule(bot, claims, ctx);
  if (result.pending) {
    const { live, seen, now, why } = result.pending;
    const decide = ctx.decide || require('./decisions').decide;
    const state = stateOf(bot, ctx);
    const held = state.holder || null;
    const tree = Object.fromEntries(live.map(c => [c.layer, optionOf(c, held, now)]));
    const decision = await decide('turn_priority', { client: ctx.client, bot, task: ctx.task, goal: ctx.goal, save: ctx.save, tree,
      state: { health: bot?.health, food: bot?.food, claims: live.map(c => c.layer), why,
        mobs: mobsSaid(ctx.mobs || (() => { try { return probe.mobs(bot, 16); } catch (_) { return []; } })()),
        ...(held ? { hasTheTurn: { layer: held.layer, action: held.action, seconds: Math.round((now - held.since) / 1000) } } : {}) } });
    if (decision?.stale) return { winner: null, by: 'stale', ask: true, why };
    const winner = live.find(c => c.layer === decision?.path?.[0]) || rulesPick(live);
    state.ruling = { winner: winner.layer, fingerprint: fingerprintOf(live), at: now, until: now + RULING_MS, ...seen };
    Object.assign(result, { winner, by: 'jev', ruling: state.ruling });
    delete result.pending;
  }
  if (!ctx.dry && ctx.run !== false && result.winner?.run) result.acted = !!(await result.winner.run(ctx.task));
  if (result.acted !== undefined) idled(stateOf(bot, ctx), result.winner, result.acted, ctx.now ?? Date.now());
  return result;
}
// A held ruling whose winner did nothing is marked from the first such
// turn, and the mark goes when it acts.
function idled(state, winner, acted, now = Date.now()) {
  const ruling = state.ruling?.winner === winner?.layer ? state.ruling : null;
  const holder = state.holder?.layer === winner?.layer ? state.holder : null;
  for (const r of [ruling, holder]) if (r) { if (acted) delete r.idleSince; else r.idleSince ||= now; }
}

const stateOf = (bot, ctx) => ctx.state || (bot ? (bot._arbiter ||= {}) : (ctx.state = {}));

// The ruling by rules alone, at once: everything but the question. Dry, the
// rules' pick stands where Jev would be asked, and is held as his would be.
function rule(bot, claims, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const state = stateOf(bot, ctx);
  const live = (claims || []).filter(Boolean);
  const reflexes = live.filter(c => c.urgency === 'reflex').sort((a, b) => (REFLEX_RANK[a.reflex] ?? 99) - (REFLEX_RANK[b.reflex] ?? 99));
  // Held to two past its line, reflex or alert alike (observeReflexes).
  state.reflexes = [...new Set(live.map(c => c.reflex || c.alert).filter(Boolean))];
  // Ruling for real, the arbiter has picked up what the watch stopped the
  // holder for: the reflex is among these claims and wins (it or one above
  // it), or it has gone; a newcomer is among the mobs this ruling reads.
  if (!ctx.dry && bot?._preempt) { console.log(`[arbiter] picked up ${bot._preempt.by}`); delete bot._preempt; }
  if (reflexes.length) { delete state.ruling; return { winner: reflexes[0], by: 'reflex', ask: false }; }
  if (!live.length) { delete state.ruling; return { winner: null, by: 'none', ask: false }; }
  if (live.length === 1) { delete state.ruling; return { winner: live[0], by: 'single', ask: false }; }
  const seen = observe(bot, ctx);
  const why = broken(state.ruling, live, seen, now);
  if (!why) return { winner: live.find(c => c.layer === state.ruling.winner), by: 'held', ask: false, ruling: state.ruling };
  if (!ctx.dry) return { winner: null, ask: true, why, pending: { live, seen, now, why } };
  const winner = rulesPick(live);
  state.ruling = { winner: winner.layer, fingerprint: fingerprintOf(live), at: now, until: now + RULING_MS, ...seen };
  return { winner, by: 'rules', ask: true, why, ruling: state.ruling };
}

// Shadow mode: the arbiter's ruling beside what the old layers did, before
// it has the turn. makeClaims is called at once; gave(layer) is called with
// the layer that acted. A difference is logged (the same one at most every
// ten seconds) and the pair kept on bot._arbiterShadow for the flight
// record. Nothing here may stop the loop: a failure is logged once.
const SHADOW_REPEAT_MS = 10000;
let shadowFailed = false;
const failedOnce = err => { if (!shadowFailed) { shadowFailed = true; console.log(`[arbiter] shadow failed (said once): ${err?.stack || err}`); } };
const says = w => w ? `${w.layer} ${w.action}${w.ask ? ` (would ask Jev: ${w.claims.join(', ')})` : ''}` : 'nothing';
function shadow(bot, makeClaims, { log = console.log, now = Date.now } = {}) {
  let would;
  try {
    const claims = (makeClaims() || []).filter(Boolean);
    const r = rule(bot, claims, { dry: true, now: now() });
    would = r.winner ? { layer: r.winner.layer, action: r.winner.action, by: r.by, ask: r.ask, claims: claims.map(c => c.layer) } : null;
  } catch (err) { failedOnce(err); return { would: undefined, gave() {} }; }
  let given = false;
  return {
    would,
    gave(layer) {
      if (given || !bot) return;
      given = true;
      try {
        const at = now();
        bot._arbiterShadow = { would: would ? { layer: would.layer, action: would.action, by: would.by, ...(would.ask ? { ask: true } : {}) } : null, gave: layer, at };
        if ((would?.layer || null) === (layer || null)) return;
        const line = `[arbiter] would ${says(would)}, gave ${layer || 'nothing'}`;
        const last = bot._arbiterShadowSaid;
        if (last?.line === line && at - last.at < SHADOW_REPEAT_MS) return;
        bot._arbiterShadowSaid = { line, at };
        log(line);
      } catch (err) { failedOnce(err); }
    },
  };
}

// Live: the turn given by the ruling. The winner's run is the layer's own
// step, as the old loop ran it; only who has the turn changes. A winner
// that does nothing keeps the turn (the old loop handed it down the line
// unasked, mid-231-o's 0.9 health to the work), and the ruling, told, asks
// again after IDLE_MS.
//   ctx.backstop  the survival step, run first when survival claims nothing
//                 and a layer in ctx.backstopFor (the meal, the work) has
//                 the turn, as the old loop did: its claim leaves out what
//                 is not cheap to read (the edge, the night mine, the
//                 evening at home), and a step that acts unclaimed is said,
//                 for the claim to learn it. A caller with more to run
//                 first (runGoal's recovery plan) runs it itself, told by
//                 `unclaimed`.
// -> { winner, layer, by, ask, why, acted, backstop, unclaimed }
const SAID_MS = 10000;
async function take(bot, claims, ctx = {}) {
  const state = stateOf(bot, ctx);
  const live = (claims || []).filter(Boolean);
  const r = await arbitrate(bot, live, { ...ctx, run: false });
  const now = ctx.now ?? Date.now();
  const unclaimed = !live.some(c => c.layer === 'survival');
  if (!r.winner) return { ...r, layer: null, acted: false, unclaimed };
  const holding = (layer, action, extra = {}) => {
    const was = state.holder;
    let ids = [];
    try { ids = (ctx.mobs || probe.mobs(bot, STANCE_NEWCOMER) || []).map(t => t.entity?.id); } catch (_) { /* no world */ }
    state.holder = { layer, action, since: was?.layer === layer ? was.since : now, ...(was?.layer === layer && was.idleSince ? { idleSince: was.idleSince } : {}), ids, ...extra };
    require('./turn').takeTurn(bot, layer, action);
  };
  const w = r.winner;
  holding(w.layer, w.action, { urgency: w.urgency, ...(w.reflex ? { reflex: w.reflex } : {}) });
  said(bot, `[arbiter] gave ${w.layer} ${w.action} (${r.by}${r.why && r.by === 'jev' ? `: ${r.why}` : ''})`, now);
  if (ctx.backstop && w.urgency !== 'reflex' && (ctx.backstopFor || ['vitals', 'work']).includes(w.layer) && unclaimed) {
    const given = state.holder;
    holding('survival', 'step');
    if (await ctx.backstop()) {
      said(bot, `[arbiter] survival acted with no claim, ahead of ${w.layer}`, now);
      return { ...r, layer: 'survival', acted: true, backstop: true, unclaimed };
    }
    state.holder = given; require('./turn').takeTurn(bot, w.layer, w.action);
  }
  const acted = !!(w.run ? await w.run(ctx.task) : false);
  idled(state, w, acted, ctx.now ?? Date.now());
  if (bot) bot._arbiterShadow = { would: { layer: w.layer, action: w.action, by: r.by, ...(r.ask ? { ask: true } : {}) }, gave: w.layer, at: now, live: true };
  return { ...r, layer: w.layer, acted, unclaimed };
}
// A line said when it changes, or after ten seconds of the same. `key` is
// what counts as the same: a creeper's distance changes every look.
function said(bot, line, now = Date.now(), log = console.log, key = line) {
  const last = bot?._arbiterSaid;
  if (last?.key === key && now - last.at < SAID_MS) return;
  if (bot) bot._arbiterSaid = { key, at: now };
  log(line);
}

// Whether a reflex outranks what holds the turn: a reflex above the one
// held, or any reflex over a layer's ordinary step, unless it is the step
// already held. A stance Jev chose answers the mobs while it holds, as the
// hurt watchdog allows it (survival.js): the mob reflexes wait for it; the
// lava, the fire, the air and the block do not.
function outranks(bot, reflex, holder, now = Date.now()) {
  if (!reflex) return false;
  if (holder?.reflex) return (REFLEX_RANK[reflex.key] ?? 99) < (REFLEX_RANK[holder.reflex] ?? 99);
  if (holder && holder.layer === reflex.layer && holder.action === reflex.action) return false;
  if (['creeper', 'arm'].includes(reflex.key)) {
    const held = require('./danger').stanceHeld(bot, now);
    if (held && held.choice !== 'keep_working') return false;
  }
  return true;
}

// One look of the watch: the reflexes, and a hostile newcomer while the
// work holds the turn. When one outranks the holder, the holder is stopped
// and bot._preempt set; it stays until the arbiter rules again (rule
// above), with no clock: the hurt watchdog's ten seconds let a step that
// swallowed the throw carry on. Shadow: said, nothing stopped.
// -> the preemption, or null
function watchOnce(bot, { live = mode() === 'live', now = Date.now(), look = probe, log = console.log } = {}) {
  if (!bot?.entity?.position || bot.game?.gameMode === 'creative') return null;
  if (bot._preempt) return bot._preempt;
  const state = bot._arbiter ||= {};
  const holder = live ? state.holder || null : bot._turn ? { layer: bot._turn.holder, action: bot._turn.phase } : null;
  const top = observeReflexes(bot, state.reflexes || [], look)[0];
  let p = null;
  if (outranks(bot, top, holder, now)) p = { by: top.key, layer: top.layer, action: top.action, facts: top.facts, why: `${top.action.replaceAll('_', ' ')} ${JSON.stringify(top.facts)}` };
  // A newcomer: the ruling was made without it. The work's own threat check
  // (interruptCheck) is swapped out by nested steps and lost with them.
  else if (holder?.layer === 'work' && holder.ids) {
    let mobs = [];
    try { mobs = look.mobs(bot, STANCE_NEWCOMER) || []; } catch (_) { /* no world */ }
    const fresh = mobs.find(t => t.entity && t.distance <= STANCE_NEWCOMER && (t.visible || t.distance <= 4) && !holder.ids.includes(t.entity.id));
    if (fresh) p = { by: 'newcomer', layer: null, action: null, facts: { mob: fresh.entity.name, distance: Math.round(fresh.distance * 10) / 10, seen: !!fresh.visible },
      why: `a ${fresh.entity.name} came within ${Math.round(fresh.distance)} blocks` };
  }
  if (!p) return null;
  const over = holder ? `${holder.layer}${holder.action ? ` ${holder.action}` : ''}` : 'nothing held';
  // In shadow the holder is the old loop's mark (turn.js), and survival's
  // own step answers its reflexes when it next looks: said over the work.
  if (!live) { if (holder?.layer === 'work') said(bot, `[arbiter] would preempt ${over}: ${p.why}`, now, log, `preempt ${over} ${p.by}`); return null; }
  bot._preempt = { ...p, at: now, over };
  const was = require('./turn').stopForTurn(bot, p.why);
  log(`[arbiter] preempted ${over}: ${JSON.stringify(was)}`);
  return bot._preempt;
}
// Four looks a second beside the stall watch, from the loop's start to its
// end. A look that fails is said once and the watch goes on.
function watch(bot, opts = {}) {
  const state = bot._arbiter ||= {};
  if (state.watchTimer) return state.watchTimer;
  state.watchTimer = setInterval(() => { try { watchOnce(bot, opts); } catch (err) { failedOnce(err); } }, WATCH_MS);
  state.watchTimer.unref?.();
  return state.watchTimer;
}
function unwatch(bot) {
  const state = bot?._arbiter;
  if (state?.watchTimer) { clearInterval(state.watchTimer); delete state.watchTimer; }
  if (state) delete state.holder;
  if (bot) delete bot._preempt;
}

module.exports = { claimSays, ALERTS, mode, arbitrate, rule, take, shadow, watch, watchOnce, unwatch, outranks, observeReflexes, rulesPick, fingerprintOf, foodBand, probe, REFLEXES, LAYERS, CREEPER_REACH, ARM, AIR, HYSTERESIS, RULING_MS, IDLE_MS, WATCH_MS, FOOD_BANDS };
