'use strict';
// Getting about the Nether when the way on foot ends. The crossing is made
// and then the wall: legs that walk into the lava sea's cliffs and ledges,
// the fortress search standing at y 95 with its next leg's target out of
// reach on foot (mid-215-d, note 251), and the way back to the portal lost
// two hundred and fifty blocks off (mid-211-c, note 241). A player goes by
// other means: straight through the netherrack, or across on blocks laid
// ahead, at the height they stand. And when that too comes to nothing, the
// choices that answer the Nether (food from its hoglins, a portal of its
// own, going on without the Overworld) are Jev's, with what each needs.
const { Vec3 } = require('vec3');
const { surveyCrossing, bridgeTo, blocksCarried } = require('./bridging');
const { advance, setAside, isSetAside } = require('./progress');

const inNether = bot => /nether/.test(String(bot.game?.dimension || ''));
const countOf = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const retryable = err => !['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name);

// A stretch of a crossing: as far as a leg on foot toward a portal goes
// (work.js portalLeg), and the survey looks no further ahead.
const CROSS_STRETCH = 32;
// A sneaking player covers about 1.3 blocks a second; the span is crouched
// from its first block to its last (bridging.js).
const SNEAK_SPEED = 1.3;
// A block laid: six tenths of a second (survival.js BLOCK_SECONDS).
const BLOCK_SECONDS = 0.6;

// Ground made is a new nearest approach, as for every walk (skills.js
// navigation progress): a leg that went some way in and came back out, or
// shuffled along a ledge, made none. By more than a block, the size of a
// step. `record` keeps the best; a fresh record starts at `from`.
function nearer(record, distance, from) {
  if (!Number.isFinite(record.best) && Number.isFinite(from)) record.best = from;
  return !advance(record, distance, { epsilon: 1 });
}

// About how long a surveyed crossing takes: the walk crouched, each block
// laid, each dug with the tool that digs it.
const crossingSeconds = s => Math.round(s.cells / SNEAK_SPEED + s.bridge * BLOCK_SECONDS + (s.digSeconds || 0));

function crossingSays(s, what) {
  const work = [];
  if (s.dig) work.push(`digging ${s.dig} block${s.dig === 1 ? '' : 's'} of rock`);
  if (s.bridge) work.push(`laying ${s.bridge} block${s.bridge === 1 ? '' : 's'} over open ${s.overLava ? `air and lava (${s.overLava} of them over lava)` : 'air'}`);
  if (!work.length) work.push('over ground already open');
  return `Go straight at ${what} at the height the bot stands, ${s.cells} blocks, ${work.join(' and ')}, crouched all the way so a step does not go over an edge: about ${crossingSeconds(s)} seconds. ` +
    `${s.carried} blocks carried${s.bridge ? `, ${s.carried - s.bridge} left after` : ''}. It ends ${Math.round(s.gain)} blocks nearer, ${Math.round(s.from - s.gain)} from it` +
    `${s.stoppedBy ? `; there, ${s.stoppedBy}` : ''}. Rock is dug only where no lava or water is behind it.`;
}

// Straight at `target`, through rock and over air or lava, at this height,
// as far as the survey shows it can go: the way a player gets on where the
// pathfinder's walk ended. Returns the survey and whether it was tried.
// A crossing that ended no nearer rests, from this eight-block area toward
// this target, with why: mid-235-e's fortress search took the crossing
// forty times in a few minutes on an island in the lava sea, each run
// returning within a second with nothing laid, and the stall answered with
// it again each time (2026-09-27).
const CROSS_REST_MS = 5 * 60000;
const crossKey = (bot, target) => { const h = bot.entity.position; return `${Math.floor(h.x / 8)},${Math.floor(h.z / 8)}>${Math.round(target.x)},${Math.round(target.z)}`; };
const crossingResting = (bot, goal, target) => isSetAside(goal, 'crossing', crossKey(bot, target));
async function crossToward(bot, task, goal, save, target, { what = 'the target' } = {}) {
  if (!inNether(bot) || typeof bot.blockAt !== 'function') return { tried: false };
  if (crossingResting(bot, goal, target)) return { tried: false, resting: true };
  const survey = surveyCrossing(bot, target, { cells: CROSS_STRETCH });
  if (!survey.cells || survey.gain < 1) return { tried: false, survey };
  goal.step = { action: 'cross_toward', what, target: { x: Math.round(target.x), y: Math.round(target.y), z: Math.round(target.z) },
    cells: survey.cells, dig: survey.dig, bridge: survey.bridge, carried: survey.carried }; save();
  const key = crossKey(bot, target), before = flat(target, bot.entity.position);
  let why = null;
  try { await bridgeTo(bot, task, target, { maxBlocks: survey.bridge, maxSteps: survey.cells }); }
  catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; goal.lastCrossError = err.message; save(); }
  if (before - flat(target, bot.entity.position) < 1) { setAside(goal, 'crossing', key, why || 'it laid nothing nearer', CROSS_REST_MS); save(); }
  return { tried: true, survey };
}

