'use strict';
const { setAside, isSetAside } = require('./progress');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { reservedForConstruction } = require('./build-sites');
const { checkAir } = require('./vitals');
const { checkThreats } = require('./danger');
const { countOf } = require('./skills');
const stash = require('./home-stash');
const { knownVillages, BED_REACH } = require('./villages');

// A home base: one spot per world, on level ground beside water, with a
// wheat plot, a fenced cow pen and a bed the bot has slept in. The dream
// run lost its full kit six times to deaths that then cost a climb from
// world spawn; a bed moves the respawn home. Food has been the other
// recurring cost: a hunt is a walk of unknown length, a plot and a pen are
// a walk of known length. Code owns the layout, the checks and the
// mechanics; Jev only ever chooses between chores code has found feasible.
//
// The base lives in the survival state (goal.survival.home), which every
// goal shares and which is saved beside each goal, so the win objective,
// the idle loop and a player request all see the same base.
const HOME_REACH = 128;
const PLOT = 3;
const PEN = 5;
const BREAD_WHEAT = 3;
const SITE_RADIUS = 64;
const SITE_DEFER_MS = 30 * 60 * 1000;
const BREED_COOLDOWN_TICKS = 6000;
const TILLABLE = new Set(['grass_block', 'dirt', 'coarse_dirt', 'rooted_dirt', 'dirt_path']);
const CLEAR = new Set(['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'snow', 'leaf_litter', 'dandelion', 'poppy']);
const DIRECTIONS = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
const FACING = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pos = p => new Vec3(p.x, p.y, p.z);
const plain = p => ({ x: p.x, y: p.y, z: p.z });
const overworld = bot => /overworld/.test(String(bot.game?.dimension || 'overworld'));
const clear = block => !!block && CLEAR.has(block.name);
const liquid = block => !!block && ['water', 'lava'].includes(block.name);
const isBed = block => /_bed$/.test(block?.name || '');
const isFence = block => /_fence$/.test(block?.name || '');
const isGate = block => /_fence_gate$/.test(block?.name || '');
const cropAge = block => Number(block?.getProperties?.().age ?? 0);
const isBaby = (bot, entity) => {
  const keys = bot.registry?.entitiesByName?.[entity.name]?.metadataKeys || [];
  return entity.metadata?.[keys.indexOf('baby')] === true;
};

// The layout, in local coordinates: u runs away from the water, v across
// it. The plot sits against the water so every cell is hydrated; the bed
// is beside the plot; the pen is a five-by-five ring further back with a
// gate facing the plot.
function layout(site) {
  const o = site.origin, d = site.direction, a = { x: -d.z, z: d.x };
  const cell = (u, v, dy = 0) => ({ x: o.x + d.x * u + a.x * v, y: o.y + dy, z: o.z + d.z * u + a.z * v });
  const plot = [], footprint = [], fences = [];
  // Three by three to start; a fourth column (v = 2) once the base stands
  // and there is an evening to spare. The water at u = -1 keeps every cell
  // within the four blocks that hydrate farmland.
  for (let u = 0; u < PLOT; u++) for (let v = -1; v <= (site.plotWide ? 2 : 1); v++) plot.push(cell(u, v));
  for (let u = 0; u <= 8; u++) for (let v = -3; v <= 3; v++) footprint.push(cell(u, v));
  let gate = null;
  for (let u = 4; u < 4 + PEN; u++) for (let v = -2; v <= 2; v++) {
    if (u !== 4 && u !== 4 + PEN - 1 && v !== -2 && v !== 2) continue;
    if (u === 4 && v === 0) gate = cell(u, v, 1); else fences.push(cell(u, v, 1));
  }
  const corners = [cell(5, -1, 1), cell(7, 1, 1)];
  const interior = { min: { x: Math.min(corners[0].x, corners[1].x), y: o.y + 1, z: Math.min(corners[0].z, corners[1].z) },
    max: { x: Math.max(corners[0].x, corners[1].x), y: o.y + 1, z: Math.max(corners[0].z, corners[1].z) } };
  // The bed is placed from a standing spot beyond its head, looking back
  // toward the water, so its facing is the reverse of the site direction.
  const bed = { foot: cell(1, -3, 1), head: cell(0, -3, 1), stand: cell(3, -3, 1), facing: FACING[`${-d.x},${-d.z}`] };
  // The stash chest sits against the foot of the bed, between it and the
  // plot, off the line the bed is placed along so its lid never blocks the ray.
  const chest = cell(1, -2, 1);
  const pen = { fences, gate, gateStand: cell(3, 0, 1), centre: cell(6, 0, 1), interior };
  return { plot, bed, chest, pen, footprint, water: site.water };
}

const inside = (interior, p) => p && p.x >= interior.min.x && p.x < interior.max.x + 1 && p.z >= interior.min.z && p.z < interior.max.z + 1 && Math.abs(p.y - interior.min.y) <= 1.5;

// Where the base should be near: a remembered village within reach (its
// bell or centre, so the bed and the stash end up among the houses), else
// the surface above the nearest Overworld portal when it is close enough
// to be loaded, else the house it built, else where it stands.
// The surface above a point: the highest solid block with air over it in
// that column, when the column is loaded. A portal dug beside a lava lake
// at y=-41 is the right place to come home to and the wrong depth for a plot.
function surfaceAbove(bot, x, z, from) {
  for (let y = from; y > from - 128; y--) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block) return null;
    if (block.boundingBox === 'block') return clear(bot.blockAt(new Vec3(x, y + 1, z))) ? y : null;
  }
  return null;
}

// Open sky over a cell: nothing solid (leaves aside) up to forty blocks.
// The clean run chose its base beside a pool at y 0 in a cave, dark enough
// for four zombies, and died there levelling it.
function openSky(bot, p, reach = 40) {
  for (let dy = 1; dy <= reach; dy++) {
    const b = bot.blockAt(new Vec3(p.x, p.y + dy, p.z));
    if (!b) return true;
    if (b.boundingBox === 'block' && !/_leaves$/.test(b.name)) return false;
  }
  return true;
}

function baseAnchor(bot, goal) {
  const here = bot.entity.position.floored();
  const village = knownVillages(bot, goal, BED_REACH)[0]?.village;
  if (village) { const centre = village.bell || village; return { kind: 'village', x: centre.x, y: centre.y, z: centre.z }; }
  // The nearest remembered portal, if it is close enough for its surroundings
  // to be loaded: an anchor two hundred blocks off is a search that never
  // finds anything, and the run's fourth attempt was exactly that.
  const portal = (goal.portals || []).filter(p => p.dimension === 'overworld')
    .sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
  if (portal && Math.hypot(portal.x - here.x, portal.z - here.z) <= SITE_RADIUS) {
    const top = surfaceAbove(bot, portal.x, portal.z, Math.max(here.y, portal.y) + 48);
    return { kind: 'portal', x: portal.x, y: top ?? here.y - 1, z: portal.z };
  }
  const house = (goal.survival?.shelters || []).find(s => s.kind === 'house' && s.dimension === bot.game.dimension);
  if (house) return { kind: 'house', ...plain(house.origin) };
  // Underground, the surface over the bot: the rung comes up wherever the
  // ladder is, often in the mine.
  if (!openSky(bot, here)) {
    const top = surfaceAbove(bot, here.x, here.z, Math.min(here.y + 96, (bot.game?.minY ?? -64) + (bot.game?.height ?? 384) - 1));
    if (top !== null) return { kind: 'here', x: here.x, y: top, z: here.z };
  }
  return { kind: 'here', ...plain(here) };
}

