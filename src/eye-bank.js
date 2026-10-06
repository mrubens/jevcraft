'use strict';
// The eyes of ender carried on an errand before the End (note 1193): into a
// chest here first, or on with them in the pack. The chest is rod-stash.js's
// (goal.rodStashes; eye-need.js counts what it holds as held), and it is
// emptied again once going to the End is chosen (rod-bank.js collectHere).
//
// On 2026-10-04 both runs that had their eyes made lost them at Overworld
// deaths on such errands: 25594 at 06:02Z, twelve eyes in the pack on a
// search for food in the night, its portal found and the frames empty; and
// 25591 at 04:50Z, eleven taken out of its chest eight minutes before. The
// eyes were 144 minutes of 25594's play. Nothing asked about them: pearls_now
// is asked in the Nether's hunt alone.
const { decide } = require('./decisions');
const rs = () => require('./rod-stash');
const P = v => ({ x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) });
const at = p => `(${p.x}, ${p.y}, ${p.z})`;
const ASK_AGAIN_MS = 10 * 60000;
const LOST = 'On 2026-10-04 both runs that had their eyes made lost them at Overworld deaths on errands like this one, twelve and eleven, and neither got them back.';

// Where the eyes could go now. -> offer for rod-stash.js stashRods, or null
function offer(bot, goal) {
  if (!bot?.entity || rs().dimOf(bot) !== 'overworld' || goal?.kind !== 'win') return null;
  const eyes = rs().countOf(bot, 'ender_eye');
  if (!eyes) return null;
  const what = rs().KEPT.filter(n => rs().countOf(bot, n) > 0).map(n => ({ item: n, count: rs().countOf(bot, n) }));
  const near = rs().nearStash(bot, goal);
  if (near) return { existing: near.s, what, eyes, steps: Math.max(0, Math.round(near.d - 3)) };
  const site = rs().chestCell(bot), making = rs().chestMaking(bot);
  if (!site || !making) return null;
  return { site, making, what, eyes };
}