// What a sweep leg would meet along a heading at the height the bot stands,
// cell by cell before it is chosen: open air the bot walks through and sees
// from, rock the crossing digs blind, lava or unloaded ground that stops it.
// mid-205-m spent fifty-one of its sixty Nether minutes on legs of ninety-
// odd blocks at y 96 to 104 straight through solid netherrack, about six
// seconds a cell, thirteen legs and nothing seen from inside the rock (note
// 394, 2026-09-27): the leg kept the height it started at and went the way
// the compass said, whatever lay that way. Now each heading is surveyed and
// the leg is Jev's to choose (mob-hunt.js chooseLeg), with these facts.
const WALK_SPEED = 4.3;
// Measured on mid-205-m: two blocks dug a cell, about six seconds a cell.
const ROCK_CELL_SECONDS = 6;
// Open air over a drop this deep is a cavern or the lava sea's edge, where a
// fortress is seen from afar (its bricks are found within 128 blocks).
const CAVERN_DROP = 4;
const passable = b => !b || b.boundingBox === 'empty';
// A cell of open air with no floor under it is crossed only on a block laid
// there, crouched: the crossing's pace (crossingSeconds), not a walk.
// mid-211-s-nether-4 and mid-202-o, in a basalt delta with nothing carried,
// were told a leg south was "94 of open air, about 34 seconds" and chose it
// some thirty times; every one ended at the ledge (note 480).
const LAY_CELL_SECONDS = 1 / SNEAK_SPEED + BLOCK_SECONDS;
// The cells a leg's first stretch is said by, run by run.
const FIRST_CELLS = 16;
const FIRST_SAYS = { rock: 'rock to dig', floor: 'open air with a floor', gap: 'open air with no floor under it', lava: 'open air over lava a block down' };
function firstSays(survey) {
  if (!survey?.first?.length && !survey?.stoppedBy) return '';
  const runs = (survey.first || []).map(r => `${r.n} of ${FIRST_SAYS[r.kind]}`);
  const stop = Number.isInteger(survey.stoppedAt) && survey.stoppedAt < FIRST_CELLS ? `, then ${survey.stoppedBy}` : '';
  if (!runs.length) return ` The first cell: ${survey.stoppedBy}.`;
  return ` The first ${Math.min(FIRST_CELLS, survey.cells)} cell${Math.min(FIRST_CELLS, survey.cells) === 1 ? '' : 's'}, in order: ${runs.join(', ')}${stop}.`;
}
function surveyLeg(bot, heading, { cells = 96, from = null, blocks = null } = {}) {
  if (typeof bot.blockAt !== 'function' || !bot.entity?.position) return null;
  const [dx, dz] = heading;
  const carried = blocks ?? blocksCarried(bot);
  const out = { cells: 0, open: 0, rock: 0, cavern: 0, lay: 0, carried, runsOut: null, reach: 0, reachSeconds: null, stoppedBy: null, stoppedAt: null, first: [] };
  let here = from || bot.entity.position.floored(), seconds = 0;
  // The first cells as runs of what they are (rock, floor, no floor):
  // what the leg meets before anything else, said with it (legSays).
  const note = kind => { if (out.cells >= FIRST_CELLS) return; const last = out.first.at(-1); if (last?.kind === kind) last.n++; else out.first.push({ kind, n: 1 }); };
  for (let n = 0; n < cells; n++) {
    const next = here.offset(dx, 0, dz);
    const body = [next, next.offset(0, 1, 0)].map(p => bot.blockAt(p));
    if (body.some(b => !b)) { out.stoppedBy = 'unloaded ground'; out.stoppedAt = out.cells; break; }
    if (body.some(b => /lava|fire/.test(b.name || ''))) { out.stoppedBy = 'lava in the way'; out.stoppedAt = out.cells; break; }
    if (body.some(b => !passable(b))) { note('rock'); out.rock++; seconds += ROCK_CELL_SECONDS; }
    else {
      out.open++;
      const floor = bot.blockAt(next.offset(0, -1, 0));
      if (floor && floor.boundingBox === 'block') { note('floor'); seconds += 1 / WALK_SPEED; }
      else {
        note(floor && /lava/.test(floor.name || '') ? 'lava' : 'gap');
        // The first cell needing a block past those carried: the leg ends there.
        if (out.lay >= carried && out.runsOut === null) { out.runsOut = out.cells; out.reachSeconds = Math.round(seconds); }
        out.lay++; seconds += LAY_CELL_SECONDS;
      }
      let depth = 0;
      for (; depth < CAVERN_DROP; depth++) { const b = bot.blockAt(next.offset(0, -1 - depth, 0)); if (!b || !passable(b) || /lava/.test(b.name || '')) break; }
      if (depth >= CAVERN_DROP) out.cavern++;
      if (out.runsOut === null) out.reach++;
    }
    out.cells++; here = next;
  }
  out.seconds = Math.round(seconds);
  return out;
}

