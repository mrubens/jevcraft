'use strict';
// Four more ways a player takes rods at a blaze spawner with a sword, a
// shield and no fire resistance (note 606), beside blaze-stand.js's holes,
// walls and close-in. The fortress cohort of 2026-09-28 died to blazes a
// dozen times; note 602's close-in, priced honestly, still lost the drill of
// four blazes by a live spawner two times in five. Each tactic here is a
// stance the hunt (hunt_target) and the encounter (encounter_stance) offer
// with the game's rules it rests on and what the arena measured of it
// (blaze-stand.js MEASURED); Jev chooses.
//
// The rules, read from the 26.1.2 server jar:
// - Blaze.BlazeAttackGoal: with its target in sight and more than two
//   blocks off a blaze hovers where it is and throws its volleys (it sets no
//   place to go); within two it swings once a second and flies at the
//   target; out of sight it flies toward the target for five ticks and no
//   more, and it gives the target up after three seconds unseen
//   (NearestAttackableTargetGoal's sixty ticks), wandering after that. A
//   blaze does not come round a corner or to a window on its own: only one
//   already within two blocks that sees the bot comes at it.
// - A new target is taken only in sight (NearestAttackableTargetGoal, mustSee).
// - BaseSpawner: while a player is within sixteen, every ten to forty
//   seconds up to four tries at a cell within four blocks across (x and z
//   each (r - r) * 4 + 0.5, so the middle far more often than the edge) and
//   one below to one above the cage, until six blazes are within the
//   spawner's box. A try fails where the blaze does not fit or, for a blaze,
//   where its walk value is under nothing (Monster.getWalkTargetValue, the
//   light test of LevelReader.getPathfindingCostFromLightLevels with the
//   Nether's ambient 0.1): light 12 or more fails it, 11 or less spawns. A
//   round in which every try fails is tried again the next tick, so the
//   cells left dark are where the blazes come, at the same pace: lighting
//   most of them does not slow it; lighting every one stops it.
const { Vec3 } = require('vec3');
const { feetCell } = require('./terrain');
const { goals } = require('mineflayer-pathfinder');
const ce = require('./combat-estimate');
const bunker = require('./bunker');

const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const solid = b => b?.boundingBox === 'block';
const clear = b => !b || b.boundingBox === 'empty';
const liquid = b => /lava|water/.test(b?.name || '');
const round = n => Math.round(n * 10) / 10;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const debug = (...a) => { if (process.env.BLAZE_DEBUG) console.log('[tactic]', ...a); };
const BLOCKS = /^(cobblestone|cobbled_deepslate|netherrack|stone|dirt|blackstone|basalt|andesite|diorite|granite|tuff|deepslate|nether_bricks|end_stone|sandstone|stone_bricks|mossy_cobblestone|polished_blackstone|polished_basalt|gravel|sand|red_sand)$/;
// A block that falls (FallingBlock): a wall of it stands on what is under
// it, and a roof of it over air comes down on the bot. mid-242-ba-fortress-2
// died at 25594 carrying one cobblestone and sixteen gravel.
const FALLS = /^(gravel|sand|red_sand)$/;
const blocksCarried = (bot, { standing = false } = {}) => bot.inventory.items().filter(i => BLOCKS.test(i.name) && !(standing && FALLS.test(i.name))).reduce((n, i) => n + i.count, 0);
// The block for `cell`: one that falls only where solid ground is under it.
const blockItem = (bot, cell = null) => {
  const held = !cell || solid(bot.blockAt(cell.offset(0, -1, 0)));
  return bot.inventory.items().filter(i => BLOCKS.test(i.name) && (held || !FALLS.test(i.name))).sort((a, b) => FALLS.test(a.name) - FALLS.test(b.name) || b.count - a.count)[0] || null;
};
const blazesAbout = (bot, r = ce.RANGE?.blaze || 48) => {
  try { return require('./danger').threats(bot, r).filter(t => t.entity.name === 'blaze'); } catch (_) { return []; }
};

// A line from a blaze's eye to the bot's body, cell by cell, stopped by a
// solid block or by one of `walls` (cells not yet built counted as built);
// a cell in `open` (a window still to be dug) is counted as dug.
function lineThrough(bot, from, to, walls, open = null) {
  const d = to.minus(from), length = d.norm();
  if (length < 1e-6) return true;
  const u = d.scaled(1 / length);
  const c = [Math.floor(from.x), Math.floor(from.y), Math.floor(from.z)], end = to.floored();
  const step = ['x', 'y', 'z'].map(k => Math.sign(u[k]));
  const next = ['x', 'y', 'z'].map((k, i) => step[i] ? ((step[i] > 0 ? c[i] + 1 : c[i]) - from[k]) / u[k] : Infinity);
  const delta = ['x', 'y', 'z'].map((k, i) => step[i] ? Math.abs(1 / u[k]) : Infinity);
  for (let n = 0; n < 256; n++) {
    if (c[0] === end.x && c[1] === end.y && c[2] === end.z) return true;
    const key = `(${c[0]}, ${c[1]}, ${c[2]})`;
    // A block with a shape of its own (a stair, a slab, a fence) stops it
    // only where the line meets that shape (danger.js blocksRay, note 618).
    const at = new Vec3(c[0], c[1], c[2]);
    if (!open?.has(key) && (walls.has(key) || require('./danger').blocksRay(bot.blockAt(at), at, from, u, length))) return false;
    const i = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : (next[1] < next[2] ? 1 : 2);
    if (next[i] > length) return true;
    c[i] += step[i]; next[i] += delta[i];
  }
  return true;
}
const BODY = [1.6, 0.9, 0.15];
const eyeOf = e => e.position.offset(0, (e.height || 1.8) * 0.85, 0);
// The blazes with a line to a cell, `walls` counted as built.
const seeing = (bot, blazes, cell, walls = new Set()) => blazes.filter(e => e.position && BODY.some(dy => lineThrough(bot, eyeOf(e), cell.offset(0.5, dy, 0.5), walls)));

// The cells a walk reaches within `steps`, nearest first; `ok` picks.
function walkCells(bot, { steps = 16, avoid = [] } = {}) {
  const feet = feetCell(bot);
  const near = c => avoid.some(e => e.position && Math.hypot(e.position.x - (c.x + 0.5), e.position.z - (c.z + 0.5)) < 1.5 && Math.abs(e.position.y - c.y) < 2);
  const out = [{ cell: feet, steps: 0 }], seen = new Set([`${feet}`]);
  let ring = [feet];
  for (let n = 1; n <= steps && ring.length; n++) {
    const next = [];
    for (const c of ring) for (const s of SIDES) for (const dy of [0, 1, -1]) {
      const to = c.plus(s).offset(0, dy, 0), key = `${to}`;
      if (seen.has(key)) continue;
      if (dy === 1 && solid(bot.blockAt(c.offset(0, 2, 0)))) continue;
      if (dy === -1 && solid(bot.blockAt(c.plus(s).offset(0, 1, 0)))) continue;
      if (!bunker.standable(bot, to) || near(to)) continue;
      seen.add(key); next.push(to); out.push({ cell: to, steps: n });
    }
    ring = next;
  }
  return out;
}