// Sixty-three level cells do not occur in a birch forest on a hill, and the
// second run's site search failed three times in one second on exactly
// that. A site is level enough when every footprint cell is within a
// block of the origin and the difference is work the bot can do: blocks
// to dig where the ground or a tree stands higher, dirt to lay where it
// dips. The work list is what the level step executes.
const LEVEL_BUDGET = 48;
const diggable = block => !!block && block.boundingBox === 'block' && !liquid(block) && !/bedrock|obsidian|_bed$|chest/.test(block.name);
// Choosing a site is strict: any cell that cannot be made level, a liquid,
// a reserved cell or too much work rules the site out. The established
// home is judged loosely: its own footprint is reserved construction by
// then, a cell that cannot be fixed is left as it is, and only unloaded
// cells stop the work.
// The registry's cells, built once and kept for a few seconds: a base-site
// search calls siteWork thousands of times, and rebuilding the set from a
// forty-eight building registry each time could hold the event loop.
function claimedCells(bot, now = Date.now()) {
  const where = String(bot.game?.dimension || 'overworld').replace(/^minecraft:/, '').replace(/^the_/, '');
  const cache = bot._claimedCells;
  if (cache && cache.where === where && cache.registry === bot.buildRegistry && now - cache.at < 5000) return cache.cells;
  const cells = bot.buildRegistry?.claimed?.(where) || new Set();
  bot._claimedCells = { where, registry: bot.buildRegistry, at: now, cells };
  return cells;
}
function siteWork(bot, goal, site, { strict = true } = {}) {
  const { plot, footprint } = layout(site);
  const plotKeys = new Set(plot.map(p => `${p.x},${p.z}`));
  const digs = [], fills = [];
  const unfit = () => strict ? null : 'skip';
  // Jev's own buildings are not ground to level. Only this goal's blueprint
  // was reserved, so a base laid out beside the village dug into the walls
  // of an older cottage.
  const built = claimedCells(bot);
  for (const p of footprint) {
    const at = dy => bot.blockAt(pos(p).offset(0, dy, 0));
    const ground = at(0), above = at(1), head = at(2), below = at(-1);
    if (!ground || !above || !head || !below) return strict ? null : { digs, fills, unloaded: true };
    if ([-1, 0, 1, 2, 3].some(dy => built.has(`${p.x},${p.y + dy},${p.z}`))) { if (unfit() === null) return null; continue; }
    if ([ground, above, head, below].some(liquid)) { if (unfit() === null) return null; continue; }
    // Reserved for anything but this home: its own footprint is reserved
    // from other digging (build-sites.js), not from its own levelling.
    if (strict && reservedForConstruction({ ...goal, survival: { ...goal.survival, home: undefined } }, pos(p).offset(0, 1, 0))) return null;
    const isPlot = plotKeys.has(`${p.x},${p.z}`);
    if (ground.boundingBox === 'block') {
      // Standing higher: whatever is solid in the two cells above comes out.
      let bad = false;
      for (const [dy, block] of [[1, above], [2, head]]) {
        if (clear(block)) continue;
        if (!diggable(block)) { bad = true; break; }
        digs.push(pos(p).offset(0, dy, 0));
      }
      if (bad) { if (strict) return null; continue; }
      // A third solid block above is a hill, not a bump.
      const third = at(3);
      if (strict && third && third.boundingBox === 'block' && !clear(at(1)) && !clear(at(2))) return null;
      if (isPlot && !TILLABLE.has(ground.name)) { if (!diggable(ground)) { if (strict) return null; continue; } digs.push(pos(p)); fills.push({ ...plain(p), item: 'dirt' }); }
    } else if (clear(ground) && below.boundingBox === 'block') {
      // One lower: lay a block; dirt where the plot goes.
      if (!clear(above) || !clear(head)) { if (strict) return null; continue; }
      fills.push({ ...plain(p), item: isPlot ? 'dirt' : 'any' });
    } else if (strict) return null;
  }
  if (strict && digs.length + fills.length > LEVEL_BUDGET) return null;
  // Never on top of a portal the bot walks back to.
  if (strict && (goal.portals || []).some(q => q.dimension === 'overworld' && footprint.some(p => Math.abs(p.x - q.x) <= 3 && Math.abs(p.z - q.z) <= 3))) return null;
  return { digs, fills };
}
function siteFits(bot, goal, site) {
  const work = siteWork(bot, goal, site);
  return !!work && work.digs.length + work.fills.length === 0;
}

// The nearest level, tillable shore to the anchor that fits the whole
// layout. Water is scanned around the anchor, not the bot, so a base is
// chosen once per world and does not drift with where the bot happens to be.
// With `several`, up to four sites at least eight blocks apart, the flat ones
// first, for Jev to choose among (homeStep); otherwise the first of them.
function chooseBaseSite(bot, goal, { radius = SITE_RADIUS, dryOk = false, several = false } = {}) {
  const anchor = baseAnchor(bot, goal);
  const waterId = bot.registry.blocksByName.water?.id;
  if (waterId === undefined) return null;
  const point = new Vec3(anchor.x, anchor.y, anchor.z);
  const water = (bot.findBlocks({ matching: [waterId], maxDistance: radius, count: 512, point,
    useExtraInfo: b => clear(bot.blockAt(b.position.offset(0, 1, 0))) && openSky(bot, b.position) }) || [])
    .sort((a, b) => a.distanceTo(point) - b.distanceTo(point));
  // The nearest site that needs the least levelling: a flat one is taken as
  // soon as it is seen, a bumpy one only when nothing flatter is close.
  const want = several ? 4 : 1;
  const apart = (a, list) => list.every(b => Math.hypot(a.origin.x - b.origin.x, a.origin.z - b.origin.z) >= 8);
  const fit = (cells, extra = {}) => {
    const flat = [], bumpy = [];
    for (const w of cells) for (const d of DIRECTIONS) {
      const a = { x: -d.z, z: d.x };
      for (const shift of [0, -1, 1, -2, 2]) {
        const origin = w.offset(d.x + a.x * shift, 0, d.z + a.z * shift);
        const site = { origin: plain(origin), direction: d, water: plain(w), ...extra };
        const work = siteWork(bot, goal, site);
        if (!work) continue;
        const cost = work.digs.length + work.fills.length + w.distanceTo(point) / 16;
        if (work.digs.length + work.fills.length === 0) {
          if (apart(site, flat)) flat.push({ ...site, work, anchor });
          if (flat.length >= want) return several ? flat : flat[0];
          continue;
        }
        bumpy.push({ ...site, work, anchor, cost });
      }
    }
    const rest = [];
    for (const b of bumpy.sort((x, y) => x.cost - y.cost)) if (apart(b, [...flat, ...rest])) { const { cost, ...site } = b; rest.push(site); if (flat.length + rest.length >= want) break; }
    const sites = [...flat, ...rest].slice(0, want);
    return several ? (sites.length ? sites : null) : sites[0] || null;
  };
  // The nearest sixty-four candidates, not all of them: each is fitted in
  // twenty placements of a sixty-three-cell footprint, and four thousand
  // columns of dry ground blocked the event loop for tens of seconds at a
  // time, long enough for the server to drop the bot and a zombie to kill it
  // without an answer (the dream run, 2026-09-24). The nearest are the sites
  // wanted anyway; a flat one ends the search at once.
  const NEAREST = 64;
  const natural = fit(water.slice(0, NEAREST));
  if (natural) return natural;
  // No pond within reach, but a bucket of water in the pockets is a pond
  // anywhere: a one-block hole beside the plot, filled once. The run's
  // home search failed four times on a mountain top with a full bucket.
  // With no bucket at all, after looks in two places (dryOk), the site is
  // taken dry: trial 10's search failed on a mountain with the bed and the
  // chest in the pack, its bucket rung set aside, for want of water the bed
  // and the chest do not need; the pond waits for its bucket.
  if (!countOf(bot, 'water_bucket') && !dryOk) return null;
  const groundIds = [...TILLABLE].map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
  // One candidate per column, the surface: a thousand-block scan of
  // grass and dirt finds cave floors and the same slope over and over.
  const columns = new Map();
  for (const b of bot.findBlocks({ matching: groundIds, maxDistance: radius, count: 1024, point,
    useExtraInfo: b => clear(bot.blockAt(b.position.offset(0, 1, 0))) && bot.blockAt(b.position.offset(0, -1, 0))?.boundingBox === 'block' && openSky(bot, b.position) }) || []) {
    const key = `${b.x},${b.z}`;
    if (!columns.has(key) || columns.get(key).y < b.y) columns.set(key, b);
  }
  const ground = [...columns.values()].sort((a, b) => a.distanceTo(point) - b.distanceTo(point));
  return fit(ground.slice(0, NEAREST), { pourWater: true });
}

