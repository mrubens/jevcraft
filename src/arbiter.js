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
//   claim   null, or { layer, action, urgency: 'body'|'pressing'|'routine',
//           facts: {observed values}, run: async task => bool, preemptible,
//           minHoldMs, reflex (the key below, for a reflex), cost }
// A reflex is physical safety and never asked: the first in REFLEXES wins.
// Otherwise one claim is taken as it is, and two or more go to Jev as one
// question (turn_priority), one option per claim, its facts and cost said.
// The ruling is held until something changes it: a reflex, a newcomer, the
// health falling, the food crossing a band, its winner doing nothing, or a
// minute.
//
// Two modes (JEV_ARBITER): live, the default, where the ruling gives the
// turn (take below, runGoal and runIdle) and the watch stops a holder that a
// reflex or a newcomer outranks; and shadow (JEV_ARBITER=shadow), where the
// old layers keep the turn and the ruling is only logged beside theirs.
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
// Live everywhere since note 536: the half-and-half comparison of note 485
// had served, and the deaths it showed were the old order's (a hunt that
// ran before survival while fireballs landed, note 533).
const mode = () => process.env.JEV_ARBITER === 'shadow' ? 'shadow' : 'live';
// Hunger six and under, no sprinting; under eighteen, no healing (vitals.js).
const FOOD_BANDS = [6, 17];
const foodBand = food => FOOD_BANDS.filter(b => (food ?? 20) > b).length;