// A biter come to arm's length that was not there when the run began (a
// wither skeleton by the blazes): the run ends, said why, and the stance is
// asked again with it at hand. mid-208-k-fortress-5's close-in held on
// while one struck it from 15.3 to 5.7, and was asked again only then
// (2026-09-28 13:56:57, note 606).
const ARM = 3;
function bitersAtArm(bot) {
  let near = [];
  try { near = require('./danger').threats(bot, ARM + 1); } catch (_) { return []; }
  const { shooter } = require('./combat');
  return near.filter(t => t.distance <= ARM && t.entity.name !== 'blaze' && !shooter(t.entity));
}
function biterWatch(bot) {
  const known = new Set(bitersAtArm(bot).map(t => t.entity.id));
  return () => {
    const come = bitersAtArm(bot).find(t => !known.has(t.entity.id));
    return come ? `a ${String(come.entity.name).replaceAll('_', ' ')} came to arm's length, ${round(come.distance)} blocks off` : null;
  };
}

// ---- The box with a window --------------------------------------------
// Walled round at feet and head and roofed, one block open at head height
// toward the spawner: the rod farm players build by hand. Only a blaze in
// line with the window sees the bot, and every shot from it comes from in
// front, where the shield faces; no fire lands in the box, and a push meets
// a wall. Within four of the cage the spawner puts its blazes beside it,
// and one that comes within two and sees in flies at the window into the
// sword; the rest hover where they are (the jar's attack goal above).
const BOX_NEAR = [2, 4.5];
function boxPlan(bot, cell, toward) {
  const centre = cell.offset(0.5, 0, 0.5);
  const d = toward ? toward.minus(centre) : new Vec3(1, 0, 0);
  const side = SIDES.slice().sort((a, b) => (b.x * d.x + b.z * d.z) - (a.x * d.x + a.z * d.z))[0];
  const window = cell.plus(side).offset(0, 1, 0);
  // The side toward the blazes first, then the rest, feet before head, and
  // the roof last (it hangs on the head row).
  const order = SIDES.slice().sort((a, b) => (b.x * d.x + b.z * d.z) - (a.x * d.x + a.z * d.z));
  const cells = [];
  for (const s of order) cells.push(cell.plus(s));
  for (const s of order) { const h = cell.plus(s).offset(0, 1, 0); if (!h.equals(window)) cells.push(h); }
  // The roof touches none of the head row (they meet it edge to edge), so a
  // block goes first on the wall at the back, and the roof against that:
  // the drill's first boxes were left without a roof, "no adjacent solid
  // anchor" (2026-09-28).
  const roof = cell.offset(0, 2, 0);
  const holder = solid(bot.blockAt(roof)) ? null : cell.minus(side).offset(0, 2, 0);
  if (holder) cells.push(holder);
  cells.push(roof);
  return { cell, side, window, walls: cells, holder };
}
function boxFits(bot, plan) {
  if (!bunker.standable(bot, plan.cell)) return null;
  const floor = bot.blockAt(plan.cell.offset(0, -1, 0));
  if (!solid(floor) || /magma|netherrack/.test(floor.name) && false) return null;
  const place = [];
  for (const c of plan.walls) {
    const b = bot.blockAt(c);
    if (!b) return null;
    if (solid(b)) continue;
    if (liquid(b) || /fire/.test(b.name) && false) return null;
    // A feet-row cell needs ground under it to be placed on (the bot's own
    // floor is only an edge away from it).
    if (c.y === plan.cell.y && !solid(bot.blockAt(c.offset(0, -1, 0)))) return null;
    place.push(c);
  }
  // Lava beside the box's cells is lava a block away from the bot through
  // any gap: not here.
  for (const c of [plan.cell, plan.cell.offset(0, 1, 0)]) for (const s of SIDES) if (liquid(bot.blockAt(c.plus(s)))) return null;
  const win = bot.blockAt(plan.window);
  const dig = solid(win) ? plan.window : null;
  if (dig && (win.diggable === false || /bedrock|obsidian|spawner/.test(win.name))) return null;
  return { ...plan, place, dig, blocks: place.length };
}
function boxSite(bot, { cage = null, from = null, steps = 16, avoid = [], sightOf = null } = {}) {
  const carried = blocksCarried(bot);
  const centre = cage ? cage.offset(0.5, 0.5, 0.5) : null;
  const fits = [];
  for (const { cell, steps: n } of walkCells(bot, { steps, avoid })) {
    if (centre) {
      const off = Math.hypot(cell.x + 0.5 - centre.x, cell.z + 0.5 - centre.z);
      if (off < BOX_NEAR[0] || off > BOX_NEAR[1] || Math.abs(cell.y - cage.y) > 1) continue;
    } else if (n > BOX_WALK) continue;
    const fit = boxFits(bot, boxPlan(bot, cell, centre || from));
    if (!fit || fit.blocks > carried) continue;
    // Over air (the roof), only a block that does not fall.
    if (fit.place.filter(c => !solid(bot.blockAt(c.offset(0, -1, 0))) && !fit.place.some(q => q.equals(c.offset(0, -1, 0)))).length > blocksCarried(bot, { standing: true })) continue;
    const score = n + fit.blocks * 0.5 + (fit.dig ? 2 : 0);
    fits.push({ ...fit, steps: n, score, cage, off: centre ? round(Math.hypot(cell.x + 0.5 - centre.x, cell.z + 0.5 - centre.z)) : null });
  }
  fits.sort((a, b) => a.score - b.score);
  // A box held for a spawner's blazes is held for those its window sees
  // (note 708): the nearest, with its window's line to the cells round the
  // cage where they come, and (`inLine`) the one of the nearest few whose
  // window sees the most of them, where that is more.
  const spawner = sightOf || cage, best = fits[0] || null;
  if (!spawner || !best) return best;
  let most = null;
  for (const f of fits.slice(0, SIGHT_TRIES)) {
    f.line = windowLine(bot, f, spawner);
    if (!most || f.line.per100 > most.line.per100) most = f;
  }
  return most !== best && most.line.per100 > best.line.per100 ? { ...best, inLine: most } : best;
}
const SIGHT_TRIES = 24;
// Where the spawner's blazes come (spawnCells, weighted by how often each is
// tried) against a cell the bot would hold: of its tries, how many in 100
// put a blaze whose eyes have a line to the bot's body there, `walls`
// counted as built and `open` as dug. A box's window is the only open face
// (windowLine); a stand in the open has no walls (standLine). mid-242-nb
// (25591) held a box 6.4 blocks from the cage at (-108, 77, 155) whose
// window faced a netherrack wall: the 9 blazes the spawner made within 6
// blocks were all out of sight, and "hold it for its next blazes" was
// chosen twice (note 708).
const BLAZE_EYE = 1.53;
function spawnLine(bot, cell, cage, { walls = [], open = [] } = {}) {
  const shut = new Set(walls.map(c => `(${c.x}, ${c.y}, ${c.z})`)), dug = new Set(open.map(c => `(${c.x}, ${c.y}, ${c.z})`));
  const own = new Set([`${cell}`, `${cell.offset(0, 1, 0)}`, ...walls.map(c => `${c}`)]);
  let all = 0, seen = 0, cells = 0, of = 0;
  for (const { cell: c, weight } of spawnCells(bot, cage)) {
    if (own.has(`${c}`)) continue;
    of++; all += weight;
    const eye = c.offset(0.5, BLAZE_EYE, 0.5);
    if (BODY.some(dy => lineThrough(bot, eye, cell.offset(0.5, dy, 0.5), shut, dug))) { seen += weight; cells++; }
  }
  return { cells, of, per100: all ? Math.round(100 * seen / all) : 0 };
}
const windowLine = (bot, site, cage) => spawnLine(bot, site.cell, cage, { walls: site.walls.filter(w => !w.equals(site.window)), open: site.dig ? [site.window] : [] });
const standLine = (bot, cell, cage) => spawnLine(bot, cell, cage);
// In words: what a cell sees of where they come.
const lineWords = l => !l.cells ? 'none of where the spawner\'s blazes come'
  : `where ${l.per100 ? `about ${l.per100}` : 'fewer than 1'} in 100 of the spawner's blazes come`;
