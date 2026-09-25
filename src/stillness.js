'use strict';
// Getting nowhere is a bug, whatever the bot is doing.
//
// Every stuck hour of the runs had the same shape: an action that kept
// running, or kept being chosen again, while the world stayed as it was. A
// pocket sealed and dug open every two seconds; a lid navigated at every
// four; rings walked round a forest for one species of log; a furnace
// watched for four minutes; the same persist in the same cell for seven.
// Each was patched on its own, and four watchdogs grew beside the patches
// (twenty seconds without activity, five minutes inside one box, thirty
// unchanged ticks, three errors), each with its own measure, and every one
// of them excused the survival layer, which is where the longest ones were
// (the dream run's night mine, surface return and food search: over an
// hour and a half between them in one day).
//
// Activity was the wrong measure: pacing is moving, a sealing loop is
// placing, a re-dug hole is digging. Progress is the measure, and it is the
// same for every action in either layer:
//
//   somewhere new     over three blocks from anywhere the bot has stood in
//                     the last three minutes (bar the last ten seconds),
//                     whatever it was doing there: a walk back and forth
//                     between a stone face and a food drop is not new
//                     ground because the step changed its name between
//   something new     more of what the action is for (or of anything worth
//                     keeping, when it names nothing)
//   a new block       dug or placed where this action has not dug or placed
//   nearer            a new best 3D distance to the action's own target
//
// Forty-five seconds of an action being current without any of them is a
// stall (under the minute a watcher calls standing still). The action is
// set aside and the loop answers it one way, in order: the same thing done
// differently, then something else useful for a while, then the rung left
// for later. Waits that are the right thing (asleep, a fight, a shelter at
// night) are not measured, and nor are emergencies, which end on their own.
const STALL_MS = 45000, MEMORY_MS = 600000, TICK_MS = 1000;
const GROUND = { radius: 3, recentMs: 10000, spanMs: 180000 };
// Kept for the old callers' sake: the threshold a stall is judged at.
const STILL_MS = STALL_MS;
// Rock and dirt dug on the way are not something new: a shaft adds
// cobblestone every step, so a tunnel pacing along one ledge would look
// busy for as long as it paced. Unless the action is for them.
const FILLER = /^(cobblestone|cobbled_deepslate|netherrack|dirt|coarse_dirt|gravel|stone|deepslate|andesite|diorite|granite|tuff|calcite|basalt|blackstone|sand|red_sand|soul_sand|soul_soil|end_stone|leaf_litter|stick|wheat_seeds|.*_sapling|rotten_flesh|string|bone|arrow)$/;

// The waits that are the right thing to be doing. Each is bounded where it
// is chosen; this only keeps the stall rule from interrupting it. The names
// are the ones survival and the hunt actually report.
const HOLDS = new Set(['hold_bunker', 'hold_defensive_position', 'fight', 'block_shot', 'end_combat', 'dig_in', 'dig_in_bunker',
  'seal_shelter', 'wall_off', 'take_cover', 'dig_in_to_recover', 'break_their_line', 'take_the_door',
  // A shelter held because something outside is watching, and the minute
  // by the bed before it can be slept in.
  'wait_in_shelter', 'wait_for_bedtime', 'sleep']);
// Emergencies end when the danger does; a rule that set aside the way out
// of lava would be the death of the bot.
const EMERGENCIES = new Set(['leave_lava', 'leave_lava_edge', 'escape_threat', 'eat', 'dig_out_of_block', 'creeper_back_off',
  'creeper_close_in', 'fight_in_pocket', 'shoot', 'charge', 'off_the_edge', 'surface', 'swim_up']);
// Goals whose whole point is to be near a player who may be standing still.
const COMPANY = new Set(['follow', 'come']);
// The retry steps are not actions of their own: their time is the time of
// the step that failed.
const RETRY_STEPS = new Set(['persist', 'shake_loose', 'retreat_from_tunnel']);