function establishHome(goal, site, { now = Date.now() } = {}) {
  goal.survival.home = { version: 1, dimension: 'overworld', origin: site.origin, direction: site.direction, water: site.water,
    pourWater: !!site.pourWater, anchor: site.anchor, chosenAt: new Date(now).toISOString(), bed: {}, plot: {}, pen: {},
    levelling: (site.work?.digs?.length || 0) + (site.work?.fills?.length || 0) };
  delete goal.survival.homeSearch;
  return goal.survival.home;
}

function homeOf(bot, goal) {
  const home = goal?.survival?.home;
  return home && overworld(bot) ? home : null;
}
function homeDistance(bot, home) {
  const here = bot.entity.position;
  // Three dimensions: forty blocks down a mine under the base is not home.
  return Math.hypot(here.x - (home.origin.x + 0.5), here.y - (home.origin.y + 1), here.z - (home.origin.z + 0.5));
}

function plotStatus(bot, home) {
  const { plot } = layout(home);
  const status = { untilled: [], bare: [], growing: [], grown: [], blocked: [], unloaded: [], waiting: [] };
  for (const p of plot) {
    const ground = bot.blockAt(pos(p)), crop = bot.blockAt(pos(p).offset(0, 1, 0));
    if (!ground || !crop) { status.unloaded.push(p); continue; }
    // A cell the hoe would not turn, twice, from beside it, waits twenty
    // minutes: trial 24's bot tried one cell for ninety seconds and failed
    // the audit standing beside the plot (2026-09-24). Waiting, not blocked:
    // blocked cells reopen the base for repair, and trial 26 went back to
    // repair four such cells, round and round, for ten minutes.
    if (ground.name !== 'farmland' && TILLABLE.has(ground.name) && home.plot?.stubborn?.[`${p.x},${p.y},${p.z}`] > Date.now()) { status.waiting.push(p); continue; }
    if (ground.name !== 'farmland') { (TILLABLE.has(ground.name) ? status.untilled : status.blocked).push(p); continue; }
    if (crop.name === 'wheat') (cropAge(crop) >= 7 ? status.grown : status.growing).push(p);
    else if (clear(crop)) status.bare.push(p);
    else status.blocked.push(p);
  }
  return status;
}

function bedStatus(bot, home) {
  const { bed } = layout(home);
  const foot = bot.blockAt(pos(bed.foot)), head = bot.blockAt(pos(bed.head));
  const placed = isBed(foot) && isBed(head);
  const loaded = !!foot && !!head;
  return { placed, loaded, claimed: placed && !!home.bed?.claimedAt };
}

function penStatus(bot, home) {
  const { pen } = layout(home);
  const missingFences = pen.fences.filter(p => !isFence(bot.blockAt(pos(p))));
  const gate = bot.blockAt(pos(pen.gate));
  const cows = Object.values(bot.entities || {}).filter(e => e.name === 'cow' && e.isValid !== false && inside(pen.interior, e.position));
  const adults = cows.filter(e => !isBaby(bot, e));
  const open = gate?.getProperties?.().open;
  return { fenced: !missingFences.length && isGate(gate), missingFences, gateMissing: !isGate(gate), gateOpen: open === true || open === 'true',
    cows: cows.length, adults: adults.length, adultCows: adults };
}

const bedCarried = bot => bot.inventory.items().find(i => /_bed$/.test(i.name))?.name || null;
const hoeCarried = bot => bot.inventory.items().some(i => /_hoe$/.test(i.name));
function woolCarried(bot) {
  const counts = {};
  for (const i of bot.inventory.items()) if (/_wool$/.test(i.name)) counts[i.name] = (counts[i.name] || 0) + i.count;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? { colour: best[0].replace(/_wool$/, ''), count: best[1], total: Object.values(counts).reduce((n, c) => n + c, 0) } : { colour: 'white', count: 0, total: 0 };
}
// Fences from the wood already carried, then the trees that were seen.
function woodSpecies(bot) {
  const counts = {};
  for (const i of bot.inventory.items()) { const m = /^(\w+)_(planks|log)$/.exec(i.name); if (m) counts[m[1]] = (counts[m[1]] || 0) + i.count; }
  const carried = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (carried && bot.registry.itemsByName[`${carried}_fence`]) return carried;
  const seen = (bot._catalogObservation?.nearby || []).find(name => /_log$/.test(name))?.replace(/_log$/, '');
  return seen && bot.registry.itemsByName[`${seen}_fence`] ? seen : 'oak';
}

// The home rung, one bounded step at a time, read off the world: bed
// first (it is what a death costs), then the plot, then the pen. A base
// needs a survival layer and the Overworld; anything else has no rung.
function homeStage(bot, goal, { now = Date.now() } = {}) {
  const survival = goal.survival;
  if (!survival || !overworld(bot)) return null;
  const home = survival.home;
  if (!home) return isSetAside(goal, 'home_site', 'search', now) ? null : { phase: 'home_site', action: 'choose_site' };
  const bed = bedStatus(bot, home);
  // A finished base stays finished until the bed or the chest is seen to
  // be gone; an unloaded base far away is not a reason to walk back.
  if (home.completedAt) {
    const chest = stash.stashStatus(bot, home);
    const plotNow = plotStatus(bot, home);
    if (bed.loaded && !bed.placed) { delete home.completedAt; delete home.bed.claimedAt; }
    else if (chest.loaded && !chest.placed) { delete home.completedAt; stash.forgetChest(home); }
    // A plot trampled back to dirt, or with shell blocks on it, is a farm
    // that stopped: the second run's base was "finished" with five of nine
    // cells growing. Reopen for the repair; the bed and chest stand.
    // Blocked cells (shell damage) reopen the base; untilled cells, the
    // grown column included, are the evening chores' work, not the ladder's.
    else if (!plotNow.unloaded.length && plotNow.blocked.length) { delete home.completedAt; }
    else return null;
  }
  if (!bed.loaded) return { phase: 'home_bed', action: 'return_home' };
  // Levelling first: the bed and the chest want their cells clear and the
  // plot wants dirt. Read off the world each time, so a restart or a
  // creeper does not leave a half-done site counted as done.
  if (home.levelling > 0 && !home.levelledAt) {
    const work = siteWork(bot, goal, home, { strict: false });
    if (work.unloaded) return { phase: 'home_level', action: 'return_home' };
    const remaining = work.digs.length + work.fills.length;
    if (remaining) {
      // Walk home first: levelling from inside the iron mine was one long
      // path search per block.
      if (homeDistance(bot, home) > 12) return { phase: 'home_level', action: 'return_home' };
      const dirt = work.fills.filter(f => f.item === 'dirt').length, blocks = work.fills.length;
      if (countOf(bot, 'dirt') < dirt) return { phase: 'home_level', action: 'acquire', item: 'dirt', count: dirt };
      if (countOf(bot, 'dirt') + countOf(bot, 'cobblestone') < blocks) return { phase: 'home_level', action: 'acquire', item: 'cobblestone', count: blocks - countOf(bot, 'dirt') };
      return { phase: 'home_level', action: 'level_site', digs: work.digs.length, fills: work.fills.length };
    }
    home.levelledAt = new Date(now).toISOString();
  }
  if (!bed.claimed) {
    if (bed.placed) return { phase: 'home_bed', action: 'claim_bed' };
    const carried = bedCarried(bot);
    if (carried) return { phase: 'home_bed', action: 'place_bed', item: carried };
    const wool = woolCarried(bot);
    if (wool.count >= 3) return { phase: 'home_bed', action: 'acquire', item: `${wool.colour}_bed`, count: 1 };
    return { phase: 'home_bed', action: 'gather_wool', count: 3 - wool.count };
  }
  // The stash chest beside the bed: the bed is what a death costs, the
  // chest is what the respawn starts with. Eight planks, placed once.
  const chest = stash.stashStatus(bot, home);
  if (!chest.loaded) return { phase: 'home_stash', action: 'return_home' };
  if (!chest.placed) {
    if (home.stash?.position) stash.forgetChest(home);
    return countOf(bot, 'chest') ? { phase: 'home_stash', action: 'place_chest' } : { phase: 'home_stash', action: 'acquire', item: 'chest', count: 1 };
  }
  if (!home.stash?.position) home.stash = { ...home.stash, position: plain(chest.at), placedAt: new Date(now).toISOString(), contents: home.stash?.contents || {} };
  // A poured pond comes before the plot: the farmland is hydrated by it.
  if (home.pourWater) {
    const w = bot.blockAt(pos(home.water));
    if (!w) return { phase: 'home_water', action: 'return_home' };
    if (w.name !== 'water') return countOf(bot, 'water_bucket') ? { phase: 'home_water', action: 'pour_water' } : { phase: 'home_water', action: 'acquire', item: 'water_bucket', count: 1 };
  }
  const plot = plotStatus(bot, home);
  if (plot.unloaded.length) return { phase: 'home_plot', action: 'return_home' };
  // Blocked cells first: cobblestone from a night shell where dirt should
  // be, or a block sitting on the cell. Dirt to lay, then the repair.
  if (plot.blocked.length) {
    const needDirt = plot.blocked.filter(p => !TILLABLE.has(bot.blockAt(pos(p))?.name) && bot.blockAt(pos(p))?.name !== 'farmland').length;
    if (countOf(bot, 'dirt') < needDirt) return { phase: 'home_plot', action: 'acquire', item: 'dirt', count: needDirt };
    return { phase: 'home_plot', action: 'repair_plot', cells: plot.blocked.length };
  }
  if (plot.untilled.length) return hoeCarried(bot) ? { phase: 'home_plot', action: 'till', cells: plot.untilled.length } : { phase: 'home_plot', action: 'acquire', item: 'wooden_hoe', count: 1 };
  if (plot.bare.length) {
    return countOf(bot, 'wheat_seeds') >= plot.bare.length ? { phase: 'home_plot', action: 'plant', cells: plot.bare.length }
      : { phase: 'home_plot', action: 'acquire', item: 'wheat_seeds', count: plot.bare.length };
  }
  const pen = penStatus(bot, home);
  if (!pen.fenced) {
    const species = woodSpecies(bot), fence = `${species}_fence`, gate = `${species}_fence_gate`;
    if (countOf(bot, fence) < pen.missingFences.length) return { phase: 'home_pen', action: 'acquire', item: fence, count: pen.missingFences.length };
    if (pen.gateMissing && countOf(bot, gate) < 1) return { phase: 'home_pen', action: 'acquire', item: gate, count: 1 };
    return { phase: 'home_pen', action: 'build_pen', fences: pen.missingFences.length, gate: pen.gateMissing };
  }
  home.completedAt ||= new Date(now).toISOString();
  return null;
}