// For a box's option.
function windowSays(line) {
  if (!line) return '';
  return ` Its window sees ${lineWords(line)}${line.per100 > 0 ? '' : `: it holds for ${line.cells ? 'hardly any' : 'none'} of them`}.`;
}
// How far the box where the bot stands may be walked to: the nearest ground
// a box fits on (a span over a drop takes none).
const BOX_WALK = 8;
const inBox = (bot, site) => feetCell(bot).equals(site.cell);
const centred = (bot, cell) => inBox(bot, { cell }) && Math.hypot(bot.entity.position.x - cell.x - 0.5, bot.entity.position.z - cell.z - 0.5) < 0.2;
// Crouched to the middle of the cell: the body clear of every side cell, so
// a block can go into each (the game puts none where the body is).
function centre(bot, task, cell) {
  const c = cell.offset(0.5, 0, 0.5);
  return require('./motion').move(bot, task, { label: 'box_centre', keys: ['forward'], sneak: true, why: 'to the middle of the box\'s cell, clear of the cells to be walled', look: c.offset(0, 1.6, 0), maxMs: 1500, tick: 30,
    until: () => Math.hypot(bot.entity.position.x - c.x, bot.entity.position.z - c.z) < 0.15 });
}
// How long the building goes on before the box is given up as not walled.
const BUILD_SECONDS = 12;
const boxWhole = (bot, site) => site.walls.every(c => solid(bot.blockAt(c)));

// A torch-free, block-by-block build from inside, the shield up for each
// volley as it comes (blaze-stand shieldVolley) and the flames at the feet
// put out first.
async function buildBox(bot, task, goal, save, site, { navigate } = {}) {
  const stand = require('./blaze-stand');
  const { place } = require('./work');
  if (!inBox(bot, site)) {
    if (!navigate) throw Object.assign(new Error('no way to walk to the box\'s cell'), { name: 'StanceFailed' });
    const c = site.cell;
    for (let tries = 0; tries < 6 && !inBox(bot, site); tries++) {
      task.check(); bot._threatResponseAt = Date.now();
      if (await stand.putOutFlames(bot, task)) continue;
      if (await stand.shieldVolley(bot, task, { toward: c.offset(0.5, 0, 0.5) })) continue;
      stand.claimBlazes?.(bot);
      try { await navigate(bot, task, new goals.GoalBlock(c.x, c.y, c.z), { timeoutMs: 4000, stallMs: 1500, onFoot: true, sprint: true, stopWhen: () => stand.volleyComing(bot) }); }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; debug('box walk', err.message); }
    }
    if (!inBox(bot, site)) throw Object.assign(new Error(`the walk to the box's cell at (${c.x}, ${c.y}, ${c.z}) did not get there`), { name: 'StanceFailed' });
  }
  goal.step = { action: 'box_in', cell: { ...site.cell }, window: { ...site.window } }; save?.();
  bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
  // Passes over the cells still open, in order: a blaze in a cell holds its
  // block out (the game puts none where a body is), so it is struck if in
  // reach and the cell is tried again next pass; the roof hangs on the head
  // row and waits for it.
  const { occupant } = require('./work');
  const deadline = Date.now() + BUILD_SECONDS * 1000;
  while (Date.now() < deadline) {
    const open = site.walls.filter(c => !solid(bot.blockAt(c)));
    if (!open.length) break;
    let placed = 0;
    for (const c of open) {
      task.check(); bot._threatResponseAt = Date.now();
      if (solid(bot.blockAt(c))) continue;
      // A fireball's push moves the bot off the box's cell, and a block for
      // the cell it was pushed into is refused: back to the middle first.
      if (!centred(bot, site.cell)) { await centre(bot, task, site.cell); if (!inBox(bot, site)) break; }
      if (await stand.putOutFlames(bot, task)) { /* then this cell */ }
      if (await strikeInReach(bot, task)) { /* then this cell */ }
      await stand.shieldVolley(bot, task);
      if (occupant(bot, c)) continue;
      if (!SIDES.concat([new Vec3(0, -1, 0), new Vec3(0, 1, 0)]).some(s => solid(bot.blockAt(c.plus(s))))) continue;
      const item = blockItem(bot, c);
      if (!item) throw Object.assign(new Error(`out of blocks with ${plural(open.length, 'cell')} of the box open`), { name: 'StanceFailed' });
      require('./combat').lowerShield(bot);
      try { await place(bot, task, c, item.name, { stay: true }); placed++; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; debug('box place', `${c}`, err.message, process.env.BLAZE_DEBUG === 'stack' ? err.stack : ''); }
    }
    if (!placed) { await stand.shieldVolley(bot, task); if (!await strikeInReach(bot, task)) await sleep(150); }
  }
  if (site.dig && solid(bot.blockAt(site.window))) await bunker.digCell(bot, task, site.window);
  const open = site.walls.filter(w => !solid(bot.blockAt(w)));
  if (open.length) throw Object.assign(new Error(`the box has ${plural(open.length, 'cell')} it could not wall (${open.map(p => `(${p.x}, ${p.y}, ${p.z})`).join(', ')})`), { name: 'StanceFailed' });
  return true;
}

// A blaze within the sword's reach, struck; true while one is.
async function strikeInReach(bot, task) {
  const { canStrike, strike, lowerShield } = require('./combat');
  const live = e => e && bot.entities[e.id] === e && e.isValid !== false;
  const hurt = bot._struck && Date.now() - bot._struck.at < 4000 ? bot.entities[bot._struck.id] : null;
  // A zombified piglin only once it is angry: a hit on a calm one turns its
  // whole group on the bot. 25592's box struck at whatever was in reach, a
  // calm one 2.9 blocks off among them, and three of them ended it from 20
  // health two seconds later (note 703).
  const { provoked } = require('./danger');
  const reach = Object.values(bot.entities).filter(e => ['blaze', 'wither_skeleton', 'magma_cube', 'zombified_piglin', 'piglin_brute'].includes(e.name) && live(e) && canStrike(bot, e)
    && (e.name !== 'zombified_piglin' || provoked(bot, e)))
    .sort((a, b) => (b === hurt) - (a === hurt) || a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  const target = reach[0];
  if (!target) return false;
  const wait = (ce.SWING_MS?.sword || 625) - (Date.now() - (bot._defenseAttackAt || 0));
  if (wait > 0) { await sleep(Math.min(wait, 120)); return true; }
  lowerShield(bot);
  await bot.lookAt(target.position.offset(0, (target.height || 1.8) * 0.5, 0), true);
  task.check();
  if (live(target) && canStrike(bot, target)) {
    await strike(bot, task, target);
    bot._defenseAttackAt = bot._threatResponseAt = Date.now();
    bot._struck = { id: target.id, at: bot._defenseAttackAt };
  }
  return true;
}

// Rods on the ground near a held stance: walked to between volleys and
// carried, one at a time, while none is close enough for the game's own
// pickup to have taken it already. Shared by every stance that holds one
// spot and would otherwise leave a dead blaze's rod where the fight left it
// (note 710: holdCorner struck what came into reach and never once fetched
// a rod that landed past that reach — the box's fetchRods, below, only ever
// covered the box).
async function fetchNearbyRods(bot, task, { navigate, item = 'blaze_rod', near = 7, origin, open, close } = {}) {
  const stand = require('./blaze-stand');
  const { countOf } = require('./skills');
  const rods = () => Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === item && e.position.distanceTo(origin) < near);
  if (!navigate || !rods().length || stand.volleyComing(bot)) return false;
  if (blazesAbout(bot, 4).length) return false;
  if (open) await open();
  const deadline = Date.now() + 8000;
  try {
    while (Date.now() < deadline && rods().length) {
      task.check(); bot._threatResponseAt = Date.now();
      if (stand.volleyComing(bot)) { await stand.shieldVolley(bot, task); continue; }
      const drop = rods().sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
      const before = countOf(bot, item), d = drop.position.floored();
      try { await navigate(bot, task, new goals.GoalNear(d.x, d.y, d.z, 0.5), { timeoutMs: 3000, stallMs: 1200, onFoot: true, stopWhen: () => countOf(bot, item) > before || bot.entities[drop.id] !== drop || stand.volleyComing(bot) }); }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; break; }
      await sleep(150);
    }
  } finally { if (close) await close(); }
  return true;
}