function permittedWait(bot, goal, now = Date.now()) {
  if (bot.isSleeping) return 'asleep';
  if (COMPANY.has(goal?.kind)) return 'with the player';
  // Something hostile in view is the survival layer's moment. For a
  // minute, and not the hunt's own quarry: a blaze watched through the
  // floor held the bot still for as long as it stayed.
  // The minute runs from when one came into view and starts again only
  // once none is in view: cleared at its end instead, it began a fresh minute
  // at the next look and a mob in sight exempted the bot for good (trial 15
  // stood thirteen minutes without the rule firing, 2026-09-24).
  try {
    const { threats, claimed } = require('./danger');
    const inView = threats(bot, 16).some(t => (t.visible || t.distance < 6) && !claimed(bot, t.entity));
    const stalls = bot._stalls;
    if (!inView) { if (stalls) delete stalls.hostileSince; }
    else {
      const since = stalls ? (stalls.hostileSince ??= now) : now;
      if (now - since < 60000) return 'a hostile in view';
    }
  } catch (_) {}
  const encounter = bot._combatEncounter;
  if (encounter && encounter.expiresAt > now && !encounter.task?.cancelled) return 'in a fight';
  const recent = goal?.survivalAction;
  const current = recent && now - Date.parse(recent.at || 0) < 8000 ? recent.action : null;
  if (current && (HOLDS.has(current) || EMERGENCIES.has(current))) return current;
  // A bundle's step is its child's, wrapped.
  const action = goal?.step?.action === 'combined_request' ? goal.step.detail?.action : goal?.step?.action;
  if (HOLDS.has(action)) return action;
  // A batch of the step's own in the furnace, for as long as it takes: the
  // furnace is getting somewhere while the bot mines nearby. Trial 51's
  // twenty-four iron for the armour was called stalled at forty-five
  // seconds, the answer was more smelting, and that was called stalled too.
  const batch = goal?.smelting;
  if (batch?.startedAt && now < batch.startedAt + (batch.count || 1) * 10000 + 20000) return 'a batch cooking';
  // Waiting for health, hurt and fed: fine while it is coming back.
  if (['recover_before_combat', 'recover_before_nether'].includes(action) && (bot.health ?? 20) < 20 && (bot.food ?? 20) >= 18) return 'recovering';
  return null;
}

const P = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? v : null;

// What the bot is doing now, as the stall rule sees it: the survival
// layer's action while it is recent, otherwise the work step (a retry
// charged to the step that failed). A work step is keyed by what it is for,
// not what it is called: mining stone, walking back to the stone and moving
// on from it are one piece of work, which is getting stone or is not (the
// first trial split two minutes of that between three step names, and none
// of them looked stuck). The key leaves the target out too: a search that
// goes from tree to tree round the same wood is one action.
function actionOf(goal, now = Date.now()) {
  const recent = goal?.survivalAction;
  if (recent?.action && now - Date.parse(recent.at || 0) < 8000) {
    return { key: `survival:${recent.action}`, layer: 'survival', name: recent.action, target: P(recent.to) || P(recent.target) || P(recent.destination), item: recent.item || null };
  }
  let step = goal?.step?.action === 'combined_request' ? goal.step.detail : goal?.step;
  if (RETRY_STEPS.has(step?.action) && goal?.lastStruggleStep) step = goal.lastStruggleStep;
  if (!step?.action) return { key: 'step:none', layer: 'work', name: 'none', target: null, item: null };
  const item = step.item || step.drops || null;
  // On the game ladder the purpose is the rung: every step under it (the
  // repair and the tilling of one plot, the mining and smelting for one set
  // of armour) is one piece of work, which is getting somewhere or is not.
  // Keyed by step, trial 19's plot repair and tilling split their time
  // between two keys and neither stalled, flipping every second and a half
  // until the audit called the loop (2026-09-24). A detour is its own.
  const rung = goal?.kind === 'win' && step.action !== 'detour' ? goal.rungTime?.phase || goal.gameProgress?.phase : null;
  const purpose = rung ? `rung:${rung}` : step.block || step.resource || item || (step.choice ? `${step.action}:${step.choice}` : step.action);
  return { key: `step:${purpose}`, layer: 'work', name: step.action,
    target: P(step.target) || P(step.destination) || P(step.to) || P(step.cell) || P(step.portal), item };
}
const stillReason = (goal, now = Date.now()) => actionOf(goal, now).key;