// The reflexes, in the order they win. Kept in step with stillness.js
// EMERGENCIES: each one's action is an emergency there, never set aside.
const REFLEXES = [
  { key: 'lava', layer: 'survival', action: 'leave_lava' },
  { key: 'fire', layer: 'vitals', action: 'out_of_fire' },
  { key: 'head_in_block', layer: 'vitals', action: 'dig_out_of_block' },
  // A hot floor under a body standing still: mid-242-aa-nether-3 stood on
  // a magma block from 20 to none through the work, a rest and a meal
  // (note 579). The way off is body_way's, asked in the vitals step.
  { key: 'hot_floor', layer: 'vitals', action: 'off_hot_floor' },
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
// block, a hot floor, air) is taken by rule.
const ALERTS = new Set(['creeper', 'arm']);
// The shadow's pick (JEV_ARBITER=shadow, and a dry ruling): the more urgent
// claim, and among equals the layer that keeps the bot alive first. In live
// play the turn is never given by it: Jev not answering, nobody is given
// the turn and the question is asked again (jev-down.js, note 707).
const LAYERS = ['survival', 'vitals', 'hunt', 'work'];
const URGENCY = { body: 0, pressing: 1, routine: 2 };

// What the reflexes read, injectable for the tests.
const probe = {
  inLava: bot => require('./terrain').bodyInLava(bot),
  // A fire the reflex can answer (vitals.js fireToAnswer): alight in the
  // Nether with no flames about, it has none, and the claims decide (note 548).
  burning: bot => require('./vitals').fireToAnswer(bot),
  headInBlock: bot => require('./vitals').headInBlock(bot),
  hotFloor: bot => require('./vitals').onHotFloor(bot),
  // Burning out of the fire that Jev chose to leave to burn out (body_way):
  // held, not a reflex, until it could have ended or health falls four more.
  burnLeft: bot => !require('./vitals').inFire(bot) && !!require('./body').held(bot, 'fire'),
  mobs: (bot, radius) => require('./danger').threats(bot, radius),
  // What the threat check a layer's run is given (work.js liveTurn,
  // danger.js checkThreats) finds now.
  threatNow: bot => require('./danger').immediateThreat(bot),
  // A biter at its own reach of the bot, and something that can push it
  // with a deadly drop beside it (danger.js atReach, pushOverDrop): what the
  // ruling and the holder's turn were given against (note 586).
  atReach: bot => require('./danger').atReach(bot),
  pushOver: bot => require('./danger').pushOverDrop(bot),
  // The walkers about with no way to the bot (danger.js noWayIds).
  noWay: (bot, list) => require('./danger').noWayIds(bot, list),
};
// Whether a mob is at its reach of the bot, or a push can put it over a
// deadly drop, now: { reach, push }, false where a look fails.
function pressing(bot, look = probe) {
  let reach = false, push = false;
  try { reach = !!(look.atReach?.(bot) || []).length; } catch (_) { reach = false; }
  try { push = !!look.pushOver?.(bot); } catch (_) { push = false; }
  return { reach, push };
}

// What one blow of a mob at arm's length costs this body through the armour
// worn, 0 for one that does not strike at arm's length (a shooter, a creeper)
// or a blaze still farther than its two blocks (it shoots from there). The
// figures are the questions' own (combat-estimate MOBS, FIREBALL.melee).
function blowOf(bot, t, { held = false } = {}) {
  const ce = require('./combat-estimate');
  const name = t?.entity?.name, m = ce.MOBS[name];
  if (!m || name === 'creeper') return 0;
  if (name === 'blaze') { if (t.distance > ce.FIREBALL.meleeReach + (held ? HYSTERESIS : 0)) return 0; }
  else if (m.shoots) return 0;
  const hit = name === 'blaze' ? ce.FIREBALL.melee : (m.most ?? m.hit);
  const worn = ce.armourOf([5, 6, 7, 8].map(slot => bot?.inventory?.slots?.[slot]?.name).filter(Boolean));
  return m.ignoresArmour ? hit : ce.afterArmour(hit, worn);
}
// How many blows of the hardest at arm's length end the bot before Jev is
// asked again: the alert does not wait for the last six health but for the
// last BLOWS_LEFT blows. 25594 (mid-242-dd-fortress-16, 05:05:37Z) at 20
// health between four blazes took 4.8 a second at 33.5, 34.5, 35.5 and 36.5
// and was first preempted at 1.6 (the alert stood at six health, one blow
// from the bot's end); a wither skeleton's 6.7 took 20 to none in three
// blows a second and a half apart (25591, 09:36:05Z).
const BLOWS_LEFT = 3, STRUCK_MS = 4000;

// The reflexes that hold now, as { key, layer, action, facts }. `held` is
// the set that held last time: one of them lasts to its line plus two.
function observeReflexes(bot, held = bot?._arbiter?.reflexes || [], look = probe) {
  if (!bot?.entity?.position) return [];
  const was = new Set(held), out = [];
  const add = (key, facts) => { const r = REFLEXES.find(x => x.key === key); out.push({ key, layer: r.layer, action: r.action, facts }); };
  if (look.inLava(bot)) add('lava', { inLava: true, health: bot.health });
  if (look.burning(bot) && !look.burnLeft?.(bot)) add('fire', { burning: true, health: bot.health });
  if (look.headInBlock(bot)) add('head_in_block', { headInBlock: true, health: bot.health });
  const hot = look.hotFloor?.(bot);
  if (hot) add('hot_floor', { hotFloor: hot.block?.name || true, health: bot.health });
  const air = bot.oxygenLevel ?? 20;
  if (air <= AIR + (was.has('air') ? HYSTERESIS : 0)) add('air', { air });
  const mobs = look.mobs(bot, CREEPER_REACH + HYSTERESIS + 1) || [];
  // In sight, or within four unseen: it comes round the corner already at
  // its fuse's distance (danger.js immediateThreat, mid-79-b). Not one out of
  // sight past four, once alerted (the sight is the rule's, danger.js keeps a
  // creeper seen close a moment ago in sight for three seconds), and not one
  // with no way to the bot (walk-reach.js): the step answers the creepers
  // it sees or that are within four with a way, and an alert it does not
  // answer is a promise the claim does not keep. 25593 (mid-242-ig, 22:20:20
  // to 22:22Z), sealed 27 blocks under the sky, was asked turn_priority
  // about ten times, once every ten seconds, "the stance is asked next", for
  // a creeper 6 to 9 blocks off through the rock; no stance came (note 696).
  const creeperLine = CREEPER_REACH + (was.has('creeper') ? HYSTERESIS : 0);
  const creepers = mobs.filter(t => t.entity?.name === 'creeper' && t.distance <= creeperLine && (t.visible || t.distance <= 4));
  let apart = new Set();
  if (creepers.length) { try { apart = look.noWay?.(bot, mobs) || new Set(); } catch (_) { apart = new Set(); } }
  const creeper = creepers.filter(t => !apart.has(t.entity.id)).sort((a, b) => a.distance - b.distance)[0];
  if (creeper) add('creeper', { creeper: Math.round(creeper.distance * 10) / 10, seen: !!creeper.visible, lightsAt: LIGHTS_AT, blocksASecond: APPROACH, fuse: FUSE });
  const armLine = ARM + (was.has('arm') ? HYSTERESIS : 0);
  // At the stance's six health or under, or with no more than BLOWS_LEFT of
  // the blows that mob strikes at arm's length between the bot and its end.
  // A blow taken within the last STRUCK_MS: the mob is at its work, not just
  // near (first contact is the reach rule's, below).
  const health = bot.health ?? 20, struck = Date.now() - (bot._recentHurtAt || 0) < STRUCK_MS;
  const arm = mobs.filter(t => t.entity && t.distance <= armLine && (t.visible || t.distance <= 2))
    .map(t => ({ t, blow: blowOf(bot, t, { held: was.has('arm') }) }))
    .filter(({ blow }) => health <= STANCE_HEALTH || (struck && blow > 0 && health <= BLOWS_LEFT * blow))
    .sort((a, b) => a.t.distance - b.t.distance)[0];
  if (arm) {
    const { t: close, blow } = arm;
    add('arm', { mob: close.entity.name, distance: Math.round(close.distance * 10) / 10, health: bot.health,
      ...(blow > 0 ? { blowThroughArmour: Math.round(blow * 10) / 10, blowsThatEndIt: Math.ceil(health / blow) } : {}) });
  }
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
// Nor is a layer's own action changing (survival between its shelter and
// the creeper's answer: mid-236-j was asked twice in a second): who acts is
// the question, and an alert's coming or going is part of that (note 492).
const keyOf = c => `${c.layer}${c.alert ? `:${c.alert}` : ''}`;
const fingerprintOf = claims => claims.map(keyOf).sort().join('|');
// A claim's absence counts once it has been absent two passes running. A
// claim read from a mob at the edge of a reach comes and goes: in twenty
// seconds mid-235-p-fortress-1 was asked turn_priority six times, three of
// them survival's claim going and coming (its blaze drifting across the
// sixteen blocks then counted, a fireball in flight and then not), each
// absence taken as the ruling's end, the one-claim pass between dropping
// the ruling so the return was asked as new (note 509). A claim that comes
// counts at once: that is news.
const ABSENT_PASSES = 2;
// The layers absent this pass that were here the last, as layer -> key.
function missing(state, live) {
  const was = state.claimed || {}, now = {};
  for (const c of live) now[c.layer] = { key: keyOf(c), missed: 0 };
  for (const [layer, e] of Object.entries(was)) if (!now[layer] && e.missed + 1 < ABSENT_PASSES) now[layer] = { key: e.key, missed: e.missed + 1 };
  state.claimed = now;
  return new Map(Object.entries(now).filter(([, e]) => e.missed).map(([layer, e]) => [layer, e.key]));
}
// When a claim's last run was stopped, as a time.
const stoppedAt = c => { const t = c?.facts?.lastErrorAt; return typeof t === 'number' ? t : Date.parse(t || '') || 0; };
const STOPPED_BY_THREAT = /Threat nearby|Preempted|hurt|NeedsSafety/i;

// What the ruling was made against: the mobs within STANCE_NEWCOMER, the
// health and the food band.
// And whether a mob was at its reach, or a push over a deadly drop about
// (pressing): a ruling for the work made without one is asked again when
// one comes (note 586).
function observe(bot, ctx) {
  const mobs = ctx.mobs || (() => { try { return probe.mobs(bot, STANCE_NEWCOMER); } catch (_) { return []; } })();
  // A mob counts as come when it can be at the bot: in sight, or within four
  // (the watch's own newcomer, watchOnce). One out of sight behind rock is
  // counted when it comes into sight. At a live spawner every blaze it put
  // out behind the rock re-asked the turn: 25591 (mid-242-nb) was asked
  // turn_priority 14 times in 43 seconds, each "a newcomer within six
  // blocks", none of them seeing it (note 708).
  return { ids: mobs.filter(t => t.distance <= STANCE_NEWCOMER && (t.visible !== false || t.distance <= 4)).map(t => t.entity?.id), health: bot?.health ?? 20, band: foodBand(bot?.food),
    ...(ctx.pressing || pressing(bot, ctx.look || probe)) };
}

// The same scene, answered lately: its answer is given again, not asked
// again (note 672). turn_priority was a fifth of all asks on 2026-09-28
// and 29 (21,507 of 108,743, a question a minute a bot); 39% came with no
// ruling standing (one dropped by a reflex or a single claim between) and
// a fifth more with the claims gone and come back, and of those asked
// within thirty seconds of an answer to the same scene, 94% were answered
// the same. The scene is what the answer is weighed on: each claim's layer,
// alert and action, the kinds of mob within sixteen blocks, and the food
// band; health fallen SCENE_HEALTH since, a newcomer, a stopped or idle
// winner, a minute passed or a mob at reach are asked as before (broken).
const SCENE_MS = 30000, SCENE_HEALTH = 4;
const SCENE_WHY = /^(no ruling|its winner no longer claims|the claims changed)$/;
function sceneOf(bot, claims, seen, ctx = {}) {
  let about = ctx.mobs;
  if (!about) { try { about = probe.mobs(bot, 16); } catch (_) { about = []; } }
  const kinds = [...new Set((about || []).filter(t => !(t.distance > 16)).map(t => t.entity?.name).filter(Boolean))].sort();
  return `${claims.map(c => `${keyOf(c)}:${c.action}`).sort().join('|')}#${kinds.join(',')}#${seen.band}`;
}
function sameScene(state, scene, why, seen, now) {
  const was = state.scenes?.[scene];
  if (!was || !SCENE_WHY.test(why) || now - was.at >= SCENE_MS || seen.health <= was.health - SCENE_HEALTH) return null;
  return was;
}
function answeredScene(state, scene, winner, health, now) {
  const kept = Object.entries(state.scenes || {}).filter(([, s]) => now - s.at < SCENE_MS);
  state.scenes = Object.fromEntries([...kept, [scene, { winner, at: now, health }]]);
}

// Why a held ruling no longer holds, or null while it does.
function broken(ruling, claims, seen, now, print = fingerprintOf(claims)) {
  if (!ruling) return 'no ruling';
  const winner = claims.find(c => c.layer === ruling.winner);
  if (!winner) return 'its winner no longer claims';
  // A winner that asked not to be cut short keeps the turn for its hold,
  // whatever else comes; only a reflex takes it.
  if (winner.preemptible === false && now - ruling.at < (winner.minHoldMs || 0)) return null;
  if (ruling.stoppedBy) return `its winner was stopped: ${ruling.stoppedBy}`;
  if (now >= ruling.until) return 'a minute passed';
  // Its winner stopped by a mob since the ruling: the ruling was made
  // before it, and giving it the turn back only stops it again. mid-218-n's
  // work was stopped by a drowned eleven times in four seconds, handed back
  // each time on the ruling held, at seven health (note 490).
  if (stoppedAt(winner) > ruling.at && STOPPED_BY_THREAT.test(winner.facts?.lastError || '')) return `its winner was stopped: ${winner.facts.lastError}`;
  if (ruling.idleSince && now - ruling.idleSince >= IDLE_MS) return `its winner did nothing for ${IDLE_MS / 1000} seconds`;
  if (print !== ruling.fingerprint) return 'the claims changed';
  if (seen.ids.some(id => !ruling.ids.includes(id))) return 'a newcomer within six blocks';
  // The turn given to a layer other than survival's with no mob at its
  // reach, or nothing to push the bot over the drop beside it: one coming is
  // asked about, whoever holds the turn (note 586). mid-242-ae's work was
  // given the turn after a meal with a spear piglin four blocks off, and it
  // came to its reach and speared the bot to death with no one asked.
  if (ruling.winner !== 'survival' && seen.reach && !ruling.reach) return 'a mob came within its reach of the bot';
  if (ruling.winner !== 'survival' && seen.push && !ruling.push) return 'something that can push the bot is about, a deadly drop beside it';
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
// Said beside a claim's own words, at the asking (note 585):
// - a layer whose last turns were each stopped at once by the threat check
//   its run is given, and whether that check finds a threat now. mid-242-
//   ab-nether-3 was asked turn_priority 41 times in six seconds in a sealed
//   pocket at 10.6 health: Jev gave the meal the turn each time (0.5 to
//   0.9), and each time the meal's check found a blaze the stance was
//   chosen against, out of sight behind the pocket's wall, and stopped it
//   before a bite; the meal's option said "Eat beef now", nothing more.
// - the work's option, with the body and the mobs about: at 2.5 health,
//   hunger 17 and nothing to eat, two blazes 3.4 and 3.9 blocks off out of
//   sight, the same trial's work was offered as "Go on with the work: find
//   fortress", taken (none good 0.75, the work the best listed), and it
//   walked into their fire and died 34 seconds later.
const STOPS_MS = 10000, STOP_SAID_MS = 30000;
function stopped(state, layer, why, now = Date.now()) {
  const was = state.stopped;
  const again = was?.layer === layer && now - was.at < STOPS_MS;
  state.stopped = { layer, why: String(why || '').slice(0, 120), at: now, first: again ? was.first : now, count: again ? was.count + 1 : 1 };
}
function stoppedSays(bot, state, layer, now = Date.now()) {
  const s = state.stopped;
  if (!s || s.layer !== layer || now - s.at > STOP_SAID_MS) return null;
  let threat = null; try { threat = probe.threatNow(bot); } catch (_) { threat = null; }
  const span = Math.max(1, Math.round((now - s.first) / 1000));
  const found = threat ? `the ${String(threat.entity?.name || 'mob').replaceAll('_', ' ')} ${Math.round(threat.distance)} blocks off${threat.visible === false ? ' (out of sight)' : ''}${threat.stance ? `, one the ${String(threat.stance).replaceAll('_', ' ')} stance was chosen against` : ''}` : null;
  return `${s.count === 1 ? 'Its last turn was' : `Its last ${s.count} turns, in the last ${span} second${span === 1 ? '' : 's'}, were each`} stopped at once by the threat check its run is given: ${s.why}. ${found ? `That check still finds one now: ${found}; given the turn again, it is stopped again at once.` : 'That check finds nothing now.'}`;
}
// What a mob about would do to a bot going on with the work: a shooter
// fires from its own reach at what it sees, a biter comes at the bot once
// it has seen it, at its walk. mid-235-q-nether-2-fortress-4's work was
// given the turn at 4 health beside "a piglin 9.8 blocks off" (in sight, no
// gold worn), and a ghast 60 blocks off, past the sixteen then said, ended
// it eighteen seconds later (note 607).
function mobWouldSays(t, { noWay = false, bot = null } = {}) {
  const ce = require('./combat-estimate'), name = t.entity.name;
  // An angry one of a group (anger.js): hunting the bot, not "no way".
  // 25592's stance said of what was about "it has no way to the bot" two
  // seconds before three zombified piglins killed it (note 703).
  let angry = null;
  try { angry = bot ? require('./anger').angrySays(bot, t.entity) : null; } catch (_) { angry = null; }
  if (angry) return noWay ? `${angry}; no way to the bot is found within 12 blocks now` : angry;
  // A walker with no way to the bot (walk-reach.js) is about, not coming:
  // 25593's creeper through the rock read "once it sees the bot it comes at
  // it, about 2 seconds at its walk" (note 696).
  if (noWay) return `it has no way to the bot from where it is (none found through the ground between)${name === 'creeper' ? ', and goes off only within about three blocks' : ''}`;
  const reach = ce.RANGE[name] || (ce.MOBS[name]?.shoots ? 15 : null);
  if (reach) return t.visible ? `it has the bot in sight and fires at it from as far as ${reach} blocks` : `it fires once it has the bot in sight, from as far as ${reach} blocks`;
  const secs = Math.max(1, Math.round(t.distance / ce.blocksPerSecond(name)));
  const why = name === 'piglin' ? ' (no gold is worn)' : '';
  return t.visible ? `it sees the bot${why} and comes at it: at the bot in about ${secs} seconds at its walk` : `once it sees the bot it comes at it${why}, about ${secs} seconds at its walk`;
}
function workBodySays(bot, mobs) {
  const hp = bot?.health, food = bot?.food;
  if (typeof hp !== 'number') return null;
  const ce = require('./combat-estimate');
  const worn = (() => { try { return ce.armourOf([5, 6, 7, 8].map(s => bot.inventory?.slots?.[s]?.name).filter(Boolean)); } catch (_) { return null; } })();
  const hit = name => { const m = ce.MOBS[name]; return m?.hit && worn ? Math.round(ce.afterArmour(m.hit, worn) * 10) / 10 : null; };
  const heals = (food ?? 20) >= 18;
  // Hurt with health not coming back, the shooters past sixteen whose fire
  // reaches the bot are among the mobs about too (combat-estimate RANGE).
  const far = heals || hp >= 20 ? [] : (() => { try { return probe.mobs(bot, 64).filter(t => t.distance > 16 && t.distance <= (ce.RANGE[t.entity.name] || 0)); } catch (_) { return []; } })();
  const said = [...(mobs || []), ...far].filter(t => t.entity?.name);
  let apart = new Set();
  try { apart = probe.noWay(bot, said.filter(t => !t.visible)) || new Set(); } catch (_) { apart = new Set(); }
  const line = t => {
    const h = hit(t.entity.name), noWay = !t.visible && apart.has(t.entity.id);
    let angry = false;
    try { angry = require('./anger').angry(bot, t.entity); } catch (_) { angry = false; }
    if (angry) return `${/^[aeiou]/.test(t.entity.name) ? 'an' : 'a'} ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance * 10) / 10} blocks off${t.visible ? '' : ' (out of sight)'}${h ? `, about ${h} a hit through the armour worn` : ''}; ${mobWouldSays(t, { noWay, bot })}`;
    return `${/^[aeiou]/.test(t.entity.name) ? 'an' : 'a'} ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance * 10) / 10} blocks off${t.visible ? '' : ' (out of sight)'}${h ? `, about ${h} a hit through the armour worn${h >= hp && !noWay ? ' (as much as the health left)' : ''}` : ''}${heals && !noWay ? '' : `; ${mobWouldSays(t, { noWay })}`}`;
  };
  // Each mob its own sentence where what it would do is said.
  const near = said.slice(0, 5).map(line).map(l => heals ? l : `${l[0].toUpperCase()}${l.slice(1)}`);
  let fed = '';
  if (!heals) {
    let points = 0; try { points = require('./foraging').foodSupply(bot); } catch (_) { points = 0; }
    fed = points ? '' : ', and nothing carried is food, so it does not come back while the work goes on';
  }
  const back = heals ? 'it comes back meanwhile, at hunger eighteen or more' : `it does not come back at hunger ${food}${fed}`;
  return `Health ${Math.round(hp * 10) / 10}: ${back}.${near.length ? ` ${far.length ? 'Mobs about now, within sixteen blocks and the shooters farther off whose fire reaches the bot' : 'Mobs within sixteen blocks now'}: ${near.join(heals ? '; ' : '. ')}.` : ''}`;
}
function withSays(option, c, bot, state, mobs, now) {
  const add = [];
  const stop = stoppedSays(bot, state, c.layer, now);
  if (stop) add.push(stop);
  if (c.layer === 'work') { const body = workBodySays(bot, mobs); if (body) add.push(body); }
  // Where the bot stands now, with a ghast in sight whose fireball's push
  // carries it over a drop that kills: said on the work too, as on the
  // survival claim (note 612). mid-242-bb-fortress-2's work was offered
  // beside the piglin and the drop, the ghast 55 blocks off in sight said
  // nowhere, and its fireball threw the bot into the lava.
  if (c.layer === 'work') { let blast = null; try { blast = require('./survival').blastOverSays(bot); } catch (_) { blast = null; } if (blast) add.push(`Where the bot stands now:${blast.says}`); }
  if (!add.length) return option;
  const d = option.description;
  return { ...option, description: { ...d, does: `${d.does} ${add.join(' ')}`, ...(stop ? { facts: { ...d.facts, stoppedAtOnce: stop } } : {}) } };
}

// What giving a layer the turn does, in words: mid-218-n chose the work
// ("recover_before_nether") over "escape_threat" at seven health with a
// drowned five blocks off, the options named by their code (note 490).
function claimSays(c) {
  const f = c.facts || {}, mob = t => t ? `the ${String(t.name).replaceAll('_', ' ')}${/_spear$/.test(t.held || '') ? ' with a spear' : ''} ${t.distance} blocks off${t.seen === false ? ' (out of sight)' : ''}` : 'the mobs about';
  const hp = f.health !== undefined ? ` Health ${Math.round(f.health * 10) / 10}.` : '';
  const heals = f.healing === false ? ` It does not come back at hunger ${f.food}.` : f.healing ? ' It comes back meanwhile, at hunger eighteen or more.' : '';
  // A shooter's reach and what it has done, said: mid-235-p-fortress-1's
  // blaze fired from 16.5 blocks (note 509).
  const fire = t => t?.shoots ? `, which fires from as far as ${t.reach} blocks${t.fireballLandsPer100 !== undefined ? ` (from here each fireball lands about ${t.fireballLandsPer100} in 100, a volley of three at least one about ${t.volleyLandsOnePer100} in 100; its volleys land more often than not within about ${t.volleysMostlyLandWithin})` : ''}${t.hitItSecondsAgo !== undefined ? ` and hit the bot ${t.hitItSecondsAgo} seconds ago` : ''}${t.shotsInFlight ? `, ${t.shotsInFlight} shot${t.shotsInFlight === 1 ? '' : 's'} on the way now` : ''}` : '';
  const plural = item => { const s = String(item).replaceAll('_', ' '); return s.endsWith('s') ? s : `${s}s`; };
  switch (c.action) {
    // With the pocket begun here and the mob in its wall, said: mid-226-h's
    // Jev read "answer the skeleton" while the seal went at its cell forty
    // times (note 520).
    // A stance chosen and holding goes on (note 535): said so, not as a
    // question to come.
    case 'escape_threat': return `Answer ${f.threat ? mob(f.threat) : f.atArm ? `${f.atArm.map(mob).join(', ')}, at arm's length` : f.mob ? mob({ name: f.mob, distance: f.distance }) : 'the mob about'}${fire(f.threat)}: ${f.stance ? `the ${String(f.stance.choice).replaceAll('_', ' ')} chosen against it ${f.stance.secondsAgo} second${f.stance.secondsAgo === 1 ? '' : 's'} ago goes on (asked again when it fails, when a mob it was not chosen against comes within six blocks, or once it has cost more than it was said to)` : 'the stance is asked next (fight, back off, pillar, a pocket, dig down, eat, and the rest)'}.${f.edge ? ` ${f.edge}` : ''}${f.push ? ` ${f.push}` : ''}${f.pocket ? ` ${f.pocket}` : ''}${f.onPillar ? ` ${f.onPillar}` : ''} The work waits.${hp}${heals}`;
    case 'creeper_back_off': return `Answer the creeper ${f.creeper} blocks off${f.seen === false ? ' (out of sight)' : ''}: it lights about ${f.lightsAt} blocks off and goes off ${f.fuse} seconds after, walking about ${f.blocksASecond} blocks a second; ${f.stance ? `the ${String(f.stance.choice).replaceAll('_', ' ')} chosen ${f.stance.secondsAgo} second${f.stance.secondsAgo === 1 ? '' : 's'} ago goes on` : 'the stance is asked next'}. The work waits.`;
    case 'surface': return `Swim up for air: the head is under water, air ${f.air} of 20; at none, drowning takes 2 health a second.${hp}`;
    // Said with the biters walking up while it eats, standing still (note 552).
    case 'eat': return `Eat ${f.item ? (f.item === 'chicken' ? 'raw chicken' : String(f.item).replaceAll('_', ' ')) : 'food'} now, about ${c.cost?.seconds || 1.6} seconds standing still.${hp} Hunger ${f.food}${f.foodPoints ? ` to ${Math.min(20, f.food + f.foodPoints)}` : ''}.${heals}${f.effect ? ` It is the last resort: ${f.effect}.` : ''}${(f.comingAtTheBot || []).map(m => ` ${mob(m)[0].toUpperCase()}${mob(m).slice(1)} is coming at about ${m.blocksASecond} blocks a second, at the bot in about ${m.atBotInSeconds} seconds${m.atBotInSeconds <= (c.cost?.seconds || 1.6) ? ', before the meal is done' : ''}${m.hitsFor ? `; each hit about ${m.hitsFor} through the armour worn${f.health !== undefined && m.hitsFor >= f.health ? ' (as much as the health left)' : ''}` : ''}${m.note ? ` (${m.note})` : ''}.`).join('')}`;
    case 'leave_lava': return 'Get out of the lava.';
    case 'out_of_fire': return 'Put out the fire on the bot.';
    case 'dig_out_of_block': return 'Dig the head out of the block it is in.';
    case 'swim_up': return `Swim up: air ${f.air} of 20.`;
    // With its minutes so far and what it was sealed against (note 584).
    case 'pocket_next': return `In a sealed pocket${f.inPocketMinutes !== undefined ? `, ${f.inPocketMinutes} minutes so far` : ''}${f.sealedAgainst ? `, sealed against ${f.sealedAgainst}` : ''}: whether to stay, leave or do something else there is asked next.${f.waitingFor ? ` The wait there waits for ${f.waitingFor}${f.staysForNothing ? `; stay chosen ${f.staysForNothing} time${f.staysForNothing === 1 ? '' : 's'} in it, nothing changed in any` : ''}.` : ''}${hp}${heals}`;
    case 'secure_shelter': return `Shelter for the night: the way (a room, a pocket here, a shaft, the bed) is asked next.${hp}${heals}`;
    // Said with the last resort carried and, when health does not come back,
    // the sealed wait for daylight among the ways asked next (note 515).
    case 'obtain_food': return `Find food: where is asked next${f.waitSealedMinutes !== undefined ? `, beside waiting sealed in a pocket for daylight, about ${f.waitSealedMinutes} real minutes, standing still and spending no hunger` : ''}. Hunger ${f.food}${f.foodCarried !== undefined ? `, ${f.foodCarried} food points carried` : ''}${f.foodWanted !== undefined ? ` of ${f.foodWanted} wanted` : ''}${f.lastResortCarried ? `, and ${f.lastResortCarried} more in the last resort (rotten flesh or raw chicken, which may bring on Hunger)` : ''}.${hp}${heals}`;
    case 'wait_for_day_sealed': return `Go on sealing a pocket and waiting in it for daylight, as chosen: about ${f.minutesToDawn} real minutes to dawn, standing still and spending no hunger.${hp}${heals}`;
    // The hunt's claim was said as "hunt: hunt." to mid-235-p-fortress-1,
    // at 5.5 health beside the work (note 509): what it goes for, and why.
    // Out of sight and walled in, the fight begins only through the walls
    // (note 708): said, not left as "close on it".
    case 'hunt': return `Hunt ${f.entity ? mob({ name: f.entity, distance: f.distance, seen: f.outOfSight ? false : undefined }) : 'the mob in view'}${f.item ? ` for ${plural(f.item)} (${f.have ?? 0} of ${f.want} carried)` : ''}: ${f.walledIn ? `the bot is walled in (${f.walledIn}), so it closes on it only by digging out first` : 'close on it and fight it'}; which one, and the fight's cost, is asked next. The work waits.${hp}`;
    case 'night_hunt': return `Go on with ${f.forFood ? 'the hunt for food' : 'tonight\'s hunt'}${f.hunting ? ` of ${plural(f.hunting)}` : ''}, as chosen${f.forFood ? '' : ' for the night'}: close on those met and fight them.${hp}${heals}${f.hoglinFight ? ` ${f.hoglinFight}` : ''}`;
    case 'recover_items': return `Go back for the items dropped at the death${f.dropsAt ? ` at ${Math.round(f.dropsAt.x)}, ${Math.round(f.dropsAt.y)}, ${Math.round(f.dropsAt.z)}` : ''}: the way there is walked; items left lying in a loaded area vanish five minutes after they drop.${hp}`;
    case 'go_home_for_night': return `Go home for the night, as planned: the walk to the bed and sleep.${hp}`;
    case 'out_of_powder_snow': return `Get out of the powder snow: freezing takes health while the bot stands in it.${hp}`;
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
    const mobsNow = ctx.mobs || (() => { try { return probe.mobs(bot, 16); } catch (_) { return []; } })();
    const tree = Object.fromEntries(live.map(c => [c.layer, withSays(optionOf(c, held, now), c, bot, state, mobsNow, now)]));
    let setAside = false;
    const askedAt = Date.now();
    const asking = decide('turn_priority', { client: ctx.client, bot, task: ctx.task, goal: ctx.goal, save: ctx.save, tree,
      interrupt: () => { if (setAside) throw new Error('turn_priority set aside'); },
      state: { health: bot?.health, food: bot?.food, claims: live.map(c => c.layer), why,
        mobs: mobsSaid(mobsNow),
        ...(held ? { hasTheTurn: { layer: held.layer, action: held.action, seconds: Math.round((now - held.since) / 1000) } } : {}) } });
    let out;
    try { out = await answerOrCut(bot, asking, { task: ctx.task, askedAt, ms: ctx.askMs ?? ASK_MS }); }
    catch (err) { setAside = true; throw err; }
    if (out.cut) setAside = true;
    const decision = out.decision;
    if (decision?.stale) return { winner: null, by: 'stale', ask: true, why };
    // Cut short (no answer in its time), nobody is given the turn by rule:
    // the question is asked again at the next pass, from where the bot is
    // then (the user, 2026-09-30: "If jev is down, decisions aren't made").
    // Said with how far the question had got (decisions/index.js), the
    // stages a question that never came back could not show (note 540).
    if (out.cut) {
      const got = bot?._asking?.id === 'turn_priority' ? `; the question had got to ${bot._asking.stages.map(s => `${s.stage} ${s.ms}`).join(', ')}` : '';
      console.log(`[arbiter] turn_priority cut short (${out.cut}): nobody given the turn, asked again${got}`);
      delete result.pending;
      return { ...result, winner: null, by: 'cut', ask: true, cut: out.cut, why };
    }
    const winner = live.find(c => c.layer === decision?.path?.[0]);
    // An answer that is no claim of this pass's (gone meanwhile): nobody is
    // given the turn by rule; asked again at the next pass.
    if (!winner) { delete result.pending; return { ...result, winner: null, by: 'stale', ask: true, why }; }
    state.ruling = { winner: winner.layer, fingerprint: fingerprintOf(live), at: now, until: now + RULING_MS, ...seen };
    // Jev's answer to this scene, given again to it for a while (sameScene).
    if (decision?.path && !decision.standIn && result.pending.scene) answeredScene(state, result.pending.scene, winner.layer, seen.health, now);
    Object.assign(result, { winner, by: decision.standIn ? 'stand-in' : 'jev', ruling: state.ruling });
    delete result.pending;
  }
  if (!ctx.dry && ctx.run !== false && result.winner?.run) result.acted = !!(await result.winner.run(ctx.task));
  if (result.acted !== undefined) idled(stateOf(bot, ctx), result.winner, result.acted, ctx.now ?? Date.now());
  return result;
}
// The question out, watched from here as well as from inside decide: the
// turn is nobody's while it is out. mid-243-q-nether-3 asked turn_priority
// with an enderman two blocks off and never had its answer: for six seconds
// the frames said "asking Jev", the enderman took it from twenty to seven,
// the hurt watchdog's stop and a pending preemption were both left standing,
// no layer acted, and it was knocked into lava (note 539). Here the question
// ends when the task's check throws (a preemption, the watchdogs, a cancel:
// thrown, as an abort would be); when no answer has come in ASK_MS the
// question is cut, told to stop at its next look, and nobody is given the
// turn: it is asked again at the next pass. The rules' pick took the turn
// there (and when the bot was hurt while it was out) until note 707: a turn
// given by rule is a decision made without Jev. While Jev is down the
// question's own hold (decisions/index.js, jev-down.js) is the wait, not cut.
const ASK_MS = 5000;
const ASK_LOOK_MS = 50;
function answerOrCut(bot, asking, { task, askedAt = Date.now(), ms = ASK_MS, every = ASK_LOOK_MS } = {}) {
  return new Promise((resolve, reject) => {
    let done = false, timer = null;
    const end = (fn, value) => { if (done) return; done = true; clearInterval(timer); fn(value); };
    Promise.resolve(asking).then(decision => end(resolve, { decision }), err => end(reject, err));
    timer = setInterval(() => {
      try { task?.check?.(); } catch (err) { end(reject, err); return; }
      if (require('./jev-down').isDown(bot)) return;
      if (Date.now() - askedAt >= ms) end(resolve, { cut: `no answer in ${ms / 1000} seconds` });
    }, every);
  });
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
  const reflexes = live.filter(c => c.urgency === 'body').sort((a, b) => (REFLEX_RANK[a.reflex] ?? 99) - (REFLEX_RANK[b.reflex] ?? 99));
  // Held to two past its line, reflex or alert alike (observeReflexes).
  state.reflexes = [...new Set(live.map(c => c.reflex || c.alert).filter(Boolean))];
  // Ruling for real, the arbiter has picked up what the watch stopped the
  // holder for: the reflex is among these claims and wins (it or one above
  // it), or it has gone; a newcomer is among the mobs this ruling reads.
  // A newcomer picked up is known from here: the holder's list takes it, or
  // the same mob coming on from four blocks to three to two preempted three
  // times, each stop cutting the question that was out about it
  // (mid-243-q-nether-3, note 539).
  if (!ctx.dry && bot?._preempt) {
    console.log(`[arbiter] picked up ${bot._preempt.by}`);
    if (bot._preempt.id !== undefined && state.holder?.ids && !state.holder.ids.includes(bot._preempt.id)) state.holder.ids.push(bot._preempt.id);
    delete bot._preempt;
  }
  const gone = missing(state, live);
  if (reflexes.length) { delete state.ruling; return { winner: reflexes[0], by: 'body', ask: false }; }
  // The ruling's claims absent one pass still count for it (ABSENT_PASSES).
  // Its winner absent one pass: nobody has the turn this pass, a breath,
  // and the ruling stands; its claim's run is not taken from a pass it was
  // not in.
  const ruling = state.ruling, ruled = ruling ? new Set(ruling.fingerprint.split('|')) : new Set();
  const kept = [...gone.values()].filter(key => ruled.has(key));
  if (ruling && gone.has(ruling.winner) && !ruling.stoppedBy && now < ruling.until) return { winner: null, by: 'absent', ask: false, why: `its winner, ${ruling.winner}, missed one look`, ruling };
  if (!live.length) { delete state.ruling; return { winner: null, by: 'none', ask: false }; }
  if (live.length === 1 && !kept.length) { delete state.ruling; return { winner: live[0], by: 'single', ask: false }; }
  const seen = observe(bot, ctx);
  const why = broken(ruling, live, seen, now, [...live.map(keyOf), ...kept].sort().join('|'));
  if (!why) return { winner: live.find(c => c.layer === ruling.winner), by: 'held', ask: false, ruling };
  if (live.length === 1) { delete state.ruling; return { winner: live[0], by: 'single', ask: false }; }
  const scene = sceneOf(bot, live, seen, ctx);
  const same = sameScene(state, scene, why, seen, now);
  if (same) {
    const winner = live.find(c => c.layer === same.winner);
    state.ruling = { winner: winner.layer, fingerprint: fingerprintOf(live), at: now, until: same.at + RULING_MS, ...seen };
    return { winner, by: 'scene', ask: false, why: `${why}; this same scene was answered ${Math.round((now - same.at) / 1000)} seconds ago`, ruling: state.ruling };
  }
  if (!ctx.dry) return { winner: null, ask: true, why, pending: { live, seen, now, why, scene } };
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
  if (r.by === 'absent') said(bot, `[arbiter] held for ${r.ruling.winner}: ${r.why}`, now);
  if (!r.winner) return { ...r, layer: null, acted: false, unclaimed };
  // What the turn is given against: a mob at its reach, a push over a
  // deadly drop. Where a ruling was made, what it was made against counts
  // too (Jev was asked with it); the watch stops the holder for one it was
  // given without (watchOnce, note 586).
  const seenNow = ctx.pressing || pressing(bot, ctx.look || probe);
  const knew = { reach: !!(seenNow.reach || r.ruling?.reach), push: !!(seenNow.push || r.ruling?.push) };
  const holding = (layer, action, extra = {}) => {
    const was = state.holder;
    let ids = [];
    try { ids = (ctx.mobs || probe.mobs(bot, STANCE_NEWCOMER) || []).map(t => t.entity?.id); } catch (_) { /* no world */ }
    state.holder = { layer, action, since: was?.layer === layer ? was.since : now, ...(was?.layer === layer && was.idleSince ? { idleSince: was.idleSince } : {}), ids, knew, ...extra };
    require('./turn').takeTurn(bot, layer, action);
  };
  const w = r.winner;
  holding(w.layer, w.action, { urgency: w.urgency, ...(w.reflex ? { reflex: w.reflex } : {}) });
  said(bot, `[arbiter] gave ${w.layer} ${w.action} (${r.by}${r.why && (r.by === 'jev' || r.by === 'scene') ? `: ${r.why}` : ''})`, now);
  if (ctx.backstop && w.urgency !== 'body' && (ctx.backstopFor || ['vitals', 'work']).includes(w.layer) && unclaimed) {
    const given = state.holder;
    holding('survival', 'step');
    if (await ctx.backstop()) {
      said(bot, `[arbiter] survival acted with no claim, ahead of ${w.layer}`, now);
      return { ...r, layer: 'survival', acted: true, backstop: true, unclaimed };
    }
    state.holder = given; require('./turn').takeTurn(bot, w.layer, w.action);
  }
  // Stopped by a mob, any winner's ruling ends with it: giving the turn back
  // only stops it again. mid-218-q's swim up (vitals, Jev's pick at 0.97)
  // was stopped by a drowned at every tick, "Threat nearby", and handed
  // back each time on the ruling held, sinking, until the drowned was on
  // it; survival never answered (note 504). Note 490's rule read only the
  // work's error.
  let acted;
  try { acted = !!(w.run ? await w.run(ctx.task) : false); }
  catch (err) {
    if (err?.name === 'NeedsSafety' && state.ruling?.winner === w.layer) { state.ruling.until = 0; state.ruling.stoppedBy = String(err.message || '').slice(0, 120); }
    if (err?.name === 'NeedsSafety') stopped(state, w.layer, err.message, ctx.now ?? Date.now());
    throw err;
  }
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
  // An alert does not stop the layer it would give the turn to: survival's
  // own step answers a creeper (its stance), and stopping its shelter walk
  // for one, asking who acts, and giving survival the turn again ran round
  // for thirteen seconds with nothing answering it; mid-236-j was blown up
  // at the end of it (note 492). The body's physics still stops anything.
  if (ALERTS.has(reflex.key) && holder?.layer === reflex.layer) return false;
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
  if (bot._preempt) return physicsOver(bot, bot._preempt, { now, look, log });
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
    // A build begun in a lull (spawner-clock.js, note 691) is finished: the
    // kind it was begun against coming out of the spawner is what it is for,
    // and the build meets its volleys itself. A mob at its reach, a push by a
    // drop, and the body's own dangers still preempt (below and above).
    const commit = bot._buildCommit && bot._buildCommit.until > now ? bot._buildCommit : null;
    // Within four counts a melee mob the sight check missed at point-blank
    // range; a shooter has no reach of its own, only sight, so a blaze
    // behind a box's wall (out of sight, note 708's line) does not count
    // just for being close: 25598's box saw none of its cage's cells and
    // still restarted encounter_stance about five times a second, each
    // "a blaze came within 4 blocks" (note 729).
    const { shooter } = require('./mob-policy');
    const fresh = mobs.find(t => t.entity && t.distance <= STANCE_NEWCOMER && (t.visible || (t.distance <= 4 && !shooter(t.entity))) && !holder.ids.includes(t.entity.id) &&
      !(commit && commit.kinds.includes(t.entity.name) && t.distance > 3));
    if (fresh) p = { by: 'newcomer', layer: null, action: null, id: fresh.entity.id, facts: { mob: fresh.entity.name, distance: Math.round(fresh.distance * 10) / 10, seen: !!fresh.visible },
      why: `a ${fresh.entity.name} came within ${Math.round(fresh.distance)} blocks` };
  }
  // A mob come to its reach of the bot, or something that can push it with
  // a deadly drop beside it, that the holder's turn was given without:
  // whose turn it is now is asked (note 586). A layer's long run is not
  // looked into between its passes: mid-242-ac-nether-3's work held one
  // turn for 57 seconds by a nineteen-block drop while a crossbow piglin
  // came on from 28 blocks to 6 and shot it over, and mid-242-ae's work,
  // given the turn after a meal, was speared twice by a piglin come to its
  // reach, neither asked. Not over survival's own step: it answers them.
  if (!p && holder && holder.layer !== 'survival' && holder.knew) {
    const got = pressing(bot, look);
    const mob = got.reach ? (() => { try { return look.atReach(bot)[0]; } catch (_) { return null; } })() : null;
    if (got.reach && !holder.knew.reach) p = { by: 'reach', layer: 'survival', action: 'escape_threat', ...(mob?.entity?.id !== undefined ? { id: mob.entity.id } : {}),
      facts: mob ? { mob: mob.entity.name, distance: Math.round(mob.distance * 10) / 10, seen: !!mob.visible } : {}, why: `a ${mob?.entity?.name || 'mob'} came within its reach of the bot` };
    else if (got.push && !holder.knew.push) p = { by: 'push', layer: 'survival', action: 'escape_threat', facts: {}, why: 'something that can push the bot is about, a deadly drop beside it' };
    // Said once for the holder: its turn now counts it as given with it.
    if (p) holder.knew = { reach: holder.knew.reach || got.reach, push: holder.knew.push || got.push };
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
// While a preemption waits to be picked up, the body's physics is still
// looked for (lava, fire, the head in a block, air), and one above what
// waits takes its place: the holder is stopped again and the arbiter picks
// up the physics. mid-243-q-nether-3 was knocked into lava with a newcomer's
// preemption waiting, the watch looking at nothing (note 540). Newcomers
// and alerts are not looked for until the arbiter has ruled: the same
// enderman coming on from four blocks to three to two preempted three times
// and cut the question each time (note 539). A newcomer's id is kept, so
// the ruling still knows it.
function physicsOver(bot, pending, { now = Date.now(), look = probe, log = console.log } = {}) {
  const state = bot._arbiter ||= {};
  const top = observeReflexes(bot, state.reflexes || [], { ...look, mobs: () => [] }).filter(r => !ALERTS.has(r.key))[0];
  if (!top || (REFLEX_RANK[top.key] ?? 99) >= (REFLEX_RANK[pending.by] ?? 99)) return pending;
  const why = `${top.action.replaceAll('_', ' ')} ${JSON.stringify(top.facts)}`;
  bot._preempt = { by: top.key, layer: top.layer, action: top.action, facts: top.facts, why, ...(pending.id !== undefined ? { id: pending.id } : {}), at: now, over: pending.over, waited: pending.by };
  const was = require('./turn').stopForTurn(bot, why);
  log(`[arbiter] preempted ${pending.over || 'nothing held'} again, ${pending.by} waiting: ${JSON.stringify(was)}`);
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
// The rung's budget, kept by the arbiter on the wall clock whoever holds
// the turn (tried.js watchRung, note 599). It had run from the work's own
// pass with every wait left out, so survival holding the turn (a sealed
// pocket, a pillar's top, a stance asked every fifteen seconds) was minutes
// that never counted, and nothing above the survival layer asked after the
// rung. Due, the rung's question is raised for the work (answerStall), and
// the loop's next pass asks it before the turn is given.
function rungWatch(bot, goal, now = Date.now()) {
  // Held for Jev, the rung's question could not be asked (note 707).
  if (require('./jev-down').isDown(bot)) return null;
  const stillness = require('./stillness');
  const due = require('./tried').watchRung(bot, goal, { now, waiting: stillness.waitEnds(bot, goal, now) });
  if (!due) return null;
  const holder = bot?._arbiter?.holder;
  const k = stillness.actionOf(goal, now).key;
  const says = holder && holder.layer !== 'work' ? `${due.says}; meanwhile the ${holder.layer} layer has had the turn (${String(holder.action || '').replaceAll('_', ' ')}) for ${Math.round((now - holder.since) / 60000)} minutes` : due.says;
  stillness.raiseFor(bot, goal, says, now, { rung: { ...due, says }, layer: 'work', key: /^survival:/.test(k) ? `step:rung:${due.rung}` : k });
  return due;
}
function unwatch(bot) {
  const state = bot?._arbiter;
  if (state?.watchTimer) { clearInterval(state.watchTimer); delete state.watchTimer; }
  if (state) delete state.holder;
  if (bot) delete bot._preempt;
}

module.exports = { blowOf, BLOWS_LEFT, STRUCK_MS, mobWouldSays, rungWatch, ABSENT_PASSES, ASK_MS, answerOrCut, claimSays, ALERTS, mode, arbitrate, rule, take, shadow, watch, watchOnce, unwatch, outranks, observeReflexes, rulesPick, fingerprintOf, foodBand, probe, REFLEXES, LAYERS, CREEPER_REACH, ARM, AIR, HYSTERESIS, RULING_MS, IDLE_MS, WATCH_MS, FOOD_BANDS };