// The box's own case: the sill under the window dug through to reach what
// is outside, put back once the bot is back inside.
async function fetchRods(bot, task, site, { navigate, item = 'blaze_rod', near = 7 } = {}) {
  const sill = site.window.offset(0, -1, 0);
  return fetchNearbyRods(bot, task, { navigate, item, near, origin: site.cell.offset(0.5, 0, 0.5),
    open: async () => { if (solid(bot.blockAt(sill))) await bunker.digCell(bot, task, sill); },
    close: async () => {
      const c = site.cell;
      if (!inBox(bot, site)) { try { await navigate(bot, task, new goals.GoalBlock(c.x, c.y, c.z), { timeoutMs: 4000, stallMs: 1500, onFoot: true }); } catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; } }
      const blockName = blockItem(bot, sill)?.name;
      if (inBox(bot, site) && blockName && !solid(bot.blockAt(sill))) {
        try { await require('./work').place(bot, task, sill, blockName, { stay: true }); } catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
      }
    } });
}

// The corner's own case: open ground, nothing to dig through and nothing to
// put back, only the walk out to the rod and back to the cell the ambush
// stands at.
async function fetchRodsAtCorner(bot, task, site, { navigate, item = 'blaze_rod', near = 7 } = {}) {
  const c = site.cell;
  return fetchNearbyRods(bot, task, { navigate, item, near, origin: c.offset(0.5, 0, 0.5),
    close: async () => {
      if (feetCell(bot).equals(c)) return;
      try { await navigate(bot, task, new goals.GoalBlock(c.x, c.y, c.z), { timeoutMs: 4000, stallMs: 1500, onFoot: true }); }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
    } });
}

// Holding the box: the flames put out, what is in reach struck, the shield
// up facing each volley and otherwise facing the window, the rods fetched
// once none is within four. Ends after `seconds`, with `want` rods, six
// health gone, or twenty seconds with no blaze seeing in or within eight.
const QUIET_SECONDS = 20;
async function holdBox(bot, task, goal, save, site, { navigate, seconds = 45, item = 'blaze_rod', want = Infinity, stats = {} } = {}) {
  const stand = require('./blaze-stand');
  const { countOf } = require('./skills');
  const { raiseShield, defenseWeapon } = require('./combat');
  const { STANCE_HEALTH } = require('./danger');
  stand.volleyWatch(bot);
  const started = Date.now(), startHealth = bot.health ?? 20;
  let quietFrom = Date.now(), kills = 0;
  const onDeath = e => { if (e?.name === 'blaze' && Date.now() - (bot._struck?.at || 0) < 6000) kills++; };
  bot.on('entityDead', onDeath);
  Object.assign(stats, { seconds: 0, swings: 0, kills: 0, mostInSight: 0, ended: 'time' });
  const face = site.window.offset(0.5, 0.5, 0.5);
  const biter = biterWatch(bot);
  try {
    const sword = defenseWeapon(bot);
    if (sword && bot.heldItem?.name !== sword.name) await bot.equip(sword, 'hand');
    while (Date.now() - started < seconds * 1000) {
      task.check(); bot._threatResponseAt = Date.now();
      if (countOf(bot, item) >= want) { stats.ended = 'rod'; break; }
      if (startHealth - (bot.health ?? 20) >= STANCE_HEALTH) { stats.ended = 'hurt'; break; }
      const came = biter(); if (came) { stats.ended = came; break; }
      const about = blazesAbout(bot, 24).map(t => t.entity);
      const inLine = seeing(bot, about, site.cell);
      stats.mostInSight = Math.max(stats.mostInSight, inLine.length);
      if (inLine.length || about.some(e => e.position.distanceTo(bot.entity.position) <= 8)) quietFrom = Date.now();
      else if (Date.now() - quietFrom > QUIET_SECONDS * 1000) { stats.ended = 'quiet'; break; }
      goal.step = { action: 'hold_box', inLine: inLine.length, about: about.length, kills, health: bot.health, held: Math.round((Date.now() - started) / 1000) }; save?.();
      if (!inBox(bot, site)) { debug('hold: back in'); await require('./bunker').stepTo(bot, task, site.cell); continue; }
      if (await stand.putOutFlames(bot, task)) { debug('hold: flames'); continue; }
      if (await strikeInReach(bot, task)) { stats.swings++; continue; }
      // Behind the window: every shot comes through it (note 623).
      if (await stand.shieldVolley(bot, task, { face })) continue;
      if (await fetchRods(bot, task, site, { navigate, item })) { debug('hold: rods'); continue; }
      // A wall knocked out (a fireball does not break blocks, but the bot's
      // own swing at the window can): put back.
      const gap = site.walls.find(w => !solid(bot.blockAt(w)) && !w.equals(site.window.offset(0, -1, 0)));
      if (gap && blockItem(bot, gap)) { try { await require('./work').place(bot, task, gap, blockItem(bot, gap).name, { stay: true }); } catch (_) { task.check(); } continue; }
      await bot.lookAt(face, true);
      raiseShield(bot);
      await sleep(150);
    }
  } catch (err) { debug('hold: stopped', err.name, err.message); throw err; }
  finally {
    debug('hold: ended', stats.ended, Math.round((Date.now() - started) / 1000), 's');
    bot.removeListener('entityDead', onDeath);
    // Left in the box, the shield stays up facing the window: the next
    // question takes seconds (up to eighteen in the arena, 2026-09-28), and
    // with it lowered the volleys through the window landed whole meanwhile,
    // 11.5 to none in one run.
    if (inBox(bot, site) && boxWhole(bot, site)) { await bot.lookAt(face, true).catch(() => {}); raiseShield(bot); }
    else require('./combat').lowerShield(bot);
    stats.seconds = Math.round((Date.now() - started) / 1000); stats.kills = kills;
  }
  return { kills, ended: stats.ended };
}

