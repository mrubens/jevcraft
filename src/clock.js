'use strict';
// The run's clock against the ten-hour goal, said on every plan question in every phase (note 2626; the project review
// of 2026-10-30, item 11): strategy.js said the budget only before the Nether was entered, and the phases after it are
// where the full runs' hours went (full-2: the End re-kit 23 hours, full-3: 103 hours in the End). The code does the
// arithmetic; Jev weighs it.
const BUDGET = [
  ['nether_entered', 'the Nether', 60],
  ['rods_obtained', 'seven blaze rods', 180],
  ['eyes_obtained', 'the twelve eyes of ender', 270],
  ['end_entered', 'the End', 420],
  ['dragon_defeated', 'the dragon dead', 600],
];
const mins = m => { m = Math.round(m); if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`; const h = Math.floor(m / 60), r = m % 60; return `${h} hour${h === 1 ? '' : 's'}${r ? ` ${r} minute${r === 1 ? '' : 's'}` : ''}`; };

// -> the sentence, or null where the run has no clock (not a fresh-world win goal).
function clockSays(bot, goal, now = Date.now()) {
  const c = goal?.gameProgress?.clock, p = goal?.gameProgress;
  if (goal?.kind !== 'win' || !c?.playedMs || !p?.startedAt) return null;
  const played = c.playedMs / 60000;
  const ms = p.milestones || {};
  const at = name => { const m = ms[name]; if (!m?.at) return null; return Math.max(0, Math.round((m.at - p.startedAt) / 60000)); };
  // The rods: seven carried or banked counts as reached, at the time the hunt's own record says, else now.
  const rods = (() => { try { return require('./blaze-stand').rodsNeeded(bot, goal) <= 0; } catch (_) { return false; } })();
  const reached = BUDGET.filter(([k]) => k === 'rods_obtained' ? rods : at(k) !== null)
    .map(([k, what, due]) => { const t = k === 'rods_obtained' ? (ms.rods_obtained?.at ? at('rods_obtained') : null) : at(k); return `${what}${t === null ? '' : ` ${mins(t)} in`}${t !== null && t > due ? ` (${mins(t - due)} past its budget of ${mins(due)})` : ''}`; });
  const next = BUDGET.find(([k]) => !(k === 'rods_obtained' ? rods : at(k) !== null));
  const left = 600 - played;
  const nextSays = next ? `Next by the budget: ${next[1]} by ${mins(next[2])}, ${played < next[2] ? `${mins(next[2] - played)} left to it` : `${mins(played - next[2])} past it`}.` : 'Every budgeted milestone is reached.';
  return `The goal is the ender dragon dead in under 10 hours of play from a fresh world; the run's budget: the Nether by ${mins(60)}, seven blaze rods by ${mins(180)}, the twelve eyes by ${mins(270)}, the End by ${mins(420)}, the dragon dead by ${mins(600)}. This run has played ${mins(played)}${left > 0 ? `, ${mins(left)} left in all` : `, ${mins(-left)} over`}. ${reached.length ? `Reached: ${reached.join('; ')}.` : 'No milestone reached yet.'} ${nextSays} A way that cannot finish within what is left is a way to a slower run, not a safer one.`;
}

// The questions the clock goes to: those about the plan and the work, not a stance in a fight.
const CLOCK_KINDS = new Set(['strategy', 'fortress', 'mining', 'upkeep', 'explore', 'travel', 'stronghold', 'end', 'smelting', 'recovery', 'trade', 'pickup']);

module.exports = { clockSays, BUDGET, CLOCK_KINDS };