// Somewhere new: judged against where the bot stood, not a grid (a grid
// counts a half-block step over a cell's edge as new ground).
function newGround(stalls, here, now) {
  const trail = stalls.trail ||= [];
  while (trail.length && now - trail[0].t > GROUND.spanMs) trail.shift();
  const far = p => Math.hypot(p.x - here.x, p.y - here.y, p.z - here.z) > GROUND.radius;
  // Credited once, on arrival: standing on at a new spot is not new again.
  const fresh = (!stalls.arrived || far(stalls.arrived)) && trail.every(({ p, t }) => now - t < GROUND.recentMs || far(p));
  if (fresh) stalls.arrived = { x: here.x, y: here.y, z: here.z };
  if (!trail.length || now - trail[trail.length - 1].t >= 1000) trail.push({ p: { x: here.x, y: here.y, z: here.z }, t: now });
  return fresh;
}
const blockKey = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;

// One look: the current action's record is brought up to date and the
// time since its last progress returned. `dt` is how long this look covers.
function look(bot, goal, { now = Date.now(), dt = TICK_MS } = {}) {
  const stalls = bot._stalls ||= { records: {}, marks: [] };
  const here = bot.entity?.position;
  if (!here) return null;
  const action = actionOf(goal, now);
  for (const [key, r] of Object.entries(stalls.records)) if (now - r.seenAt > MEMORY_MS) delete stalls.records[key];
  const r = stalls.records[action.key] ||= { key: action.key, blocks: {}, items: {}, idle: 0, strikes: [], seenAt: now };
  r.seenAt = now; r.layer = action.layer; r.name = action.name;
  let progress = false;
  const forget = at => now - at > MEMORY_MS;
  if (newGround(stalls, here, now)) progress = true;
  // Something new: the action's own item, or anything worth keeping.
  for (const i of bot.inventory?.items?.() || []) {
    // Anything worth keeping, and the action's own item even when it is rock:
    // an iron helmet is got by way of ore, coal and ingots, and a stall rule
    // that counted only helmets moved trial 10's bot on from its furnace
    // with thirteen iron cooking (2026-09-24).
    const counts = i.name === action.item || !FILLER.test(i.name);
    if (!counts) continue;
    r.now ||= {}; r.now[i.name] = (r.now[i.name] || 0) + i.count;
  }
  // The first look only sets the baseline: what was carried when the
  // action began is not something it found.
  for (const [name, n] of Object.entries(r.now || {})) { if (r.primed && n > (r.items[name] ?? 0)) progress = true; r.items[name] = Math.max(r.items[name] ?? 0, n); }
  r.primed = true; delete r.now;
  // Nearer the action's own target, when it has one. The best is kept per
  // target: the walk back to the same stone face is not nearer twice.
  if (action.target) {
    const t = blockKey(action.target), d = here.distanceTo({ x: action.target.x + 0.5, y: action.target.y, z: action.target.z + 0.5 });
    const bests = r.bests ||= {};
    if (bests[t] === undefined) bests[t] = d;
    else if (d < bests[t] - 1) { bests[t] = d; progress = true; }
  }
  // Blocks dug or placed since the last look, where this action has not.
  for (const m of stalls.marks.splice(0)) {
    const k = blockKey(m);
    if (!r.blocks[k] || forget(r.blocks[k])) progress = true;
    r.blocks[k] = now;
  }
  const waiting = permittedWait(bot, goal, now);
  if (progress) r.idle = 0;
  else if (!waiting) r.idle += dt;
  stalls.current = r;
  return { action, record: r, progress, waiting, idle: r.idle };
}