// ---- Lighting the spawner ---------------------------------------------
// The spawner's tries (BaseSpawner, above): x and z each the cage's plus
// (r - r) * 4 + 0.5, floored, so an offset k is tried about this often
// (the triangle's mass on [k - 0.5, k + 0.5) / 4), y the cage's -1, 0 or +1.
const SPAWN_RANGE = 4;
const tryWeight = k => {
  const mass = (a, b) => { const f = t => (t < 0 ? (t + 1) ** 2 / 2 : 1 - (1 - t) ** 2 / 2); return f(Math.min(1, Math.max(-1, b))) - f(Math.min(1, Math.max(-1, a))); };
  return mass((k - 0.5) / SPAWN_RANGE, (k + 0.5) / SPAWN_RANGE);
};
const LIT = 12; // light 12 or more stops a blaze (Nether ambient 0.1)
// Where a blaze fits: its 0.6 by 1.8 box in the cell and the one over it,
// neither solid nor liquid.
const fits = (bot, c) => { const a = bot.blockAt(c), b = bot.blockAt(c.offset(0, 1, 0)); return !!a && !!b && !solid(a) && !solid(b) && !liquid(a) && !liquid(b); };
function spawnCells(bot, cage) {
  const out = [];
  for (let dx = -SPAWN_RANGE; dx <= SPAWN_RANGE; dx++) for (let dz = -SPAWN_RANGE; dz <= SPAWN_RANGE; dz++) for (const dy of [-1, 0, 1]) {
    const c = cage.offset(dx, dy, dz);
    if (fits(bot, c)) out.push({ cell: c, weight: tryWeight(dx) * tryWeight(dz) / 3 });
  }
  return out;
}
// Block light by spreading, as the game does: a level less for each step
// through a cell that lets light through (not a full solid block), and the
// cage (it lets light through at one more). `extra` are torches planned.
function lightField(bot, sources, { box }) {
  const light = new Map();
  const inBoxRange = p => p.x >= box[0].x && p.x <= box[1].x && p.y >= box[0].y && p.y <= box[1].y && p.z >= box[0].z && p.z <= box[1].z;
  const queue = [];
  for (const s of sources) { const k = `${s.position}`; if ((light.get(k) || 0) < s.emission) { light.set(k, s.emission); queue.push([s.position, s.emission]); } }
  while (queue.length) {
    const [p, l] = queue.shift();
    if (light.get(`${p}`) > l) continue;
    for (const d of [...SIDES, new Vec3(0, 1, 0), new Vec3(0, -1, 0)]) {
      const q = p.plus(d);
      if (!inBoxRange(q)) continue;
      const b = bot.blockAt(q);
      if (!b) continue;
      const cost = b.name === 'spawner' ? 2 : solid(b) ? Infinity : 1;
      const n = l - cost;
      if (n <= 0 || (light.get(`${q}`) || 0) >= n) continue;
      light.set(`${q}`, n); queue.push([q, n]);
    }
  }
  return light;
}
// Where a torch can go: an open cell with a floor under it, or a solid side
// for a wall torch (the cage's sides and top included).
function torchSpots(bot, cage) {
  const out = [];
  for (let dx = -SPAWN_RANGE - 1; dx <= SPAWN_RANGE + 1; dx++) for (let dz = -SPAWN_RANGE - 1; dz <= SPAWN_RANGE + 1; dz++) for (const dy of [-2, -1, 0, 1, 2]) {
    const c = cage.offset(dx, dy, dz), b = bot.blockAt(c);
    if (!b || solid(b) || liquid(b) || /torch|fire/.test(b.name)) continue;
    const under = bot.blockAt(c.offset(0, -1, 0));
    const floor = solid(under) && !/spawner|magma/.test(under.name) || under?.name === 'spawner';
    const wall = SIDES.find(s => solid(bot.blockAt(c.plus(s))));
    if (floor || wall) out.push({ cell: c, against: floor ? new Vec3(0, -1, 0) : wall });
  }
  return out;
}
function lightPlan(bot, cage, { max = 40 } = {}) {
  if (!cage) return null;
  const box = [cage.offset(-SPAWN_RANGE - 14, -14, -SPAWN_RANGE - 14), cage.offset(SPAWN_RANGE + 14, 14, SPAWN_RANGE + 14)];
  const { lightSources } = require('./torches');
  const existing = lightSources(bot, cage, 16);
  const cells = spawnCells(bot, cage);
  const total = cells.reduce((n, c) => n + c.weight, 0);
  const field = lightField(bot, existing, { box });
  const dark = () => cells.filter(c => (field.get(`${c.cell}`) || 0) < LIT);
  let left = dark();
  const already = cells.length - left.length;
  const spots = torchSpots(bot, cage);
  const torches = [];
  // What each spot's torch lights, spread the game's way (walls stop it);
  // light from several sources is the most of them, not a sum, so the
  // torch lighting the most dark cells is taken again and again.
  const index = new Map(cells.map(c => [`${c.cell}`, c]));
  const lights = spots.map(s => {
    const add = lightField(bot, [{ position: s.cell, emission: 14 }], { box: [s.cell.offset(-3, -3, -3), s.cell.offset(3, 3, 3)] });
    return { spot: s, lit: [...add].filter(([k, v]) => v >= LIT && index.has(k)).map(([k]) => k) };
  });
  const darkKeys = new Set(left.map(c => `${c.cell}`));
  while (darkKeys.size && torches.length < max) {
    let best = null, gain = 0;
    for (const l of lights) { const n = l.lit.filter(k => darkKeys.has(k)).length; if (n > gain) { gain = n; best = l; } }
    if (!best) break;
    torches.push({ ...best.spot, lights: gain });
    for (const k of best.lit) darkKeys.delete(k);
    lights.splice(lights.indexOf(best), 1);
  }
  left = left.filter(c => darkKeys.has(`${c.cell}`));
  const darkWeight = left.reduce((n, c) => n + c.weight, 0);
  return { cage, cells: cells.length, alreadyLit: already, torches, dark: left.map(c => c.cell), darkShare: total ? round(100 * darkWeight / total) / 100 : 0, total };
}
const torchesCarried = bot => bot.inventory.items().filter(i => i.name === 'torch').reduce((n, i) => n + i.count, 0);
const makeable = bot => {
  const coal = bot.inventory.items().filter(i => /^(coal|charcoal)$/.test(i.name)).reduce((n, i) => n + i.count, 0);
  const sticks = bot.inventory.items().filter(i => i.name === 'stick').reduce((n, i) => n + i.count, 0);
  return Math.min(coal, sticks) * 4;
};
async function makeTorches(bot, task, want) {
  const id = bot.registry?.itemsByName?.torch?.id;
  if (id === undefined || typeof bot.recipesFor !== 'function') return 0;
  let made = 0;
  while (torchesCarried(bot) < want) {
    task.check();
    const recipe = bot.recipesFor(id, null, 1, null)?.[0];
    if (!recipe) break;
    const times = Math.max(1, Math.min(Math.ceil((want - torchesCarried(bot)) / 4), makeable(bot) / 4));
    try { await bot.craft(recipe, times, null); made += times * 4; } catch (err) { task.check(); debug('torch craft', err.message); break; }
  }
  return made;
}
async function placeTorch(bot, task, spot) {
  const item = bot.inventory.items().find(i => i.name === 'torch');
  if (!item) return false;
  const ref = bot.blockAt(spot.cell.plus(spot.against));
  if (!solid(ref)) return false;
  await bot.equip(item, 'hand');
  for (let n = 0; n < 10 && bot.heldItem?.name !== 'torch'; n++) await sleep(50);
  if (bot.heldItem?.name !== 'torch') return false;
  task.check();
  const face = spot.against.scaled(-1);
  await bot.lookAt(ref.position.offset(0.5 + face.x * 0.5, 0.5 + face.y * 0.5, 0.5 + face.z * 0.5), true);
  try { await bot.placeBlock(ref, face); } catch (err) { task.check(); debug('torch', `${spot.cell}`, err.message); }
  const deadline = Date.now() + 1200;
  while (Date.now() < deadline && !/torch/.test(bot.blockAt(spot.cell)?.name || '')) { task.check(); await sleep(50); }
  return /torch/.test(bot.blockAt(spot.cell)?.name || '');
}
const REACH = 4.3;
// Torches in the plan's order, each from a cell within reach of it: the
// shield up for each volley, the flames put out, what is in reach struck.
async function lightSpawner(bot, task, goal, save, cage, { navigate, seconds = 60 } = {}) {
  const stand = require('./blaze-stand');
  const started = Date.now();
  let plan = lightPlan(bot, cage);
  if (!plan) return { placed: 0, dark: null };
  await makeTorches(bot, task, Math.min(plan.torches.length, 64));
  let placed = 0, failed = new Set();
  goal.step = { action: 'light_spawner', spawner: { ...cage }, torches: plan.torches.length }; save?.();
  const biter = biterWatch(bot);
  let ended = null;
  while (Date.now() - started < seconds * 1000) {
    task.check(); bot._threatResponseAt = Date.now();
    if ((ended = biter())) break;
    plan = lightPlan(bot, cage);
    const todo = plan.torches.filter(t => !failed.has(`${t.cell}`));
    if (!plan.dark.length && !todo.length) break;
    if (!todo.length || !torchesCarried(bot)) break;
    if (await stand.putOutFlames(bot, task)) continue;
    if (await strikeInReach(bot, task)) continue;
    if (await stand.shieldVolley(bot, task)) continue;
    const eye = () => bot.entity.position.offset(0, 1.62, 0);
    const next = todo.sort((a, b) => a.cell.offset(0.5, 0.5, 0.5).distanceTo(eye()) - b.cell.offset(0.5, 0.5, 0.5).distanceTo(eye()))[0];
    if (next.cell.offset(0.5, 0.5, 0.5).distanceTo(eye()) > REACH) {
      if (!navigate) break;
      stand.claimBlazes?.(bot);
      try { await navigate(bot, task, new goals.GoalNear(next.cell.x, next.cell.y, next.cell.z, 2), { timeoutMs: 3000, stallMs: 1200, onFoot: true, sprint: true, stopWhen: () => stand.volleyComing(bot) || next.cell.offset(0.5, 0.5, 0.5).distanceTo(eye()) <= REACH - 0.5 }); }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
      if (next.cell.offset(0.5, 0.5, 0.5).distanceTo(eye()) > REACH) { failed.add(`${next.cell}`); }
      continue;
    }
    require('./combat').lowerShield(bot);
    if (await placeTorch(bot, task, next)) placed++; else failed.add(`${next.cell}`);
  }
  plan = lightPlan(bot, cage);
  return { placed, dark: plan.cells - plan.alreadyLit, darkShare: plan.darkShare, cells: plan.cells, ended };
}

