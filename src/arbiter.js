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
  // One the alert was raised for stays in it out of sight while within its
  // line and alive (danger.js creeperMarked, note 752i): 25597 (19:49:09 to
  // 19:49:12Z) was preempted for a creeper 6.5 blocks off, it stepped out of
  // sight at 4.6, nothing backed from it, the work was asked about again,
  // and it came round to 1.7 and went off, 20 to none.
  const marked = t => { try { return require('./danger').creeperMarked(bot, t); } catch (_) { return false; } };
  const creepers = mobs.filter(t => t.entity?.name === 'creeper' && t.distance <= creeperLine && (t.visible || t.distance <= 4 || marked(t)));
  let apart = new Set();
  if (creepers.length) { try { apart = look.noWay?.(bot, mobs) || new Set(); } catch (_) { apart = new Set(); } }
  // Nor one that has stood off (danger.js standsOff, note 752b): parked past
  // a second's walk from its lighting distance for a minute and more, not
  // walking at the bot. It is the claim's, beside the work, with that said.
  const stood = t => { try { return !!require('./danger').standsOff(bot, t); } catch (_) { return false; } };
  const creeper = creepers.filter(t => !apart.has(t.entity.id) && !stood(t)).sort((a, b) => a.distance - b.distance)[0];
  // Marked only where it is seen or within four: a mark kept alive by its
  // own mark would hold a creeper round a corner for as long as it stayed
  // there (note 752j).
  if (creeper) { if (creeper.visible || creeper.distance <= 4) { try { require('./danger').markCreeper(bot, creeper); } catch (_) { /* unmarked */ } }
    add('creeper', { creeper: Math.round(creeper.distance * 10) / 10, seen: !!creeper.visible, lightsAt: LIGHTS_AT, blocksASecond: APPROACH, fuse: FUSE }); }
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
  // At a live spawner the bot still owes rods to, the ring at six blocks is
  // never still: 17 to 21 blazes of the one capped swarm drift in and out
  // of it on their own, each a fresh id though the swarm they come from was
  // already read on the last ruling. Counting them one by one broke
  // turn_priority every 9 to 15 seconds with nothing said changed but which
  // blaze of the many was nearest: 25598 (note 731) got neither hunt nor
  // work an eyeblink to do either for over an hour. What matters there is
  // already said on every option (spawner-clock.js capSays, the cage's own
  // cap), not which one of the swarm is momentarily closest, so a blaze's
  // id is left out of the newcomer set while the bot is at such a cage; a
  // mob at the bot's reach still breaks the ruling below, as it always did.
  let atCage = false;
  try { atCage = !!require('./cage-hold').cageFight(bot, ctx.goal); } catch (_) { atCage = false; }
  const near = mobs.filter(t => t.distance <= STANCE_NEWCOMER && (t.visible !== false || t.distance <= 4) && !(atCage && t.entity?.name === 'blaze'));
  const counts = {};
  for (const t of mobs) if (t.distance <= 16 && t.entity?.name) counts[t.entity.name] = (counts[t.entity.name] || 0) + 1;
  return { ids: near.map(t => t.entity?.id), newKinds: near.map(t => t.entity?.name), counts,
    health: bot?.health ?? 20, band: foodBand(bot?.food),
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

// A ruling is a commitment with its end stated (note 764, decisions/
// commit.js). Read over the flight records of 2026-09-30 13:20Z to 19:00Z,
// turn_priority asked again within 30 s gave the same answer as before at
// 100% of 349 re-asks for "a newcomer within six blocks" after survival's
// escape_threat, 98% of 175 for "its winner was stopped", 100% of 128 for
// "food crossed a band", 100% of 22 for "health fell", 81% of 194 and 95%
// of 106 for "the claims changed" (survival's own alert coming or going), and
// 93 to 99% of 938 re-asks for "a minute passed" whatever the winner. So:
//   - survival's answer to a threat (a fight ruling: its action
//     escape_threat or creeper_back_off, or an alert) holds until its claim
//     is over (the threat answered, its winner no longer claims), the other
//     layers' claims change, or its winner does nothing for IDLE_MS: a
//     newcomer, its own step stopped by a mob, health or food falling, and
//     survival's own alert coming or going are the fight it is answering;
//   - a minute passed ends a ruling only where the scene it was made on
//     (sceneOf: each claim's layer, alert and action, the kinds of mob about,
//     the food band) has changed; else it is renewed, up to RULING_MAX_MS;
//   - a pass with a reflex, or with the winner's claim alone, keeps the
//     ruling (rule() below) where it had been dropped and asked as new.
const FIGHT_ACTIONS = new Set(['escape_threat', 'creeper_back_off']);
const RULING_MAX_MS = 5 * 60000;
const fightRuling = (ruling, winner) => ruling?.winner === 'survival' && !!winner && (FIGHT_ACTIONS.has(winner.action) || !!winner.alert);
// The fingerprint without survival's own alert.
const bareOf = print => [...new Set(String(print).split('|').map(k => k.startsWith('survival') ? 'survival' : k))].sort().join('|');
// Why a held ruling no longer holds, or null while it does.
function broken(ruling, claims, seen, now, print = fingerprintOf(claims), scene = null) {
  if (!ruling) return 'no ruling';
  const winner = claims.find(c => c.layer === ruling.winner);
  if (!winner) return 'its winner no longer claims';
  // A winner that asked not to be cut short keeps the turn for its hold,
  // whatever else comes; only a reflex takes it.
  if (winner.preemptible === false && now - ruling.at < (winner.minHoldMs || 0)) return null;
  const fight = fightRuling(ruling, winner);
  if (ruling.stoppedBy && !fight) return `its winner was stopped: ${ruling.stoppedBy}`;
  // Stopped by the mob it is answering: the fight goes on (note 764).
  if (ruling.stoppedBy && fight) delete ruling.stoppedBy;
  if (now >= ruling.until) {
    // Renewed while nothing it was made on has changed (note 764).
    const since = ruling.since ?? ruling.at;
    // And while its winner's claim is an answer Jev gave that still holds
    // (a claim with `holds`: the food plan, note 784), whatever else of the
    // scene moved: the claim says so, and it ends by its own stated end.
    if (scene && (ruling.scene === scene || winner.holds) && !ruling.idleSince && now - since < RULING_MAX_MS) { ruling.until = now + RULING_MS; ruling.renewed = (ruling.renewed || 0) + 1; }
    else return 'a minute passed';
  }
  // Its winner stopped by a mob since the ruling: the ruling was made
  // before it, and giving it the turn back only stops it again. mid-218-n's
  // work was stopped by a drowned eleven times in four seconds, handed back
  // each time on the ruling held, at seven health (note 490).
  if (!fight && stoppedAt(winner) > ruling.at && STOPPED_BY_THREAT.test(winner.facts?.lastError || '')) return `its winner was stopped: ${winner.facts.lastError}`;
  if (ruling.idleSince && now - ruling.idleSince >= IDLE_MS) return `its winner did nothing for ${IDLE_MS / 1000} seconds`;
  if (print !== ruling.fingerprint && !(fight && bareOf(print) === bareOf(ruling.fingerprint))) return 'the claims changed';
  // A fight ruling holds through the fight it answers (note 764).
  if (fight) return null;
  // One come within six of a kind already about, their count within
  // sixteen no higher than the ruling saw, is one of those it was made
  // with moving about, not news: 25595's magma cubes, hopping in and out of
  // six blocks, re-asked turn_priority every one to five seconds for "a
  // newcomer within six blocks" (16:43:50 to 16:53Z, note 752e), as a
  // spawner's swarm did before note 731 and a stance's kin before note 743.
  // More of that kind than before is news, as is a new kind; a mob at its
  // reach breaks the ruling below whatever its kind.
  const more = kind => !ruling.counts || !kind || (seen.counts?.[kind] || 0) > (ruling.counts[kind] || 0);
  if (seen.ids.some((id, i) => !ruling.ids.includes(id) && more(seen.newKinds?.[i]))) return 'a newcomer within six blocks';
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
  // The urgency stays the arbiter's (its order of claims), not a word Jev
  // reads (note 838): "pressing" was the survival claim's at any threat,
  // whatever its price, beside riskNow's "low": 666 of 852 turn_priority
  // askings from 18:53Z were at health 18 or more, 61% given to survival,
  // 77% with one mob not a creeper (25584 at 20:11:43Z: full iron, one
  // zombie 7.9 blocks off, the fight priced 3.5; survival 0.51 to 0.45).
  return { description: { does: claimSays(c), action: c.action, facts, ...(c.cost ? { cost: c.cost } : {}) }, urgency: c.urgency, run: c.run };
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
// Work chosen over survival's answer to the mobs about leaves them be this
// long, as keep_working does (note 840).
const KEEP_ON_MS = 15000;
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
  return `${s.count === 1 ? 'Its last turn was' : `Its last ${s.count} turns, in the last ${span} second${span === 1 ? '' : 's'}, were each`} stopped at once by the threat check its run is given: ${s.why}. ${found ? `That check still finds one now: ${found}; ${layer === 'work' ? `given the turn over survival's answer to it, the work leaves the mobs about be for ${KEEP_ON_MS / 1000} seconds as keep_working does, unless one comes within three blocks, a creeper within its walk to its fuse, or a hit lands.` : 'given the turn again, it is stopped again at once.'}` : 'That check finds nothing now.'}`;
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
  // One that has stood off (danger.js standsOff, note 752) is said with it:
  // the work is given the turn beside it, and why it is no threat now.
  const stood = t => { try { return require('./danger').standsOff(bot, t) ? `; ${require('./danger').reachSays(bot, t)}` : ''; } catch (_) { return ''; } };
  const line = t => stood(t) ? lineOf(t) + stood(t) : lineOf(t);
  const lineOf = t => {
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
  // At low health, the work's option says the fall, the hits and what the
  // work given the turn at this health came to, beside the meal and the
  // pocket with their times (low-health.js, note 752c): 25588 gave the work
  // "craft (stick)" 0.51 over "Eat cooked beef now" 0.46 at 2.3 health.
  if (c.layer === 'work') { let low = ''; try { low = require('./low-health').says(bot, { mobs, health: false }).trim(); } catch (_) { low = ''; } if (low) add.push(`At low health: ${low}`); }
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

// The questions a claim's words say are asked next (claimSays), by its
// action. An option that says a question is asked next must cause it
// (note 752): 25594's pocket_next was promised every minute for eight
// minutes and never asked. Each one given the turn is watched (take,
// promised); one not asked within PROMISE_MS is said so on the claim the
// next time it is offered, in place of the promise (notAsked), until that
// question is asked. test/note-752.test.js checks every claimSays text
// that says "asked next" has its questions here.
const ASKS = {
  escape_threat: ['encounter_stance', 'ranged_response'],
  creeper_back_off: ['encounter_stance'],
  pocket_next: ['pocket_next'],
  secure_shelter: ['survival_priority', 'shelter_method'],
  obtain_food: ['survival_priority', 'resource_source', 'kit_food', 'restock_food', 'leave_nether', 'sheep_search', 'opportunistic_animal'],
  hunt: ['hunt_target', 'empty_spawner'],
};
const PROMISE_MS = 30000;
// The promise a claim makes: its questions, or null for none.
const promiseOf = c => (/asked next/.test(claimSays(c)) ? ASKS[c.action] || [] : null);
// Said in place of the promise once it was not kept.
function notAsked(f) {
  const n = f?.askedNextNotAsked;
  if (!n) return null;
  return `this said ${n.secondsAgo} seconds ago that ${n.asks.map(q => q.replaceAll('_', ' ')).join(' or ')} is asked next, and it has not been asked since${n.did ? `: the survival step went on with ${String(n.did).replaceAll('_', ' ')} instead` : ''}; given the turn, it goes on so`;
}
const UNDERGROUND = ' Underground here: daylight does not come down to it, and mobs spawn in the dark by day as by night.';
// Each pass the turn is given: the promise of the claim given it is kept
// from the first time it was given (the same layer and action), ended when
// one of its questions is asked, and marked not kept once PROMISE_MS has
// gone by without one.
function promised(bot, state, w, now = Date.now(), log = console.log) {
  const asks = w ? promiseOf(w) : null;
  const p = state.promise;
  if (p && !(w && p.layer === w.layer && p.action === w.action)) delete state.promise;
  if (asks?.length && !state.promise) state.promise = { layer: w.layer, action: w.action, asks, at: now };
  const q = state.promise;
  if (!q) return null;
  const askedAt = Math.max(0, ...q.asks.map(id => bot?._askedAt?.[id] || 0));
  if (askedAt >= q.at) { delete state.promise; if (state.unkept) delete state.unkept[q.action]; return null; }
  if (now - q.at < PROMISE_MS || state.unkept?.[q.action]?.since === q.at) return null;
  const did = bot?._survivalGoal?.survivalAction?.action || null;
  (state.unkept ||= {})[q.action] = { asks: q.asks, since: q.at, did };
  log(`[arbiter] ${q.layer} ${q.action} said ${q.asks.join(' or ')} is asked next ${Math.round((now - q.at) / 1000)} seconds ago; not asked${did ? ` (the step did ${did})` : ''}`);
  return state.unkept[q.action];
}
// A claim offered with its promise not kept: the fact on it, in place of
// the promise. Cleared once one of its questions has been asked since.
function withUnkept(bot, state, c, now = Date.now()) {
  const u = state.unkept?.[c.action];
  if (!u) return c;
  if (u.asks.some(id => (bot?._askedAt?.[id] || 0) >= u.since)) { delete state.unkept[c.action]; return c; }
  return { ...c, facts: { ...(c.facts || {}), askedNextNotAsked: { asks: u.asks, secondsAgo: Math.round((now - u.since) / 1000), did: u.did } } };
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
    // Whether it can reach the bot, said of it (danger.js reachSays, note
    // 752): 25595's hoglin was answered every minute for twelve with
    // nothing said of the no route and no hit.
    case 'escape_threat': return `Answer ${f.threat ? mob(f.threat) : f.atArm ? `${f.atArm.map(mob).join(', ')}, at arm's length` : f.mob ? mob({ name: f.mob, distance: f.distance }) : 'the mob about'}${fire(f.threat)}: ${f.stance ? `the ${String(f.stance.choice).replaceAll('_', ' ')} chosen ${f.stance.other ? '' : 'against it '}${f.stance.secondsAgo} second${f.stance.secondsAgo === 1 ? '' : 's'} ago${f.stance.other ? ' (against the mobs about then)' : ''} goes on (asked again when it fails, when a mob it was not chosen against comes within six blocks, or once it has cost more than it was said to)${f.stance.noHitSeconds !== undefined ? `; nothing has hurt the bot in the ${f.stance.noHitSeconds} seconds since it was chosen` : ''}` : notAsked(f) || 'the stance is asked next (fight, back off, pillar, a pocket, dig down, eat, and the rest)'}.${f.threat?.canReach ? ` Whether it can reach the bot: ${f.threat.canReach}.` : ''}${f.edge ? ` ${f.edge}` : ''}${f.push ? ` ${f.push}` : ''}${f.pocket ? ` ${f.pocket}` : ''}${f.onPillar ? ` ${f.onPillar}` : ''} The work waits.${hp}${heals}`;
    case 'creeper_back_off': return `Answer the creeper ${f.creeper} blocks off${f.seen === false ? ' (out of sight)' : ''}: it lights about ${f.lightsAt} blocks off and goes off ${f.fuse} seconds after, walking about ${f.blocksASecond} blocks a second; ${f.stance ? `the ${String(f.stance.choice).replaceAll('_', ' ')} chosen ${f.stance.secondsAgo} second${f.stance.secondsAgo === 1 ? '' : 's'} ago goes on` : notAsked(f) || 'the stance is asked next'}. The work waits.`;
    case 'surface': return `Swim up for air: the head is under water, air ${f.air} of 20; at none, drowning takes 2 health a second.${hp}`;
    // Said with the biters walking up while it eats, standing still (note 552).
    // Said with what eating does to healing: "It does not come back at
    // hunger 17" was said of the meal that takes hunger to 20 (25588,
    // 14:09:28Z, note 752c).
    case 'eat': return `Eat ${f.item ? (f.item === 'chicken' ? 'raw chicken' : String(f.item).replaceAll('_', ' ')) : 'food'} now, about ${c.cost?.seconds || 1.6} seconds standing still.${hp} Hunger ${f.food}${f.foodPoints ? ` to ${Math.min(20, f.food + f.foodPoints)}` : ''}.${f.healing === false && f.foodPoints && f.food + f.foodPoints >= 18 ? ` It does not come back at hunger ${f.food}; eaten, it comes back from then, at hunger eighteen or more.` : heals}${f.effect ? ` It is the last resort: ${f.effect}.` : ''}${(f.comingAtTheBot || []).map(m => ` ${mob(m)[0].toUpperCase()}${mob(m).slice(1)} is coming at about ${m.blocksASecond} blocks a second, at the bot in about ${m.atBotInSeconds} seconds${m.atBotInSeconds <= (c.cost?.seconds || 1.6) ? ', before the meal is done' : ''}${m.hitsFor ? `; each hit about ${m.hitsFor} through the armour worn${f.health !== undefined && m.hitsFor >= f.health ? ' (as much as the health left)' : ''}` : ''}${m.note ? ` (${m.note})` : ''}.`).join('')}`;
    case 'leave_lava': return 'Get out of the lava.';
    case 'out_of_fire': return 'Put out the fire on the bot.';
    case 'dig_out_of_block': return 'Dig the head out of the block it is in.';
    case 'swim_up': return `Swim up: air ${f.air} of 20.`;
    // With its minutes so far and what it was sealed against (note 584).
    // A pocket answer held is carried out without asking (survival.js
    // pocketHeldOf): said so, not "asked next" (25594, note 752).
    case 'pocket_next': return `In a sealed pocket${f.inPocketMinutes !== undefined ? `, ${f.inPocketMinutes} minutes so far` : ''}${f.sealedAgainst ? `, sealed against ${f.sealedAgainst}` : ''}: ${f.pocketWaysRest ? `every way it had there rests (${f.pocketWaysRest.says}), the first back in about ${f.pocketWaysRest.forSeconds} seconds; given the turn meanwhile, it waits sealed and nothing there is asked, while the work, given it, goes on from here (its walk digs through the pocket's own blocks first)` : f.pocketHeld ? `${String(f.pocketHeld.choice).replaceAll('_', ' ')} goes on, as chosen (${f.pocketHeld.why})${f.pocketHeld.secondsAgo !== undefined ? ` ${f.pocketHeld.secondsAgo} seconds ago` : ''}${f.pocketHeld.noHitSeconds !== undefined ? `, nothing having hurt the bot in the ${f.pocketHeld.noHitSeconds} seconds in it` : ''}, about ${f.pocketHeld.forSeconds} seconds more before whether to stay, leave or do something else there is asked again` : notAsked(f) || 'whether to stay, leave or do something else there is asked next'}.${f.waitingFor ? ` The wait there waits for ${f.waitingFor}${f.staysForNothing ? `; stay chosen ${f.staysForNothing} time${f.staysForNothing === 1 ? '' : 's'} in it, nothing changed in any` : ''}.` : ''}${f.underground ? UNDERGROUND : ''}${hp}${heals}`;
    // Under the rock the night is no reason (note 755): 25594 read "Shelter
    // for the night" at y 7 in a geode while pocket_next said nightfall
    // changes nothing there. Said by what it is, the reason first (the
    // threat, the surface's night, health), or that none holds.
    case 'secure_shelter': return `${f.underground ? 'A sealed pocket under the rock' : 'Shelter for the night'}${f.sealFor ? ` (${f.sealFor})` : ''}: ${f.nightMine ? `the night mine from the pocket, chosen ${f.nightMine.minutes} minute${f.nightMine.minutes === 1 ? '' : 's'} ago (${f.nightMine.mined} mined), goes on under the rock; a shelter is asked for once it ends` : f.wayChosen ? `the way chosen ${f.wayChosen.secondsAgo} seconds ago (${String(f.wayChosen.method).replaceAll('_', ' ')}) goes on; should it fail, it rests and the way is asked again` : notAsked(f) || 'the way (a room, a pocket here, a shaft, the bed) is asked next'}.${f.underground ? ` Underground here the night up top changes nothing: mobs spawn in the dark by day as by night${f.sleepDebt ? '; it is claimed for the sleep owed (no bed slept in for two game days and more), not for a mob named, and a pocket does not pay that: only a bed does' : ''}.` : ''}${hp}${heals}`;
    // Said with the last resort carried and, when health does not come back,
    // the sealed wait for daylight among the ways asked next (note 515).
    // Said with the hunger against what health needs, what the food carried
    // covers, what it is for, the errand's cost and whether the work is the
    // food already (note 761).
    // The food plan Jev chose, held, said as going on (note 784).
    case 'obtain_food': return `Find food${f.foodFor ? ` for ${f.foodFor}` : ''}: ${notAsked(f) || (f.foodChoiceHeld ? `${f.foodChoiceHeld}; given the turn, it goes on unasked, and given the work, it ends` : 'where is asked next')}${f.waitSealedMinutes !== undefined ? `, beside waiting sealed in a pocket for ${f.waitSealedDayNow ? `the next daylight (it is day now: the wait runs through dusk and the whole night), about ${f.waitSealedMinutes} real minutes` : `daylight, about ${f.waitSealedMinutes} real minutes`}, standing still and spending no hunger` : ''}.${f.hungerSays ? ` ${f.hungerSays}` : ` Hunger ${f.food}.`}${f.foodCarried !== undefined ? ` ${f.foodCarried} food points carried` : ''}${f.foodWanted !== undefined ? ` of ${f.foodWanted} wanted` : ''}${f.lastResortCarried ? `, and ${f.lastResortCarried} more in the last resort (rotten flesh or raw chicken, which may bring on Hunger)` : ''}${f.foodCarried !== undefined ? '.' : ''}${f.errandSoFar ? ` ${f.errandSoFar[0].toUpperCase()}${f.errandSoFar.slice(1)}.` : ''}${f.workIsFood ? ` ${f.workIsFood[0].toUpperCase()}${f.workIsFood.slice(1)}: given the turn, this takes it from that step to a search of its own.` : ''}${f.where ? ` ${f.where}` : ''}${f.reserveRecord ? ` ${f.reserveRecord}` : ''}${f.portalTrip ? ` ${f.portalTrip}` : ''}${hp}${f.hungerSays ? '' : heals}${f.cannotHeal ? ` The ${f.cannotHeal}.` : ''}${f.hungerDrain ? ` ${f.hungerDrain}` : ''}${f.lastFoodChoice ? ` The last answer to food or the work: ${f.lastFoodChoice}.` : ''}`;
    case 'night_mine': return `Go on with the night mine chosen from the pocket ${f.nightMine?.minutes ?? 0} minute${f.nightMine?.minutes === 1 ? '' : 's'} ago (${f.nightMine?.mined ?? 0} mined), under the rock, until dawn about ${f.minutesToDawn} real minutes off or until it ends; given to the work, the work's own steps (a climb to the surface among them) run instead.${hp}`;
    case 'wait_for_day_sealed': return `Go on sealing a pocket and waiting in it for daylight, as chosen: about ${f.minutesToDawn} real minutes to dawn, standing still and spending no hunger.${f.underground ? UNDERGROUND : ''}${hp}${heals}`;
    // The hunt's claim was said as "hunt: hunt." to mid-235-p-fortress-1,
    // at 5.5 health beside the work (note 509): what it goes for, and why.
    // Out of sight and walled in, the fight begins only through the walls
    // (note 708): said, not left as "close on it".
    case 'hunt': return (f.ownPursuit ? `The work in hand is this pursuit: its ${String(f.ownPursuit).replaceAll('_', ' ')} walks up to the ${String(f.entity).replaceAll('_', ' ')} and watches, and strikes only through this hunt. ` : '') + `Hunt ${f.entity ? mob({ name: f.entity, distance: f.distance, seen: f.outOfSight ? false : undefined }) : 'the mob in view'}${f.item ? ` for ${plural(f.item)} (${f.have ?? 0} of ${f.want} carried)` : ''}: ${f.walledIn ? `the bot is walled in (${f.walledIn}), so it closes on it only by digging out first` : f.cage ? 'which one, in the open or from a box or slit built at the cage' : 'close on it and fight it'}; ${notAsked(f) || 'which one, and the fight\'s cost, is asked next'}. The work waits.${hp}`;
    case 'night_hunt': return `Go on with ${f.forFood ? 'the hunt for food' : 'tonight\'s hunt'}${f.hunting ? ` of ${plural(f.hunting)}` : ''}, as chosen${f.forFood ? '' : ' for the night'}: close on those met and fight them.${hp}${heals}${f.hoglinFight ? ` ${f.hoglinFight}` : ''}`;
    case 'recover_items': return `Go back for the items dropped at the death${f.dropsAt ? ` at ${Math.round(f.dropsAt.x)}, ${Math.round(f.dropsAt.y)}, ${Math.round(f.dropsAt.z)}` : ''}: the way there is walked; items left lying in a loaded area vanish five minutes after they drop.${hp}`;
    case 'go_home_for_night': return `Go home for the night, as planned: the walk to the bed and sleep.${hp}`;
    case 'out_of_powder_snow': return `Get out of the powder snow: freezing takes health while the bot stands in it.${hp}`;
    default:
      if (c.layer === 'work' && /^(stalk_mob|dig_toward_them|dig_down_to_them|open_a_door|break_their_line)$/.test(String(c.action))) return `Go on with the work: ${f.doing || String(c.action).replaceAll('_', ' ')}${f.request ? ` (toward "${f.request}")` : ''}: it walks up to the mob it is after and watches it, digs toward it or opens a way to it; it strikes nothing itself, the hunt does.${f.lastError ? ` Its last try ended: ${f.lastError}.` : ''}`;
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
    const tree = Object.fromEntries(live.map(c => withUnkept(bot, state, c, now)).map(c => [c.layer, withSays(optionOf(c, held, now), c, bot, state, mobsNow, now)]));
    // The biters in sight within sixteen, counted, with how soon the nearest
    // is at the bot at its speed and what their blows come to together (note
    // 1025), said on survival's answer and on the work chosen over it. The
    // answer named the nearest alone and no time: 25590 (2026-10-03
    // 08:57:14Z), three wither skeletons 7.8, 9.9 and 10.7 blocks off, was
    // told "Answer the wither skeleton 7.8 blocks off", gave the work the
    // turn at 0.51 against 0.45, and seven seconds on the three were at it:
    // 20 health to none in three seconds.
    const pack = packSays(bot);
    if (pack && typeof tree.survival?.description?.does === 'string' && live.some(c => c.layer === 'survival' && c.action === 'escape_threat')) tree.survival.description.does += pack;
    // What choosing the work over survival's answer does (note 840), said on it.
    if (tree.work && typeof tree.work.description?.does === 'string' && live.some(c => c.layer === 'survival' && c.action === 'escape_threat') && mobsNow.length)
      tree.work.description.does += ` Chosen over survival's answer to the mobs about, they are left be for ${KEEP_ON_MS / 1000} seconds as the encounter's keep_working leaves them: the work's own threat check passes them over unless one comes within three blocks, a creeper within its walk to its fuse, or a hit lands.${pack || ''}`;
    let setAside = false;
    const askedAt = Date.now();
    // The alerts this question is out about (watchOnce leaves them be).
    state.askingAlerts = new Set(live.map(c => c.alert).filter(Boolean));
    const asking = decide('turn_priority', { client: ctx.client, bot, task: ctx.task, goal: ctx.goal, save: ctx.save, tree,
      interrupt: () => { if (setAside) throw new Error('turn_priority set aside'); },
      state: { health: bot?.health, food: bot?.food, claims: live.map(c => c.layer), why,
        mobs: mobsSaid(mobsNow),
        ...(held ? { hasTheTurn: { layer: held.layer, action: held.action, seconds: Math.round((now - held.since) / 1000) } } : {}) } });
    // A creeper within its alert while the question is out: the bot backs
    // from it meanwhile, as the stance question does (survival.js
    // backFromCreeper). 25585 (14:56:35Z) stood still through three
    // preemptions and this question with a creeper 3.5 blocks off, and its
    // blast took 20 to 6.3 at 14:56:36.8, before any stance was asked
    // (note 752d).
    let answered = false;
    const sv = bot?._shotSurvival;
    const backing = live.some(c => c.alert === 'creeper') && sv?.backFromCreeper && ctx.task ? (async () => {
      while (!answered) { try { if (!await sv.backFromCreeper(ctx.task, () => answered)) await new Promise(r => setTimeout(r, 100)); } catch (_) { return; } }
    })() : null;
    let out;
    try { out = await answerOrCut(bot, asking, { task: ctx.task, askedAt, ms: ctx.askMs ?? ASK_MS }); }
    catch (err) { setAside = true; throw err; }
    finally { answered = true; delete state.askingAlerts; if (backing) await backing; }
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
    state.ruling = { winner: winner.layer, action: winner.action, fingerprint: fingerprintOf(live), scene: result.pending.scene, at: now, until: now + RULING_MS, ...seen };
    // A claim that keeps Jev's answer to it (the food plan, note 784): told
    // which layer was given the turn over it.
    for (const c of live) if (typeof c.answered === 'function') { try { c.answered(winner.layer); } catch (err) { console.log(`[arbiter] ${c.layer} answered: ${err?.message || err}`); } }
    // Jev's answer to this scene, given again to it for a while (sameScene).
    if (decision?.path && !decision.standIn && result.pending.scene) answeredScene(state, result.pending.scene, winner.layer, seen.health, now);
    // Work chosen over survival's answer to the mobs about: they are left be
    // as the encounter's keep_working leaves them (danger.js threatScan's
    // leftBe: unless one comes within three, a creeper within its walk to its
    // fuse, or a hit lands), for KEEP_ON_MS (note 840). Given the turn, the
    // work's run was stopped at once by its own threat check, and survival
    // was Jev's only real answer: 25595 (21:50:26Z) at 20 health, one
    // skeleton 15.9 blocks off, told "given the turn again, it is stopped
    // again at once"; 71% of one-mob askings at 18 health or more went to
    // survival after note 838, 79% before.
    const threatClaim = live.find(c => c.layer === 'survival' && c.action === 'escape_threat');
    if (winner.layer === 'work' && threatClaim && bot) {
      const ids = mobsNow.map(m => m.id ?? m.entity?.id).filter(id => id != null);
      if (ids.length) bot._wavedOff = { ids, until: now + KEEP_ON_MS, byTurn: true };
    }
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
  // A reflex's pass keeps the ruling (note 764): the body's physics taken
  // by rule is a pause in it, not its end; what it was made on is read again
  // at the next pass that rules (broken). Dropped here, it was asked as new
  // at the next: 420 of turn_priority's re-asks within 30 s from 13:20Z to
  // 19:00Z on 2026-09-30 said "no ruling".
  if (reflexes.length) return { winner: reflexes[0], by: 'body', ask: false };
  // The ruling's claims absent one pass still count for it (ABSENT_PASSES).
  // Its winner absent one pass: nobody has the turn this pass, a breath,
  // and the ruling stands; its claim's run is not taken from a pass it was
  // not in.
  const ruling = state.ruling, ruled = ruling ? new Set(ruling.fingerprint.split('|')) : new Set();
  const kept = [...gone.values()].filter(key => ruled.has(key));
  if (ruling && gone.has(ruling.winner) && !ruling.stoppedBy && now < ruling.until) return { winner: null, by: 'absent', ask: false, why: `its winner, ${ruling.winner}, missed one look`, ruling };
  if (!live.length) { delete state.ruling; return { winner: null, by: 'none', ask: false }; }
  // The winner's claim alone keeps its ruling (note 764): the others come
  // back to a ruling that still holds. Another's claim alone ends it.
  const alone = () => { if (!(ruling && live[0].layer === ruling.winner)) delete state.ruling; return { winner: live[0], by: 'single', ask: false }; };
  if (live.length === 1 && !kept.length) return alone();
  const seen = observe(bot, ctx);
  const scene = sceneOf(bot, live, seen, ctx);
  const why = broken(ruling, live, seen, now, [...live.map(keyOf), ...kept].sort().join('|'), scene);
  if (!why) return { winner: live.find(c => c.layer === ruling.winner), by: 'held', ask: false, ruling };
  if (live.length === 1) { delete state.ruling; return { winner: live[0], by: 'single', ask: false }; }
  const same = sameScene(state, scene, why, seen, now);
  if (same) {
    const winner = live.find(c => c.layer === same.winner);
    state.ruling = { winner: winner.layer, action: winner.action, fingerprint: fingerprintOf(live), scene, at: now, until: same.at + RULING_MS, ...seen };
    return { winner, by: 'scene', ask: false, why: `${why}; this same scene was answered ${Math.round((now - same.at) / 1000)} seconds ago`, ruling: state.ruling };
  }
  if (!ctx.dry) return { winner: null, ask: true, why, pending: { live, seen, now, why, scene } };
  const winner = rulesPick(live);
  state.ruling = { winner: winner.layer, action: winner.action, fingerprint: fingerprintOf(live), scene, at: now, until: now + RULING_MS, ...seen };
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
// Whether a fight stands (note 781): a mob at its reach of the bot, a
// survival claim pressing about a threat, or a stance Jev chose that is not
// a run or leaving the mobs be still held. -> what it is, said, or null.
const NOT_FIGHTS = new Set(['keep_working', 'retreat', 'leave_reach', 'flee']);
function fightStands(bot, live = [], seen = null) {
  if (seen?.reach) return 'a mob is at its reach of the bot';
  const sv = live.find(c => c.layer === 'survival');
  if (sv && sv.urgency !== 'routine' && /^escape_threat$|^creeper_back_off$/.test(sv.action)) return `survival claims ${String(sv.action).replaceAll('_', ' ')}`;
  try { const s = require('./danger').stanceHeld(bot); if (s?.choice && !NOT_FIGHTS.has(s.choice)) return `the stance ${s.choice} is held`; } catch (_) { /* no world */ }
  return null;
}
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
  // Jev down (note 781): the work is not given the turn while a fight
  // stands. A ruling held from before the outage, or the work's claim alone
  // when survival's could not be read, gave 25595 (mid-237-bj, 05:15 to
  // 05:16:53Z on 2026-10-01) the work's turn between its swings at a single
  // zombie, and the stance question that would have answered it could not
  // be asked. The survival step goes on instead: a stance Jev chose holds,
  // or its question is held with note 778b's floor under it.
  const fight = w.layer === 'work' && require('./jev-down').isDown(bot) ? fightStands(bot, live, seenNow) : null;
  if (fight) {
    const sv = live.find(c => c.layer === 'survival');
    const run = sv?.run || ctx.backstop;
    holding('survival', sv?.action || 'step', { urgency: sv?.urgency || 'pressing' });
    if (bot?._jevDown && bot._jevDown.fightSaid !== fight) { bot._jevDown.fightSaid = fight; console.log(`[jev down] ${fight}: the work is not given the turn while Jev is down; the survival step goes on`); }
    let acted = false;
    try { acted = !!(run ? await run(ctx.task) : false); }
    catch (err) { if (err?.name === 'NeedsSafety') stopped(state, 'survival', err.message, ctx.now ?? Date.now()); throw err; }
    return { ...r, winner: sv || null, layer: 'survival', by: 'jev_down_fight', fight, acted, unclaimed };
  }
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
  try { promised(bot, state, w, ctx.now ?? Date.now()); } catch (err) { failedOnce(err); }
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
  // An alert the turn's own question is out about is not a preemption: the
  // question is its answer, and the bot backs from a creeper meanwhile
  // (arbitrate). 25597 (17:35:52 to 17:35:58Z) had turn_priority cut nine
  // times in five seconds by the same creeper's alert, the work it preempted
  // still the holder while the question was out, never answered, the bot
  // backing 2.4 blocks in all; the blast took 20 to 6.4 (note 752f).
  const askedAbout = top && ALERTS.has(top.key) && state.askingAlerts?.has(top.key);
  if (!askedAbout && outranks(bot, top, holder, now)) p = { by: top.key, layer: top.layer, action: top.action, facts: top.facts, why: `${top.action.replaceAll('_', ' ')} ${JSON.stringify(top.facts)}` };
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
    // Nor a blaze at the cage's held box or slit, but one inside it or a
    // hit through it (cage-hold.js shelterKeepsOff, note 774).
    const sheltered = t => { try { return require('./cage-hold').shelterKeepsOff(bot, t, now); } catch (_) { return false; } };
    // Nor a calm enderman (not provoked: it attacks only once looked at or
    // hit), nor beyond three blocks one of the kind the hunt is out for:
    // in a warped forest the next enderman wandering within six ended every
    // enderman fight the hunt began (25597, 2026-10-01 12:17:24Z "a enderman
    // came within 5 blocks"; note 802).
    const D = require('./danger');
    const calm = t => t.entity.name === 'enderman' && !D.provokedEnderman(bot, t.entity);
    const huntKin = t => t.distance > 3 && D.claimed(bot, t.entity);
    const fresh = mobs.find(t => t.entity && t.distance <= STANCE_NEWCOMER && (t.visible || (t.distance <= 4 && !shooter(t.entity))) && !holder.ids.includes(t.entity.id) &&
      !(commit && commit.kinds.includes(t.entity.name) && t.distance > 3) && !sheltered(t) && !calm(t) && !huntKin(t));
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

// The biters in sight within sixteen blocks, for the turn's question (note
// 1025): how many, how soon the nearest is at the bot at its own speed, each
// one's blow through the armour worn and what they come to together against
// the health the bot has. '' with none.
function packSays(bot) {
  try {
    const ce = require('./combat-estimate'), danger = require('./danger');
    const near = danger.threats(bot, 16).filter(t => t.visible && !ce.MOBS[t.entity.name]?.shoots && ce.MOBS[t.entity.name]?.hit && t.entity.name !== 'creeper').sort((a, b) => a.distance - b.distance);
    if (!near.length) return '';
    const round = n => Math.round(n * 10) / 10, words = n => String(n).replaceAll('_', ' ');
    const worn = ce.armourOf([5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean));
    const blow = t => round(ce.afterArmour(ce.MOBS[t.entity.name].hit, worn));
    const first = near[0], speed = ce.blocksPerSecond(first.entity.name), eta = round(Math.max(0, first.distance - 1.5) / speed);
    const kinds = [...new Set(near.map(t => t.entity.name))];
    const who = near.length === 1 ? `a ${words(first.entity.name)} ${round(first.distance)} blocks off` : `${near.length} ${kinds.length === 1 ? `${words(kinds[0])}s` : 'biters'} (${near.slice(0, 4).map(t => `${kinds.length === 1 ? '' : `${words(t.entity.name)} `}${round(t.distance)}`).join(', ')} blocks off)`;
    const all = round(near.reduce((n, t) => n + blow(t), 0)), hp = round(bot.health ?? 20);
    const together = near.length > 1 ? `; all ${near.length} at the bot land about ${all} a second together, and the bot has ${hp}${all >= hp ? ': one second of it' : all * 2 >= hp ? ': two seconds of it' : ''}` : '';
    return ` In sight and able to walk at the bot: ${who}. At its speed (about ${round(speed)} blocks a second) the nearest is at the bot in about ${eta} seconds if it comes; each blow about ${blow(first)} through the armour worn${together}.`;
  } catch (_) { return ''; }
}

module.exports = { packSays, fightStands, ASKS, PROMISE_MS, promiseOf, promised, withUnkept, notAsked, blowOf, BLOWS_LEFT, STRUCK_MS, mobWouldSays, rungWatch, ABSENT_PASSES, ASK_MS, answerOrCut, claimSays, ALERTS, mode, arbitrate, rule, take, shadow, watch, watchOnce, unwatch, outranks, observeReflexes, rulesPick, fingerprintOf, foodBand, probe, REFLEXES, LAYERS, CREEPER_REACH, ARM, AIR, HYSTERESIS, RULING_MS, RULING_MAX_MS, FIGHT_ACTIONS, IDLE_MS, WATCH_MS, FOOD_BANDS, broken };
