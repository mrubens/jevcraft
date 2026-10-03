'use strict';
// Gathering in the Nether when nothing of what the step mines is within
// reach. The search had been the Overworld's: walkable ground within
// forty-eight blocks, sixteen of it surveyed half a second each and the
// nearest to the target walked to. In the Nether that ground is broken up
// by lava and drops, and from a span or a ledge there is often none.
// mid-242-af-nether-2-fortress-3 (25591, note 608) stood on its own one-wide
// cobblestone span at y 72 over the lava sea, no pickaxe, no block carried,
// two health, wanting one crimson stem for the pickaxe the staircase back
// to its portal needs: "No reachable surveyed ground while searching for
// crimson_stem" over and over for twelve minutes, the stall's answers
// none good to 0.46. Crimson stems were known 60 blocks east, warped stems
// 47 to 53 west, its portal 66 off; and four of its own oak planks, laid as
// cover from ghasts, stood 12 to 19 blocks along the span, two across it.
//
// A player looks at what is known and how to get there: the wood within
// reach of any kind, each place the stems are known and the ways to it
// (on foot, straight across at this height through rock and over the air
// on blocks laid, down to the floor and along it), the portal back to the
// Overworld's trees, legs of the search where nothing is known, and going
// on without what the wood was for. Each is priced from where the bot
// stands and put to Jev (nether_gather); a way that came to nothing rests
// from here and is said.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { surveyCrossing, bridgeTo, blocksCarried, spanBlockSources, gatherSpanBlocks } = require('./bridging');
const { setAside, isSetAside } = require('./progress');
const coverage = require('./nether-coverage');
const travel = require('./nether-travel');

