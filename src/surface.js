'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { surveyRoute, navigate, cheapestTool } = require('./skills');
const { safeFromHostiles } = require('./danger');
const { tunnelStep, staircaseResting, natural } = require('./tunneling');
const { pillarUp, SCAFFOLD } = require('./pillar-recovery');
const { dryPassable, dryLeaf, dryBodySpace, supportCell, swimmableWater } = require('./terrain');

// Inspect loaded columns, ignoring tree canopies but not terrain, roofs or
// water. Two clear cave blocks are not evidence of a surface destination.
function surfaceObserver(bot) {
  const heights = new Map();
  const minimum = bot.game.minY ?? -64;
  const maximum = minimum + (bot.game.height ?? 384);
  return point => {
    const x = Math.floor(point.x), z = Math.floor(point.z), key = `${x},${z}`;
    if (!heights.has(key)) {
      let top = minimum - 1;
      for (let y = maximum - 1; y >= minimum; y--) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) { top = Infinity; break; }
        if (/_leaves$|_log$|_wood$/.test(block.name)) continue;
        if (block.boundingBox === 'block' || swimmableWater(block) || ['lava', 'bubble_column', 'powder_snow'].includes(block.name)) { top = y; break; }
      }
      heights.set(key, top);
    }
    return point.y > heights.get(key);
  };
}

// How many blocks up to open sky over a point's column (canopies ignored,
// as above): 0 on the surface, null where the column is not loaded. Said
// with the choices that mean a climb out (the decision audit, 2026-09-25):
// the midgame trials spent 84 of 220 minutes climbing out of the mine.
function climbToSurface(bot, point) {
  const minimum = bot.game?.minY ?? -64, maximum = minimum + (bot.game?.height ?? 384);
  const x = Math.floor(point.x), z = Math.floor(point.z);
  for (let y = maximum - 1; y >= minimum; y--) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block) return null;
    if (/_leaves$|_log$|_wood$/.test(block.name)) continue;
    if (block.boundingBox === 'block' || swimmableWater(block) || ['lava', 'bubble_column', 'powder_snow'].includes(block.name)) return Math.max(0, y + 1 - Math.floor(point.y));
  }
  return 0;
}
// A climb out by staircase, roughly: two blocks dug and a step for each
// block up, some three seconds a block with a stone pickaxe.
const climbMinutes = blocks => Math.max(1, Math.round(blocks * 3 / 60));

// What a climb costs, in digs and seconds, with what is carried. A stair up
// digs three blocks (the one over the head, and the two it steps into) and
// a stair across two; a climb straight up digs only the block over the head
// and puts one under the feet. mid-72-b's staircases ran three seconds a
// stair with a pickaxe and twenty-two to twenty-four by hand, which is these
// figures: seven and a half seconds a block of stone by hand, a little over
// a second a stair for the walking. Three digs a block of height also wore
// the pickaxes out on the way up: two of mid-72-b's climbs went on by hand
// from y 65 and y 58 after the last pickaxe broke on them (2026-09-26).
const STAIR_STEP_SECONDS = 1.2, PILLAR_RISE_SECONDS = 1, HAND_STONE_SECONDS = 7.5, PICKAXE_STONE_SECONDS = 0.6;
const falls = block => ['sand', 'red_sand', 'gravel'].includes(block?.name) || /_concrete_powder$/.test(block?.name || '');
const liquid = block => /^(water|lava|bubble_column|flowing_water|flowing_lava)$/.test(block?.name || '') || [true, 'true'].includes(block?.getProperties?.().waterlogged);
const AROUND = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
// A block a climb straight up may dig: ground as the world makes it, and
// nothing that falls on the head once the block under it is gone.
const climbable = block => natural.test(block.name) && !falls(block) && block.diggable !== false;

