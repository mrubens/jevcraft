'use strict';
// Standing still is a bug. Every time the bot stood in one place for
// minutes it had the same shape: a step that returned having done nothing,
// or a wait chosen with nothing else on offer, and the next tick landed in
// the same place. A chore failing silently twenty times a second, a food
// gate with nowhere left to look, a night behind a wall after one refused
// sleep. Each was patched on its own; this is the rule that catches the
// next one before it is found.
//
// Activity is what the world can see: the bot moved, dug, placed, picked
// something up, fought, or its pockets changed. Twenty seconds without any
// of it is a stall, unless the wait is one of a short list that is the
// right thing to be doing (asleep, a fight, holding a door). A stall is
// recorded with what the bot was on, and the loop then hands it something
// productive to do instead.
const STILL_MS = 20000, HOSTILE_WAIT_MS = 60000;
const MOVE_BLOCKS = 1;

function watchActivity(bot) {
  if (bot._activity) return bot._activity;
  const activity = bot._activity = { at: Date.now(), kind: 'start', anchor: bot.entity?.position?.clone?.() || null };
  const mark = kind => { activity.at = Date.now(); activity.kind = kind; };
  const onMove = () => {
    const p = bot.entity?.position;
    if (!p) return;
    if (!activity.anchor || activity.anchor.distanceTo(p) >= MOVE_BLOCKS) { activity.anchor = p.clone(); mark('move'); }
  };
  bot.on?.('move', onMove);
  bot.on?.('diggingCompleted', () => mark('dig'));
  bot.on?.('playerCollect', collector => { if (collector === bot.entity) mark('pickup'); });
  bot.on?.('entityHurt', (entity, source) => { if (source === bot.entity) mark('fight'); });
  bot.on?.('sleep', () => mark('sleep'));
  bot.inventory?.on?.('updateSlot', () => mark('inventory'));
  // Health coming back is the point of a recovery wait: it counts.
  let health = bot.health;
  bot.on?.('health', () => { if (bot.health > health) mark('heal'); health = bot.health; });
  return activity;
}

// Callers that know they did something the events above miss (a block
// placed, a craft) say so.
function markActivity(bot, kind = 'action') {
  const activity = watchActivity(bot);
  activity.at = Date.now(); activity.kind = kind;
}

function stillFor(bot, now = Date.now()) {
  return now - watchActivity(bot).at;
}

// The waits that are the right thing to be doing. Each is bounded where it
// is chosen; this only keeps the stall rule from interrupting it. The names
// are the ones survival and the hunt actually report: the list had "hold"
// where survival says "hold_defensive_position", and a bot dug in beside a
// spawner at eleven health was sent off to mine quartz.
const HOLDS = new Set(['hold_bunker', 'hold_defensive_position', 'fight', 'block_shot', 'end_combat', 'dig_in', 'dig_in_bunker',
  'seal_shelter', 'wall_off', 'take_cover', 'dig_in_to_recover', 'break_their_line', 'take_the_door',
  // A shelter held because something outside is watching, and the minute
  // by the bed before it can be slept in.
  'wait_in_shelter', 'wait_for_bedtime']);
// Goals whose whole point is to be near a player who may be standing still.
const COMPANY = new Set(['follow', 'come']);
function permittedWait(bot, goal, now = Date.now()) {
  if (bot.isSleeping) return 'asleep';
  if (COMPANY.has(goal?.kind)) return 'with the player';
  // Something hostile in view is the survival layer's moment, not an idle
  // one: a detour then walks away from whatever is holding the bot. For a
  // minute, and not the hunt's own quarry: a blaze watched through the
  // floor or a skeleton across a ravine held the bot still for as long as
  // they stayed, which is the stall this rule exists to break.
  try {
    const { threats, claimed } = require('./danger');
    if (now - watchActivity(bot).at < HOSTILE_WAIT_MS && threats(bot, 16).some(t => (t.visible || t.distance < 6) && !claimed(bot, t.entity))) return 'a hostile in view';
  } catch (_) {}
  const encounter = bot._combatEncounter;
  if (encounter && encounter.expiresAt > now && !encounter.task?.cancelled) return 'in a fight';
  if (HOLDS.has(goal?.step?.action)) return goal.step.action;
  const recent = goal?.survivalAction;
  if (recent && HOLDS.has(recent.action) && now - Date.parse(recent.at || 0) < STILL_MS) return recent.action;
  if (recent?.action === 'sleep' && now - Date.parse(recent.at || 0) < STILL_MS) return 'going to sleep';
  // Waiting for health, hurt: fine while it is coming back (healing counts
  // as activity above); stalled at the same number, it is a stall.
  if (HOLDS.has(goal?.step?.action) || goal?.step?.action === 'recover_before_combat' && (bot.health ?? 20) < 20 && (bot.food ?? 20) >= 18) return 'recovering';
  return null;
}

// What the bot was on when it stopped: the survival layer's latest action
// if it is recent, which is usually the one holding it, or the work step.
function stillReason(goal, now = Date.now()) {
  const survival = goal?.survivalAction;
  if (survival?.action && now - Date.parse(survival.at || 0) < 60000) return `survival:${survival.action}`;
  return `step:${goal?.step?.action || 'none'}`;
}

// Seconds still, per hour and per reason, kept with the survival state so
// the trial notes can say whether standing still is going down.
function recordStill(state, reason, ms, { now = Date.now(), detour } = {}) {
  const stats = state.stillness ||= { hours: {}, events: [] };
  const hour = new Date(now).toISOString().slice(0, 13);
  const bucket = stats.hours[hour] ||= { seconds: 0, stalls: 0, byReason: {} };
  bucket.seconds += Math.round(ms / 1000); bucket.stalls++;
  bucket.byReason[reason] = (bucket.byReason[reason] || 0) + Math.round(ms / 1000);
  stats.events = [...stats.events, { at: new Date(now).toISOString(), reason, seconds: Math.round(ms / 1000), detour }].slice(-60);
  // A day of hours is plenty to read back.
  for (const key of Object.keys(stats.hours).sort().slice(0, -48)) delete stats.hours[key];
  return bucket;
}

module.exports = { STILL_MS, watchActivity, markActivity, stillFor, permittedWait, stillReason, recordStill };