const inNether = bot => /nether/.test(String(bot.game?.dimension || ''));
const words = s => String(s).replaceAll('_', ' ');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const retryable = err => !['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name);
const capital = s => `${s[0].toUpperCase()}${s.slice(1)}`;
const at3 = p => `(${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`;

// Wood: what planks come from. A stem or log is four planks, a plank one.
const WOOD = /^(?:stripped_)?[a-z_]+_(?:log|wood|stem|hyphae)$|^[a-z_]+_planks$/;
const isWood = name => WOOD.test(name || '') && !/mushroom/.test(name);
const STEM = /^(?:crimson|warped)_(?:stem|hyphae)$/;
const planksOf = name => /_planks$/.test(name) ? 1 : 4;
const woodNames = bot => Object.keys(bot.registry?.blocksByName || {}).filter(isWood);

// How far the look goes for what is known: blocks in view within 128 (a
// loaded chunk's worth round the bot and more), and those remembered.
const SEE = 128;
// Blocks of a kind within this of each other are one place.
const PLACE_APART = 24;
// The places said and offered, nearest first.
const PLACES = 3;
// A way's route survey, and how near it counts as there.
const ROUTE_MS = 1500, THERE = 3;
// A crossing surveyed this far at most (mob-hunt.js FORTRESS_CROSS).
const CROSS_CELLS = 192;
// A walk that ends this much nearer is ground made, offered as far as it goes.
const PART_WAY = 8;
// A way that came to nothing rests from this eight-block area.
const WAY_REST_MS = 5 * 60000;
// The wood within reach: looked for within this, walked to within this.
const WOOD_REACH = 24, WOOD_WALK = 32, WOOD_MOST = 16;
// The most of a resource dug in reach in one go (dig_in_reach).
const IN_REACH_MOST = 32;
const ago = at => { const sec = Math.max(1, Math.round((Date.now() - at) / 1000)); return sec < 90 ? `${sec} second${sec === 1 ? '' : 's'}` : `${Math.round(sec / 60)} minutes`; };
// Whether the tools carried make a block drop what it is dug for: a block
// with harvest tools drops only to one of them.
function dropsWith(bot, name) {
  const b = bot.registry?.blocksByName?.[name];
  if (!b?.harvestTools) return true;
  return (bot.inventory?.items?.() || []).some(i => b.harvestTools[i.type] || b.harvestTools[bot.registry?.itemsByName?.[i.name]?.id]);
}
// A leg of the search where nothing is known: its length.
const LEG = 64, LEG_FIRST = 4;
const HEADINGS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const HEADING_NAMES = ['east', 'south', 'west', 'north'];
// The same headings among exploration.js's eight.
const RAY_OF = [0, 2, 4, 6];

// The blocks a step mines for `resource`, as explore reads them: any wood
// for a log step, and in the Nether either stem for a stem.
function resourceNames(bot, resource) {
  const { MINEABLE } = require('./plan'), { sourceBlocks } = require('./knowledge');
  if (STEM.test(resource)) return Object.keys(bot.registry.blocksByName).filter(n => STEM.test(n));
  if (/_log$/.test(resource)) return Object.keys(bot.registry.blocksByName).filter(n => /_log$/.test(n));
  return [...new Set([...Object.entries(MINEABLE || {}).filter(([name, data]) => name === resource || data.drops === resource).map(([name]) => name),
    ...(bot.registry.blocksByName[resource] ? [resource] : []), ...(sourceBlocks(bot.registry, resource) || [])])];
}
// Whether a search for `resource` is one this gathers: a block the Nether
// has, looked for in the Nether.
function gathers(bot, resource) {
  if (!inNether(bot) || typeof bot.blockAt !== 'function' || typeof bot.findBlocks !== 'function' || !bot.entity?.position) return false;
  try { return resourceNames(bot, resource).length > 0; } catch (_) { return false; }
}

const find = (bot, names, reach, count) => {
  const ids = names.map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  return ids.length ? bot.findBlocks({ matching: ids, maxDistance: reach, count }) || [] : [];
};

// Where what is looked for is known: in view within 128 blocks, and
// remembered (resource-observation.js), each kind's blocks gathered into
// places, nearest first. A Nether forest noticed (exploration.js
// landmarks) or a forest biome in the loaded ground stands for its stems
// where none of them is known.
function knownPlaces(bot, goal, names) {
  const here = bot.entity.position;
  const memory = goal?.resourceMemory || {}, dim = bot.game?.dimension || 'overworld';
  const nameAt = p => bot.blockAt(p)?.name || memory[`${dim}:${p.x},${p.y},${p.z}`]?.name;
  let remembered = [];
  try { remembered = require('./resource-observation').knownResourceLocations(bot, goal, names); } catch (_) { remembered = []; }
  const all = [...new Map([...find(bot, names, SEE, 512), ...remembered].map(p => [`${p}`, p])).values()]
    .filter(p => names.includes(nameAt(p)) && !isSetAside(goal, 'reach', p))
    .sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
  const places = [];
  for (const p of all) {
    const name = nameAt(p);
    const place = places.find(pl => pl.name === name && pl.at.distanceTo(p) <= PLACE_APART);
    if (place) { place.n++; continue; }
    places.push({ at: p, name, n: 1 });
  }
  // A forest merely noticed, or read off the biome underfoot, with no
  // actual stem seen there yet: a guess, not a sighting, kept apart from
  // `places` so it never crowds out a real one. It stood on equal footing
  // with confirmed clusters before this (note 726): 25593 had 168 warped
  // stems confirmed at (-83, 36, 51) and a crimson forest merely noticed
  // that happened to sit a little nearer as a raw distance; the "one of
  // each kind first" diversification took the guess into the same three
  // slots, the final resort put it first for being nearer, and the fetch
  // asked for crimson stems it could not reach ("No way to crimson stem
  // from here") while never naming the warped ones it could.
  const guesses = [];
  if (names.some(n => STEM.test(n))) {
    const { knownLandmarks, biomeView } = require('./exploration');
    for (const [kind, stem] of [['warped_forest', 'warped_stem'], ['crimson_forest', 'crimson_stem']]) {
      if (!names.includes(stem) || places.some(pl => pl.name === stem)) continue;
      let l = null;
      try { l = knownLandmarks(bot, goal, kind, 512)[0]?.landmark || null; } catch (_) { l = null; }
      if (l) { guesses.push({ at: new Vec3(l.x, Number.isFinite(l.y) ? l.y : Math.round(here.y), l.z), name: stem, n: 0, forest: `the ${words(kind)} noticed there` }); continue; }
      let b = null;
      try { b = (biomeView(bot)?.biomesNearby || []).find(v => v.biome === kind) || null; } catch (_) { b = null; }
      if (b) guesses.push({ at: new Vec3(b.x, Math.round(here.y), b.z), name: stem, n: 0, forest: `the ${words(kind)} the ground there is` });
    }
  }
  // The nearest of each confirmed kind first (the crimson forest east as
  // well as the warped one west), then the next nearest confirmed; a guess
  // fills a slot only where a confirmed sighting does not, and never ahead
  // of one merely for sitting closer on the map.
  const d = pl => pl.at.distanceTo(here);
  const byDistance = arr => arr.slice().sort((a, b) => d(a) - d(b));
  const confirmed = byDistance(places);
  const firsts = confirmed.filter((pl, i) => confirmed.findIndex(q => q.name === pl.name) === i);
  const rest = confirmed.filter(pl => !firsts.includes(pl));
  const picked = [...firsts, ...rest].slice(0, PLACES).sort((a, b) => d(a) - d(b));
  if (picked.length >= PLACES) return picked;
  return [...picked, ...byDistance(guesses)].slice(0, PLACES);
}

// The ways to a place from where the bot stands: on foot (the pathfinder's
// own survey of the walk), straight across at this height (rock dug, open
// air and lava laid over, against the blocks carried and the pickaxe), and
// down to the floor below and along it (nether-travel.js).
async function wayTo(bot, task, target) {
  const here = bot.entity.position.clone();
  const out = { from: Math.round(here.distanceTo(target)), target };
  const m = bot.pathfinder?.movements;
  if (m && (bot.pathfinder.getPathFromTo || bot.pathfinder.getPathTo)) {
    let route = null;
    try { route = await require('./skills').surveyRoute(bot, task, m, new goals.GoalNear(target.x, target.y, target.z, THERE), ROUTE_MS); }
    catch (err) { task.check(); if (!retryable(err)) throw err; route = null; }
    if (route) {
      const path = route.path || [], end = path.at(-1);
      // The blocks the pathfinder's own route lays (a tower, a bridge) and
      // digs, each priced as the crossing prices it.
      const placed = path.reduce((n, q) => n + (q.toPlace?.length || 0), 0), dug = path.reduce((n, q) => n + (q.toBreak?.length || 0), 0);
      out.walk = { found: route.status === 'success', steps: path.length, placed, dug, end: end ? new Vec3(end.x, end.y, end.z) : null, lava: route.lava || null,
        nearer: end ? Math.round(out.from - end.distanceTo(target)) : 0, seconds: Math.round(path.length / travel.WALK_SPEED + placed * travel.LAY_CELL_SECONDS + dug * travel.ROCK_CELL_SECONDS / 2) };
    }
  }
  const carried = blocksCarried(bot);
  // Where a walk that does not get there ends, what lies on from there:
  // the crossing from its end with the blocks carried (a span's far end is
  // a walk that makes ground and leads nowhere).
  if (out.walk && !out.walk.found && out.walk.end && out.walk.nearer > 0) {
    const there = Object.assign(Object.create(bot), { entity: { ...bot.entity, position: out.walk.end.offset(0.5, 0, 0.5) } });
    out.walk.onFrom = surveyCrossing(there, target, { cells: CROSS_CELLS });
  }
  const whole = surveyCrossing(bot, target, { cells: CROSS_CELLS, blocks: 999 });
  out.cross = { whole, now: whole.bridge <= carried ? whole : surveyCrossing(bot, target, { cells: CROSS_CELLS }), carried };
  const down = travel.floorWay(bot);
  const floor = down && travel.floorToward(bot, down, target);
  // The walk to the foot of the way down, as goDown will ask the pathfinder
  // for it: the floor is offered by the check its run makes first (note 695).
  if (floor && floor.floor >= travel.FLOOR_WALKABLE) out.floor = { down, floor, route: await travel.downRoute(bot, task, down) };
  return out;
}
// Which of those make ground, each as an option: the walk all the way or
// part way, the crossing as far as the blocks carried take it, the floor.
function waysOffered(way) {
  const o = {};
  if (way.walk?.found || way.walk?.nearer >= PART_WAY) o.walk = true;
  if (way.cross.now.cells && way.cross.now.gain >= 4) o.cross = true;
  if (way.floor && way.floor.route?.found !== false) o.floor = true;
  return o;
}
// No pickaxe: rock is dug by hand, slowly, and netherrack gives nothing.
function rockSays(bot) {
  const pick = (bot.inventory?.items?.() || []).find(i => /_pickaxe$/.test(i.name));
  return pick ? `dug with the ${words(pick.name)}` : 'dug by hand, no pickaxe being carried: netherrack so dug drops nothing';
}
function walkSays(way, bot) {
  const w = way.walk;
  if (!w) return 'On foot: not surveyed.';
  const work = [w.placed && `laying ${plural(w.placed, 'block')} as it goes`, w.dug && `digging ${plural(w.dug, 'block')}`].filter(Boolean).join(' and ');
  const lava = w.lava?.beside ? ` ${require('./movement').lavaAlongSays(w.lava, bot)}` : '';
  if (w.found) return `On foot: the pathfinder's route there is ${plural(w.steps, 'step')}${work ? `, ${work}` : ''}, about ${w.seconds} seconds.${lava}`;
  const on = w.onFrom, carried = on?.carried ?? 0;
  const onSays = !on ? '' : on.gain >= 1 ? ` From there, straight across with the ${plural(carried, 'block')} carried: ${plural(on.cells, 'cell')}, ${plural(Math.round(on.gain), 'block')} nearer${on.stoppedBy ? `, then ${on.stoppedBy}` : ''}.`
    : ` From there, straight across: ${on.stoppedBy || 'no way on'} at the first cell, so the walk ends there.`;
  return `On foot: the pathfinder finds no route there${w.end ? `; the nearest it walks to is ${at3(w.end)}, ${w.nearer > 0 ? `${w.nearer} blocks nearer` : 'no nearer'}` : ''}.${w.end && w.nearer > 0 ? lava : ''}${onSays}`;
}
function crossSays(bot, way) {
  const { whole, now, carried } = way.cross, y = Math.round(bot.entity.position.y);
  if (!whole.cells) return `Straight across at y ${y}: closed at the first cell (${whole.stoppedBy || 'nothing to cross'}).`;
  const work = [whole.dig && `${whole.dig} of rock to dig (${rockSays(bot)}, about ${Math.round(whole.digSeconds)} seconds)`,
    whole.bridge && `${whole.bridge} of open air or lava to lay a block over (${whole.overLava} over lava)`].filter(Boolean);
  const end = whole.end, dy = Math.round(way.target.y - end.y);
  const ends = `it ends ${plural(Math.round(flat(end, way.target)), 'block')} across from it${Math.abs(dy) >= 2 ? `, ${Math.abs(dy)} ${dy > 0 ? 'below' : 'above'} it` : ''}${whole.stoppedBy ? `, where ${whole.stoppedBy} stops it` : ''}`;
  // Short of blocks said as what it is (note 751d, as note 751c for legs).
  const short = whole.bridge > carried ? ` It needs ${plural(whole.bridge, 'block')} laid and ${carried} ${carried === 1 ? 'is' : 'are'} carried: it cannot be done with what is carried. ${plural(carried, 'block')} carried: ${now.cells ? `they take it ${plural(now.cells, 'cell')}, ${plural(Math.round(now.gain), 'block')} nearer, and it stops at the first cell needing another` : 'it stops at the first cell needing one'}.` : whole.bridge ? ` ${plural(carried, 'block')} carried, ${carried - whole.bridge} left after.` : '';
  return `Straight across at y ${y}, crouched: ${plural(whole.cells, 'cell')}, ${work.join(' and ') || 'all open ground'}, about ${travel.crossingSeconds(whole)} seconds; ${ends}.${short}`;
}
// Whether the crossing straight at a place reaches it, said, from what is
// carried and the tool in hand, for a question that offers the trip there
// (the way back to the portal for food): the same facts the gathering's
// portal option says of it. The trip was offered as "148 blocks off, about
// 34 seconds at a walk", and mid-243-af-nether-3-fortress-5 (25586) chose
// it eleven times in an hour and dug toward the portal by hand with no
// pickaxe and no block carried, where the crossing ended 107 blocks short
// at blackstone with lava behind it, a fact the gathering question had said
// each time and this one never did (note 629). The walk is surveyed by the
// pathfinder, half a second, which these sentences do not wait for.
function reachSays(bot, target) {
  if (!inNether(bot) || typeof bot.blockAt !== 'function' || !bot.entity?.position || !target) return '';
  let whole, now;
  const carried = blocksCarried(bot);
  try {
    whole = surveyCrossing(bot, target, { cells: CROSS_CELLS, blocks: 999 });
    now = whole.bridge <= carried ? whole : surveyCrossing(bot, target, { cells: CROSS_CELLS });
  } catch (_) { return ''; }
  const way = { cross: { whole, now, carried }, target };
  const short = flat(now.end, target);
  const reaches = whole.cells && short <= THERE + 1;
  return `${crossSays(bot, way)}${reaches ? '' : ` With what is carried that crossing stops ${plural(Math.round(short), 'block')} short of it.`}`;
}
function floorSays(way) {
  if (!way.floor) return '';
  const { down, floor, route } = way.floor;
  if (route?.found === false) return ` Down to the floor: ${route.why}, so it is not offered.`;
  return ` Down to the floor and along it: ${travel.wayDownSays(down)} ${travel.floorWalkSays(floor, { along: 'on the straight line toward it' })}`;
}
// Where the way from here to a place rests, and the key it rests by.
const wayKey = (bot, target, method) => { const h = bot.entity.position; return `${Math.floor(h.x / 8)},${Math.floor(h.y / 8)},${Math.floor(h.z / 8)}>${Math.round(target.x)},${Math.round(target.z)}:${method}`; };
const wayResting = (bot, goal, target, method) => isSetAside(goal, 'gather_way', wayKey(bot, target, method));
// Why it rests, as its run said it: the reason goes with the rest.
const wayRestWhy = (bot, goal, target, method) => { try { return String(require('./progress').attemptsFor(goal).why('gather_way', wayKey(bot, target, method)) || '').replace(/^The way [^:]*came no nearer: /, '').replace(/; it rests from here$/, '').slice(0, 160); } catch (_) { return ''; } };
const WAY_SAYS = { walk: 'on foot', cross: 'straight across', floor: 'down to the floor and along it', climb: 'up by a pillar and across' };
// The ways to a place that came no nearer lately from anywhere (note 965):
// the rest is kept by the 8-block area begun from, and a bot walking back
// and forth was offered the same failed way from the next area. 25597
// (mid-242-pf-nether-1, 2026-10-03 02:33:59 to 02:36:19Z) was offered and
// took walk_to_21 to the planks at (-62, 68, 91) again two minutes after it
// came no nearer, walking one diagonal four times in fifteen minutes.
const FAILED_LATELY_MS = 10 * 60000;
function failedLatelySays(goal, target, method, now = Date.now()) {
  const tail = `>${Math.round(target.x)},${Math.round(target.z)}:${method}`;
  const n = Object.entries(require('./progress').attemptsFor(goal).entries).filter(([k, e]) => k.startsWith('gather_way:') && k.endsWith(tail) && now - (e.at || 0) < FAILED_LATELY_MS).length;
  return n ? ` This way there came no nearer ${n === 1 ? 'once' : `${n} times`} in the last ten minutes, begun from other places near here.` : '';
}

// A way that ends at the same place again. 25585 (mid-242-gf-fortress-1,
// 21:02 to 21:36Z on 2026-09-29) asked this question about 60 times on one
// line at y 41: leg_east from x 897 ended at the basalt past 928, leg_west
// from there ended at the drop at 897, and each "came nearer", so neither
// ever rested; walk_to_1 went to the same (897, 41, 74) each time. Where a
// way (by heading, or by its target and method) has ended within four blocks
// of one place twice in twenty minutes, that place is where it ends: the way
// is not offered while that place lies ahead of it (a leg), or is where its
// survey ends (a walk or crossing), for fifteen minutes after the last, and
// is said with where, how often and why (note 692).
const SAME_END = 4, END_WINDOW_MS = 20 * 60000, END_REST_MS = 15 * 60000, END_TIMES = 2;
const nearEnd = (e, p) => flat(e, p) <= SAME_END && Math.abs(e.y - p.y) < 4;
function noteEnd(goal, key, p, why, now = Date.now()) {
  const ends = (goal.gatherEnds || []).filter(e => now - e.at < END_WINDOW_MS);
  ends.push({ key, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), at: now, ...(why ? { why: String(why).slice(0, 100) } : {}) });
  goal.gatherEnds = ends.slice(-24);
  return ends.filter(e => e.key === key && nearEnd(e, p)).length;
}
// The place a way keeps ending at, where `test` says it would end there
// again, or null.
function sameEnd(goal, key, test, now = Date.now()) {
  const ends = (goal.gatherEnds || []).filter(e => e.key === key && now - e.at < END_WINDOW_MS);
  for (const e of ends.slice().reverse()) {
    const same = ends.filter(o => nearEnd(o, e));
    const last = same.reduce((m, o) => Math.max(m, o.at), 0);
    if (same.length >= END_TIMES && last + END_REST_MS > now && test(e)) {
      const why = same.map(o => o.why).filter(Boolean).at(-1);
      return { at: e, n: same.length, minutes: Math.max(1, Math.round((now - Math.min(...same.map(o => o.at))) / 60000)), rest: Math.max(1, Math.ceil((last + END_REST_MS - now) / 60000)), why };
    }
  }
  return null;
}
const sameEndSays = (what, s) => `${what}: ended at the same place, ${at3(s.at)}, ${s.n} times in the last ${plural(s.minutes, 'minute')}${s.why ? ` (${s.why})` : ''}; it goes no further from here, so it rests ${plural(s.rest, 'more minute')}`;
// Ahead on a heading from here, within a leg's length and four blocks of its line.
const aheadOn = (here, h, length) => e => { const along = (e.x - here.x) * h[0] + (e.z - here.z) * h[1], side = Math.abs((e.x - here.x) * h[1] - (e.z - here.z) * h[0]); return along >= -1 && along <= length + 8 && side <= SAME_END && Math.abs(e.y - here.y) < 4; };
const wayEndKey = (target, method) => `${method}>${Math.round(target.x)},${Math.round(target.z)}`;

