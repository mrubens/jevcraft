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
// The swing at a mob in reach (defend) and a pillar held up top are the
// fight too: mid-205-i's fight with three spiders traded names with its
// swing, the flip watch called it a stall, and the swing was set aside while
// the spiders took it from nine health to none (2026-09-27).
const HOLDS = new Set(['hold_bunker', 'hold_defensive_position', 'fight', 'defend', 'pillar_hold', 'block_shot', 'end_combat', 'dig_in', 'dig_in_bunker',
  'seal_shelter', 'wall_off', 'take_cover', 'dig_in_to_recover', 'break_their_line', 'take_the_door',
  // A shelter held because something outside is watching, and the minute
  // by the bed before it can be slept in.
  'wait_in_shelter', 'wait_for_bedtime', 'sleep', 'rest_to_heal',
  // Crouched still on a span with a mob about: still is the point. Set
  // aside as a stall, every hold after threw, and nothing swung or
  // shielded while mid-242-o's piglin hit it off its span (note 420).
  'hold_on_span']);
// Emergencies end when the danger does; a rule that set aside the way out
// of lava would be the death of the bot.
const EMERGENCIES = new Set(['leave_lava', 'leave_lava_edge', 'out_of_fire', 'off_hot_floor', 'off_span', 'escape_threat', 'eat', 'dig_out_of_block', 'creeper_back_off', 'creeper_hold',
  'creeper_close_in', 'fight_in_pocket', 'shoot', 'charge', 'off_the_edge', 'surface', 'swim_up']);
// An emergency is excused while it is getting results, not by its name.
// Where its result can be read, it is: a fight is a swing landed in the
// last eight seconds. mid-235-n's fight_in_pocket was excused by name for
// two hours and twenty minutes of no swing at mobs on its lid, and the
// pocket's question never came (note 478).
// A seal or a shelter build is a hold while its blocks go in, the same:
// a block placed in the last eight seconds. mid-226-h's seal_shelter was
// excused by name for forty seconds that placed two, its cell taken by a
// skeleton shooting it from 1.6 blocks, and the stance never came (note 520).
const placing = (bot, now) => !!bot?._sealPlaced && now - bot._sealPlaced.at < 8000;
const RESULTS = { fight_in_pocket: (bot, now) => !!bot?._struck && now - bot._struck.at < 8000, seal_shelter: placing, dig_in: placing };
// Whether a hold or an emergency is excused now: by its name, and where its
// result can be read, by the result.
const excused = (bot, name, now = Date.now()) => (HOLDS.has(name) || EMERGENCIES.has(name)) && (RESULTS[name]?.(bot, now) ?? true);
// Goals whose whole point is to be near a player who may be standing still.
const COMPANY = new Set(['follow', 'come']);
// The retry steps are not actions of their own: their time is the time of
// the step that failed.
const RETRY_STEPS = new Set(['persist', 'shake_loose', 'retreat_from_tunnel']);