const homeComplete = (bot, goal) => !!homeOf(bot, goal) && homeStage(bot, goal) === null;

async function waitFor(task, predicate, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { task.check(); if (predicate()) return true; await sleep(50); }
  return predicate();
}

async function standAt(bot, task, actions, p, range = 0) {
  // Already within reach of the cell: no walk. Standing on farmland (a
  // block less a sixteenth) the bot's feet floor into the farmland itself,
  // the pathfinder cannot start from inside a block, and the dream run
  // failed that walk a hundred and eight times planting its own plot.
  if (range && bot.entity.position.distanceTo(new Vec3(p.x + 0.5, p.y, p.z + 0.5)) <= range + 1) return;
  const goal = range ? new goals.GoalNear(p.x, p.y, p.z, range) : new goals.GoalBlock(p.x, p.y, p.z);
  await actions.navigate(bot, task, goal, { timeoutMs: 30000, stallMs: 8000 });
}

async function goHome(bot, task, goal, save, home, actions) {
  goal.step = { action: 'return_home', origin: home.origin, distance: Math.round(homeDistance(bot, home)) }; save();
  await actions.navigate(bot, task, new goals.GoalNear(home.origin.x, home.origin.y + 1, home.origin.z, 4), { timeoutMs: 120000, stallMs: 15000 });
}

async function equip(bot, name) {
  const item = bot.inventory.items().find(i => i.name === name);
  if (!item) throw Object.assign(new Error(`Need ${name.replaceAll('_', ' ')} at the base`), { name: 'Blocked' });
  await bot.equip(item, 'hand');
}

// The plot repair: whatever sits on a cell comes off, and ground that is
// not soil (a shell's cobblestone) is dug and replaced with dirt.
async function repairPlot(bot, task, goal, save, home, actions) {
  const { blocked } = plotStatus(bot, home);
  goal.step = { action: 'repair_plot', cells: blocked.length }; save();
  for (const p of blocked) {
    task.check(); checkAir(bot); checkThreats(bot);
    await standAt(bot, task, actions, { x: p.x, y: p.y + 1, z: p.z }, 2);
    const above = bot.blockAt(pos(p).offset(0, 1, 0));
    if (above && above.boundingBox === 'block') await actions.dig(bot, task, pos(p).offset(0, 1, 0), { requireDrops: false });
    else if (above && !['air', 'cave_air'].includes(above.name) && above.name !== 'wheat') await actions.dig(bot, task, pos(p).offset(0, 1, 0), { requireDrops: false });
    const ground = bot.blockAt(pos(p));
    if (ground && ground.name !== 'farmland' && !TILLABLE.has(ground.name)) {
      await actions.dig(bot, task, pos(p), { requireDrops: false });
      await actions.place(bot, task, pos(p), 'dirt');
    }
  }
  save();
}

// Tilling: a hoe on grass or dirt with air above. Standing on the cell is
// allowed; farmland under the feet is how every player tills.
async function tillPlot(bot, task, goal, save, home, actions) {
  const hoe = bot.inventory.items().filter(i => /_hoe$/.test(i.name))[0];
  if (!hoe) throw Object.assign(new Error('Need a hoe to till the plot'), { name: 'Blocked' });
  let tilled = 0;
  for (const p of plotStatus(bot, home).untilled) {
    task.check(); checkAir(bot); checkThreats(bot);
    goal.step = { action: 'till', cell: p, tilled }; save();
    await standAt(bot, task, actions, { x: p.x, y: p.y + 1, z: p.z }, 2);
    // A hoe only turns ground with nothing above it: leaf litter and grass
    // on the cell held the plot up for three tries a cell.
    const cover = bot.blockAt(pos(p).offset(0, 1, 0));
    // Water over a cell (the pond poured beside it, run over) is no cover a
    // hoe can clear, and digging it never ends: trial 28 stood forty-four
    // seconds on one cell. It waits with the cells the hoe would not turn.
    const stuck = () => { (home.plot.stubborn ||= {})[`${p.x},${p.y},${p.z}`] = Date.now() + 20 * 60 * 1000; save(); };
    if (cover && (/water|lava|bubble_column/.test(cover.name) || (cover.boundingBox === 'block' && cover.diggable === false))) { stuck(); continue; }
    if (cover && cover.name !== 'air' && cover.name !== 'cave_air') {
      try { await actions.dig(bot, task, pos(p).offset(0, 1, 0), { requireDrops: false }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; stuck(); continue; }
    }
    await bot.equip(hoe, 'hand');
    const block = bot.blockAt(pos(p));
    if (!block || !TILLABLE.has(block.name)) continue;
    await bot.lookAt(pos(p).offset(0.5, 1, 0.5), true);
    await bot.activateBlock(block, new Vec3(0, 1, 0));
    if (await waitFor(task, () => bot.blockAt(pos(p))?.name === 'farmland')) { tilled++; continue; }
    // Not turned from where it stood: once more from right beside it, then
    // the cell waits and the rest of the plot goes on.
    try { await actions.navigate(bot, task, new goals.GoalNear(p.x, p.y + 1, p.z, 1), { timeoutMs: 8000, stallMs: 3000 }); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; }
    const again = bot.blockAt(pos(p));
    if (again && TILLABLE.has(again.name)) {
      await bot.lookAt(pos(p).offset(0.5, 1, 0.5), true);
      await bot.activateBlock(again, new Vec3(0, 1, 0));
      if (await waitFor(task, () => bot.blockAt(pos(p))?.name === 'farmland')) { tilled++; continue; }
    }
    stuck();
  }
  if (!tilled) throw new Error('No plot cell became farmland');
  home.plot.tilledAt = new Date().toISOString(); save();
  return tilled;
}

async function plantPlot(bot, task, goal, save, home, actions) {
  let planted = 0;
  for (const p of plotStatus(bot, home).bare) {
    task.check(); checkAir(bot); checkThreats(bot);
    if (!countOf(bot, 'wheat_seeds')) break;
    goal.step = { action: 'plant', cell: p, planted }; save();
    await standAt(bot, task, actions, { x: p.x, y: p.y + 1, z: p.z }, 2);
    await equip(bot, 'wheat_seeds');
    const farmland = bot.blockAt(pos(p));
    if (farmland?.name !== 'farmland') continue;
    await bot.lookAt(pos(p).offset(0.5, 1, 0.5), true);
    try { await bot.placeBlock(farmland, new Vec3(0, 1, 0)); } catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; }
    if (await waitFor(task, () => bot.blockAt(pos(p).offset(0, 1, 0))?.name === 'wheat')) planted++;
  }
  if (!planted) throw new Error('No wheat seed took on the plot');
  home.plot.plantedAt = new Date().toISOString(); home.plot.checkedAt = home.plot.plantedAt; save();
  return planted;
}