// A place three or more blocks up (more than a jump), reached by a pillar
// at a column clear of lava and water: under it where it is within twelve
// blocks across, else where the bot stands, and from the top straight
// across at its height. 25588 (mid-231-ad, 03:07-03:14Z on 2026-10-01) had
// crimson stems 17 and 12 blocks up, each offered only as a crossing at its
// own height that "ends 1 block across from it, 17 below it", and walked
// seven minutes among them with no pickaxe made (note 751d). The blocks the
// pillar and the crossing need are said against those carried.
const CLIMB_UP = 3, CLIMB_UNDER = 12;
function climbTo(bot, target) {
  if (typeof bot.blockAt !== 'function') return null;
  const here = bot.entity.position, up0 = Math.round(target.y - Math.floor(here.y));
  if (up0 < CLIMB_UP) return null;
  const pr = require('./pillar-recovery');
  const carried = blocksCarried(bot);
  if (!carried) return null;
  let site = null;
  try { site = flat(target, here) <= CLIMB_UNDER ? pr.pillarSite(bot, target.y, target, { radius: 5 }) : pr.pillarSite(bot, target.y, null, { radius: 2 }); } catch (_) { site = null; }
  if (!site) return null;
  const up = Math.max(0, Math.round(target.y - site.y)), top = site.offset(0, up, 0);
  const there = Object.assign(Object.create(bot), { entity: { ...bot.entity, position: top.offset(0.5, 0, 0.5) } });
  let cross = null;
  try { cross = flat(target, top) > THERE ? surveyCrossing(there, target, { cells: CROSS_CELLS, blocks: 999 }) : null; } catch (_) { cross = null; }
  const bridge = cross?.bridge || 0, need = up + bridge;
  const walk = Math.round(site.offset(0.5, 0, 0.5).distanceTo(here));
  const seconds = Math.round(walk / travel.WALK_SPEED + up * 1.2 + (cross ? travel.crossingSeconds(cross) : 0));
  const across = !cross ? 'beside it at the top' : cross.cells ? `then straight across at y ${top.y}: ${plural(cross.cells, 'cell')}${cross.dig ? `, ${cross.dig} of rock to dig (${rockSays(bot)})` : ''}${bridge ? `, ${bridge} of open air or lava to lay a block over` : ''}, ending ${plural(Math.round(flat(cross.end, target)), 'block')} across from it${cross.stoppedBy ? `, where ${cross.stoppedBy} stops it` : ''}` : `then across at y ${top.y}: ${cross.stoppedBy || 'nothing to cross'} at the first cell`;
  const blocks = need > carried ? `In all it needs ${plural(need, 'block')} laid (${up} for the pillar${bridge ? `, ${bridge} for the crossing` : ''}) and ${carried} ${carried === 1 ? 'is' : 'are'} carried: it cannot be done with what is carried, and stops where they run out${carried < up ? `, ${carried} up the pillar` : ''}.` : `In all it needs ${plural(need, 'block')} laid of the ${carried} carried, ${carried - need} left after.`;
  return { site, up, top, cross, need, carried, says: `pillar straight up ${up} blocks (jump and lay a block under the feet) at ${at3(site)}, ${walk ? `${plural(walk, 'block')} from here` : 'where the bot stands'}, a column clear of lava and water; ${across}. ${blocks} About ${seconds} seconds.` };
}
async function climbThen(bot, task, goal, save, climb, target, what, navigate) {
  const key = wayKey(bot, target, 'climb'), y0 = bot.entity.position.y, before = flat(target, bot.entity.position);
  goal.step = { action: 'nether_gather', way: 'climb', what, target: { x: Math.round(target.x), y: Math.round(target.y), z: Math.round(target.z) } }; save();
  let why = null;
  try {
    const { goals: g } = require('mineflayer-pathfinder');
    if (climb.site.distanceTo(bot.entity.position.floored()) >= 1) await navigate(bot, task, new g.GoalBlock(climb.site.x, climb.site.y, climb.site.z), { timeoutMs: 15000, stallMs: 4000 });
    if (climb.site.distanceTo(bot.entity.position.floored()) < 1.5) await require('./pillar-recovery').pillarUp(bot, task, target.y, { dig: require('./work').dig });
    if (climb.cross?.cells && bot.entity.position.y >= target.y - 1) await bridgeTo(bot, task, target, { maxBlocks: climb.cross.bridge, maxSteps: climb.cross.cells });
  } catch (err) { task.check(); if (!retryable(err)) throw err; why = String(err.message || err).slice(0, 160); }
  if (bot.entity.position.y - y0 >= 1 || before - flat(target, bot.entity.position) >= 1) return true;
  const said = `The way up to ${what} came no nearer${why ? `: ${why}` : ''}; it rests from here`;
  setAside(goal, 'gather_way', key, said.slice(0, 300), WAY_REST_MS); save();
  throw new Error(said);
}