function pickaxesCarried(bot) {
  return bot.inventory?.items?.().filter(i => /_pickaxe$/.test(i.name)).map(i => {
    const maximum = bot.registry?.itemsByName?.[i.name]?.maxDurability;
    return { name: i.name, usesLeft: maximum ? Math.max(0, maximum - (i.durabilityUsed || 0)) : null };
  }) || [];
}
// Seconds to dig a block with the tool the dig would take, and whether that
// wears a pickaxe. Blocks without the game's dig times (a test's) count as
// stone.
function digSeconds(bot, block) {
  if (typeof block?.digTime === 'function') {
    const tool = cheapestTool(bot, block);
    return { seconds: block.digTime(tool?.type ?? null, false, false, false, [], {}) / 1000, hand: block.digTime(null, false, false, false, [], {}) / 1000, wears: !!tool && /_pickaxe$/.test(tool.name) };
  }
  const pick = pickaxesCarried(bot).some(p => p.usesLeft !== 0);
  return { seconds: pick ? PICKAXE_STONE_SECONDS : HAND_STONE_SECONDS, hand: HAND_STONE_SECONDS, wears: pick };
}
// The same climb straight up the column: one block dug a block of height.
const climbStraightMinutes = (blocks, { pickaxe = false } = {}) =>
  Math.max(1, Math.round(blocks * ((pickaxe ? PICKAXE_STONE_SECONDS : HAND_STONE_SECONDS) + PILLAR_RISE_SECONDS) / 60));
// Digs that wear a pickaxe go by hand once its uses run out.
function digTime(digs, cost, usesLeft) {
  const worn = cost.wears ? Math.min(digs, usesLeft ?? digs) : digs;
  return worn * cost.seconds + (digs - worn) * cost.hand;
}

// The column over the bot's head, looked over for a climb straight up to
// open sky: every block in it dug from below, a block put under the feet at
// each step up. Null when the bot is not under cover; otherwise the height,
// the blocks to dig, or why the column cannot be climbed.
function straightUpColumn(bot, origin = bot.entity.position.floored()) {
  const up = climbToSurface(bot, origin);
  if (!up) return null;
  const top = origin.y + up, cells = [];
  for (let y = origin.y + 1; y <= top + 1; y++) {
    const c = new Vec3(origin.x, y, origin.z), block = bot.blockAt(c);
    if (!block) return { up, blocked: 'not all of it is loaded' };
    if (liquid(block) || AROUND.some(d => liquid(bot.blockAt(c.plus(d))))) return { up, blocked: 'water or lava in or beside it' };
    if (falls(block)) return { up, blocked: `${block.name.replaceAll('_', ' ')} in it would fall on the head` };
    if (dryPassable(block)) continue;
    if (y === origin.y + 1 || !climbable(block)) return { up, blocked: `${block.name.replaceAll('_', ' ')} in the way` };
    cells.push(block);
  }
  return { up, top, cells };
}

