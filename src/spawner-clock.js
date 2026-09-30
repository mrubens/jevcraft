'use strict';
// The lull at a live blaze spawner, and its clock (note 691).
//
// 25589 (mid-242-ch-nether-1-fortress-12, 2026-09-29 21:16 to 21:18Z) stood
// three blocks from a cage with every blaze about out of its sight twice
// (21:16:49 and 21:17:28): encounter_stance was asked with no blaze in sight,
// box_here on offer at 0.12 and 0.14, and the answer was charge_nearest at a
// blaze behind the wall. New blazes came at 21:16:55, 21:17:37 and 21:18:03
// (42 and 26 seconds apart), a fight in the open followed, and the bot died
// at 21:18:24. Nothing said that the moment with none in sight was the one
// to build in: what goes up while no blaze sees the bot goes up out of their
// fire.
//
// The game (the 26.1.2 server jar, BaseSpawner): while a player is within 16
// blocks the spawner's delay counts down, 200 to 800 ticks (10 to 40 seconds)
// from its last try, and then it tries up to 4 blazes at cells within 4 of
// the cage (one below to one above), while fewer than 6 are near it. The
// delay does not count while no player is within 16.
//
// The client sees a try as blazes coming into being beside the cage: an
// entity the server spawns within the bot's tracking range. Kept here per
// cage, a try being the blazes that came within two seconds of each other.
const { Vec3 } = require('vec3');

const MIN_S = 10, MAX_S = 40, PER_TRY = 4, CAP = 6, RANGE = 16, NEAR_CAGE = 4.6;
const SETTLE_MS = 5000;   // blazes seen on coming near are there already, not a try
const TRY_GAP_MS = 2000;
const round = n => Math.round(n * 10) / 10;
const keyOf = c => `${c.x},${c.y},${c.z}`;
const centre = c => new Vec3(c.x + 0.5, c.y + 0.5, c.z + 0.5);

// Installed once per bot: a blaze that comes into being beside a cage the bot
// has been within 48 of for five seconds or more is the spawner's try.
function watch(bot) {
  if (!bot || bot._spawnClock || typeof bot.on !== 'function') return;
  const clock = bot._spawnClock = { tries: {}, near: {} };
  bot.on('entitySpawn', e => { try { seen(bot, e); } catch (_) { /* no world */ } });
  return clock;
}
function cageNear(bot) {
  const c = bot._spawnClock;
  if (c && c.cageAt && Date.now() - c.cageAt < 5000) return c.cage;
  let cage = null; try { cage = require('./blaze-stand').spawnerAt(bot); } catch (_) { cage = null; }
  if (c) { c.cage = cage; c.cageAt = Date.now(); }
  return cage;
}
// Kept up at each look by the callers (lull): since when the bot has been
// within 48 of this cage.
function nearSince(bot, cage, now = Date.now()) {
  const c = bot._spawnClock || watch(bot) || { near: {} };
  const k = keyOf(cage), here = bot.entity?.position;
  if (!here || centre(cage).distanceTo(here) > 48) { delete c.near[k]; return null; }
  const n = c.near[k];
  if (!n || now - n.last > 10000) c.near[k] = { since: now, last: now }; else n.last = now;
  return c.near[k].since;
}
function seen(bot, e, now = Date.now()) {
  if (e?.name !== 'blaze' || !e.position) return;
  const cage = cageNear(bot);
  if (!cage) return;
  const since = nearSince(bot, cage, now);
  if (since == null || now - since < SETTLE_MS) return;
  const c = centre(cage);
  if (Math.hypot(e.position.x - c.x, e.position.z - c.z) > NEAR_CAGE || Math.abs(e.position.y - cage.y) > 2.5) return;
  noteTry(bot, cage, now);
}
function noteTry(bot, cage, now = Date.now()) {
  const c = bot._spawnClock || watch(bot) || { tries: {} };
  const list = c.tries[keyOf(cage)] ||= [];
  const last = list.at(-1);
  if (last && now - last.at < TRY_GAP_MS) last.blazes++;
  else list.push({ at: now, blazes: 1 });
  if (list.length > 12) list.splice(0, list.length - 12);
}