// Asked once for each count of eyes carried, and again after ten minutes.
// -> 'kept' | 'carry' | null (not asked)
async function eyesNow(bot, task, goal, save, actions, client, { errand = 'the errand', keepBack = 0, search = false } = {}) {
  if (!client) return null;
  const o = offer(bot, goal);
  if (!o || o.eyes <= keepBack) return null;
  const asked = goal.eyesNow, now = Date.now();
  // Chosen to be put away and not yet put (note 1369): carried out again, not
  // left for ten minutes. 25598 (2026-10-06 18:00:40Z) chose keep_here six
  // blocks from its chest with eleven eyes, a creeper broke off the putting,
  // the question rested, and at 18:10 it died to two skeletons 429 blocks off
  // with the eleven in its pack.
  const pending = asked && asked.pick === 'keep_here' && !asked.done && asked.count === o.eyes && now - asked.at < 30 * 60000;
  if (!pending && asked && asked.count === o.eyes && now - asked.at < ASK_AGAIN_MS) return null;
  if (!pending) { goal.eyesNow = { count: o.eyes, at: now }; save?.(); }
  const put = o.eyes - keepBack;
  const n = keepBack ? `${put} of the ${o.eyes} eyes of ender` : `${o.eyes} eye${o.eyes === 1 ? '' : 's'} of ender`;
  const all = `${o.eyes} eye${o.eyes === 1 ? '' : 's'} of ender`;
  const ring = goal.endPortal?.center ? Math.round(Math.hypot(bot.entity.position.x - goal.endPortal.center.x, bot.entity.position.z - goal.endPortal.center.z)) : null;
  const place = o.existing ? `the bot's chest at ${at(o.existing.position)}, ${o.steps} blocks off` : `a chest put down here at ${at(P(o.site.cell))}${rs().countOf(bot, 'chest') ? '' : ', made first from the wood carried'}`;
  const acts = { ...actions, place: actions?.place || require('./work').place, acquireStep: actions?.acquireStep || require('./work').acquireStep, navigate: actions?.navigate || require('./skills').navigate };
  const tree = {
    keep_here: { description: search
      ? `Put ${n} in ${place}, and go ${errand} with ${keepBack} in the pack: the search throws only the Eyes above the portal's twelve, one at a time, and picks each up again four times in five. A death on the way drops what is carried and leaves the chest as it is; the twelve are counted as held. Once the portal is found the bot comes back here for them and walks to it again: a stronghold is some 1300 to 2800 blocks from the world's middle. ${LOST}`
      : `Put the ${n} in ${place}, then go on ${errand} with nothing of the goal's in the pack. A death on the way drops everything carried and leaves the chest as it is; the eyes are counted as held, and taken out again when going to the End is chosen${ring !== null ? ` (the portal's ring is ${ring} blocks from here)` : ''}. ${LOST}` },
    carry_on: { description: `Go on ${errand} with the ${all} in the pack.${search ? ' Found, the portal is filled with no walk back.' : ''} A death drops them where it happens, and they last five minutes once the bot is near again. ${LOST} Asked again in ten minutes, or when the count carried changes.` },
  };
  let decision = pending ? { path: ['keep_here'] } : null;
  if (!pending) try { decision = await decide('eyes_now', { client, bot, task, goal, save, tree, state: { eyesOfEnderCarried: o.eyes, errand, health: bot.health, food: bot.food, ...(ring !== null ? { blocksToThePortalRing: ring } : {}), riskNow: require('./risk').riskNow(bot) } }); }
  catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[eyes_now] not asked: ${String(err.message || err).slice(0, 300)}`); return null; }
  if (decision.stale) return null;
  goal.eyesNow = { ...goal.eyesNow, pick: decision.path?.at(-1) }; save?.();
  if (decision.path?.at(-1) !== 'keep_here') return 'carry';
  const stored = await rs().stashRods(bot, task, goal, save, acts, o, { step: 'bank_eyes', rest: ['eye_bank', 'here'], ...(keepBack ? { keepBack: { ender_eye: keepBack } } : {}),
    chat: (list, where) => search ? `Put ${list} in a chest at ${where}. I'll come back for them when the portal is found.` : `Put ${list} in a chest at ${where}. They stay there until I go to the End.` });
  if (!stored) return 'carry';
  goal.eyeBank = { at: Date.now(), chestAt: o.existing ? o.existing.position : P(o.site.cell), ...(search ? { forSearch: true } : {}) };
  goal.eyesNow = { ...goal.eyesNow, done: true }; save?.();
  return 'kept';
}

// The take-out waits while an errand for the End's kit is in hand: it is for
// the errand that they were put away.
// Put away for the stronghold's search, they stay until the portal is found
// (the spare lost, the ladder makes another, or the walk goes on to where
// the bearings meet with none thrown).
// The eyes put away before the portal to the Nether, not asked (note 1264):
// nothing in the Nether takes an eye of ender, and a death there drops them
// a dimension from the bed. 25593 (2026-10-04 23:18 to 23:19Z), the first
// thirteen eyes of the day made, threw one for its first bearing, was one
// short of the thirteen with twelve in its pack, and went through its portal
// for a pearl with the twelve, into a warped forest's slot fight.
// -> 'kept', 'none' (no eye carried) or 'failed'.
async function bankBeforeNether(bot, task, goal, save, actions) {
  const o = offer(bot, goal);
  if (!o || !o.eyes) return 'none';
  const acts = { ...actions, place: actions?.place || require('./work').place, acquireStep: actions?.acquireStep || require('./work').acquireStep, navigate: actions?.navigate || require('./skills').navigate };
  let stored = false;
  try { stored = await rs().stashRods(bot, task, goal, save, acts, o, { step: 'bank_eyes', rest: ['eye_bank', 'here'],
    chat: (list, where) => `Put ${list} in a chest at ${where} before the Nether: nothing there takes an eye.` }); }
  catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; stored = false; }
  if (!stored) return 'failed';
  goal.eyeBank = { at: Date.now(), chestAt: o.existing ? o.existing.position : P(o.site.cell), forNether: true }; save?.();
  return 'kept';
}

function held(goal, bot = null) {
  if (!goal?.eyeBank) return false;
  if (goal.eyeBank.forSearch && !goal.gameProgress?.milestones?.stronghold_located) return true;
  const pick = goal.endKit?.choice?.pick;
  return !!(pick && pick !== 'enter_now');
}

// The eyes in the bot's Overworld chests, once it has put some away.
function banked(goal) {
  if (!goal?.eyeBank) return 0;
  return (rs().stashes(goal) || []).filter(c => c.dimension === 'overworld').reduce((n, c) => n + (c.contents?.ender_eye || 0), 0);
}

module.exports = { bankBeforeNether, eyesNow, offer, held, banked, LOST };