// The supervisor: a look a second, and a stall raised when the current
// action has gone STALL_MS without progress. The stall is set aside with
// the shared attempts memory (progress.js) and then held on the bot until
// the loop has answered it: every task.check() in between throws it, so a
// step that swallows the first throw meets it again at its next check.
function watchStalls(bot, goalOf) {
  const stalls = bot._stalls ||= { records: {}, marks: [] };
  stalls.goalOf = goalOf;
  if (stalls.timer) return stalls;
  let last = Date.now();
  bot.on?.('diggingCompleted', block => { if (block?.position) stalls.marks.push(block.position); });
  if (typeof bot.placeBlock === 'function' && !bot.placeBlock._stallMarked) {
    const place = bot.placeBlock.bind(bot);
    bot.placeBlock = Object.assign(async (reference, face, ...rest) => {
      const result = await place(reference, face, ...rest);
      if (reference?.position && face) stalls.marks.push(reference.position.plus(face));
      return result;
    }, { _stallMarked: true });
  }
  // A block used with an item (a hoe on the plot, seeds on farmland) is work
  // on the world too: trial 12's tilling was stalled for want of it. The
  // same block used again is not new (a chest opened twice).
  if (typeof bot.activateBlock === 'function' && !bot.activateBlock._stallMarked) {
    const activate = bot.activateBlock.bind(bot);
    bot.activateBlock = Object.assign(async (block, ...rest) => {
      const result = await activate(block, ...rest);
      if (block?.position) stalls.marks.push(block.position);
      return result;
    }, { _stallMarked: true });
  }
  stalls.timer = setInterval(() => {
    const now = Date.now(), late = now - last - TICK_MS, dt = Math.min(now - last, 5000); last = now;
    noteTrail(bot, stalls.goalOf?.(), now);
    try { require('./sightings').noteSightings(bot, stalls.goalOf?.(), now); } catch (_) { /* a look missed */ }
    // A look that comes seconds late is the event loop held by synchronous
    // work: said with what the bot was on, so the next one is found by name
    // and not by a server dropping the bot (the home-site fit, 2026-09-24).
    if (late > 3000) console.log(`[blocked] ${Math.round(late / 1000)}s on ${stalls.goalOf ? actionOf(stalls.goalOf() || {}, now).key : 'nothing'}`);
    airWatch(bot, now);
    const goal = stalls.goalOf?.();
    if (!goal || stalls.stall || bot.game?.gameMode === 'creative' || /end/.test(String(bot.game?.dimension || ''))) return;
    try {
      const seen = look(bot, goal, { now, dt });
      if (seen && seen.idle >= STALL_MS) raise(bot, goal, seen, now);
    } catch (err) { console.log(`[stall] look failed: ${err.message}`); }
  }, TICK_MS);
  stalls.timer.unref?.();
  return stalls;
}
// Air runs out on a clock, and a step waiting on something (a furnace, a
// walk that went nowhere) checks it only when it next looks up: trial 26's
// bot stood seventeen seconds under water beside a furnace and drowned with
// its air at nothing and no rescue begun. Low on air and nothing surfacing,
// the walk and any open window are stopped and the next check of the step
// unwinds it to the loop, whose survival layer swims up. Once, then again
// only if five seconds pass without a rescue.
function airWatch(bot, now = Date.now()) {
  if ((bot.oxygenLevel ?? 20) > 10) return;
  const recent = bot._survivalGoal?.survivalAction;
  if (recent?.action === 'surface' && now - Date.parse(recent.at || 0) < 8000) return;
  if (bot._airAbortAt > now - 5000) return;
  bot._airAbortAt = now; bot._airAbort = true;
  try { bot.pathfinder?.setGoal?.(null); } catch (_) { /* nothing to stop */ }
  try { bot.clearControlStates?.(); } catch (_) { /* nothing held */ }
  try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch (_) { /* no window */ }
  console.log(`[air] ${bot.oxygenLevel} air and no rescue under way: the step is stopped for the survival layer ${JSON.stringify({ sinceCheckMs: bot._lastCheckAt ? now - bot._lastCheckAt : null, digging: bot.targetDigBlock?.name || null, window: bot.currentWindow?.type ?? null })}`);
}

function unwatchStalls(bot) { if (bot._stalls?.timer) { clearInterval(bot._stalls.timer); delete bot._stalls.timer; } }

function raise(bot, goal, seen, now = Date.now()) {
  const { record: r, action } = seen;
  r.idle = 0; r.blocks = {};
  r.strikes = [...r.strikes.filter(t => now - t < MEMORY_MS), now];
  const why = `${Math.round(STALL_MS / 1000)} seconds on ${action.key.replace(/^\w+:/, '').replaceAll('_', ' ')} without getting anywhere`;
  const { setAside } = require('./progress');
  setAside(goal, 'act', action.key, why, MEMORY_MS);
  bot._stalls.stall = { key: action.key, layer: action.layer, name: action.name, why, strikes: r.strikes.length, at: now };
  console.log(`[stall] ${action.key}: strike ${r.strikes.length} (${why})`);
  return bot._stalls.stall;
}