// A wait something is bringing to an end, for the rung's budget (tried.js
// watchRung, note 599): asleep, with the player, a batch of the step's own
// cooking, health coming back, and in the Overworld at night the daylight
// coming. Every other wait (a pocket, a pillar, a stand, a fight) is
// minutes on the rung like any others: a bot sealed in, holding or fighting
// ten minutes without a new best is asked after its rung.
function waitEnds(bot, goal, now = Date.now()) {
  if (bot?.isSleeping) return 'asleep';
  if (COMPANY.has(goal?.kind)) return 'with the player';
  const batch = goal?.smelting;
  if (batch?.startedAt && now < batch.startedAt + (batch.count || 1) * 10000 + 20000) return 'a batch cooking';
  const recent = goal?.survivalAction;
  const current = recent && now - Date.parse(recent.at || 0) < 8000 ? recent.action : null;
  const action = goal?.step?.action === 'combined_request' ? goal.step.detail?.action : goal?.step?.action;
  if ((['recover_before_combat', 'recover_before_nether'].includes(action) || current === 'rest_to_heal') && (bot?.health ?? 20) < 20 && (bot?.food ?? 20) >= 18) return 'health coming back';
  const t = bot?.time?.timeOfDay;
  if (['wait_in_shelter', 'wait_for_bedtime', 'sleep'].includes(current) && /overworld/.test(String(bot?.game?.dimension || '')) && Number.isFinite(t) && t >= 12542 && t < 23460) return 'daylight coming';
  return null;
}
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
  if (current && excused(bot, current, now)) return current;
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
  // By a spawner for the minutes Jev chose to wait there (mob-hunt.js
  // wait_at_spawner): it makes the blazes, the bot need not move.
  if (action === 'wait_at_spawner' && goal?.fortressSearch?.spawnerWait?.until > now && goal.step.off <= 8) return 'waiting by a spawner';
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
  // A step dropped from hand because it cannot be done in this dimension
  // is still what the work is stuck on, and the stall names it: said as
  // "step:none", mid-227-r-nether-1's question named nothing while the loop
  // planned iron ore in the Nether 1,130 times (note 476).
  const away = goal?.wrongDimension;
  const blocker = away && now - (away.at || 0) < MEMORY_MS ? { wrongDimension: away.error, times: away.n, ...(away.phase ? { phase: away.phase } : {}), ...(away.from?.length ? { from: away.from } : {}) } : null;
  if (!step?.action && blocker && away.step?.action) step = away.step;
  if (!step?.action) return { key: 'step:none', layer: 'work', name: 'none', target: null, item: null, ...(blocker ? { blocker } : {}) };
  const blocked = blocker && (step === away.step || (away.phase && [step.phase, goal.rungTime?.phase, goal.gameProgress?.phase].includes(away.phase))) ? { blocker } : {};
  const item = step.item || step.drops || null;
  // On the game ladder the purpose is the rung: every step under it (the
  // repair and the tilling of one plot, the mining and smelting for one set
  // of armour) is one piece of work, which is getting somewhere or is not.
  // Keyed by step, trial 19's plot repair and tilling split their time
  // between two keys and neither stalled, flipping every second and a half
  // until the audit called the loop (2026-09-24). A detour is its own.
  // A rung set aside is not the purpose of what is done while it waits
  // (tried.js rungOf): the rods' waiting stage is keyed as that wait, which
  // is how its hold names it. Keyed by the rung, 25590's stall watch struck
  // "rung:obtain blaze rods" every 45 seconds through the hold it did not
  // see, set aside at the rung's question a minute before (note 605).
  const phase = goal?.kind === 'win' && step.action !== 'detour' ? goal.rungTime?.phase || goal.gameProgress?.phase : null;
  const rung = phase && !require('./progress').isSetAside(goal, 'rung', phase, now) ? phase : null;
  const purpose = rung ? `rung:${rung}` : step.block || step.resource || item || (step.choice ? `${step.action}:${step.choice}` : step.action);
  return { key: `step:${purpose}`, layer: 'work', name: step.action,
    target: P(step.target) || P(step.destination) || P(step.to) || P(step.cell) || P(step.portal), item, ...blocked };
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
// A block dug or placed, as it happens. `marked` counts only a cell not
// dug or placed in the last MEMORY_MS, the look's own rule below: a block
// put in a cell and dug out of it again is nothing done. mid-243-af-
// fortress-1's way out put a gravel north and dug it back six times in ten
// seconds, each answer "a block was dug or placed" and so getting somewhere
// in the ledger, and neither ever rested (note 603).
function markCell(stalls, p, now = Date.now()) {
  stalls.marks.push(p);
  const cells = stalls.markedCells ||= new Map(), k = blockKey(p);
  const last = cells.get(k);
  cells.delete(k); cells.set(k, now);
  for (const [key, at] of cells) { if (cells.size <= 512 && now - at <= MEMORY_MS) break; cells.delete(key); }
  if (last === undefined || now - last > MEMORY_MS) stalls.marked = (stalls.marked || 0) + 1;
}

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
  if (progress) { r.idle = 0; stalls.progressAt = now; }
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
  // Counted as they come, too: a question asked again a fraction of a
  // second after its answer reads them before the next look (decisions/
  // repeats.js, note 560).
  bot.on?.('diggingCompleted', block => { if (block?.position) markCell(stalls, block.position); });
  if (typeof bot.placeBlock === 'function' && !bot.placeBlock._stallMarked) {
    const place = bot.placeBlock.bind(bot);
    bot.placeBlock = Object.assign(async (reference, face, ...rest) => {
      const result = await place(reference, face, ...rest);
      if (reference?.position && face) markCell(stalls, reference.position.plus(face));
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
      if (block?.position) markCell(stalls, block.position);
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
      else flipWatch(bot, goal, now);
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

function raise(bot, goal, seen, now = Date.now(), because = null, extra = {}) {
  const { record: r, action } = seen;
  // An escalation to a question above is not the action standing still:
  // the question above is asked, the action is not refused nor struck
  // (tried.js).
  const above = !!extra.escalated?.to && extra.escalated.to !== 'rung_progress';
  r.idle = 0; r.blocks = {};
  r.strikes = [...r.strikes.filter(t => now - t < MEMORY_MS), ...(above ? [] : [now])];
  const why = because || `${Math.round(STALL_MS / 1000)} seconds on ${action.key.replace(/^\w+:/, '').replaceAll('_', ' ')} without getting anywhere`;
  const { setAside } = require('./progress');
  if (!above) setAside(goal, 'act', action.key, why, MEMORY_MS);
  // A flip is not a wait: a hold that trades turns with another step is
  // refused as well, for a while. dig_in, a hold, traded turns with the
  // way back to the surface twenty-three times in mid-205-c, its lid placed
  // and dug out again every second and a half, and five strikes against it
  // changed nothing (2026-09-26).
  if (because && FLIPPING.test(because)) setAside(goal, 'flip', action.key, why, FLIP_REST_MS);
  bot._stalls.stall = { key: action.key, layer: action.layer, name: action.name, why, strikes: r.strikes.length, at: now, ...(action.blocker ? { blocker: action.blocker } : {}), ...extra };
  if (extra.escalated) console.log(`[escalate] ${String(extra.escalated.from).replaceAll('_', ' ')} -> ${String(extra.escalated.to || 'the stall question').replaceAll('_', ' ')}: ${why}`);
  else console.log(`[stall] ${action.key}: strike ${r.strikes.length} (${why})`);
  return bot._stalls.stall;
}

// A stall raised from outside the watch, for the action in hand: a question
// whose same answer to the same facts came back at once, again and again,
// with nothing coming of it (decisions/repeats.js, note 560). Answered by the
// loop as any stall is: another way, a detour, the rung left for later.
function raiseFor(bot, goal, why, now = Date.now(), extra = {}) {
  const stalls = bot._stalls ||= { records: {}, marks: [] };
  const action = actionOf(goal, now);
  const record = stalls.records[action.key] ||= { key: action.key, blocks: {}, items: {}, idle: 0, strikes: [], seenAt: now };
  return raise(bot, goal, { record, action }, now, why, extra);
}

// Two steps handing the turn back and forth is a stall however busy each
// looks: a staircase and its retreat, obsidian and its tunnel, the walk home
// and a detour each traded names every few seconds until the audit failed
// the trial for it, one pair at a time (2026-09-25). The audit's own test,
// looked at as it happens and a little sooner: five changes between the
// same two steps inside forty-five seconds, the bot never more than five
// blocks from where they began nor three from it at the end, and nothing
// worth keeping gained. Raised as a stall of the step in hand, so the loop
// answers it the way it answers any other: another way, a detour, or the
// step set aside, Jev's choice with the flip said.
const FLIP_CHANGES = 5, FLIP_MS = 45000, FLIP_REST_MS = 2 * FLIP_MS;
const FLIPPING = /^turning between /;
function worth(bot) { return (bot.inventory?.items?.() || []).filter(i => !FILLER.test(i.name)).reduce((n, i) => n + i.count, 0); }
const countKey = step => step ? `${step.action}:${step.drops || step.item || ''}` : null;
// The step a retry is retrying is the step: a step and its own persist are
// one piece of work failing, which the ledger and persist answer, not two
// steps trading the turn. mid-243-af-nether-3-fortress-1's search for a
// crimson stem failed at once and went to persist fifteen times in eighty
// seconds, raised besides as "turning between mine and persist" (note 603).
const workName = goal => RETRY_STEPS.has(goal.step?.action) && goal.lastStruggleStep?.action ? goal.lastStruggleStep.action : goal.step?.action;
function flipWatch(bot, goal, now = Date.now()) {
  const stalls = bot._stalls ||= { records: {}, marks: [] };
  const here = bot.entity?.position;
  if (!here || !goal) return null;
  // The work step and the survival layer's action each kept apart: a recent
  // survival action names what the bot is doing (actionOf), and would hide
  // a step flipping under it. mid-110-e left its shelter and dug in again
  // every two seconds for twenty seconds before it opened the pocket to a
  // creeper.
  const recent = goal.survivalAction?.action && now - Date.parse(goal.survivalAction.at || 0) < 8000 ? goal.survivalAction.action : null;
  for (const [layer, a] of [['work', workName(goal)], ['survival', recent]]) {
    if (!a) continue;
    const changes = (stalls.changes ||= {})[layer] ||= [];
    if (changes.at(-1)?.a !== a) changes.push({ a, t: now, p: here.clone ? here.clone() : { ...here }, worth: worth(bot), blocks: stalls.marked || 0, count: goal.step?.count, countKey: countKey(goal.step) });
    while (changes.length > FLIP_CHANGES) changes.shift();
    if (changes.length < FLIP_CHANGES) continue;
    const first = changes[0], names = new Set(changes.map(c => c.a));
    const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    if (names.size !== 2 || now - first.t > FLIP_MS) continue;
    // Two fight moves trading places (a fight and a raised shield) are one fight.
    if ([...names].every(n => HOLDS.has(n) || EMERGENCIES.has(n))) continue;
    if (Math.max(...changes.map(c => dist(c.p, first.p)), dist(here, first.p)) >= 5 || dist(here, first.p) >= 3) continue;
    if (worth(bot) > first.worth) continue;
    // A block dug or placed in a cell not worked lately is getting
    // somewhere, as the stall watch counts it (look): the ladder names the
    // rung's step each pass and the step under it names its own, and
    // mid-244-bd's staircase to its frame, a new step dug every few seconds,
    // was raised three times as "turning between tunnel and enter nether",
    // each answered by a detour that dropped the shaft (note 603). A block
    // put back where one was dug (markCell) is not.
    if ((stalls.marked || 0) > (first.blocks || 0)) continue;
    // The step's own count going down is progress, filler or not (the
    // audit's rule too): a mine for cobblestone and its pickups trade names.
    if (Number.isFinite(goal.step?.count) && changes.some(c => c.countKey === countKey(goal.step) && Number.isFinite(c.count) && goal.step.count < c.count)) continue;
    const pair = [...names].map(n => n.replaceAll('_', ' ')).join(' and ');
    // The work's flip is the work's: a stance answered a few seconds before
    // (actionOf's recent survival action) is not what traded the turn.
    // mid-242-ae-nether-3-fortress-3's legs and their crossings, each ending
    // at once, were struck as "survival:keep_working" and the keep-working
    // stance set aside for it (note 603).
    const action = layer === 'work' ? actionOf({ ...goal, survivalAction: null }, now) : actionOf(goal, now);
    const record = stalls.records[action.key] ||= { key: action.key, blocks: {}, items: {}, idle: 0, strikes: [], seenAt: now };
    stalls.changes = {};
    const why = `turning between ${pair} ${FLIP_CHANGES - 1} times in ${Math.round((now - first.t) / 1000)} seconds without getting anywhere`;
    // Both sides of a survival flip rest, not only the one in hand: the one
    // in hand may be reported where no refusal is looked at (the way back
    // to the surface is set by the work step's climb), and mid-235-b's
    // return to the surface and sealed shelter traded turns through eight
    // strikes (2026-09-26).
    if (layer === 'survival') { const { setAside } = require('./progress'); for (const n of names) if (!EMERGENCIES.has(n)) setAside(goal, 'flip', `survival:${n}`, why, FLIP_REST_MS); }
    if (layer === 'work') flipFailed(bot, goal, action, why, now);
    return raise(bot, goal, { record, action }, now, why);
  }
  return null;
}
// Two steps trading the turn are one failure of the work, and the ledger
// has it as a step's failure is had (work.js persist, note 571): written as
// the step's, and the answer the work was carrying out marked come to
// nothing with the flip said, owed to its question (tried.escalate), so it
// rests at the second as any way does and a hold on it that reads what is
// owed ends (netherLeaveHeld). The flip is still the stall's, raised below
// as before, for the work's own answers. mid-242-ae-nether-3-fortress-3 set
// the rods aside at the rung's question and took them up again at
// leave_nether's search_on a second later, four times in a second,
// "turning between find fortress and rods waiting", and search_on was
// offered each time as untried; mid-243-af-fortress-1 and mid-243-ag-
// fortress-3 held leave_nether's go_back while the staircase back and the
// crossing traded the turn in the same three cells (note 603).
function flipFailed(bot, goal, action, why, now = Date.now()) {
  try {
    const tried = require('./tried');
    const failed = RETRY_STEPS.has(goal.step?.action) && goal.lastStruggleStep ? goal.lastStruggleStep : goal.step;
    tried.record(bot, goal, { q: 'step', method: failed?.action || 'none', outcome: 'blocked', why, now });
    const owner = tried.owner(goal, { now, work: action.key, skip: new Set(['stillness_detour', 'rung_progress']) });
    if (!owner) return null;
    const what = `the work was ${why}`;
    const up = tried.escalate(goal, { from: 'step', to: owner.q, why: what, parentOf: require('./decisions').parentOf, here: bot.entity?.position, now });
    tried.markBlocked(owner, what, now);
    return up;
  } catch (_) { return null; }
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
  const phase = goal?.rungTime?.phase || goal?.gameProgress?.phase;
  require('./game-progress').tallyClock(goal, doing && doing === goal?.step?.action && phase ? `${phase}: ${doing}` : doing || 'between steps', now);
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
  // A claim that outranks the turn's holder (arbiter.js watch): held until
  // the arbiter picks it up, with no clock. Here, on the task's stall check,
  // because nested steps set their own interruptCheck and lose the caller's.
  if (bot._preempt) throw preempted(bot._preempt);
  if (bot._threatAbort) {
    const { NeedsSafety, threats } = require('./danger');
    let near = null; try { near = threats(bot, 16)[0]; } catch (_) { /* no entities yet */ }
    throw new NeedsSafety(near || { entity: { name: 'something unseen' }, distance: 0 });
  }
  const stall = bot._stalls?.stall; if (stall) throw new Stalled(stall);
}
// NeedsSafety, which every rethrow list already passes up, saying what
// took the turn.
function preempted(p) {
  const { NeedsSafety } = require('./danger');
  const err = new NeedsSafety({ entity: { name: p.by }, distance: 0 });
  err.message = `Preempted by ${p.by}: ${p.why}`; err.preempted = p;
  return err;
}
// The loop takes the stall to answer it; nothing throws it again after.
function takeStall(bot) { const stall = bot._stalls?.stall; if (stall) delete bot._stalls.stall; return stall || null; }
// The survival layer asks before it starts an action: one that stalled is
// refused for a while, and the layer falls through to its next answer.
function refused(holder, key, now = Date.now()) { return require('./progress').isSetAside(holder, 'act', key, now); }
function flipped(holder, key, now = Date.now()) { return require('./progress').isSetAside(holder, 'flip', key, now); }

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

module.exports = { flipped, flipWatch, noteTrail, recentPositions, airWatch, STALL_MS, STILL_MS, GROUND, HOLDS, EMERGENCIES, RESULTS, excused, FILLER, permittedWait, waitEnds, actionOf, stillReason, look, watchStalls, unwatchStalls, raise, raiseFor, worth,
  Stalled, checkStall, preempted, takeStall, refused, recordStill };