// Taken: the way chosen, and whether it came nearer. One that came no
// nearer rests from here and is said as the step's failure.
async function runWay(bot, task, goal, save, way, method, what, navigate) {
  const target = way.target, key = wayKey(bot, target, method), before = bot.entity.position.distanceTo(target);
  goal.step = { action: 'nether_gather', way: method, what, target: { x: Math.round(target.x), y: Math.round(target.y), z: Math.round(target.z) } }; save();
  let why = null;
  try {
    if (method === 'walk') {
      const end = way.walk.found ? target : way.walk.end;
      await navigate(bot, task, way.walk.found ? new goals.GoalNear(end.x, end.y, end.z, THERE) : new goals.GoalBlock(end.x, end.y, end.z), { timeoutMs: 60000, stallMs: 8000, passing: true });
    } else if (method === 'cross') {
      const now = way.cross.now;
      await bridgeTo(bot, task, target, { maxBlocks: now.bridge, maxSteps: now.cells });
    } else if (method === 'floor') {
      const done = await travel.walkFloorToward(bot, task, goal, save, target, way.floor.down, navigate);
      why = done.why || null;
    }
  } catch (err) { task.check(); if (!retryable(err)) throw err; why = String(err.message || err).slice(0, 160); }
  const nearer = before - bot.entity.position.distanceTo(target);
  if (flat(target, bot.entity.position) > THERE + 1) { noteEnd(goal, wayEndKey(target, method), bot.entity.position, why); save(); }
  if (nearer >= 1) return { nearer: Math.round(nearer) };
  const said = `The way ${WAY_SAYS[method]} to ${what} came no nearer${why ? `: ${why}` : ''}; it rests from here`;
  setAside(goal, 'gather_way', key, said.slice(0, 300), WAY_REST_MS); save();
  throw new Error(said);
}

// The wood within reach, of any kind: blocks a walk from here (a step up,
// level or down, nothing dug or laid) can dig, as the restock finds its
// blocks (bridging.js spanBlockSources). The planks the bot laid as cover
// on its span count too.
function woodInReach(bot, goal) {
  return spanBlockSources(bot, { reach: WOOD_REACH, walk: WOOD_WALK, names: woodNames(bot), skip: p => isSetAside(goal, 'reach', p) });
}
const talliedSays = tally => Object.entries(tally).sort((x, y) => y[1] - x[1]).map(([n, c]) => `${c} ${words(n)}`).join(', ');
const planksCarried = bot => (bot.inventory?.items?.() || []).filter(i => isWood(i.name)).reduce((n, i) => n + i.count * planksOf(i.name), 0);
function woodSays(bot, found) {
  const here = bot.entity.position, s = found.sources, first = s[0];
  const planks = s.slice(0, WOOD_MOST).reduce((n, x) => n + planksOf(x.name), 0);
  const seconds = Math.round(first.walk / travel.WALK_SPEED + s.slice(0, WOOD_MOST).reduce((n, x) => n + ((typeof x.block?.digTime === 'function' ? x.block.digTime(null, false, false, false, [], {}) : 3000) / 1000) + 1 / travel.WALK_SPEED, 0));
  const out = Object.keys(found.unreachable).length ? ` Within ${WOOD_REACH} blocks but not to be dug from ground walked to from here now: ${talliedSays(found.unreachable)}.` : '';
  return `Take the wood within reach here: ${talliedSays(found.reachable)}, the nearest ${Math.round(first.p.distanceTo(here))} blocks off at ${at3(first.p)}, dug from ${first.walk ? `a walk of ${plural(first.walk, 'block')}` : 'where the bot stands'}, one after another; about ${seconds} seconds, by hand where no axe is carried. ` +
    `That is ${plural(planks, 'plank')}' worth (a log or stem makes four planks, a plank is one); ${plural(planksCarried(bot), 'plank')}' worth carried now.${out} Taken, the step is looked at again with them.`;
}