// ---- The corner ---------------------------------------------------------
// A cell no blaze sees, beside one some blaze does: round the corner of the
// rock. A blaze that loses the bot flies toward it for a quarter second and
// then hovers; it comes round only by wandering once it has given the bot
// up. Held facing the corner, striking what comes within reach.
function cornerSite(bot, blazes, { steps = 10, avoid = [] } = {}) {
  const { knockLands } = require('./blaze-stand');
  let best = null;
  for (const { cell, steps: n } of walkCells(bot, { steps, avoid })) {
    if (seeing(bot, blazes, cell).length) continue;
    if (!knockLands(bot, cell)) continue;
    const edge = SIDES.map(s => cell.plus(s)).find(c => bunker.standable(bot, c) && seeing(bot, blazes, c).length);
    if (!edge) continue;
    const near = Math.min(...blazes.map(e => e.position.distanceTo(cell.offset(0.5, 1, 0.5))));
    const score = n + Math.max(0, near - 6) * 0.5;
    if (!best || score < best.score) best = { cell, edge, steps: n, score, nearest: round(near) };
  }
  return best || builtCorner(bot, blazes);
}
// No rock to go round within reach: a corner made where the bot stands, a
// wall two high and three wide a step toward the blazes' middle, the cell
// beside the bot at its end the edge they would come round.
function builtCorner(bot, blazes) {
  const { knockLands } = require('./blaze-stand');
  const cell = feetCell(bot);
  if (!bunker.standable(bot, cell) || !knockLands(bot, cell) || !blazes.length) return null;
  const mid = blazes.reduce((s, e) => s.plus(e.position), new Vec3(0, 0, 0)).scaled(1 / blazes.length);
  const d = mid.minus(cell.offset(0.5, 0, 0.5));
  const side = SIDES.slice().sort((a, b) => (b.x * d.x + b.z * d.z) - (a.x * d.x + a.z * d.z))[0];
  const across = SIDES.filter(s => s.x * side.x + s.z * side.z === 0);
  const near = Math.min(...blazes.map(e => e.position.distanceTo(cell.offset(0.5, 1, 0.5))));
  // Two wide, toward one side: the bot's line covered and the cell on the
  // other side of it left in their sight, the edge they would come round.
  for (const [cover, open] of [[across[0], across[1]], [across[1], across[0]]]) {
    const wall = [];
    let fits = true;
    for (const c of [cell.plus(side), cell.plus(side).plus(cover)]) for (const dy of [0, 1]) {
      const w = c.offset(0, dy, 0), b = bot.blockAt(w);
      if (!b || liquid(b)) { fits = false; continue; }
      if (!solid(b)) { if (dy === 0 && !solid(bot.blockAt(w.offset(0, -1, 0)))) fits = false; wall.push(w); }
    }
    if (!fits || wall.length > blocksCarried(bot)) continue;
    const walls = new Set(wall.map(c => `${c}`));
    if (seeing(bot, blazes, cell, walls).length) continue;
    const edge = cell.plus(open);
    if (!bunker.standable(bot, edge) || !seeing(bot, blazes, edge, walls).length) continue;
    return { cell, edge, steps: 0, score: 0, nearest: round(near), build: wall };
  }
  return null;
}
async function holdCorner(bot, task, goal, save, site, { navigate, seconds = 30, item = 'blaze_rod', want = Infinity, stats = {} } = {}) {
  const stand = require('./blaze-stand');
  const { countOf } = require('./skills');
  const { raiseShield } = require('./combat');
  const { STANCE_HEALTH } = require('./danger');
  stand.volleyWatch(bot);
  const c = site.cell;
  if (!feetCell(bot).equals(c)) {
    stand.claimBlazes?.(bot);
    try { await navigate(bot, task, new goals.GoalBlock(c.x, c.y, c.z), { timeoutMs: 4000, stallMs: 1500, onFoot: true, sprint: true }); }
    catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
    if (!feetCell(bot).equals(c)) throw Object.assign(new Error(`the walk to the corner at (${c.x}, ${c.y}, ${c.z}) did not get there`), { name: 'StanceFailed' });
  }
  // A corner built where there is none: the wall first, the shield up for
  // each volley between blocks.
  for (const w of site.build || []) {
    task.check(); bot._threatResponseAt = Date.now();
    if (solid(bot.blockAt(w))) continue;
    await stand.putOutFlames(bot, task);
    await stand.shieldVolley(bot, task);
    const item = blockItem(bot, w);
    if (!item || require('./work').occupant(bot, w)) continue;
    require('./combat').lowerShield(bot);
    try { await require('./work').place(bot, task, w, item.name, { stay: true }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; debug('corner place', `${w}`, err.message); }
  }
  const started = Date.now(), startHealth = bot.health ?? 20;
  let kills = 0;
  const onDeath = e => { if (e?.name === 'blaze' && Date.now() - (bot._struck?.at || 0) < 6000) kills++; };
  bot.on('entityDead', onDeath);
  Object.assign(stats, { seconds: 0, swings: 0, kills: 0, came: 0, ended: 'time' });
  goal.step = { action: 'corner_ambush', cell: { ...c } }; save?.();
  const biter = biterWatch(bot);
  try {
    while (Date.now() - started < seconds * 1000) {
      task.check(); bot._threatResponseAt = Date.now();
      if (countOf(bot, item) >= want) { stats.ended = 'rod'; break; }
      if (startHealth - (bot.health ?? 20) >= STANCE_HEALTH) { stats.ended = 'hurt'; break; }
      const came = biter(); if (came) { stats.ended = came; break; }
      if (await stand.putOutFlames(bot, task)) continue;
      if (await strikeInReach(bot, task)) { stats.swings++; continue; }
      if (await stand.shieldVolley(bot, task)) continue;
      if (!feetCell(bot).equals(c)) { await bunker.stepTo(bot, task, c); continue; }
      if (await fetchRodsAtCorner(bot, task, site, { navigate, item })) { debug('corner: rods'); continue; }
      await bot.lookAt(site.edge.offset(0.5, 1.5, 0.5), true);
      raiseShield(bot);
      await sleep(150);
    }
  } finally { bot.removeListener('entityDead', onDeath); require('./combat').lowerShield(bot); stats.seconds = Math.round((Date.now() - started) / 1000); stats.kills = kills; }
  return { kills, ended: stats.ended };
}

// ---- Away to heal -------------------------------------------------------
// Out of every blaze's line, far enough that none within two comes at it,
// then eat and wait for the health: hunger 18 or more heals a point every
// four seconds, and with saturation at full hunger one every half second
// (FoodData). The blazes stay, and a spawner makes more meanwhile.
function healSite(bot, blazes, { steps = 14, avoid = [] } = {}) {
  // A cell whose walk just failed (leaveAndHeal's noteSiteFailed) is not
  // offered again at once: leave_and_heal picked the same unreachable cell
  // twice running on 25591 (mid-242-vd, note 732), each answered "no route"
  // by the pathfinder a second after the option said "walk N blocks to
  // (cell) ... and stay until the health is full" as if it would arrive.
  const { siteFailedNear } = require('./blaze-stand');
  let best = null;
  for (const { cell, steps: n } of walkCells(bot, { steps, avoid })) {
    if (siteFailedNear(bot, cell)) continue;
    if (seeing(bot, blazes, cell).length) continue;
    const near = Math.min(...blazes.map(e => e.position.distanceTo(cell.offset(0.5, 1, 0.5))));
    if (near < 4) continue;
    const score = n - Math.min(near, 12) * 0.4;
    if (!best || score < best.score) best = { cell, steps: n, score, nearest: round(near) };
  }
  return best || walledHeal(bot, blazes);
}
// No rock to go behind within reach: walled in where the bot stands, the
// box with its window shut, and the side toward them opened again once the
// health is back.
function walledHeal(bot, blazes) {
  const cell = feetCell(bot);
  const mid = blazes.reduce((s, e) => s.plus(e.position), new Vec3(0, 0, 0)).scaled(1 / blazes.length);
  const fit = boxFits(bot, boxPlan(bot, cell, mid));
  if (!fit) return null;
  const build = [...fit.walls.slice(0, -1), fit.window, fit.walls.at(-1)].filter(c => !solid(bot.blockAt(c)));
  if (build.length > blocksCarried(bot)) return null;
  const near = Math.min(...blazes.map(e => e.position.distanceTo(cell.offset(0.5, 1, 0.5))));
  // A blaze whose body stands in a cell to be walled, or in the bot's own:
  // no block goes in where a body is, and the box is not shut while it stays.
  // 25589 (mid-242-hd-fortress-2, 23:25:51Z) was told none of 16 blazes had
  // a line to it there, one 1.1 blocks off, and was hit a second later (note 700).
  const { bodyIn } = require('./work');
  const inCells = blazes.filter(e => [...build, cell, cell.offset(0, 1, 0)].some(c => bodyIn(e, c))).length;
  return { cell, steps: 0, score: 0, nearest: round(near), build, open: [fit.window.offset(0, -1, 0), fit.window], ...(inCells ? { inCells } : {}) };
}
// How long a bot with nothing to heal on waits for its fire to burn out.
const FIRE_WAIT_MS = 8000;
async function leaveAndHeal(bot, task, goal, save, site, { navigate, seconds = 60, stats = {} } = {}) {
  const stand = require('./blaze-stand');
  const { chooseFood } = require('./vitals');
  const c = site.cell;
  stand.volleyWatch(bot);
  const started = Date.now();
  Object.assign(stats, { seconds: 0, ate: 0, from: bot.health, to: bot.health, ended: 'time' });
  goal.step = { action: 'leave_and_heal', cell: { ...c } }; save?.();
  for (let tries = 0; tries < 5 && !feetCell(bot).equals(c); tries++) {
    task.check(); bot._threatResponseAt = Date.now();
    if (await stand.putOutFlames(bot, task)) continue;
    if (await stand.shieldVolley(bot, task)) continue;
    try { await navigate(bot, task, new goals.GoalBlock(c.x, c.y, c.z), { timeoutMs: 5000, stallMs: 1500, onFoot: true, sprint: true, stopWhen: () => stand.volleyComing(bot) }); }
    catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
  }
  if (!feetCell(bot).equals(c)) {
    // Remembered against the cell (siteFailedNear, note 732): healSite does
    // not offer this same cell again for a while, the way spawnerSite,
    // wallSite and holeSite already withhold theirs.
    stand.noteSiteFailed(bot, c, 'did not get there');
    throw Object.assign(new Error(`the walk out of their sight to (${c.x}, ${c.y}, ${c.z}) did not get there`), { name: 'StanceFailed' });
  }
  if (site.build?.length) await buildBox(bot, task, goal, save, { cell: c, walls: site.build, window: site.open[1] }, { navigate });
  try {
    const biter = biterWatch(bot), arrived = Date.now();
    while (Date.now() - started < seconds * 1000 && (bot.health ?? 20) < 20) {
      task.check(); bot._threatResponseAt = Date.now();
      const came = biter(); if (came) { stats.ended = came; break; }
      if (await stand.putOutFlames(bot, task)) continue;
      if (await strikeInReach(bot, task)) continue;
      if (await stand.shieldVolley(bot, task)) continue;
      const food = (bot.food ?? 20) < 20 ? chooseFood(bot) : null;
      if (food) {
        require('./combat').lowerShield(bot);
        await bot.equip(food, 'hand');
        const before = bot.food;
        try { await bot.consume(); stats.ate++; } catch (err) { task.check(); debug('heal eat', err.message); }
        if (bot.food <= before) await sleep(300);
        continue;
      }
      // Nothing to eat and hunger under eighteen: no health comes back, so
      // waiting for it is waiting for nothing (note 638). Out of their sight
      // is what this got: it ends once the fire on the body is out (a few
      // seconds; the fire is the one thing standing here still changes).
      if ((bot.food ?? 20) < 18) {
        if (require('./vitals').onFire(bot) && Date.now() - arrived < FIRE_WAIT_MS) { await sleep(250); continue; }
        stats.ended = `out of their sight and the fire out; at hunger ${bot.food} nothing comes back`; stats.outOfSight = true; break;
      }
      await sleep(250);
    }
    if ((bot.health ?? 20) >= 20) stats.ended = 'healed';
    // Walled in: the side toward them opened again, the way back out.
    if (site.open && (bot.health ?? 20) >= 20) for (const o of site.open) if (solid(bot.blockAt(o))) await bunker.digCell(bot, task, o);
  } finally { stats.seconds = Math.round((Date.now() - started) / 1000); stats.to = bot.health; }
  return stats;
}

// ---- Waiting far off (note 665) ----------------------------------------
// The one way to a smaller count the game allows without killing them: a
// blaze a spawner made is an ordinary monster to Mob.checkDespawn (read from
// the 26.1.2 server jar, note 665): with no player within 32 blocks and idle
// for 600 ticks (30 seconds) it is removed by chance, one in 800 each tick (a
// mean of about 40 seconds, so about 78 in 100 gone at ninety seconds and 89
// in 100 at two minutes), and at once beyond 128. The spawner
// itself makes none while no player is within sixteen. So a bot that walks
// past 32 blocks of every blaze and waits leaves the room with fewer in it; the
// spawner's first try on the way back is up to four more, ten to forty seconds
// after the bot is within sixteen again. Nothing in the records shows a bot
// doing it, and a blaze that follows in sight is not one that is left behind.
const FAR = { blocks: 34, seconds: 120, spread: 12, maxWalk: 120, think: 700, fresh: 6000, chance: 800, idle: 600 };
// The share of blazes gone by a wait: none in the first 30 idle seconds, then
// one in 800 each tick.
const farGone = seconds => Math.round(100 * (1 - Math.pow(1 - 1 / FAR.chance, Math.max(0, seconds - FAR.idle / 20) * 20)));
// The way found before the stance is asked (survival.scoutRetreat calls it):
// a route to any cell past FAR.blocks of the cage and of every blaze about,
// that passes no blaze nearer than the bot is now. Kept on the bot for the
// question that follows, for the cell it was found from.
async function scoutFar(bot, task, blazes, cage, { now = Date.now() } = {}) {
  const movements = bot.pathfinder?.movements, here = bot.entity?.position;
  if (!movements || !here || !blazes.length || !cage) return null;
  const feet = `${feetCell(bot)}`, prev = bot._farScout;
  if (prev && prev.feet === feet && now - prev.at < FAR.fresh) return prev;
  const centre = cage.offset(0.5, 0.5, 0.5);
  const spread = Math.min(FAR.spread, Math.max(0, ...blazes.map(e => e.position.distanceTo(centre))));
  const radius = Math.ceil(FAR.blocks + spread);
  const nearestNow = Math.min(...blazes.map(e => e.position.distanceTo(here)));
  const found = { at: now, feet, radius, nearestNow: round(nearestNow), spread: round(spread) };
  const saved = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, allowSprinting: movements.allowSprinting };
  Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: true });
  try {
    const { surveyRoute } = require('./skills');
    const route = await surveyRoute(bot, task, movements, new goals.GoalInvert(new goals.GoalNear(centre.x, centre.y, centre.z, radius)), FAR.think);
    const path = route?.path || [];
    if (route?.status !== 'success' || !path.length) return bot._farScout = { ...found, none: `no route was found in ${FAR.think} milliseconds to a place ${radius} blocks from the cage${route?.status && route.status !== 'success' ? ` (${route.status})` : ''}` };
    const along = Math.min(...path.map(n => Math.min(...blazes.map(e => Math.hypot(e.position.x - (n.x + 0.5), e.position.y - n.y, e.position.z - (n.z + 0.5))))));
    if (path.length > FAR.maxWalk) return bot._farScout = { ...found, none: `the nearest such place is ${path.length} blocks of walking away` };
    if (along < nearestNow - 1.5) return bot._farScout = { ...found, none: `the way there passes within ${round(along)} blocks of a blaze, nearer than the ${round(nearestNow)} the nearest is now` };
    const end = path.at(-1);
    return bot._farScout = { ...found, destination: { x: end.x, y: end.y, z: end.z }, blocks: path.length, nearestAlong: round(along), ...(route.lava ? { lava: route.lava } : {}) };
  } catch (err) {
    task.check?.(); if (['NeedsAir', 'Cancelled'].includes(err?.name)) throw err;
    return bot._farScout = { ...found, none: `the route search failed: ${err?.message || err}` };
  } finally { Object.assign(movements, saved); }
}
const farSite = (bot, now = Date.now()) => {
  const f = bot._farScout;
  return f && f.destination && f.feet === `${feetCell(bot)}` && now - f.at < FAR.fresh ? f : null;
};
// The walk out and the wait. Ends with its time, a mob that is not a blaze
// coming to arm's length, a shooter in sight that is not a blaze, or the health
// gone below eight (the walk's fire); eats where health can come back.
async function waitFarOff(bot, task, goal, save, site, { navigate, seconds = FAR.seconds, stats = {} } = {}) {
  const stand = require('./blaze-stand');
  const { chooseFood } = require('./vitals');
  const d = site.destination, dest = new Vec3(d.x, d.y, d.z);
  stand.volleyWatch(bot);
  const started = Date.now();
  Object.assign(stats, { seconds: 0, walked: 0, ate: 0, ended: 'time', from: bot.health, to: bot.health });
  goal.step = { action: 'wait_far_off', at: { ...d } }; save?.();
  const nearest = () => { const b = blazesAbout(bot, 128).map(t => t.distance); return b.length ? Math.min(...b) : Infinity; };
  try {
    for (let tries = 0; tries < 6 && feetCell(bot).distanceTo(dest) > 2; tries++) {
      task.check(); bot._threatResponseAt = Date.now();
      if (await stand.putOutFlames(bot, task)) continue;
      if (await stand.shieldVolley(bot, task)) continue;
      try { await navigate(bot, task, new goals.GoalNear(dest.x, dest.y, dest.z, 2), { timeoutMs: Math.max(6000, site.blocks * 500), stallMs: 2500, onFoot: true, sprint: true }); }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
    }
    stats.walked = Math.round((Date.now() - started) / 1000);
    if (feetCell(bot).distanceTo(dest) > 6) throw Object.assign(new Error(`the walk out to (${d.x}, ${d.y}, ${d.z}) ended ${round(feetCell(bot).distanceTo(dest))} blocks short`), { name: 'StanceFailed' });
    const arrived = Date.now(), biter = biterWatch(bot);
    stats.nearestBlaze = round(nearest());
    while (Date.now() - arrived < seconds * 1000) {
      task.check(); bot._threatResponseAt = Date.now();
      const came = biter(); if (came) { stats.ended = came; break; }
      if ((bot.health ?? 20) < 8) { stats.ended = 'under eight health'; break; }
      if (await stand.putOutFlames(bot, task)) continue;
      if (await strikeInReach(bot, task)) continue;
      if (await stand.shieldVolley(bot, task)) continue;
      const food = (bot.food ?? 20) < 20 && ((bot.health ?? 20) < 20 || (bot.food ?? 20) < 18) ? chooseFood(bot) : null;
      if (food) {
        require('./combat').lowerShield(bot);
        await bot.equip(food, 'hand');
        const before = bot.food;
        try { await bot.consume(); stats.ate++; } catch (err) { task.check(); debug('far eat', err.message); }
        if (bot.food <= before) await sleep(300);
        continue;
      }
      await sleep(500);
    }
    stats.blazesTracked = blazesAbout(bot, 128).length;
  } finally { stats.seconds = Math.round((Date.now() - started) / 1000); stats.to = bot.health; }
  return stats;
}

module.exports = { FAR, farGone, scoutFar, farSite, waitFarOff, biterWatch, bitersAtArm, ARM, lineThrough, seeing, walkCells, boxPlan, boxFits, boxSite, spawnLine, windowLine, standLine, windowSays, lineWords, buildBox, holdBox, inBox, boxWhole, fetchRods, strikeInReach, tryWeight, spawnCells, lightField, torchSpots, lightPlan, makeTorches, placeTorch, lightSpawner, torchesCarried, makeable, cornerSite, holdCorner, healSite, leaveAndHeal, blocksCarried, LIT, BOX_NEAR, QUIET_SECONDS, SPAWN_RANGE, fetchNearbyRods, fetchRodsAtCorner };