// When the next try can come, from the last one seen: 10 to 40 seconds after
// it (while the bot stays within 16). -> { lastAgo, from, to, seen } in seconds.
function nextTry(bot, cage, now = Date.now()) {
  const list = bot?._spawnClock?.tries?.[keyOf(cage)] || [];
  const last = list.at(-1);
  if (!last) return { lastAgo: null, from: 0, to: MAX_S, seen: 0 };
  const ago = (now - last.at) / 1000;
  return { lastAgo: round(ago), from: round(Math.max(0, MIN_S - ago)), to: round(Math.max(0, MAX_S - ago)), seen: list.length, lastBlazes: last.blazes };
}
// The chance a job of `seconds` is done before the next try, the try's
// moment even over what is left of its 10 to 40 seconds.
function doneBefore(next, seconds) {
  const { from, to } = next;
  if (to <= 0) return 0;
  return Math.max(0, Math.min(1, (to - Math.max(from, seconds)) / Math.max(0.1, to - from)));
}
const clockSays = next => next.lastAgo == null
  ? `No try of the spawner's has been seen since the bot came near, so the next can come any moment up to ${MAX_S} seconds from now`
  : next.to <= 0 ? `Its last try was seen ${next.lastAgo} seconds ago, past the ${MAX_S} its delay can be: the next is due now (it tries only while fewer than ${CAP} are near it)`
    : `Its last try was seen ${next.lastAgo} seconds ago (${next.lastBlazes === 1 ? 'a blaze' : `${next.lastBlazes} blazes`}), so the next comes ${next.from ? `${next.from} to ${next.to}` : `within ${next.to}`} seconds from now`;

// The lull: within 16 of a live cage, no blaze in the bot's sight and none
// within two blocks. -> { cage, off, unseen, within16, next, says } or null.
// `threats` is danger.threats(bot, 48) when the caller has it.
function lull(bot, { cage = undefined, threats = null, now = Date.now() } = {}) {
  const here = bot?.entity?.position;
  if (!here || !/nether/.test(String(bot.game?.dimension || ''))) return null;
  if (cage === undefined) cage = cageNear(bot);
  if (!cage) return null;
  const off = centre(cage).distanceTo(here);
  if (off > RANGE) return null;
  let t = threats;
  if (!t) { try { t = require('./danger').threats(bot, 48); } catch (_) { t = []; } }
  const blazes = t.filter(x => x.entity?.name === 'blaze');
  // Within two a blaze swings instead of shooting and closes (the jar's
  // BlazeAttackGoal): that is a fight, not a lull, seen or not.
  if (blazes.some(x => x.visible) || blazes.some(x => x.distance <= 2)) return null;
  nearSince(bot, cage, now);
  const within16 = blazes.filter(x => x.distance <= RANGE).length;
  const next = nextTry(bot, cage, now);
  let record = '';
  try { const r = require('./blaze-record'); record = r.boxedSays(bot.health ?? 20) + r.lullsSay(); } catch (_) { record = ''; }
  const says = `No blaze sees the bot now${within16 ? ` (${within16 === 1 ? 'one' : within16} within sixteen out of its sight, behind rock)` : ''}; the spawner ${round(off)} blocks off tries up to ${PER_TRY} more every ${MIN_S} to ${MAX_S} seconds while the bot is within sixteen, until ${CAP} are about. ${clockSays(next)}. What is done before then is done out of their fire.${record}`;
  // Short, for a question held to the plain cap (empty_spawner, note 672).
  const soon = next.lastAgo == null ? `its last try not seen, the next within ${MAX_S} s` : next.to <= 0 ? `its last try ${next.lastAgo} s ago, the next due now` : `its last try ${next.lastAgo} s ago, the next ${next.from ? `in ${next.from} to ${next.to}` : `within ${next.to}`} s`;
  let rows = '';
  try { const b = require('./blaze-record').BOXED.spawner[require('./blaze-record').HEALTH_BAND(bot.health ?? 20)]; rows = ` Trials at a spawner begun at this health: box held ${b.boxed[0]} fights, ${Math.round(100 * b.boxed[1] / b.boxed[0])}% died; open ${b.open[0]}, ${Math.round(100 * b.open[1] / b.open[0])}% died; too few boxed to tell apart.`; } catch (_) { rows = ''; }
  const short = `No blaze in sight${within16 ? ` (${within16} within 16 behind rock)` : ''}. Spawner ${round(off)} blocks off: ${soon} (every ${MIN_S} to ${MAX_S} s, up to ${PER_TRY}, until ${CAP} about).${rows}`;
  return { cage, off: round(off), within16, next, says, short };
}
// A job's timing against the lull, for an option's words: its seconds and
// the chance it is done before the next try.
function jobSays(l, seconds) {
  if (!l) return '';
  const p = Math.round(100 * doneBefore(l.next, seconds));
  return ` About ${round(seconds)} second${round(seconds) === 1 ? '' : 's'} of it; done before the spawner's next try about ${p} times in 100${l.next.lastAgo == null ? ' (its last try not seen)' : ''}.`;
}

module.exports = { watch, noteTry, nextTry, doneBefore, lull, jobSays, clockSays, nearSince, MIN_S, MAX_S, PER_TRY, CAP, RANGE };