// Back through the portal to the Overworld's trees: the nearest Nether
// portal known and the way to it, the Overworld portal it leads to, and the
// wood known near that.
function portalsKnown(bot, goal) {
  const here = bot.entity.position;
  const out = (goal.portals || []).filter(p => /nether/.test(String(p.dimension || ''))).map(p => new Vec3(p.x, p.y, p.z));
  for (const p of find(bot, ['nether_portal'], 64, 16)) if (!out.some(q => q.distanceTo(p) <= 8)) out.push(p);
  return out.sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
}
function overworldWoodSays(goal, portal) {
  const home = (goal.portals || []).filter(p => /overworld/.test(String(p.dimension || ''))).sort((a, b) => Math.hypot(a.x - portal.x * 8, a.z - portal.z * 8) - Math.hypot(b.x - portal.x * 8, b.z - portal.z * 8))[0];
  const at = home || { x: portal.x * 8, y: portal.y, z: portal.z * 8 };
  const logs = Object.values(goal.resourceMemory || {}).filter(e => /overworld/.test(String(e.dimension || '')) && /_log$/.test(e.name || ''))
    .map(e => ({ e, d: Math.round(Math.hypot(e.position.x - at.x, e.position.z - at.z)) })).sort((a, b) => a.d - b.d);
  const where = home ? `the Overworld portal at ${at3(home)}` : `the Overworld near ${Math.round(at.x)}, ${Math.round(at.z)}`;
  return `It comes out at ${where}. ${logs.length ? `The nearest wood remembered there: ${words(logs[0].e.name)} ${logs[0].d} blocks from it.` : 'No tree is remembered near it: the surface search for wood looks from there.'}`;
}

// Going on without what the wood is for: the rung it is for left thirty
// minutes and the ladder's next step taken up, as the climb's stay_below
// does (work.js surfaceTrip).
function withoutOption(bot, goal, save, { forItem, resource }) {
  const phase = goal.rungTime?.phase || goal.gameProgress?.phase;
  // Stems fetched for a pickaxe (nether-wood.js fetchStems, upkeep's
  // fetch_stems): going on without them is going without the stems and the
  // pickaxe, the work in hand going on as it is, not the rung left. 25591's
  // "leave the obtain blaze rods for thirty minutes" read as giving up the
  // rods at a live spawner, where the stems were only for a pickaxe (note 700).
  const stems = bot._errand?.key === 'fetch_stems' && STEM.test(String(resource)) ? bot._errand : null;
  if (stems) {
    const rest = Math.round(require('./nether-wood').REST_MS / 60000);
    return { description: `Go on without the stems and ${stems.for}: the fetch ends here and is not offered again for ${rest} minutes; the ${phase ? words(phase) : 'work'} goes on as it is${stems.for === 'a pickaxe' ? ', with no pickaxe' : ''}.`,
      run: async () => {
        setAside(goal, 'fetch_stems', 'nether', 'Jev chose to go on without the stems', require('./nether-wood').REST_MS);
        goal.stemsWithout = { at: Date.now() }; save();
        throw new Error('Going on without the stems, as Jev chose');
      } };
  }
  if (!phase || goal.kind !== 'win') return null;
  const { nextGameStage, RUNG_WAIT_MS } = require('./game-progress');
  let next = null;
  try { const probe = JSON.parse(JSON.stringify(goal)); setAside(probe, 'rung', phase, 'left for now', RUNG_WAIT_MS); next = nextGameStage(bot, probe); }
  catch (_) { next = null; }
  const errand = phase === 'errand' && goal.errand ? ` (the trip to the ${goal.errand.dimension}${goal.errand.items?.length ? ` for ${goal.errand.items.map(i => words(i.item)).join(', ')}` : ''}${goal.errand.for ? `, for ${goal.errand.for}` : ''})` : '';
  const wantedFor = forItem && bot._wantedFor?.item === forItem ? `, wanted for ${bot._wantedFor.what}, which ends here` : '';
  const wants = forItem ? `the ${words(forItem)} this ${words(resource)} is for${wantedFor}` : `the ${words(resource)}`;
  const items = next?.item ? ` (${next.count > 1 ? `${next.count} ${words(next.item)}${/s$/.test(next.item) ? '' : 's'}` : words(next.item)})` : '';
  // With no other step open, going on without it is thirty minutes of
  // standing idle or the same step taken up again at once: 25591 chose it
  // and was asked leave_nether's search_on the same second, round and
  // round (note 695). Said as the fact it is, not offered as a way.
  if (!(next?.phase && next.phase !== phase)) return { none: `Going on without ${wants} is not offered: no other step of the game is open now${errand}, so leaving the ${words(phase)} would only be waiting for it to come back.` };
  const goOn = `go on with the ${words(next.phase)}${items}`;
  return { description: `Go on without ${wants}: leave the ${words(phase)}${errand} for thirty minutes and ${goOn}. It comes back after, and this with it.`,
    run: async () => {
      setAside(goal, 'rung', phase, `Jev chose to go on without ${wants} for now`, RUNG_WAIT_MS);
      delete goal.rungTime;
      // What it was set aside for and from where, as the rung's question
      // keeps it (work.js set_aside_rung): taking it up again from here
      // meets the same want. 25584 chose this and, a second later,
      // leave_nether's search_on took the rods up again, round and round
      // every few seconds (note 678).
      const at = bot.entity?.position, now = Date.now();
      if (at) goal.rungAside = { phase, at: now, where: { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) }, until: now + require('./tried').REST_MS,
        why: `Jev chose to go on without ${wants}: none within reach here`.slice(0, 300) };
      goal.step = { action: 'go_without', phase, need: resource }; save();
    } };
}

