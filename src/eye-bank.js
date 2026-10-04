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
async function eyesNow(bot, task, goal, save, actions, client, { errand = 'the errand' } = {}) {
  if (!client) return null;
  const o = offer(bot, goal);
  if (!o) return null;
  const asked = goal.eyesNow, now = Date.now();
  if (asked && asked.count === o.eyes && now - asked.at < ASK_AGAIN_MS) return null;
  goal.eyesNow = { count: o.eyes, at: now }; save?.();
  const n = `${o.eyes} eye${o.eyes === 1 ? '' : 's'} of ender`;
  const ring = goal.endPortal?.center ? Math.round(Math.hypot(bot.entity.position.x - goal.endPortal.center.x, bot.entity.position.z - goal.endPortal.center.z)) : null;
  const place = o.existing ? `the bot's chest at ${at(o.existing.position)}, ${o.steps} blocks off` : `a chest put down here at ${at(P(o.site.cell))}${rs().countOf(bot, 'chest') ? '' : ', made first from the wood carried'}`;
  const acts = { ...actions, place: actions?.place || require('./work').place, acquireStep: actions?.acquireStep || require('./work').acquireStep, navigate: actions?.navigate || require('./skills').navigate };
  const tree = {
    keep_here: { description: `Put the ${n} in ${place}, then go on ${errand} with nothing of the goal's in the pack. A death on the way drops everything carried and leaves the chest as it is; the eyes are counted as held, and taken out again when going to the End is chosen${ring !== null ? ` (the portal's ring is ${ring} blocks from here)` : ''}. ${LOST}` },
    carry_on: { description: `Go on ${errand} with the ${n} in the pack. A death drops them where it happens, and they last five minutes once the bot is near again. ${LOST} Asked again in ten minutes, or when the count carried changes.` },
  };
  let decision;
  try { decision = await decide('eyes_now', { client, bot, task, goal, save, tree, state: { eyesOfEnderCarried: o.eyes, errand, health: bot.health, food: bot.food, ...(ring !== null ? { blocksToThePortalRing: ring } : {}), riskNow: require('./risk').riskNow(bot) } }); }
  catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[eyes_now] not asked: ${String(err.message || err).slice(0, 300)}`); return null; }
  if (decision.stale) return null;
  if (decision.path?.at(-1) !== 'keep_here') return 'carry';
  const stored = await rs().stashRods(bot, task, goal, save, acts, o, { step: 'bank_eyes', rest: ['eye_bank', 'here'],
    chat: (list, where) => `Put ${list} in a chest at ${where}. They stay there until I go to the End.` });
  if (!stored) return 'carry';
  goal.eyeBank = { at: Date.now(), chestAt: o.existing ? o.existing.position : P(o.site.cell) }; save?.();
  return 'kept';
}

// The take-out waits while an errand for the End's kit is in hand: it is for
// the errand that they were put away.
function held(goal) {
  const pick = goal?.endKit?.choice?.pick;
  return !!(goal?.eyeBank && pick && pick !== 'enter_now');
}

module.exports = { eyesNow, offer, held, LOST };
