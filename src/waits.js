'use strict';
// What a wait waits for (note 698).
//
// Fable's check-in of 22:50Z on 2026-09-29: waiting out rests (13.7 bot-hours)
// and shelter sitting (10) were a third of all waste, and 25591 (mid-242-jb)
// answered leave_nether wait_here 32 times of 32, standing 9.5 minutes on
// "rods waiting". Its wait_here said "Wait here until the rods step's rest
// ends, taken up again in 30 minutes", and the rest was for "Jev chose to go
// on without the warped stem": standing there brought no stem, and at the
// rest's end the rods step met the same want. Note 679 said such a wait for
// the pocket's stay alone, and still offered it.
//
// The rule, for every option whose point is to stay put until something
// happens: the option names what it waits for and when that is expected
// ("the rods step's rest to end, in 30 minutes (at 22:49Z)", "the spawner's
// next try, in 10 to 40 seconds", "daylight, in about 9 minutes"), and where
// that cannot come, or coming changes nothing, the option is not offered and
// why is said in the question's facts (waitsForNothing). The builders say
// the event with these helpers; decide (src/decisions/index.js) does the
// rest in one place (gate).
//
// A wait node carries `waits`: { for, fromMs, toMs, comes, why, says }.

const { DAY } = require('./day');
const round = n => Math.round(n * 10) / 10;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function spanSays(fromMs, toMs, at = null) {
  if (!Number.isFinite(toMs)) return 'at no set time';
  const s = ms => Math.max(0, Math.round(ms / 1000));
  if (toMs < 90000) {
    if (Number.isFinite(fromMs) && s(toMs) - s(fromMs) >= 2) return `in ${s(fromMs)} to ${s(toMs)} seconds`;
    return `in about ${plural(Math.max(1, s(toMs)), 'second')}`;
  }
  const m = Math.max(1, Math.round(toMs / 60000));
  return `in about ${plural(m, 'minute')}${at ? ` (at ${new Date(at).toISOString().slice(11, 16)}Z)` : ''}`;
}

// A wait for `what`, expected between fromMs and toMs from now (toMs
// Infinity: no set time). `comes` false: it cannot come, or its coming
// changes nothing; `why` says so, as a fact.
function event(what, { fromMs = null, toMs = Infinity, at = null, comes = true, why = null } = {}) {
  const when = spanSays(fromMs, toMs, at);
  return { for: what, fromMs, toMs, comes: !!comes, ...(why ? { why } : {}),
    says: comes ? `It waits for ${what}, ${when}.` : `Nothing it waits for comes: ${why || `${what} does not come`}.` };
}

// What time alone can change in a cause, standing still: the mobs about
// (they move, they go), the hour (the Overworld's), health (while hunger
// holds at eighteen or more), a furnace, a fire. Anything else (blocks,
// a pickaxe, wood, a route, lava, a drop, a thing set aside for want of
// it) is the same when the rest ends as when it began.
// A mob named is not a mob in the way: "go to blazes about" is an option's
// name. A cause is the mobs' when it says what they do: see the bot, shoot,
// stand in the way, a fight on.
const MOB_CAUSE = /\b(able to see|can see|sees? (the bot|me)|in sight of|shoots?|shooting|shooter|watching|in the way|standing in|a fight|fight is on|threats?|danger|NeedsSafety|attacked|hurt by)\b/i;
function timeChanges(cause, bot) {
  const text = String(cause || '');
  if (!text.trim()) return 'unknown';
  if (MOB_CAUSE.test(text)) return 'the mobs about';
  const overworld = /overworld/.test(String(bot?.game?.dimension || 'overworld'));
  if (overworld && /\b(night|dark|dusk|dawn|daylight)\b/i.test(text)) return 'the hour';
  if (/\b(health|hurt)\b/i.test(text) && (bot?.food ?? 20) >= 18 && (bot?.health ?? 20) < 20) return 'health';
  if (/\b(furnace|smelt\w*|cook\w*)\b/i.test(text)) return 'the furnace';
  if (/\b(burning|on fire|alight)\b/i.test(text)) return 'the fire';
  return null;
}

