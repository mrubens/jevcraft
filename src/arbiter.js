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
// health falling, the food crossing a band, or a minute.
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
const fingerprintOf = claims => claims.map(c => `${c.layer}:${c.action}`).sort().join('|');

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
  if (fingerprintOf(claims) !== ruling.fingerprint) return 'the claims changed';
  if (seen.ids.some(id => !ruling.ids.includes(id))) return 'a newcomer within six blocks';
  if (seen.health <= ruling.health - STANCE_HEALTH) return `health fell ${STANCE_HEALTH}`;
  if (seen.band !== ruling.band) return 'food crossed a band';
  return null;
}

// What Jev reads for one claim.
const optionOf = c => ({ description: { action: c.action, urgency: c.urgency, facts: c.facts || {}, ...(c.cost ? { cost: c.cost } : {}) }, run: c.run });

// arbitrate(bot, claims, ctx) -> { winner, by, ask, why, ruling, acted }
//   ctx.state   where the ruling and the held reflexes live (bot._arbiter)
//   ctx.dry     compute only: nothing is run and Jev is not asked; `ask`
//               says whether he would be, and the rules' pick stands in
//   ctx.decide  the question runner (decisions.decide), for the tests
//   ctx.now, ctx.mobs, ctx.task, ctx.goal, ctx.save, ctx.client
async function arbitrate(bot, claims, ctx = {}) {
  const result = rule(bot, claims, ctx);
  if (result.pending) {
    const { live, seen, now, why } = result.pending;
    const decide = ctx.decide || require('./decisions').decide;
    const tree = Object.fromEntries(live.map(c => [c.layer, optionOf(c)]));
    const decision = await decide('turn_priority', { client: ctx.client, bot, task: ctx.task, goal: ctx.goal, save: ctx.save, tree,
      state: { health: bot?.health, food: bot?.food, claims: live.map(c => c.layer) } });
    if (decision?.stale) return { winner: null, by: 'stale', ask: true, why };
    const winner = live.find(c => c.layer === decision?.path?.[0]) || rulesPick(live);
    const state = stateOf(bot, ctx);
    state.ruling = { winner: winner.layer, fingerprint: fingerprintOf(live), at: now, until: now + RULING_MS, ...seen };
    Object.assign(result, { winner, by: 'jev', ruling: state.ruling });
    delete result.pending;
  }
  if (!ctx.dry && result.winner?.run) result.acted = !!(await result.winner.run(ctx.task));
  return result;
}

const stateOf = (bot, ctx) => ctx.state || (bot ? (bot._arbiter ||= {}) : (ctx.state = {}));

// The ruling by rules alone, at once: everything but the question. Dry, the
// rules' pick stands where Jev would be asked, and is held as his would be.
function rule(bot, claims, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const state = stateOf(bot, ctx);
  const live = (claims || []).filter(Boolean);
  const reflexes = live.filter(c => c.urgency === 'reflex').sort((a, b) => (REFLEX_RANK[a.reflex] ?? 99) - (REFLEX_RANK[b.reflex] ?? 99));
  state.reflexes = [...new Set(reflexes.map(c => c.reflex).filter(Boolean))];
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

module.exports = { arbitrate, rule, shadow, observeReflexes, rulesPick, fingerprintOf, foodBand, probe, REFLEXES, LAYERS, CREEPER_REACH, ARM, AIR, HYSTERESIS, RULING_MS, FOOD_BANDS };