// The leg as a fact: what is open, what is rock and about how long, that
// nothing is seen from inside the rock, and the blocks it needs laid
// against the blocks carried.
function legSays(survey, { direction, length, y }) {
  if (!survey) return `Go ${direction} ${length} blocks at y ${y}. Not surveyed from here.`;
  const parts = [];
  if (survey.open) parts.push(`${survey.open} of open air${survey.cavern ? ` (${survey.cavern} of them over a drop of four or more: a cavern or the lava sea's edge, where a fortress is seen from afar)` : ''}`);
  if (survey.rock) parts.push(`${survey.rock} of rock to dig (about ${ROCK_CELL_SECONDS} seconds a cell, and nothing is seen from inside it)`);
  const stop = survey.stoppedBy ? ` ${survey.stoppedBy[0].toUpperCase()}${survey.stoppedBy.slice(1)} stops it at cell ${survey.stoppedAt}.` : '';
  const lay = survey.lay || 0, carried = survey.carried ?? 0, short = Number.isInteger(survey.runsOut);
  const blocks = !lay ? '' : ` ${lay} of the open cells have no floor: it needs ${lay} block${lay === 1 ? '' : 's'} laid, crouched, about ${Math.round(LAY_CELL_SECONDS * 10) / 10} seconds a cell, ${carried} carried: ` +
    (short ? `the blocks run out at cell ${survey.runsOut}, about ${survey.reachSeconds} seconds in, where the leg stops with none to lay.` : `${carried - lay} left after.`);
  return `Go ${direction} ${length} blocks at y ${y}: of the ${survey.cells} cells ahead, ${parts.join(' and ') || 'none open'}; about ${survey.seconds} seconds${short ? ' with the blocks for all of it' : ''}.${blocks}${stop}${firstSays(survey)}`;
}

// Whether food is why the bot is going back: hungry, with nothing to eat
// or the return for food chosen.
function foodReason(bot, goal) {
  if ((bot.food ?? 20) >= 18) return false;
  const { hasFood } = require('./mob-policy');
  return !hasFood(bot) || [goal.survivalAction?.action, goal.step?.action, goal.lastStruggleStep?.action].includes('return_for_food');
}

// Where the stalled Nether work was going: a portal on the way back, a
// fortress leg or the bricks seen, the tunnel's target; with the food trip,
// the nearest Nether portal known.
function legTarget(bot, goal) {
  const steps = [goal.step, goal.lastStruggleStep].filter(Boolean);
  for (const s of steps) {
    const p = s.portal || s.target || s.found;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      const portal = !!s.portal || /portal/.test(s.action || '');
      return { at: new Vec3(p.x, p.y ?? bot.entity.position.y, p.z), what: portal ? 'the portal back' : s.action === 'find_fortress' ? 'the fortress search\'s leg' : 'where the work was going', portal };
    }
  }
  const t = goal.fortressSearch?.target;
  if (t) return { at: new Vec3(t.x, t.y, t.z), what: 'the fortress search\'s leg', portal: false };
  if (foodReason(bot, goal)) {
    const here = bot.entity.position;
    const p = (goal.portals || []).filter(q => q.dimension === 'nether').sort((a, b) => flat(a, here) - flat(b, here))[0];
    if (p) return { at: new Vec3(p.x, p.y, p.z), what: 'the portal back', portal: true };
  }
  return null;
}

// Hoglins known: in view now within thirty-two blocks, and seen earlier
// (sightings.js), with the nearest.
function hoglinsKnown(bot, goal) {
  const here = bot.entity.position;
  const inView = Object.values(bot.entities || {}).filter(e => e.name === 'hoglin' && e.isValid !== false && e.position && e.position.distanceTo(here) <= 32)
    .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
  const seen = require('./sightings').sighted(bot, goal, 'hoglin').filter(s => s.distance > 32 && s.distance <= 192);
  return { inView, seen };
}

// The hoglin as food: what it drops and what one costs to kill, from the
// game's numbers (combat-estimate.js), and whether health comes back.
function hoglinSays(bot, known) {
  const { fightEstimate } = require('./combat-estimate');
  const { defenseWeapon } = require('./combat');
  const nearest = known.inView[0];
  const weapon = defenseWeapon(bot)?.name || null, armour = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
  const one = fightEstimate({ threats: [{ name: 'hoglin', distance: nearest ? nearest.position.distanceTo(bot.entity.position) : 8, visible: true }], armour, weapon, health: bot.health,
    shield: bot.inventory?.slots?.[45]?.name === 'shield' }).fightHere;
  const where = nearest ? `${known.inView.length} in view within thirty-two blocks, the nearest ${Math.round(nearest.position.distanceTo(bot.entity.position))} blocks off`
    : `none in view; ${known.seen[0].says}`;
  const others = require('./danger').threats(bot, 32).filter(t => t.entity.name !== 'hoglin');
  const crowd = others.length ? ` Also within thirty-two blocks: ${[...new Set(others.map(t => t.entity.name.replaceAll('_', ' ')))].slice(0, 5).join(', ')}.` : '';
  return `Hunt a hoglin for its meat (${where}): each drops two to four raw porkchops, safe to eat raw at three hunger each, eight cooked. ` +
    `A hoglin has forty health and hits for about six, throwing the bot about three blocks, off an edge if there is one beside it. ` +
    `One with ${weapon ? `the ${weapon.replaceAll('_', ' ')}` : 'bare hands'}: about ${one.seconds} seconds and ${one.damageTaken} damage, from ${Math.round(bot.health ?? 20)} health. ` +
    `Two minutes, and six health lost ends it.${(bot.food ?? 20) < 18 ? ` Health does not come back meanwhile: hunger ${bot.food}.` : ''}${crowd}`;
}

// The Overworld side of a portal built here: the game puts it at the
// Nether's x and z times eight, and links to a portal of its own there
// within 128 blocks instead of building one.
function portalHereSays(bot, goal) {
  const here = bot.entity.position;
  const x = Math.round(here.x * 8), z = Math.round(here.z * 8);
  const home = (goal.portals || []).filter(p => p.dimension === 'overworld').sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  const far = home && Math.round(Math.hypot(home.x - x, home.z - z));
  const lighter = countOf(bot, 'flint_and_steel') ? 'flint and steel' : 'a fire charge';
  const supports = require('./build-sites').portalSupports(bot).count;
  return `Build a portal here from the obsidian carried (${countOf(bot, 'obsidian')}; a frame without its corners takes ten) and light it with ${lighter}, with three ordinary blocks to stand the lintel on while it goes up (${supports} carried), then go through. ` +
    `It comes out in the Overworld near ${x}, ${z}${home ? `, ${far} blocks from the portal the bot came through${far <= 128 ? ', close enough that the game links to that one' : ': a new place, with a new portal there'}` : ''}.`;
}

// The stalled Nether work's answers beside "another way" (work.js
// answerStall): each only where it can help, with what it needs. mid-211-c
// was offered "another way" and "mine nearby" 1,546 times, 250 blocks from
// its portal and short of food, and mined nearby 907 times (note 241); and
// mid-215-d's fortress search took "another way", the one detour, without
// asking, again and again (note 251).
function netherAnswers(bot, task, goal, save, { survival, actions = {} } = {}) {
  if (!inNether(bot) || !bot.entity?.position) return {};
  const answers = {};
  const target = legTarget(bot, goal);
  if (target && typeof bot.blockAt === 'function') {
    const survey = surveyCrossing(bot, target.at, { cells: CROSS_STRETCH });
    if (survey.cells && survey.gain >= 1 && !crossingResting(bot, goal, target.at)) answers.cross_toward = { description: crossingSays(survey, `${target.what}, ${Math.round(flat(target.at, bot.entity.position))} blocks off${Math.abs(target.at.y - bot.entity.position.y) >= 4 ? ` and ${Math.abs(Math.round(target.at.y - bot.entity.position.y))} blocks ${target.at.y > bot.entity.position.y ? 'up' : 'down'}` : ''}`),
      run: async () => {
        // The leg goes on from where the crossing ends, not a new one.
        if (!target.portal && goal.fortressSearch && !goal.fortressSearch.target) goal.fortressSearch.target = { x: target.at.x, y: target.at.y, z: target.at.z };
        await crossToward(bot, task, goal, save, target.at, { what: target.what });
      } };
  }
  const food = foodReason(bot, goal);
  if (food && survival?.foodHunt) {
    const known = hoglinsKnown(bot, goal);
    if (known.inView.length || known.seen.length) answers.hoglin_food = { description: hoglinSays(bot, known),
      run: async () => {
        if (!known.inView.length && actions.navigate) await require('./sightings').walkToSighting(bot, task, goal, save, 'hoglin', known.seen[0], actions.navigate);
        survival.foodHunt(goal, save, 'hoglin');
      } };
  }
  const returning = food || !!target?.portal;
  const lighter = countOf(bot, 'flint_and_steel') + countOf(bot, 'fire_charge') > 0;
  if (returning && countOf(bot, 'obsidian') >= 10 && lighter && require('./build-sites').portalSupports(bot).count >= 3 && actions.portalHere && !isSetAside(goal, 'portal_here', 'nether'))
    answers.portal_here = { description: portalHereSays(bot, goal),
      run: async () => {
        try { for (let i = 0; i < 4; i++) { task.check(); if (await actions.portalHere(bot, task, goal, save)) return; } }
        catch (err) { task.check(); if (!retryable(err)) throw err; setAside(goal, 'portal_here', 'nether', err, 600000); save(); }
      } };
  if (food && !isSetAside(goal, 'nether_return', 'food')) {
    const { foodSupply } = require('./foraging');
    const points = foodSupply(bot);
    const meals = bot.inventory.items().filter(i => require('./vitals').safeFood(bot, i)).map(i => `${i.count} ${i.name.replaceAll('_', ' ')}`).join(', ');
    const starve = { peaceful: 'no hunger at all', easy: 'starving takes health down to ten and no further', normal: 'starving takes health down to one and no further', hard: 'starving kills' }[String(bot.game?.difficulty || 'normal')] || '';
    answers.keep_on = { description: `Stay in the Nether and go on without the Overworld for twenty minutes: ${points ? `eat what is carried (${meals}, ${points} food points)` : 'nothing edible is carried'}, and go on with the work. Hunger ${bot.food}: health comes back only at eighteen or more${starve ? `, and ${starve}` : ''}. With nothing to eat below eighteen, no fight is started: the blazes wait.`,
      run: async () => {
        setAside(goal, 'nether_return', 'food', 'Jev chose to go on in the Nether without going back for food', 20 * 60000);
        delete goal.stockFood; save();
      } };
  }
  return answers;
}

module.exports = { LAY_CELL_SECONDS, WALK_SPEED, crossingResting, CROSS_REST_MS, inNether, nearer, crossToward, surveyLeg, legSays, ROCK_CELL_SECONDS, CAVERN_DROP, crossingSays, crossingSeconds, foodReason, legTarget, hoglinsKnown, hoglinSays, portalHereSays, netherAnswers, CROSS_STRETCH };