// A rest's end: `what` names the rest ("the rods step's rest"), `until` its
// end, `cause` what it rests for, `idle` true when nothing is on offer from
// here meanwhile (the wait is standing still). Idle, with a cause that
// standing still cannot change, the rest's end brings the same ways back to
// the same want: that wait is for nothing.
function restEnds(bot, { what, until, cause = '', idle = false, now = Date.now() } = {}) {
  const ms = Math.max(0, (until || now) - now);
  const ev = `${what} to end`;
  if (!idle) return event(ev, { toMs: ms, at: until });
  const changes = timeChanges(cause, bot);
  if (changes) return event(ev, { toMs: ms, at: until });
  const c = String(cause).replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return event(ev, { toMs: ms, at: until, comes: false,
    why: `${what} ends ${spanSays(null, ms, until)}, but it rests for this: ${c.length > 240 ? `${c.slice(0, 237)}...` : c}; standing here changes none of that, so the work meets the same when it ends` });
}

// Daylight: none off the Overworld, and none to wait for by day.
// `night`: the caller's own reading that it is night (the shelter's), taken
// over the clock's.
function daylight(bot, { dawnTick = DAY.DAWN, duskTick = DAY.DUSK, night = null } = {}) {
  if (!/overworld/.test(String(bot?.game?.dimension || 'overworld'))) return event('daylight', { comes: false, why: `no daylight comes here: the ${/end/.test(String(bot?.game?.dimension)) ? 'End' : 'Nether'} has no day` });
  const t = bot?.time?.timeOfDay ?? 0;
  if (night !== true && (t >= dawnTick || t < duskTick)) return event('daylight', { comes: false, why: 'it is day already: daylight is what the bot has now' });
  const ticks = (dawnTick - t + 24000) % 24000;
  return event('daylight', { toMs: ticks * 50, at: Date.now() + ticks * 50 });
}

// Health coming back, standing still: only at hunger eighteen or more.
function heal(bot) {
  const hp = bot?.health ?? 20, food = bot?.food ?? 20;
  if (hp >= 20) return event('health to come back', { comes: false, why: 'health is full' });
  if (food < 18) return event('health to come back', { comes: false, why: `health ${round(hp)} does not come back at hunger ${food} (only at eighteen or more)` });
  return event(`health back to 20 from ${round(hp)}`, { toMs: Math.round((20 - hp) * 4000) });
}

// A spawner's next try (spawner-clock.js): 10 to 40 seconds from its last
// while the bot is within 16, none while it is not.
function spawnerTry(bot, cage) {
  const clock = require('./spawner-clock');
  const next = cage ? clock.nextTry(bot, cage) : { lastAgo: null, from: 0, to: clock.MAX_S };
  if (next.lastAgo == null) return event('the spawner\'s next blazes', { fromMs: 0, toMs: clock.MAX_S * 1000 });
  return event('the spawner\'s next blazes', { fromMs: next.from * 1000, toMs: Math.max(1000, next.to * 1000) });
}

// A timer that runs on its own: a furnace's batch, bedtime.
function timer(what, ms) { return event(what, { toMs: Math.max(0, ms), at: Date.now() + Math.max(0, ms) }); }

// The mobs outside moving off: no set time, and nothing to wait for once
// they are gone (pocket-wait.js says which).
function mobsMoveOff(who, { gone = false, why = null } = {}) {
  return gone ? event(`${who} to go`, { comes: false, why: why || `${who} ${/s$/.test(who) ? 'are' : 'is'} gone already` }) : event(`${who} to move off`);
}

// The wait options of the questions (declared `wait: true` in define): a
// node offered for one of these without `waits` is reported once.
const reported = new Set();
// decide's one place: the waits that cannot come are taken out and said as
// facts, unless every option offered is such a wait (the question still
// needs an answer; each then says it on itself). A question whose options
// are said, never left out (the stances, SAY_ONLY), keeps them, said on
// each. -> { tree, facts: [..] }
function gate(id, tree, { sayOnly = false, declaredWait = () => false } = {}) {
  const facts = [], out = {};
  for (const [key, node] of Object.entries(tree || {})) {
    const w = node?.waits;
    if (!w && declaredWait(key)) {
      const m = `${id}: ${key} offered without what it waits for`;
      if (!reported.has(m)) { reported.add(m); console.log(`[waits] ${m}`); }
    }
    if (w && w.comes === false && !sayOnly) { facts.push(`${key.replaceAll('_', ' ')}: not offered. ${w.says}`); continue; }
    out[key] = node;
  }
  if (!Object.keys(out).length) {
    const kept = Object.fromEntries(Object.entries(tree).map(([k, n]) => [k, n?.waits && n.waits.comes === false && !String(n.description || '').includes(n.waits.says) ? { ...n, description: `${n.description || ''} ${n.waits.says}`.trim() } : n]));
    return { tree: kept, facts: [] };
  }
  return { tree: out, facts };
}

module.exports = { event, restEnds, daylight, heal, spawnerTry, timer, mobsMoveOff, timeChanges, gate, spanSays };