// The step: what is known, the ways to each, put to Jev and taken.
async function netherGather(bot, task, goal, save, resource, { navigate, returnOverworld = null, mineAt = null, forItem = null, client = task.opportunityClient } = {}) {
  const here = bot.entity.position.clone();
  const names = resourceNames(bot, resource);
  const wood = isWood(resource);
  const state = goal.fortressSearch || (goal.netherMap ||= {});
  const dim = coverage.dimOf(bot);
  try { coverage.stand(bot, state); coverage.look(bot, state); } catch (_) { /* nothing seen is nothing said */ }
  const options = {}, facts = { looking: `${words(resource)}${wood ? ' (any wood serves: a stem or log makes four planks)' : ''}`, height: Math.round(here.y) };
  const notOffered = [];

  // The wood within reach, of any kind.
  if (wood && mineAt) {
    const found = woodInReach(bot, goal);
    if (found.sources.length) options.wood_in_view = { description: woodSays(bot, found),
      run: async () => {
        goal.step = { action: 'nether_gather', way: 'wood_in_view', what: talliedSays(found.reachable) }; save();
        // All within reach, those out of reach from here among them: a wall of
        // the bot's own planks across its span opens the way to the rest.
        const within = [...found.sources.map(x => [x.name, 1]), ...Object.entries(found.unreachable)].reduce((n, [name, c]) => n + c * planksOf(name), 0);
        const want = planksCarried(bot) + Math.min(within, WOOD_MOST * 4);
        const done = await gatherSpanBlocks(bot, task, want, { navigate, reach: WOOD_REACH, walk: WOOD_WALK, names: woodNames(bot), carried: planksCarried, what: 'wood',
          skip: p => isSetAside(goal, 'reach', p), mineAt: s => mineAt(s.p, s.name) });
        if (!done.gained) {
          const why = `The wood within reach gave nothing${done.why ? `: ${done.why}` : ''}`;
          for (const s of found.sources) setAside(goal, 'reach', s.p, why, WAY_REST_MS);
          save(); throw new Error(why);
        }
      } };
    else if (Object.keys(found.unreachable).length) facts.woodOutOfReach = `within ${WOOD_REACH} blocks but not to be dug from ground walked to from here: ${talliedSays(found.unreachable)}`;
  }

  // Any other resource within reach, dug where it lies: a fetch walked to the
  // block and never dug what was already in reach. 25591 (mid-244-eg,
  // 11:16 to 11:37Z on 2026-09-30) stood on a two-block islet in the lava
  // sea with two wooden pickaxes, netherrack 3 blocks west, and was told "No
  // way to netherrack from here ... the pathfinder's route there is 0 steps
  // ... came no nearer; it rests" for twenty minutes; db66b8a6 dug in reach
  // for span blocks only (note 751). Offered where the tools carried make
  // the block drop.
  if (!wood && mineAt) {
    const found = spanBlockSources(bot, { reach: WOOD_REACH, walk: WOOD_WALK, names: names.filter(n => dropsWith(bot, n)), skip: p => isSetAside(goal, 'reach', p) });
    const countOf = b => (b.inventory?.items?.() || []).filter(i => names.includes(i.name) || i.name === resource).reduce((n, i) => n + i.count, 0);
    if (found.sources.length) {
      const first = found.sources[0], most = Math.min(found.sources.length, IN_REACH_MOST);
      options.dig_in_reach = { description: `Dig the ${words(resource)} within reach here: ${talliedSays(found.reachable)}, the nearest ${Math.round(first.p.distanceTo(here))} blocks off at ${at3(first.p)}, dug from ${first.walk ? `a walk of ${plural(first.walk, 'block')}` : 'where the bot stands'}, up to ${most} one after another, with the ${(bot.inventory?.items?.() || []).find(i => /_pickaxe$/.test(i.name))?.name.replaceAll('_', ' ') || 'hand'}. ${plural(countOf(bot), words(resource))} carried now.${Object.keys(found.unreachable).length ? ` Within ${WOOD_REACH} blocks but not to be dug from ground walked to from here: ${talliedSays(found.unreachable)}.` : ''}`,
        run: async () => {
          goal.step = { action: 'nether_gather', way: 'dig_in_reach', what: talliedSays(found.reachable) }; save();
          // The walls where it stands first, no walk (note 971, as the block
          // gather's since note 960): 25590 (mid-242-wb-fortress-6,
          // 2026-10-03 03:40:15Z) was told "netherrack within reach gave
          // nothing", the walk to each source refused.
          const before = countOf(bot);
          try { await require('./bridging').quarryHere(bot, task, most, { names: names.filter(n => dropsWith(bot, n)) }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
          if (countOf(bot) - before >= most) return;
          const done = await gatherSpanBlocks(bot, task, countOf(bot) + most, { navigate, reach: WOOD_REACH, walk: WOOD_WALK, names: names.filter(n => dropsWith(bot, n)), carried: countOf, what: words(resource),
            skip: p => isSetAside(goal, 'reach', p), mineAt: x => mineAt(x.p, x.name) });
          if (!done.gained && countOf(bot) <= before) {
            const why = `The ${words(resource)} within reach gave nothing${done.why ? `: ${done.why}` : ''}`;
            for (const x of found.sources) setAside(goal, 'reach', x.p, why, WAY_REST_MS);
            save(); throw new Error(why);
          }
        } };
    } else if (Object.keys(found.unreachable).length) facts.outOfReach = `within ${WOOD_REACH} blocks but not to be dug from ground walked to from here: ${talliedSays(found.unreachable)}`;
  }

  // Each place it is known, and the ways there. A crossing is not offered
  // while the span's own check refuses it (bridging.js spanRefused): said.
  const refused = require('./bridging').spanRefused(bot);
  const places = knownPlaces(bot, goal, names);
  const placesSaid = [];
  const placeIds = require('./decisions/keys').ids(goal, 'gather_place', places.map(p => p.at), { near: 8, base: 1 });
  for (const [pi, place] of places.entries()) {
    const placeId = placeIds[pi];
    const way = await wayTo(bot, task, place.at);
    const off = Math.round(flat(place.at, here)), dy = Math.round(place.at.y - here.y);
    const where = place.n ? `the ${words(place.name)}s` : place.forest;
    const whereSays = `${place.n ? `${plural(place.n, words(place.name))} known` : `No ${words(place.name)} is known yet in ${place.forest}`} at ${at3(place.at)}, ${off} blocks ${HEADING_NAMES[Math.round(Math.atan2(place.at.z - here.z, place.at.x - here.x) / (Math.PI / 2) + 4) % 4]}${Math.abs(dy) >= 2 ? ` and ${Math.abs(dy)} ${dy > 0 ? 'up' : 'down'}` : ''}`;
    const stood = coverage.stoodNear(state, dim, place.at, 32);
    const standSays = stood === null ? 'The bot has not stood within 32 blocks of it.' : `The bot has stood ${stood} blocks from it before.`;
    const says = `${whereSays}. ${walkSays(way, bot)} ${crossSays(bot, way)}${floorSays(way)} ${standSays}`;
    const offered = waysOffered(way);
    if (way.cross.whole.bridge > way.cross.carried) require('./block-stock').noteBlocksShort(goal, way.cross.whole.bridge, way.cross.carried, `the crossing to ${where} at ${at3(place.at)}`);
    const keys = [];
    for (const method of ['walk', 'cross', 'floor']) {
      if (!offered[method]) continue;
      if (method === 'cross' && refused) { notOffered.push(`${WAY_SAYS[method]} to ${where} at ${at3(place.at)}: not now, ${refused.says}`); continue; }
      if (wayResting(bot, goal, place.at, method)) { const why = wayRestWhy(bot, goal, place.at, method); notOffered.push(`${WAY_SAYS[method]} to ${where} at ${at3(place.at)}: came to nothing from here a few minutes ago${why ? ` (${why})` : ''}, resting`); continue; }
      const endsAt = method === 'walk' ? (way.walk.found ? null : way.walk.end) : method === 'cross' ? way.cross.now.end : null;
      const same = endsAt ? sameEnd(goal, wayEndKey(place.at, method), e => nearEnd(e, endsAt)) : null;
      if (same) { notOffered.push(sameEndSays(`${WAY_SAYS[method]} to ${where} at ${at3(place.at)}`, same)); continue; }
      // Keyed by the way and the number the place was given when first
      // offered (keys.js, note 749), not by its place among the nearest three.
      const key = `${method}_to_${placeId}`;
      keys.push(key);
      const how = method === 'walk' ? (way.walk.found ? 'on foot, by the pathfinder\'s route' : `on foot as far as the pathfinder goes (${at3(way.walk.end)}, ${way.walk.nearer} blocks nearer), and the way on asked from there`)
        : method === 'cross' ? `straight across at this height as far as the blocks carried take it (${way.cross.now.cells} cells, ${Math.round(way.cross.now.gain)} blocks nearer${way.cross.whole.bridge > way.cross.carried ? `; the whole crossing needs ${way.cross.whole.bridge} blocks laid and ${way.cross.carried} are carried, so it cannot be done with what is carried` : ''})`
          : 'down to the floor and along it toward them';
      options[key] = { description: `Go to ${where} ${how}. ${says}${failedLatelySays(goal, place.at, method)}`, target: place.at, run: () => runWay(bot, task, goal, save, way, method, `${where} at ${at3(place.at)}`, navigate) };
    }
    // Up to it: stems overhead are climbed to, as a player pillars up to a
    // forest's floor (note 751d).
    const climb = mineAt && !way.walk?.found && !wayResting(bot, goal, place.at, 'climb') ? climbTo(bot, place.at) : null;
    if (climb) {
      require('./block-stock').noteBlocksShort(goal, climb.need, climb.carried, `the way up to ${where} at ${at3(place.at)}`);
      const key = `climb_to_${placeId}`;
      keys.push(key);
      options[key] = { description: `Go up to ${where} at ${at3(place.at)}: ${climb.says}`, target: place.at, run: () => climbThen(bot, task, goal, save, climb, place.at, `${where} at ${at3(place.at)}`, navigate) };
    }
    placesSaid.push(`${says}${keys.length ? '' : ' No way from here makes ground toward it, so it is not offered.'}`);
  }
  if (placesSaid.length) facts.knownPlaces = placesSaid;
  else facts.knownPlaces = `none: no ${words(resource)} seen within ${SEE} blocks or remembered${names.some(n => STEM.test(n)) ? ', and no Nether forest noticed' : ''}`;

  // The portal back to the Overworld's trees.
  if (wood && returnOverworld) {
    const portal = portalsKnown(bot, goal)[0];
    // The wood wanted for the way back to this portal itself (a pickaxe for
    // the stair to it): going back through it for wood is that same trip,
    // not a way to the wood. 25591 was offered it under its own go_back and
    // took it, over and over (note 678).
    const wantedFor = bot._wantedFor;
    const circular = portal && wantedFor?.target && Math.hypot(wantedFor.target.x - portal.x, wantedFor.target.y - portal.y, wantedFor.target.z - portal.z) <= 3;
    if (circular) facts.portal = `The ${words(wantedFor.item)} this wood is for is for ${wantedFor.what} at ${at3(portal)}: going back through it for wood is the trip that wants it, so it is not offered.`;
    else if (portal) {
      const way = await wayTo(bot, task, portal);
      // Where it is across and up or down: the crossing at this height ends
      // beside it only when it is at this height (25591 was told its portal
      // 10 blocks straight below was reached by the crossing, note 678).
      const dy = Math.round(portal.y - here.y), height = Math.abs(dy) > 2 ? ` and ${Math.abs(dy)} ${dy < 0 ? 'below' : 'above'}` : '';
      const t = require('./tunneling');
      const stair = height && !way.walk?.found && flat(portal, here) <= t.STAIR_ACROSS ? t.stairFromHere(bot, goal, portal) : null;
      const says = `The nether portal at ${at3(portal)}, ${Math.round(flat(portal, here))} blocks ${height ? `across${height}` : 'off'}. ${walkSays(way, bot)} ${crossSays(bot, way)}${stair ? ` ${t.stairSays(bot, stair, portal)}` : ''}`;
      const crossReaches = !refused && way.cross.now.cells && flat(way.cross.now.end, portal) <= THERE && !height && way.cross.now.gain >= 1;
      const method = way.walk?.found ? 'walk' : crossReaches ? 'cross' : stair?.gains ? 'stair' : null;
      if (method && !isSetAside(goal, 'gather_way', wayKey(bot, portal, 'portal'))) {
        options.portal_trip = { description: `Go back through the portal to the Overworld for wood, ${method === 'walk' ? 'on foot' : method === 'cross' ? 'straight across at this height' : `by a stair dug ${dy < 0 ? 'down' : 'up'} to it`}. ${says} ${overworldWoodSays(goal, portal)} The work here waits till the bot comes back through.`,
          target: portal,
          run: async () => {
            // The stair is the way back's own (work.js returnFromNether).
            if (method !== 'stair') {
              try { await runWay(bot, task, goal, save, way, method, `the portal at ${at3(portal)}`, navigate); }
              catch (err) { if (!retryable(err)) throw err; setAside(goal, 'gather_way', wayKey(bot, portal, 'portal'), err.message.slice(0, 300), WAY_REST_MS); save(); throw err; }
            }
            await returnOverworld(bot, task, goal, save);
          } };
      } else facts.portal = `${says} Neither the walk${stair ? ', the stair' : ''} nor the crossing with the blocks carried reaches it from here${refused ? ` (and no crossing now: ${refused.says})` : ''}, so going back through it is not offered.`;
    } else facts.portal = 'no nether portal known in the Nether';
  }

  // Legs of the search, for what is not known yet.
  const legsClosed = [];
  const { biomeRay } = require('./exploration');
  for (const [i, h] of HEADINGS.entries()) {
    const name = HEADING_NAMES[i], survey = travel.surveyLeg(bot, h, { cells: LEG });
    if (!survey) continue;
    // A leg whose line stops or runs out of blocks within its first few
    // cells makes no ground to search from: said, not offered.
    const goes = Math.min(...[survey.stoppedAt, survey.runsOut, survey.cells].filter(Number.isInteger));
    if (goes < LEG_FIRST) { legsClosed.push(`leg ${name}: ${goes ? `goes ${plural(goes, 'cell')} at y ${Math.round(here.y)}, then` : `closed at the first cell at y ${Math.round(here.y)},`} ${Number.isInteger(survey.runsOut) && survey.runsOut === goes ? `open air with no floor and ${plural(survey.carried, 'block')} carried to lay` : survey.stoppedBy}`); continue; }
    if (wayResting(bot, goal, here.plus(new Vec3(h[0] * LEG, 0, h[1] * LEG)), 'leg')) { legsClosed.push(`leg ${name}: came to nothing from here a few minutes ago, resting`); continue; }
    const same = sameEnd(goal, `leg_${name}`, aheadOn(here, h, LEG));
    if (same) { legsClosed.push(sameEndSays(`leg ${name}`, same)); continue; }
    let forests = [];
    try { forests = biomeRay(bot, RAY_OF[i]).filter(s => /crimson_forest|warped_forest/.test(s.biome)); } catch (_) { forests = []; }
    const seen = coverage.headingCoverage(state, dim, here, h, { length: LEG, bot });
    const unseen = seen.cells ? ` Of the ground within ${seen.reveal} blocks of its line, about ${Math.round(seen.unseen / 16)} of ${Math.round(seen.cells / 16)} chunks are unseen (no line from the eyes has reached it through open air).${seen.stood ? ` The bot has stood on ${seen.stood} of its ${LEG} blocks before.` : ''}` : '';
    const forestSays = !wood ? '' : forests.length ? ` The Nether forests that way at this height, as far as loaded: ${forests.map(s => `${words(s.biome)} from ${s.from} to ${s.to} blocks`).join(', ')}.` : ' No Nether forest lies that way at this height as far as loaded.';
    // A leg that ended short this way lately, once is enough to say, and
    // the leg that came here from there: 25595 (mid-242-ya, 11:35Z on
    // 2026-09-30) went leg_east, leg_west, leg_east, leg_west between x 562
    // and 579 at 8 health with no pickaxe and no block, each ending at the
    // same netherrack with lava behind it, the legs saying nothing of it
    // (note 751).
    const lastEnd = (goal.gatherEnds || []).filter(e => e.key === `leg_${name}` && Date.now() - e.at < END_WINDOW_MS && aheadOn(here, h, LEG)(e)).at(-1);
    const cameFrom = (goal.gatherEnds || []).filter(e => e.key === `leg_${HEADING_NAMES[(i + 2) % 4]}` && Date.now() - e.at < END_WINDOW_MS && nearEnd(e, here)).at(-1);
    const walkedSays = `${lastEnd ? ` The last leg ${name} ended ${ago(lastEnd.at)} ago at ${at3(lastEnd)}, ${Math.round(flat(lastEnd, here))} blocks ahead${lastEnd.why ? ` (${lastEnd.why})` : ''}: walked again from here it meets the same, having searched nothing new up to there.` : ''}${cameFrom ? ` The bot came here ${ago(cameFrom.at)} ago on a leg ${HEADING_NAMES[(i + 2) % 4]} that ended here${cameFrom.why ? ` (${cameFrom.why})` : ''}: this one goes back over it.` : ''}`;
    // The walk the leg takes first, said with the line (note 751b).
    const walkFirst = await travel.legWalkSays(bot, task, here.plus(new Vec3(h[0] * LEG, 0, h[1] * LEG)), { state });
    options[`leg_${name}`] = { description: `Search ${name}: ${travel.legSays(survey, { direction: name, length: LEG, y: Math.round(here.y) })} Walked by the pathfinder first, then straight across where the walk gives out.${walkFirst}${walkedSays}${forestSays}${unseen}`,
      run: async () => {
        const target = here.plus(new Vec3(h[0] * LEG, 0, h[1] * LEG)), before = flat(target, bot.entity.position);
        goal.step = { action: 'nether_gather', way: `leg_${name}`, what: words(resource), target: { x: target.x, y: target.y, z: target.z } }; save();
        let why = null;
        try { await navigate(bot, task, new goals.GoalNearXZ(target.x, target.z, 8), { timeoutMs: 45000, stallMs: 8000, passing: true }); }
        catch (err) { task.check(); if (!retryable(err)) throw err; why = String(err.message || err).slice(0, 120); }
        if (before - flat(target, bot.entity.position) < 2) {
          const s = surveyCrossing(bot, target, { cells: 32 });
          if (s.cells && s.gain >= 1) {
            try { await bridgeTo(bot, task, target, { maxBlocks: s.bridge, maxSteps: s.cells }); }
            catch (err) { task.check(); if (!retryable(err)) throw err; why = `${why ? `${why}; ` : ''}${String(err.message || err).slice(0, 120)}`; }
          }
        }
        if (flat(target, bot.entity.position) >= 8) { noteEnd(goal, `leg_${name}`, bot.entity.position, why || survey.stoppedBy || 'the walk and the crossing went no further'); save(); }
        if (before - flat(target, bot.entity.position) < 2) {
          const said = `The leg ${name} came no nearer${why ? `: ${why}` : ''}; it rests from here`;
          setAside(goal, 'gather_way', wayKey(bot, target, 'leg'), said.slice(0, 300), WAY_REST_MS); save();
          throw new Error(said);
        }
      } };
  }
  if (legsClosed.length) facts.legsClosed = legsClosed;
  if (notOffered.length) facts.waysResting = notOffered;
  // A way that takes the bot farther from a known fortress, the rods still
  // wanted, says on itself how far from the fortress it goes and what it
  // leaves (fortress-away.js awaySays): 25590 (mid-242-yc, 11:14:36Z) took
  // cross_to_2 for stems 173 blocks north from 7 blocks off its fortress's
  // floor, owing 3 rods, told the stems' distance from the bot and nothing of
  // the fortress (note 750). Said on the option, not only in the facts'
  // fortressLeft, since it is the option's own cost.
  {
    const fa = require('./fortress-away'), fort = fa.fortressAt(goal);
    if (fort) {
      const legEnd = k => { const i = HEADING_NAMES.findIndex(n => k === `leg_${n}`); return i >= 0 ? here.plus(new Vec3(HEADINGS[i][0] * LEG, 0, HEADINGS[i][1] * LEG)) : null; };
      for (const [k, o] of Object.entries(options)) {
        const to = o.target || legEnd(k);
        if (!to || fort.distanceTo(new Vec3(to.x, Number.isFinite(to.y) ? to.y : here.y, to.z)) <= fort.distanceTo(here)) continue;
        const away = fa.awaySays(bot, goal, to, { owed: true });
        if (away) o.description += ` ${away}`;
      }
    }
  }

  const without = withoutOption(bot, goal, save, { forItem, resource });
  if (without?.none) facts.without = without.none;
  else if (without) options.without = without;
  if (!Object.keys(options).length) throw new Error(`No way to ${words(resource)} from here: ${[...(Array.isArray(facts.knownPlaces) ? facts.knownPlaces : [facts.knownPlaces]), ...notOffered, facts.portal, ...legsClosed, facts.without].filter(Boolean).join('; ')}`.slice(0, 600));

  facts.blocksCarried = blocksCarried(bot);
  // No pickaxe and no block: said plainly as what the ways here can and
  // cannot do (note 751, 25595 at 8 health pacing between two walls).
  if (!facts.blocksCarried && !(bot.inventory?.items?.() || []).some(i => /_pickaxe$/.test(i.name))) facts.withNeither = 'No pickaxe and no block carried: rock dug by hand drops nothing and no gap or lava can be spanned, so from here the bot goes only where the ground is walkable; a way that needs a block laid or rock kept ends where the walkable ground does.';
  facts.pickaxe = (bot.inventory?.items?.() || []).filter(i => /_pickaxe$/.test(i.name)).map(i => words(i.name)).join(', ') || 'none: rock is dug by hand, slowly, and netherrack dug by hand drops nothing';
  if (forItem) facts.for = words(forItem);
  facts.health = bot.health; facts.food = bot.food;
  // The fortress the gathering leaves, and the health it walks with (note 702).
  { const away = require('./fortress-away').awayFacts(bot, goal); if (away) facts.fortressLeft = away; }
  try { facts.threatsInView = require('./danger').threats(bot, 64).filter(t => t.visible && (t.distance <= 32 || t.entity.name === 'ghast')).map(t => `${words(t.entity.name)} ${Math.round(t.distance)} blocks off`); } catch (_) { /* none said */ }
  try { facts.seenSoFar = coverage.coverageSays(state, dim, here, LEG); } catch (_) { /* none said */ }
  const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description, ...(o.target ? { target: { x: Math.round(o.target.x), y: Math.round(o.target.y), z: Math.round(o.target.z) } } : {}) }]));
  const unseen = Object.fromEntries(HEADING_NAMES.map((n, i) => [`leg_${n}`, options[`leg_${n}`] ? coverage.headingCoverage(state, dim, here, HEADINGS[i], { length: LEG }).unseen : null]));
  const decision = await require('./decisions').decide('nether_gather', { client, bot, task, goal, save, tree, state: facts, context: { unseen } });
  if (decision.stale) return false;
  await options[decision.path.at(-1)].run();
  return true;
}

module.exports = { failedLatelySays, climbTo, withoutOption, noteEnd, sameEnd, END_REST_MS, netherGather, reachSays, crossSays, gathers, resourceNames, knownPlaces, wayTo, woodInReach, isWood, STEM, PLACE_APART, WAY_REST_MS };