// The two ways out by digging, each with what it costs and leaves, for Jev.
function climbOptions(bot, target, column, { landing = false } = {}) {
  const feet = bot.entity.position.floored(), picks = pickaxesCarried(bot);
  const usesLeft = picks.reduce((n, p) => n + (p.usesLeft ?? 64), 0);
  const tools = picks.length ? picks.map(p => `${p.name.replaceAll('_', ' ')}${p.usesLeft != null ? ` (${p.usesLeft} uses left)` : ''}`).join(', ') : 'no pickaxe';
  const duration = s => s < 90 ? `about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : `about ${Math.round(s / 60)} minutes`;
  const wearNote = (digs, wearing) => wearing && digs > usesLeft ? ` That is more digs than the ${usesLeft} uses the pickaxes have left: the rest by hand.` : '';
  const options = {}, estimate = {};

  // The staircase: to the landing it heads for, or, with none seen, up by
  // the height of open sky over here.
  const ground = bot.blockAt(feet.offset(0, -1, 0));
  const stone = digSeconds(bot, ground?.boundingBox === 'block' && natural.test(ground.name) ? ground : null);
  const rises = Math.max(1, landing ? target.y - feet.y : climbToSurface(bot, feet) || target.y - feet.y);
  const across = landing ? Math.abs(target.x - feet.x) + Math.abs(target.z - feet.z) : rises;
  const level = Math.max(0, across - rises), stairDigs = 3 * rises + 2 * level;
  estimate.staircase = digTime(stairDigs, stone, usesLeft) + (rises + level) * STAIR_STEP_SECONDS;
  const toward = landing ? `to the open ground seen at ${target.x}, ${target.y}, ${target.z}, ${rises} up and ${across} across` : `up toward open sky, about ${rises} blocks up (no open ground seen within reach to head for)`;
  options.staircase = { description: `Dig a staircase ${toward}: about ${stairDigs} blocks dug, three for each block of height and two for each stair across, and ${rises + level} stairs walked; ${duration(estimate.staircase)} with ${picks.length ? 'the pickaxe' : 'bare hands'}.${wearNote(stairDigs, stone.wears)} The stairs stay open behind: a walk back down to this mine later.` };

  if (column?.cells) {
    const scaffold = bot.inventory?.items?.().filter(i => SCAFFOLD.includes(i.name)).reduce((n, i) => n + i.count, 0) || 0;
    const wearing = column.cells.filter(b => digSeconds(bot, b).wears).length;
    let left = usesLeft, seconds = column.up * PILLAR_RISE_SECONDS;
    for (const block of column.cells) { const cost = digSeconds(bot, block); seconds += !cost.wears ? cost.seconds : left > 0 ? (left--, cost.seconds) : cost.hand; }
    const kinds = [...new Set(column.cells.map(b => b.name.replaceAll('_', ' ')))].slice(0, 4).join(', ');
    if (scaffold < column.up) column = { ...column, blocked: `${scaffold} building blocks carried for the ${column.up} steps up` };
    else {
      estimate.straight_up = seconds;
      options.straight_up = { description: `Dig straight up this column to open sky: ${column.up} blocks up, ${column.cells.length} blocks to dig${kinds ? ` (${kinds})` : ''}, a block put under the feet at each of the ${column.up} steps (${scaffold} building blocks carried); ${duration(seconds)} with ${picks.length ? 'the pickaxe' : 'bare hands'}.${wearNote(wearing, wearing > 0)} Nothing that falls or flows is in or beside the column. The column is filled behind with the blocks put down: no way back down is left.` };
    }
  }
  const state = { blocksToOpenSky: climbToSurface(bot, feet), pickaxes: tools, pickaxeUsesLeft: usesLeft,
    ...(column?.blocked ? { straightUpBlocked: column.blocked } : {}) };
  return { options, estimate, state };
}

function surfaceMovement(bot) {
  const movements = bot.pathfinder.movements;
  const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers,
    allowSprinting: movements.allowSprinting, scafoldingBlocks: movements.scafoldingBlocks,
    allowedPosition: movements.allowedPosition, exclusionAreasBreak: movements.exclusionAreasBreak };
  const isSurface = surfaceObserver(bot);
  const start = bot.entity.position.floored();
  // Permit leaving a house or a tree's immediate cover without allowing a
  // downhill cave route. Every subsequent surface step remains constrained.
  const surfaceSwimming = p => {
    const feet = new Vec3(p.x, p.y, p.z), head = feet.offset(0, 1, 0);
    return swimmableWater(bot.blockAt(feet)) && dryPassable(bot.blockAt(head)) && isSurface(head);
  };
  // A river's upper water cell is a surface route when the head remains in
  // open air. Requiring the feet to be above the water stranded explorers on
  // riverbanks even when the pathfinder had a safe swimming route across.
  const allowed = p => isSurface(p) || surfaceSwimming(p) ||
    (Math.abs(p.x - start.x) <= 4 && Math.abs(p.z - start.z) <= 4 && p.y >= start.y);
  // Carried scaffolding can bridge a gap, but searching for trees must not
  // build vertical pillars that strand the bot above the available ground.
  // Clear leaf body-space when a canopy blocks an otherwise supported route.
  // Trunks, terrain and buildings still cannot be excavated by surface travel;
  // stricter inherited no-dig and construction restrictions remain in force.
  // Leaving where the bot stands is always allowed: from the foot of a pit
  // it dug itself, sheer walls and no towers left no route at all, and the
  // first fresh-world trial stood at the bottom of one for a minute and a
  // half walking at a sheep (2026-09-24). From a pit, a pillar and digging
  // within the start's own box are allowed; out on the surface the walk
  // keeps to it.
  // Sunk: walled in at head height on three sides or four, the foot of a
  // pit or a shaft (open sky above it is still a pit; a roofed house with
  // room around the bot is not).
  const sunk = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => bot.blockAt(start.offset(dx, 1, dz))?.boundingBox === 'block').length >= 3;
  const nearStart = q => Math.abs(q.x - start.x) <= 4 && Math.abs(q.z - start.z) <= 4 && q.y >= start.y - 1;
  Object.assign(movements, { canDig: previous.canDig === true, allowSprinting: false, allow1by1towers: sunk && previous.allow1by1towers !== false,
    exclusionAreasBreak: [...(previous.exclusionAreasBreak || []), block => dryLeaf(block) || (sunk && block.position && nearStart(block.position)) ? 0 : 100],
    allowedPosition: p => allowed(p) && (!previous.allowedPosition || previous.allowedPosition(p)) });
  return { isSurface, allowed, restore: () => Object.assign(movements, previous) };
}

// Tree supports are useful intermediate landings, even when ordinary ground
// is too far below. Each successful step loses height; no shaft digging,
// invented landing or scaffold construction is needed for this recovery.
async function descendCanopy(bot, task, goal, save, { move = navigate } = {}) {
  task.check();
  const start = bot.entity.position.clone(), footing = bot.blockAt(supportCell(start));
  const tree = b => b?.boundingBox === 'block' && (dryLeaf(b) || /_log$/.test(b.name));
  if (bot.entity.onGround === false || !tree(footing) || !dryBodySpace(bot, start)) return false;
  const movement = bot.pathfinder.movements, policy = surfaceMovement(bot);
  const previous = { scafoldingBlocks: movement.scafoldingBlocks, allowParkour: movement.allowParkour };
  const inherited = movement.allowedPosition;
  const allowed = p => p.y >= start.y - 3 && p.y <= start.y + 1 &&
    Math.hypot(p.x - start.x, p.z - start.z) <= 8 && inherited(p);
  Object.assign(movement, { scafoldingBlocks: [], allowParkour: false, allowedPosition: allowed });
  const clearableLeaf = b => dryLeaf(b) && movement.canDig === true && !movement.blocksCantBreak?.has(b.type) &&
    (movement.exclusionAreasBreak || []).reduce((cost, rule) => cost + rule(b), 0) < 100;
  const landingSafe = (p, allowClearing = false) => p.y < start.y - .5 && allowed(p) && tree(bot.blockAt(p.offset(0, -1, 0))) &&
    (dryBodySpace(bot, p) || allowClearing && [p, p.offset(0, 1, 0)].every(q => {
      const block = bot.blockAt(q); return dryPassable(block) || clearableLeaf(block);
    })) && safeFromHostiles(bot, p.offset(.5, 0, .5));
  try {
    const ids = bot.registry.blocksArray.filter(b => /_leaves$|_log$/.test(b.name)).map(b => b.id);
    const candidates = bot.findBlocks({ matching: ids, maxDistance: 8, count: 48,
      // A thick crown can hide the only lower trunk behind two leaf blocks.
      // Survey that clearance; requiring air here discarded it before routing.
      useExtraInfo: b => landingSafe(b.position.offset(0, 1, 0), true),
    }).map(p => p.offset(0, 1, 0)).sort((a, b) => a.distanceTo(start) - b.distanceTo(start));
    for (const p of candidates.slice(0, 8)) {
      task.check();
      const destination = new goals.GoalBlock(p.x, p.y, p.z);
      const route = await surveyRoute(bot, task, movement, destination, 300);
      const breaks = (route.path || []).flatMap(q => q.toBreak || []);
      if (route.status !== 'success' || (route.path || []).length > 16 ||
          new Set(breaks.map(b => `${b.x},${b.y},${b.z}`)).size > 8 ||
          !(route.path || []).every(q => allowed(q) && !q.toPlace?.length &&
            (q.toBreak || []).every(b => clearableLeaf(bot.blockAt(new Vec3(b.x, b.y, b.z))))) || !landingSafe(p, true)) continue;
      task.check();
      goal.step = { action: 'descend_canopy', from: { ...start }, destination: { ...p } }; save();
      await move(bot, task, destination, { timeoutMs: 12000, stallMs: 4000 });
      task.check();
      if (!landingSafe(p) || !dryBodySpace(bot, bot.entity.position) || bot.entity.onGround === false ||
          !bot.entity.position.floored().equals(p)) throw new Error('Canopy descent did not reach the inspected landing');
      goal.step.landed = { ...bot.entity.position }; save(); return true;
    }
    return false;
  } finally {
    policy.restore();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete movement[key]; else movement[key] = value;
  }
}

// Open sky is not an exit from a ravine. After ordinary surface routes fail,
// retain a nearby observed higher landing as the minimum escape elevation.
// This is only proposed from actual dry surface candidates, never a guessed Y.
function beginSurfaceAscent(bot, goal, candidates) {
  const start = bot.entity.position;
  const target = candidates.filter(p => p.y >= start.y + 4 && p.y <= start.y + 32 &&
    Math.hypot(p.x - start.x, p.z - start.z) <= 24 && safeFromHostiles(bot, p))
    .sort((a, b) => a.y - b.y || a.distanceTo(start) - b.distanceTo(start))[0];
  if (!target) return false;
  goal.surfaceReturn ||= { attempts: 0, visited: {} };
  Object.assign(goal.surfaceReturn, { minimumY: target.y, target: { ...target }, reason: 'No progress through surface routes below observed higher ground' });
  return true;
}

// The Nether and the End have no surface to return to: a bedrock roof is
// not sky, and the dream run spent its first Nether minutes digging up
// toward it for a food search. Off the Overworld, anywhere is the surface.
const hasSurface = bot => /overworld/.test(String(bot.game?.dimension || 'overworld'));

function surfaceReturnComplete(bot, goal, isSurface = surfaceObserver(bot)) {
  if (!hasSurface(bot)) return true;
  return isSurface(bot.entity.position) && bot.entity.position.y >= (goal.surfaceReturn?.minimumY ?? -Infinity);
}

// Gathering stone or cooking can leave us under terrain. Surface-only travel
// intentionally cannot leave a deep alcove, so first route to an inspected
// surface landing using ordinary mining/scaffolding capabilities. Keep the
// lower bound local to prevent this recovery from becoming a deeper cave trip.
async function returnToSurface(bot, task, goal, save, actions = {}) {
  if (!hasSurface(bot)) { delete goal.surfaceReturn; save(); return; }
  const isSurface = surfaceObserver(bot), start = bot.entity.position.floored();
  if (surfaceReturnComplete(bot, goal, isSurface)) { if (goal.surfaceReturn) { delete goal.surfaceReturn; save(); } return; }
  const movements = bot.pathfinder.movements, previous = movements.allowedPosition;
  const ordinary = { canDig: movements.canDig, scafoldingBlocks: movements.scafoldingBlocks, allow1by1towers: movements.allow1by1towers };
  // First try existing exits without spending the very ingredients needed to
  // replace a tool. Explicit staircase recovery owns any necessary excavation.
  // A pillar of dirt or other stone that makes no tool is an existing exit
  // too: trial 32's bot wandered under a beach for minutes, beside the shaft
  // it had come down by, open to the sky, with dirt in its pockets.
  const TOOL_STONE = new Set(['cobblestone', 'cobbled_deepslate', 'blackstone'].map(n => bot.registry?.itemsByName?.[n]?.id));
  Object.assign(movements, { canDig: false, scafoldingBlocks: (ordinary.scafoldingBlocks || []).filter(id => !TOOL_STONE.has(id)), allow1by1towers: true });
  movements.allowedPosition = p => p.y >= start.y - 3 && (!previous || previous(p));
  const state = goal.surfaceReturn ||= { attempts: 0, visited: {} };
  try {
    task.check();
    // A spent budget is a reason to start the search over with a clean map
    // of visited cells, not a reason to stop: the bot is still underground.
    if (++state.attempts > 192) {
      goal.surfaceReturn = { attempts: 0, visited: {}, byHand: state.byHand, rounds: (state.rounds || 0) + 1 };
      save();
      throw new Error(`Could not return to the surface after 192 recovery steps; starting round ${goal.surfaceReturn.rounds + 1} of the search`);
    }
    const lid = actions.dig ? lidExit(bot) : [];
    if (lid.length) {
      goal.survivalAction = { action: 'return_to_surface', from: { ...start }, lid: lid.map(p => ({ ...p })), at: new Date().toISOString() }; save();
      for (const p of lid) { task.check(); await actions.dig(bot, task, p, { requireDrops: false }); }
      if (surfaceReturnComplete(bot, goal, surfaceObserver(bot))) { delete goal.surfaceReturn; save(); }
      return;
    }
    const clear = p => dryPassable(bot.blockAt(p));
    const candidates = bot.findBlocks({ matching: ['grass_block', 'dirt', 'stone', 'sand', 'gravel', 'deepslate'].map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined),
      maxDistance: 48, count: 128, useExtraInfo: block => {
        const p = block.position.offset(0, 1, 0);
        return p.y >= Math.max(start.y - 3, state.minimumY ?? -Infinity) && clear(p) && clear(p.offset(0, 1, 0)) && isSurface(p) && safeFromHostiles(bot, p);
      },
    }).map(p => p.offset(0, 1, 0));
    const key = p => `${Math.floor(p.x / 4)},${Math.floor(p.y / 4)},${Math.floor(p.z / 4)}`;
    candidates.sort((a, b) => a.distanceTo(start) + (state.visited[key(a)] || 0) * 16 - b.distanceTo(start) - (state.visited[key(b)] || 0) * 16);
    const checked = new Set();
    // Retry complete exit routes periodically as the staircase opens up.
    // Repeating twelve expensive searches at every one-block step stalls work.
    // A staircase call that did not move the bot re-reads the routes too.
    // A climb straight up the column has none to find on the way: they were
    // read when it began, and are read again if the column stops rising.
    const climbing = state.climb?.method === 'straight_up';
    for (const target of (!state.ascent && !climbing) || state.ascent?.steps % 8 === 0 || state.still ? candidates : []) {
      if (checked.has(key(target))) continue;
      checked.add(key(target));
      if (checked.size > 12) break;
      const destination = new goals.GoalBlock(target.x, target.y, target.z);
      const route = await surveyRoute(bot, task, movements, destination, 700);
      if (route.status !== 'success') continue;
      state.visited[key(target)] = (state.visited[key(target)] || 0) + 1;
      goal.survivalAction = { action: 'return_to_surface', from: { ...start }, target: { ...target }, at: new Date().toISOString() };
      save();
      await (actions.navigate || navigate)(bot, task, destination, { timeoutMs: 20000, stallMs: 5000 });
      if (!surfaceReturnComplete(bot, goal)) throw new Error('Surface destination changed while returning from underground');
      delete goal.surfaceReturn; save();
      return;
    }
    if (actions.dig) {
      Object.assign(movements, ordinary);
      if (actions.prepareTool && !await actions.prepareTool()) { save(); return; }
      // A landing whose staircase has been given up is not tried again for a
      // while; with none left, a heading of its own, turned at each give-up.
      const open = candidates.filter(c => !staircaseResting(goal, c.offset(0, Math.max(0, start.y + 1 - c.y), 0)));
      const heading = (state.heading || 0) * Math.PI / 4;
      const target = open[0]?.clone() || (state.target ? new Vec3(state.target.x, state.target.y, state.target.z)
        : start.offset(Math.round(24 * Math.cos(heading)), 32, Math.round(24 * Math.sin(heading))));
      target.y = Math.max(target.y, start.y + 1);
      // Which way to dig out is Jev's: a staircase, or straight up the
      // column overhead, each said with what it costs and leaves.
      const climb = await chooseClimb(bot, task, goal, save, state, target, { landing: !!open[0] });
      if (climb.method === 'straight_up') { await climbStraightUp(bot, task, goal, save, state, climb.column, start, actions); return; }
      state.ascent ||= { entrance: { ...start }, steps: 0, visited: {} };
      // Keep the exit staircase separate from the suspended mining worksite.
      // The copy shares the goal's memory of failed attempts, or a
      // staircase given up is forgotten with the copy.
      goal.attempts ||= {};
      const ascentGoal = { ...goal, tunnel: state.ascent };
      const record = () => {
        goal.step = { ...ascentGoal.step, action: 'ascend_to_surface' };
        goal.survivalAction = { action: 'return_to_surface', from: { ...start }, target: { ...target }, at: new Date().toISOString() };
        save();
      };
      // Stair choices already rise or stay level. Keep the three-block local
      // retreat allowance so an obstructed step can back out along the stairs
      // we just excavated, rather than forbidding its only dry escape.
      // Six stairs a call, as on the way down (work.js tunnelOrSetAside):
      // one a call climbed trial 10's bot a block every six seconds, the step
      // names flipping between the stair and the work that wanted the
      // surface (2026-09-24). A later stair's failure ends the run for now.
      for (let n = 0; n < 6; n++) {
        const before = bot.entity.position.clone();
        try { await tunnelStep(bot, task, ascentGoal, record, target, { dig: actions.dig, navigate: actions.navigate || navigate }); }
        catch (err) {
          if (n > 0 && !['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) break;
          // Higher ground that cannot be reached is not the way out: the
          // ravine rule demanded y 70 of a bot sealed in its own pocket on a
          // hillside at 66, and kept it digging at the hill all day.
          if (err.name === 'StaircaseStalled') { state.heading = ((state.heading || 0) + 1) % 8; delete state.target; delete state.minimumY; state.ascent = { entrance: { ...bot.entity.position.floored() }, steps: 0, visited: {} }; save(); }
          throw err;
        }
        task.check();
        if (surfaceReturnComplete(bot, goal) || bot.entity.position.distanceTo(before) < 0.5) break;
      }
      state.still = bot.entity.position.distanceTo(start.offset(0.5, 0, 0.5)) < 1;
      if (surfaceReturnComplete(bot, goal)) { delete goal.surfaceReturn; save(); }
      return;
    }
    save();
    throw new Error(`No safe route from underground to an observed surface landing (${Math.min(checked.size, 12)} areas checked)`);
  } finally { movements.allowedPosition = previous; Object.assign(movements, ordinary); }
}

// How the climb digs its way: asked when it starts, and again when the
// pickaxes carried change (one wearing out halfway up changes every cost)
// or the column overhead stops being open. Without Jev, the quicker.
async function chooseClimb(bot, task, goal, save, state, target, { landing = false } = {}) {
  const feet = bot.entity.position.floored(), here = `${feet.x},${feet.z}`;
  const tools = pickaxesCarried(bot).map(p => p.name).sort().join(',') || 'hand';
  const column = state.climb?.failedColumn === here ? null : straightUpColumn(bot, feet);
  const kept = state.climb?.method && state.climb.tools === tools && (state.climb.method !== 'straight_up' || column?.cells);
  const offered = state.climb?.offered || [];
  if (kept && !(column?.cells && !offered.includes('straight_up'))) return { method: state.climb.method, column };
  const { options, estimate, state: facts } = climbOptions(bot, target, column, { landing });
  // Asked again only when something new is on offer.
  if (kept && Object.keys(options).every(k => offered.includes(k))) return { method: state.climb.method, column };
  const quicker = Object.keys(estimate).sort((a, b) => estimate[a] - estimate[b])[0];
  const decision = await require('./decisions').decide('climb_out', { client: task.opportunityClient, bot, task, goal, save, tree: options, state: facts, context: { quicker } });
  const method = decision.path.at(-1);
  state.climb = { method, tools, offered: Object.keys(options), ...(state.climb?.failedColumn ? { failedColumn: state.climb.failedColumn } : {}), estimate: Math.round(estimate[method] ?? 0), at: new Date().toISOString() };
  save();
  return { method, column };
}

// Up the column a few blocks a call, as the staircase goes six stairs a
// call. A column that would not rise at all is not offered again here.
async function climbStraightUp(bot, task, goal, save, state, column, start, { dig, pillar = pillarUp }) {
  const feet = bot.entity.position.floored(), before = bot.entity.position.y;
  goal.step = { action: 'ascend_to_surface', method: 'straight_up', from: { ...feet }, top: column.top };
  goal.survivalAction = { action: 'return_to_surface', method: 'straight_up', from: { ...start }, top: column.top, at: new Date().toISOString() };
  save();
  await pillar(bot, task, Math.min(column.top, feet.y + 8), { dig, maxBlocks: 8, threats: false, canDig: climbable });
  delete state.still;
  if (bot.entity.position.y - before < 0.5) state.climb = { ...state.climb, method: null, failedColumn: `${feet.x},${feet.z}` };
  if (surfaceReturnComplete(bot, goal)) delete goal.surfaceReturn;
  save();
}

// Whether the way up from here can be dug without a tool. A shore under a
// two-block gravel lip is "underground" to the surface observer, and the
// second fresh trial died there asking for a pickaxe that needs wood it
// could not reach. Gravel, dirt and sand come away in the hand.
const HAND_DIGGABLE = new Set(['dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol', 'mycelium', 'gravel', 'sand', 'red_sand',
  'clay', 'snow', 'snow_block', 'moss_block', 'mud', 'soul_sand', 'soul_soil', 'leaf_litter']);
function handDiggableExit(bot, { origin = bot.entity.position.floored(), maxHeight = 12 } = {}) {
  const x = origin.x, z = origin.z;
  let solids = 0;
  for (let y = origin.y + 2; y <= origin.y + 2 + maxHeight; y++) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block) return false;
    if (/_leaves$/.test(block.name) || block.boundingBox !== 'block') continue;
    if (!HAND_DIGGABLE.has(block.name)) return false;
    solids++;
  }
  // Nothing solid overhead means the observer's "underground" came from
  // further up than we can see; leave that to the ordinary route search.
  return solids > 0 && surfaceObserver(bot)(new Vec3(x + .5, origin.y + 2 + maxHeight + 1, z + .5));
}

// A night lid. The bot seals itself in at the surface with a few blocks of
// cobblestone, and a lid left behind (or one whose closures were lost with
// a restart) reads as terrain to the surface observer: the bot stands on
// grass, "underground", and searches for a route up that no stair choice
// can dig because cobblestone is not natural stone. The dream run sat
// under one for twenty minutes saying it could not reach a safe spot. A
// thin lid of shelter material with open sky above it is dug straight up.
const LID = new Set(['cobblestone', 'cobbled_deepslate', 'netherrack', 'blackstone', 'dirt', 'oak_planks', 'spruce_planks', 'birch_planks', 'acacia_planks', 'dark_oak_planks', 'jungle_planks', 'mangrove_planks', 'cherry_planks']);
function lidExit(bot, { origin = bot.entity.position.floored(), maxHeight = 3 } = {}) {
  const x = origin.x, z = origin.z, lid = [];
  for (let y = origin.y + 2; y <= origin.y + 2 + maxHeight; y++) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block) return [];
    if (/_leaves$/.test(block.name) || block.boundingBox !== 'block') continue;
    if (!LID.has(block.name)) return [];
    lid.push(new Vec3(x, y, z));
  }
  if (!lid.length || !surfaceObserver(bot)(new Vec3(x + .5, origin.y + 2 + maxHeight + 1, z + .5))) return [];
  return lid;
}

module.exports = { climbToSurface, climbMinutes, climbStraightMinutes, straightUpColumn, climbOptions, lidExit, hasSurface, surfaceObserver, surfaceMovement, descendCanopy, returnToSurface, beginSurfaceAscent, surfaceReturnComplete, handDiggableExit, HAND_DIGGABLE };