// Ripe wheat is dug; the drops (wheat and seeds) are walked over; the cell
// is replanted while the seeds are still in hand.
async function harvestPlot(bot, task, goal, save, home, actions, { replant = true } = {}) {
  const before = countOf(bot, 'wheat');
  const cells = plotStatus(bot, home).grown;
  for (const p of cells) {
    task.check(); checkAir(bot); checkThreats(bot);
    goal.step = { action: 'harvest', cell: p, cells: cells.length }; save();
    const crop = pos(p).offset(0, 1, 0);
    await actions.dig(bot, task, crop, { requireDrops: false, done: () => bot.blockAt(crop)?.name !== 'wheat' });
  }
  if (cells.length) {
    await sleep(400);
    const drops = Object.values(bot.entities).filter(e => ['wheat', 'wheat_seeds'].includes(e.getDroppedItem?.()?.name) &&
      e.position.distanceTo(pos(home.origin)) < 8);
    for (const drop of drops.slice(0, 12)) {
      task.check();
      const d = drop.position.floored();
      await actions.navigate(bot, task, new goals.GoalNear(d.x, d.y, d.z, 0.5), { timeoutMs: 8000, stallMs: 3000, stopWhen: () => bot.entities[drop.id] !== drop || drop.isValid === false });
      await sleep(150);
    }
    home.plot.lastHarvestAt = new Date().toISOString();
  }
  home.plot.checkedAt = new Date().toISOString(); save();
  if (replant && plotStatus(bot, home).bare.length && countOf(bot, 'wheat_seeds')) await plantPlot(bot, task, goal, save, home, actions);
  return countOf(bot, 'wheat') - before;
}

async function placeOriented(bot, task, actions, stand, target, item, verify) {
  await standAt(bot, task, actions, stand);
  await equip(bot, item);
  const ground = bot.blockAt(pos(target).offset(0, -1, 0));
  if (ground?.boundingBox !== 'block') throw new Error(`No ground under ${item.replaceAll('_', ' ')} at ${pos(target)}`);
  await bot.lookAt(pos(target).offset(0.5, 0.5, 0.5), true);
  try { await bot.placeBlock(ground, new Vec3(0, 1, 0)); } catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; }
  if (!await waitFor(task, verify)) throw new Error(`${item.replaceAll('_', ' ')} did not go where it was placed`);
}

// A night shell left on the site: its cobblestone comes off the cells the
// bed, the chest and the placing stand need before anything is placed.
const STRAY = new Set(['cobblestone', 'cobbled_deepslate', 'dirt', 'netherrack', 'andesite', 'diorite', 'granite', 'stone', 'oak_planks', 'birch_planks', 'spruce_planks']);
async function clearStray(bot, task, actions, cells) {
  for (const p of cells) {
    task.check();
    const block = bot.blockAt(pos(p));
    if (block && block.boundingBox === 'block' && STRAY.has(block.name)) await actions.dig(bot, task, pos(p), { requireDrops: false });
  }
}

async function placeBed(bot, task, goal, save, home, actions, item) {
  const { bed } = layout(home);
  goal.step = { action: 'place_bed', item, at: bed.foot }; save();
  const up = (p, dy) => ({ x: p.x, y: p.y + dy, z: p.z });
  await clearStray(bot, task, actions, [bed.foot, bed.head, up(bed.foot, 1), up(bed.head, 1), bed.stand, up(bed.stand, 1), up(bed.stand, 2), up(bed.stand, -1) === undefined ? bed.stand : { x: bed.stand.x, y: bed.stand.y + 1, z: bed.stand.z }]);
  // A bed that landed the wrong way round is picked back up first.
  for (const p of [bed.foot, bed.head, pos(bed.foot).plus(pos(bed.foot).minus(pos(bed.head)))]) {
    if (isBed(bot.blockAt(pos(p))) && !(isBed(bot.blockAt(pos(bed.foot))) && isBed(bot.blockAt(pos(bed.head))))) await actions.dig(bot, task, pos(p), { requireDrops: false });
  }
  if (isBed(bot.blockAt(pos(bed.foot))) && isBed(bot.blockAt(pos(bed.head)))) return;
  await placeOriented(bot, task, actions, bed.stand, bed.foot, item, () => isBed(bot.blockAt(pos(bed.foot))) && isBed(bot.blockAt(pos(bed.head))));
  home.bed = { ...home.bed, item, placedAt: new Date().toISOString() }; save();
}

// The levelling: bumps and trees on the footprint come out, dips are
// filled, dirt where the plot goes and anything solid elsewhere.
async function levelSite(bot, task, goal, save, home, actions) {
  const work = siteWork(bot, goal, home, { strict: false });
  if (work.unloaded) throw new Error('The home site is not loaded');
  goal.step = { action: 'level_site', digs: work.digs.length, fills: work.fills.length }; save();
  // Trunks before crowns: the leaves of a felled tree decay on their own.
  for (const p of work.digs.sort((a, b) => a.y - b.y)) {
    task.check(); checkAir(bot); checkThreats(bot);
    if (clear(bot.blockAt(pos(p)))) continue;
    await actions.dig(bot, task, pos(p), { requireDrops: false });
  }
  for (const f of work.fills) {
    task.check(); checkAir(bot); checkThreats(bot);
    const item = f.item === 'dirt' || !countOf(bot, 'cobblestone') ? 'dirt' : 'cobblestone';
    await actions.place(bot, task, pos(f), item);
  }
  save();
}

// The bucket pond: the ground block at the water cell comes out, and the
// bucket is emptied onto the floor of the hole from the cell beside it.
// A one-block hole with solid sides keeps a source still.
async function pourWater(bot, task, goal, save, home, actions) {
  const w = pos(home.water);
  goal.step = { action: 'pour_water', at: home.water }; save();
  // Right beside the hole, looking steeply into it: from two blocks off the
  // bucket's aim grazed the ground beside the hole, the water landed a block
  // up and ran over the plot, and the hole filled from the spill so the pour
  // looked done (trial 28: a flooded plot cell the hoe stood over).
  await actions.navigate(bot, task, new goals.GoalNear(w.x, w.y + 1, w.z, 1), { timeoutMs: 20000, stallMs: 5000 });
  const spill = () => [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]].map(([x, z]) => w.offset(x, 1, z)).find(q => /^water$/.test(bot.blockAt(q)?.name || ''));
  if (bot.blockAt(w)?.name === 'water' && !spill()) { home.pouredAt = new Date().toISOString(); save(); return; }
  // Water above the ground is taken back up in the bucket before anything else.
  const over = spill();
  if (over && countOf(bot, 'bucket')) {
    await equip(bot, 'bucket'); task.check();
    await bot.lookAt(over.offset(0.5, 0.5, 0.5), true); bot.activateItem(); bot.deactivateItem?.();
    await waitFor(task, () => bot.blockAt(over)?.name !== 'water', 2500);
  }
  if (bot.blockAt(w)?.boundingBox === 'block') await actions.dig(bot, task, w, { requireDrops: false, plug: false });
  const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  if (!bucket) throw new Error('No water bucket for the home pond');
  await equip(bot, 'water_bucket'); task.check();
  await bot.lookAt(w.offset(0.5, 0.05, 0.5), true); task.check();
  bot.activateItem();
  try { await waitFor(task, () => bot.blockAt(w)?.name === 'water', 2500); } finally { bot.deactivateItem?.(); }
  if (bot.blockAt(w)?.name !== 'water') throw new Error('The water did not land in the hole beside the plot');
  if (spill()) throw new Error('The water spilled over the ground beside the hole; taking it back up next');
  home.pouredAt = new Date().toISOString(); save();
}

