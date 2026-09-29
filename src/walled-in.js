'use strict';
// Walled in by its own blocks, said with every question about the plan.
//
// mid-242-jb (25591, 22:37 to 22:49Z on 2026-09-29) sealed against a skeleton
// at a fortress's edge with the netherrack it carried, no pickaxe, and stood
// there eleven minutes: the pocket's lava corner never closed, so the pocket's
// own question was never asked (shelter.js closedIn), and leave_nether chose
// wait_here fifteen times and rung_progress answered none good over and over,
// none of them told the bot stood walled in. Only the stall's work_free said
// "4 of the 7 blocks round it its own ... which it can dig through", and it
// was asked last (note 697).
//
// The fact: walled in where it stands (every side closed at the feet or the
// head, unstuck.js walledOf) with one or more of the blocks round it its own
// (own-blocks.js laidAt); how many, of what, laid when, what digging them
// costs (by hand: the game's time, dropping nothing), whether it sealed here
// and the mob nearest now. A walk from inside digs through its own blocks
// (movement.js SurvivalMovements.safeToBreak); the rest round it is not dug.

const round = n => Math.round(n * 10) / 10;
const hhmm = at => new Date(at).toISOString().slice(11, 16);
const words = n => String(n).replaceAll('_', ' ');

// -> { says, own, of } or null
function walledInSays(bot, { survival = null, now = Date.now() } = {}) {
  if (!bot?.entity?.position || typeof bot.blockAt !== 'function') return null;
  let u, view, w;
  try { u = require('./unstuck'); view = u.liveView(bot); w = u.walledOf(view, bot.entity.position.floored()); } catch (_) { return null; }
  if (!w || !w.own.length) return null;
  // What digging its own costs, by kind.
  const costs = w.names.map(n => {
    const cell = w.own.find(c => view.name(c) === n);
    const s = u.digSeconds(n, view, false, cell);
    return s == null ? null : `${words(n)} about ${s} s a block${view.pickaxe ? ` with the ${words(view.pickaxe)}` : ', by hand, dropping nothing'}`;
  }).filter(Boolean);
  const others = [...new Set(w.round.filter(c => !w.own.includes(c)).map(c => view.name(c)))];
  // Sealed here: the seal pass's own record, where the bot stands.
  const s = survival?.sealing, feet = bot.entity.position.floored();
  const sealedHere = s?.origin && Math.abs(s.origin.x - feet.x) <= 1 && Math.abs(s.origin.y - feet.y) <= 1 && Math.abs(s.origin.z - feet.z) <= 1 && Number.isFinite(s.at) ? s.at : null;
  const against = survival?.pocketWait?.against?.mobs?.map(m => words(m.name || 'mob')) || [];
  let nearest = null;
  try { nearest = require('./danger').threats(bot, 16)?.[0] || null; } catch (_) { nearest = null; }
  const mobSays = nearest ? `the nearest mob now: a ${words(nearest.entity.name)} ${Math.round(nearest.distance)} blocks off, ${nearest.visible ? 'in sight' : 'out of sight'}` : 'no mob within 16 blocks now';
  const says = `Walled in where it stands: ${w.own.length} of the ${w.round.length} blocks round it are its own (${w.names.map(words).join(', ')}${w.at ? `, laid from ${hhmm(w.at)}Z` : ''})${sealedHere ? `, sealed here at ${hhmm(sealedHere)}Z${against.length ? ` against a ${[...new Set(against)].join(' and a ')}` : ''}` : ''}${others.length ? `; the rest is ${others.map(words).join(', ')}` : ''}. ${costs.length ? `Its own come away: ${costs.join('; ')}. ` : ''}A walk from here digs through its own blocks first; ${mobSays}.`;
  return { says, own: w.own.length, of: w.round.length, ...(sealedHere ? { sealedAt: sealedHere } : {}), at: now, health: round(bot.health ?? 20) };
}

module.exports = { walledInSays };