// Where the bot has been, and on what, for every choice to see: a loop is
// plain in its own footprints (the user's suggestion, 2026-09-25). One
// place every fifteen seconds, the last three minutes.
const TRAIL_EVERY_MS = 15000, TRAIL_KEEP = 12;
function noteTrail(bot, goal, now = Date.now()) {
  const trail = bot._trail ||= [];
  if (trail.length && now - trail.at(-1).at < TRAIL_EVERY_MS) return;
  const p = bot.entity?.position;
  if (!p) return;
  const doing = goal?.survivalAction && now - Date.parse(goal.survivalAction.at || 0) < 20000 ? goal.survivalAction.action : goal?.step?.action;
  trail.push({ at: now, x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), doing: doing || null });
  if (trail.length > TRAIL_KEEP) trail.splice(0, trail.length - TRAIL_KEEP);
}
// The trail as the state says it: oldest first, how long ago, and how far
// the bot has got from where the trail begins.
function recentPositions(bot, now = Date.now()) {
  const trail = bot._trail || [];
  if (!trail.length) return null;
  const p = bot.entity.position.floored(), first = trail[0];
  return {
    every: 'fifteen seconds', minutes: Math.round((now - first.at) / 6000) / 10,
    furthestFromNowBlocks: Math.round(Math.max(...trail.map(t => Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z)))),
    places: trail.map(t => ({ secondsAgo: Math.round((now - t.at) / 1000), x: t.x, y: t.y, z: t.z, doing: t.doing })),
  };
}

class Stalled extends Error {
  constructor(stall) { super(`Stalled: ${stall.why}`); this.name = 'Stalled'; this.stall = stall; }
}
// Called from Task.check: a raised stall unwinds whatever is running.
function checkStall(bot) {
  // Both held until the survival layer runs (Survival.stepOnce clears
  // them): thrown once and swallowed by a catch on the way up, the step went
  // on and trial 30 was shot dead with the hurt watchdog firing three times.
  const now = bot._lastCheckAt = Date.now();
  // Ten seconds at most, should a loop never hand the survival layer its turn.
  if (bot._airAbort && now - (bot._airAbortAt || 0) > 10000) bot._airAbort = false;
  if (bot._threatAbort && now - (bot._threatAbortAt || 0) > 10000) bot._threatAbort = false;
  if (bot._airAbort) { const { NeedsAir } = require('./vitals'); throw new NeedsAir(); }
  if (bot._threatAbort) {
    const { NeedsSafety, threats } = require('./danger');
    let near = null; try { near = threats(bot, 16)[0]; } catch (_) { /* no entities yet */ }
    throw new NeedsSafety(near || { entity: { name: 'something unseen' }, distance: 0 });
  }
  const stall = bot._stalls?.stall; if (stall) throw new Stalled(stall);
}
// The loop takes the stall to answer it; nothing throws it again after.
function takeStall(bot) { const stall = bot._stalls?.stall; if (stall) delete bot._stalls.stall; return stall || null; }
// The survival layer asks before it starts an action: one that stalled is
// refused for a while, and the layer falls through to its next answer.
function refused(holder, key, now = Date.now()) { return require('./progress').isSetAside(holder, 'act', key, now); }

// Seconds stalled, per hour and per reason, kept with the survival state
// so the trial notes can say whether getting stuck is going down.
function recordStill(state, reason, ms, { now = Date.now(), detour } = {}) {
  const stats = state.stillness ||= { hours: {}, events: [] };
  const hour = new Date(now).toISOString().slice(0, 13);
  const bucket = stats.hours[hour] ||= { seconds: 0, stalls: 0, byReason: {} };
  bucket.seconds += Math.round(ms / 1000); bucket.stalls++;
  bucket.byReason[reason] = (bucket.byReason[reason] || 0) + Math.round(ms / 1000);
  stats.events = [...stats.events, { at: new Date(now).toISOString(), reason, seconds: Math.round(ms / 1000), detour }].slice(-60);
  for (const key of Object.keys(stats.hours).sort().slice(0, -48)) delete stats.hours[key];
  return bucket;
}

module.exports = { noteTrail, recentPositions, airWatch, STALL_MS, STILL_MS, GROUND, HOLDS, EMERGENCIES, FILLER, permittedWait, actionOf, stillReason, look, watchStalls, unwatchStalls, raise,
  Stalled, checkStall, takeStall, refused, recordStill };