// Using the bed sets the respawn point whatever the hour: at night the
// bot sleeps, by day the server says so and sets the point anyway. Either
// message is the evidence; three unconfirmed uses are taken as done.
const SPAWN_MESSAGES = /set_spawn|bed\.no_sleep|bed\.not_safe|respawn point set/i;
async function claimBed(bot, task, goal, save, home, actions) {
  const { bed } = layout(home);
  goal.step = { action: 'claim_bed', at: bed.foot }; save();
  await standAt(bot, task, actions, bed.stand, 2);
  const block = bot.blockAt(pos(bed.foot));
  if (!isBed(block)) throw new Error('The bed is not where it was placed');
  let evidence = null;
  const onMessage = message => {
    const text = typeof message?.toString === 'function' ? message.toString() : String(message || '');
    const key = message?.json?.translate || message?.translate || '';
    if (SPAWN_MESSAGES.test(key) || SPAWN_MESSAGES.test(text)) evidence = key || text;
  };
  const onSleep = () => { evidence = 'slept'; };
  bot.on?.('message', onMessage); bot.on?.('sleep', onSleep);
  try {
    await bot.lookAt(pos(bed.foot).offset(0.5, 0.5, 0.5), true);
    await bot.activateBlock(block);
    await waitFor(task, () => !!evidence || bot.isSleeping, 3000);
    if (bot.isSleeping) { evidence ||= 'slept'; await sleep(2000); try { await bot.wake(); } catch (_) {} }
  } finally { bot.removeListener?.('message', onMessage); bot.removeListener?.('sleep', onSleep); }
  home.bed.attempts = (home.bed.attempts || 0) + 1;
  if (evidence || home.bed.attempts >= 3) {
    home.bed = { ...home.bed, claimedAt: new Date().toISOString(), evidence: evidence || 'assumed after three uses' };
    delete home.bed.attempts;
  }
  save();
  if (!home.bed.claimedAt) throw new Error('The bed did not confirm a respawn point');
}

async function buildPen(bot, task, goal, save, home, actions) {
  const { pen } = layout(home);
  const species = woodSpecies(bot), fence = `${species}_fence`, gate = `${species}_fence_gate`;
  const status = penStatus(bot, home);
  goal.step = { action: 'build_pen', fences: status.missingFences.length, gate: status.gateMissing }; save();
  const carriedFence = bot.inventory.items().find(i => /_fence$/.test(i.name))?.name || fence;
  for (const p of status.missingFences) { task.check(); checkAir(bot); checkThreats(bot); await actions.place(bot, task, pos(p), carriedFence); }
  if (status.gateMissing) {
    const carriedGate = bot.inventory.items().find(i => /_fence_gate$/.test(i.name))?.name || gate;
    await placeOriented(bot, task, actions, pen.gateStand, pen.gate, carriedGate, () => isGate(bot.blockAt(pos(pen.gate))));
  }
  if (penStatus(bot, home).fenced) { home.pen.builtAt = new Date().toISOString(); save(); }
}

// Wool comes off a sheep the same way mutton does; the foraging hunt does
// the chase and the wool is picked up beside the meat.
async function gatherWool(bot, task, goal, save, home, actions) {
  const before = woolCarried(bot).total;
  // Shears first, when carried or two ingots make a pair: three wool a
  // sheep, and the sheep is still there for the next bed.
  const shearing = require('./shearing');
  if (shearing.canShear(bot) && shearing.woollySheep(bot, goal).length) {
    try { if (await shearing.shearSheep(bot, task, goal, save, { navigate: actions.navigate, acquireStep: actions.acquireStep, want: before + 3 })) return; }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
  const { setAside, isSetAside } = require('./progress');
  const sheep = Object.values(bot.entities).filter(e => e.name === 'sheep' && e.isValid !== false && !isBaby(bot, e) && e.position.distanceTo(bot.entity.position) < 48 &&
    !isSetAside(goal, 'wool_sheep', e.uuid || e.id))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
  goal.step = { action: 'gather_wool', target: sheep ? plain(sheep.position.floored()) : null, carried: before }; save();
  // How long, and how far, without a sheep in sight (strategy.js says it).
  if (sheep) delete goal.woolSearch;
  else goal.woolSearch ||= { since: Date.now(), from: plain(bot.entity.position.floored()) };
  if (!sheep) { await actions.explore(bot, task, goal, save, 'sheep', { surfaceOnly: true }); return; }
  const where = sheep.position.clone();
  // A sheep that could not be had rests; the next try is another sheep, not
  // the nearest one again.
  let failure = null;
  try { await require('./foraging').hunt(bot, task, sheep, actions, goal, save); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; failure = err; }
  const drops = Object.values(bot.entities).filter(e => /_wool$/.test(e.getDroppedItem?.()?.name || '') && e.position.distanceTo(where) < 10);
  for (const drop of drops) {
    task.check();
    const d = drop.position.floored();
    await actions.navigate(bot, task, new goals.GoalNear(d.x, d.y, d.z, 0.5), { timeoutMs: 8000, stallMs: 3000, stopWhen: () => woolCarried(bot).total > before });
    await sleep(200);
  }
  if (woolCarried(bot).total <= before) {
    setAside(goal, 'wool_sheep', sheep.uuid || sheep.id, failure?.message || 'no wool from it', 180000);
    throw new Error(failure ? `No wool from the sheep: ${failure.message}` : 'No wool picked up from the sheep');
  }
}

async function closeGate(bot, task, home) {
  const { pen } = layout(home);
  const gate = bot.blockAt(pos(pen.gate));
  if (!isGate(gate)) return;
  const open = gate.getProperties?.().open;
  if (open === true || open === 'true') { await bot.lookAt(pos(pen.gate).offset(0.5, 0.5, 0.5), true); await bot.activateBlock(gate); await sleep(200); task.check(); }
}

// Cows follow wheat. Walk them to the pen, step in so they follow, put
// the wheat away, step out and shut the gate. Bounded and re-checked;
// a cow that wanders out is a lure for another day, not a stuck bot.
async function lureCows(bot, task, goal, save, home, actions) {
  const { pen } = layout(home);
  const outside = Object.values(bot.entities).filter(e => e.name === 'cow' && e.isValid !== false && !isBaby(bot, e) && !inside(pen.interior, e.position) &&
    e.position.distanceTo(bot.entity.position) < 48).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  const need = Math.max(0, 2 - penStatus(bot, home).cows);
  if (!outside.length || !need) throw new Error('No cows in view to lead to the pen');
  goal.step = { action: 'lure_cows', cows: outside.length, need }; save();
  const target = outside[0];
  await equip(bot, 'wheat');
  await actions.navigate(bot, task, new goals.GoalFollow(target, 2), { timeoutMs: 30000, stallMs: 8000, stopWhen: () => target.isValid === false });
  const following = () => outside.filter(e => e.isValid !== false && e.position.distanceTo(bot.entity.position) < 5).length;
  await waitFor(task, () => following() >= Math.min(need, outside.length), 15000);
  if (!following()) throw new Error('The cows did not follow the wheat');
  try {
    await equip(bot, 'wheat');
    await actions.navigate(bot, task, new goals.GoalBlock(pen.centre.x, pen.centre.y, pen.centre.z), { timeoutMs: 90000, stallMs: 10000 });
    await waitFor(task, () => penStatus(bot, home).cows >= Math.min(2, following() + penStatus(bot, home).cows), 30000);
    if (bot.heldItem?.name === 'wheat') await bot.unequip('hand');
    await actions.navigate(bot, task, new goals.GoalBlock(pen.gateStand.x, pen.gateStand.y, pen.gateStand.z), { timeoutMs: 30000, stallMs: 8000 });
  } finally { await closeGate(bot, task, home); }
  const penned = penStatus(bot, home).cows;
  home.pen.cows = penned; home.pen.luredAt = new Date().toISOString(); save();
  if (!penned) throw new Error('No cow stayed in the pen');
}

// Two adults fed wheat within a few seconds of each other breed once per
// cooldown; the calf is the proof and the pen count the record.
async function breedCows(bot, task, goal, save, home, actions) {
  const { pen } = layout(home);
  const status = penStatus(bot, home);
  if (status.adults < 2) throw new Error('Breeding needs two adult cows in the pen');
  goal.step = { action: 'breed_cows', adults: status.adults, wheat: countOf(bot, 'wheat') }; save();
  await standAt(bot, task, actions, pen.gateStand, 1);
  const before = countOf(bot, 'wheat');
  for (const cow of status.adultCows.slice(0, 2)) {
    task.check(); checkThreats(bot);
    await equip(bot, 'wheat');
    if (cow.position.distanceTo(bot.entity.position) > 4.5) {
      await actions.navigate(bot, task, new goals.GoalFollow(cow, 3), { timeoutMs: 15000, stallMs: 5000, stopWhen: () => cow.position.distanceTo(bot.entity.position) <= 4 });
    }
    await bot.lookAt(cow.position.offset(0, 0.7, 0), true);
    bot.useOn(cow);
    await sleep(400);
  }
  try { await closeGate(bot, task, home); } catch (_) {}
  const fed = before - countOf(bot, 'wheat');
  home.pen.lastBredAt = new Date().toISOString(); home.pen.lastBredAge = bot.time?.age ?? null; home.pen.cows = status.cows; save();
  if (fed < 2) throw new Error('The cows did not take the wheat');
}

// Steak from the pen: one cow beyond the breeding pair.
async function takeSteak(bot, task, goal, save, home, actions) {
  const status = penStatus(bot, home);
  if (status.adults < 3) throw new Error('The pen has only its breeding pair');
  const cow = status.adultCows.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
  goal.step = { action: 'take_steak', cows: status.cows }; save();
  try { await require('./foraging').hunt(bot, task, cow, actions, goal, save); }
  finally { try { await closeGate(bot, task, home); } catch (_) {} }
  home.pen.cows = penStatus(bot, home).cows; save();
}

async function bake(bot, task, goal, save, actions) {
  const loaves = Math.floor(countOf(bot, 'wheat') / BREAD_WHEAT);
  if (!loaves) return false;
  goal.step = { action: 'bake', loaves }; save();
  await actions.acquireStep(bot, task, 'bread', countOf(bot, 'bread') + loaves, goal, save);
  return true;
}

// Where home goes, of the sites found: Jev's, with each one's distance, the
// levelling it needs and its water. Without Jev, the first (the nearest
// flat one).
async function pickHomeSite(bot, task, goal, save, sites) {
  const client = task.opportunityClient;
  if (!client || sites.length < 2) return sites[0];
  const here = bot.entity.position;
  const tree = Object.fromEntries(sites.map((site, i) => {
    const levelling = site.work.digs.length + site.work.fills.length;
    const distance = Math.round(Math.hypot(site.origin.x - here.x, site.origin.z - here.z));
    return [`site_${i}`, { description: `A site ${distance} blocks away${site.anchor?.kind && site.anchor.kind !== 'here' ? ` near the remembered ${site.anchor.kind}` : ''}: ${levelling ? `${levelling} blocks to dig or fill to level it` : 'level already'}, ${site.pourWater ? 'no water beside it (a bucket is poured into a hole for the plot)' : 'beside natural water for the plot and the pond'}.` }];
  }));
  try {
    const { decide } = require('./decisions');
    const decision = await decide('home_site', { client, bot, task, goal, save, tree, state: { position: plain(here.floored()), sites: sites.length, timeOfDay: bot.time?.timeOfDay } });
    return sites[Number(/^site_(\d+)$/.exec(decision.path.at(-1) || '')?.[1] ?? 0)] || sites[0];
  } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return sites[0]; }
}

// One step of the home rung.
async function homeStep(bot, task, goal, save, stage, actions) {
  task.check(); checkAir(bot);
  const survival = goal.survival;
  if (stage.action === 'choose_site') {
    const sites = chooseBaseSite(bot, goal, { several: true }) ||
      // Two places looked at and still no water: the site is taken dry,
      // an empty bucket or not (trial 10 went after cave water with one and
      // ran out of trial). The pond is the water phase's, later.
      (survival.homeSearch?.attempts >= 2 && !countOf(bot, 'water_bucket') ? chooseBaseSite(bot, goal, { dryOk: true, several: true }) : null);
    const site = sites && await pickHomeSite(bot, task, goal, save, sites);
    if (!site && countOf(bot, 'bucket') && !countOf(bot, 'water_bucket')) {
      // No pond here, but an empty bucket: fill it wherever water is and
      // the next attempt can put the pond beside the plot.
      goal.step = { action: 'home_site', found: false, fillingBucket: true }; save();
      await actions.acquireStep(bot, task, 'water_bucket', 1, goal, save);
      return;
    }
    if (!site) {
      // Three failed looks from three different places, not three ticks in
      // one spot: an attempt counts once the bot has moved on or a minute
      // has passed, and between attempts the ladder goes on with its work.
      const search = survival.homeSearch ||= { attempts: 0 };
      const here = plain(bot.entity.position.floored());
      const moved = !search.lastAt || Math.hypot(search.lastAt.x - here.x, search.lastAt.z - here.z) >= 24 || Date.now() - (search.lastTriedAt || 0) > 60000;
      if (moved) { search.attempts++; search.lastAt = here; search.lastTriedAt = Date.now(); }
      setAside(goal, 'home_site', 'search', `no level ground beside water within ${SITE_RADIUS} blocks (look ${search.attempts})`, search.attempts >= 3 ? SITE_DEFER_MS : 60000);
      goal.step = { action: 'home_site', found: false, attempts: search.attempts }; save();
      throw new Error(`No level ground beside water within ${SITE_RADIUS} blocks for a home base`);
    }
    const home = establishHome(goal, site);
    goal.step = { action: 'home_site', origin: home.origin, anchor: home.anchor.kind, water: home.water }; save();
    return;
  }
  const home = homeOf(bot, goal);
  if (!home) return;
  switch (stage.action) {
    case 'return_home': return goHome(bot, task, goal, save, home, actions);
    case 'acquire': await actions.acquireStep(bot, task, stage.item, stage.count, goal, save); return;
    case 'gather_wool': return gatherWool(bot, task, goal, save, home, actions);
    case 'place_bed': return placeBed(bot, task, goal, save, home, actions, stage.item);
    case 'pour_water': return pourWater(bot, task, goal, save, home, actions);
    case 'level_site': return levelSite(bot, task, goal, save, home, actions);
    case 'claim_bed': return claimBed(bot, task, goal, save, home, actions);
    case 'till': return tillPlot(bot, task, goal, save, home, actions);
    case 'repair_plot': return repairPlot(bot, task, goal, save, home, actions);
    case 'plant': return plantPlot(bot, task, goal, save, home, actions);
    case 'build_pen': return buildPen(bot, task, goal, save, home, actions);
    case 'place_chest': return stash.placeStashChest(bot, task, goal, save, home, actions);
    case 'restock': return stash.restockFromStash(bot, task, goal, save, home, actions, stage.wants || []);
    default: throw new Error(`Unknown home step ${stage.action}`);
  }
}

// What the base can feed the bot right now, if it is within reach: loaves
// from ripe wheat and carried wheat, steak from cows beyond the pair.
function homeFood(bot, goal) {
  const home = homeOf(bot, goal);
  if (!home) return null;
  const distance = homeDistance(bot, home);
  if (distance > HOME_REACH) return null;
  const plot = plotStatus(bot, home), pen = penStatus(bot, home);
  const grown = plot.unloaded.length ? (home.plot.lastSeen?.grown || 0) : plot.grown.length;
  const loaves = Math.floor((grown + countOf(bot, 'wheat')) / BREAD_WHEAT);
  const steaks = Math.max(0, (plot.unloaded.length ? (home.pen.cows || 0) : pen.adults) - 2);
  if (!plot.unloaded.length) { home.plot.lastSeen = { grown: plot.grown.length, at: new Date().toISOString() }; home.pen.cows = pen.cows; }
  if (!loaves && !steaks) return null;
  return { distance: Math.round(distance), loaves, steaks, unloaded: plot.unloaded.length > 0 };
}

async function eatFromHome(bot, task, goal, save, actions) {
  const home = homeOf(bot, goal);
  if (!home) throw new Error('No home base');
  if (homeDistance(bot, home) > 6 || plotStatus(bot, home).unloaded.length) await goHome(bot, task, goal, save, home, actions);
  const plot = plotStatus(bot, home);
  if (plot.grown.length) await harvestPlot(bot, task, goal, save, home, actions);
  if (await bake(bot, task, goal, save, actions)) return;
  if (penStatus(bot, home).adults >= 3) { await takeSteak(bot, task, goal, save, home, actions); return; }
  throw new Error('Nothing to eat at the base after all');
}

// The chores Jev chooses between when nothing needs it, each feasible now.
// The dark ground around home, where monsters spawn between the bed, the
// plot and the pen: looked at once a minute (a few hundred cells).
const darkAtHome = new Map();
function homeDarkness(bot, home, now = Date.now()) {
  const key = `${home.origin.x},${home.origin.y},${home.origin.z}`;
  const cached = darkAtHome.get(key);
  if (cached && now - cached.at < 60000) return cached;
  const torches = require('./torches');
  const centre = pos(layout(home).footprint[31]).offset(0, 1, 0);
  const dark = torches.darkCells(bot, torches.groundCells(bot, centre, 10));
  const result = { at: now, dark: dark.length, plan: torches.torchPlan(dark) };
  darkAtHome.set(key, result);
  return result;
}
const torchMakings = bot => (countOf(bot, 'coal') + countOf(bot, 'charcoal')) > 0 &&
  (countOf(bot, 'stick') > 0 || bot.inventory.items().some(i => /_planks$|_log$/.test(i.name)));

function homeChores(bot, goal, { now = Date.now() } = {}) {
  const home = homeOf(bot, goal);
  if (!home || !(home.completedAt || homeComplete(bot, goal))) return {};
  const distance = Math.round(homeDistance(bot, home));
  if (distance > HOME_REACH) return {};
  const options = {}, plot = plotStatus(bot, home), pen = penStatus(bot, home), wheat = countOf(bot, 'wheat'), seeds = countOf(bot, 'wheat_seeds');
  const far = plot.unloaded.length > 0;
  const stale = far && now - Date.parse(home.plot.checkedAt || home.plot.plantedAt || 0) > 20 * 60 * 1000;
  if (!far && plot.grown.length + wheat >= BREAD_WHEAT) {
    options.harvest_and_bake = { description: `Harvest the ${plot.grown.length} ripe wheat on the home plot (${distance} blocks away), replant, and bake bread: three wheat a loaf, ${wheat} wheat already carried.`,
      run: (b, t, g, s, a) => harvestPlot(b, t, g, s, home, a).then(() => bake(b, t, g, s, a)) };
  } else if ((!far && (plot.grown.length || plot.untilled.length || (plot.bare.length && seeds > 0))) || stale) {
    options.tend_farm = { description: far ? `Walk back to the home plot (${distance} blocks away) and see how the wheat is doing; it was last checked a while ago.`
      : `Tend the home plot (${distance} blocks away): ${plot.grown.length} ripe, ${plot.growing.length} growing, ${plot.bare.length} bare, ${plot.untilled.length} untilled.`,
      run: async (b, t, g, s, a) => {
        if (homeDistance(b, home) > 6 || plotStatus(b, home).unloaded.length) await goHome(b, t, g, s, home, a);
        const status = plotStatus(b, home);
        if (status.untilled.length && hoeCarried(b)) await tillPlot(b, t, g, s, home, a);
        if (status.grown.length) await harvestPlot(b, t, g, s, home, a);
        else if (status.bare.length && countOf(b, 'wheat_seeds')) await plantPlot(b, t, g, s, home, a);
        home.plot.checkedAt = new Date().toISOString(); s();
      } };
  }
  // Light: torches where monsters could spawn around home, when some are
  // carried or can be made.
  if (!far) {
    const { dark, plan } = homeDarkness(bot, home, now);
    const carried = countOf(bot, 'torch');
    if (plan.length && (carried || torchMakings(bot))) options.light_home = {
      description: `Put ${plan.length} torch${plan.length === 1 ? '' : 'es'} around home: ${dark} spots between the bed, the plot and the pen are dark enough for monsters to spawn, and light stops them spawning (it does not drive off those already there). ${carried} torches carried${carried < plan.length ? '; the rest made from coal and sticks first' : ''}.`,
      run: async (b, t, g, s, a) => {
        if (countOf(b, 'torch') < plan.length) await a.acquireStep(b, t, 'torch', Math.ceil(plan.length / 4) * 4, g, s);
        if (homeDistance(b, home) > 8) await goHome(b, t, g, s, home, a);
        g.step = { action: 'light_home', torches: plan.length }; s();
        const placed = await require('./torches').placeTorches(b, t, a, plan, { max: plan.length });
        darkAtHome.delete(`${home.origin.x},${home.origin.y},${home.origin.z}`);
        if (!placed) throw new Error('No torch went down around home');
      } };
  }
  // Spares for the chest beside the bed, whenever the pockets have any.
  Object.assign(options, stash.stashChores(bot, goal));
  if (!far) {
    const age = bot.time?.age ?? 0;
    const cooled = !home.pen.lastBredAt || (Number.isFinite(home.pen.lastBredAge) ? age - home.pen.lastBredAge >= BREED_COOLDOWN_TICKS : now - Date.parse(home.pen.lastBredAt) > 6 * 60 * 1000);
    if (pen.adults >= 2 && wheat >= 2 && cooled) {
      options.breed_cows = { description: `Breed the ${pen.adults} adult cows in the home pen with two of the ${wheat} wheat carried; a calf is a steak in a few days.`,
        run: (b, t, g, s, a) => breedCows(b, t, g, s, home, a) };
    }
    const loose = Object.values(bot.entities || {}).filter(e => e.name === 'cow' && e.isValid !== false && !inside(layout(home).pen.interior, e.position) && e.position.distanceTo(bot.entity.position) < 48).length;
    if (pen.cows < 2 && wheat >= 1 && loose) {
      options.lure_cows = { description: `Lead ${Math.min(loose, 2 - pen.cows)} of the ${loose} cows in view into the home pen with wheat; the pen holds ${pen.cows} so far and needs two to breed.`,
        run: (b, t, g, s, a) => lureCows(b, t, g, s, home, a) };
    }
  }
  return options;
}

module.exports = { bedCarried, placeOriented, isBed, siteWork, levelSite, clearStray, repairPlot, HOME_REACH, BREAD_WHEAT, layout, inside, baseAnchor, siteFits, chooseBaseSite, establishHome, homeOf, homeDistance, goHome, plotStatus, bedStatus, penStatus,
  woolCarried, woodSpecies, homeStage, homeComplete, homeStep, tillPlot, plantPlot, harvestPlot, placeBed, claimBed, buildPen, gatherWool, lureCows, breedCows, takeSteak, bake,
  homeFood, eatFromHome, homeChores };
