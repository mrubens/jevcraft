'use strict';
// What counts as progress on a rung: a change in the rung's own measure, not
// displacement (the design review of 2026-09-28, note 646).
//
// The ledger (tried.js) called an answer "getting somewhere" when the bot
// moved more than three blocks, carried something different, or laid or dug a
// block. Fortress legs (no target), boxes built and heal-and-return cycles
// each did one of those every time: 25587 healed to full eleven times in six
// minutes at a cage with no kill (note 631), and a hand-dug tunnel of 62
// blocks that ended at a wall was "moved 62 blocks" (note 629). Note 629
// fixed the walks that had a place to go (an answer starting near where the
// nearest earlier one ended and ending no nearer). This is the general form:
// each rung has a small vector of numbers, each with a direction, and an
// answer under the rung came to something when one of them got better over
// the answer's life.
//
// The parts, by kind:
//   count     more is better: what the rung is for (rods, pearls, the piece
//             of gear), what the step in hand is for (its item, what it
//             drops, its block), blazes killed, food points carried,
//             milestones, the standing blocks of a portal frame. Not "anything
//             worth keeping": a flint picked up on the way is not the rung's,
//             and 25598 was counted as getting somewhere by one every few
//             minutes. Fewer is not worse and not better (eating, or a box's
//             walls, spend what is carried; that is not a loss of progress
//             and it is not a gain).
//   ground    more is better: columns of the Nether looked over at fortress
//             heights (nether-coverage seen; a tunnel dug blind looks over
//             none). New ground is a position measure.
//   distance  nearer is better: to the fortress found, to where blazes were
//             seen, to a blaze cage known, to the portal frame, to the
//             step's own target. Also position, and judged as the rung's
//             budget judges it: by a new nearest, not by how far the bot
//             walked. A nearest kept over thirty minutes is stale (a death
//             and a new approach must not be held to the last life's).
// Motion counts only through the position measures, so a walk of two
// hundred blocks toward a fortress is a new nearest at each answer, and a
// walk of thirty blocks along a tunnel already dug is not.
const NEARER = 2;                // a distance is nearer by more than this
const GROUND_CELLS = 4;          // new columns that make new ground
const BEST_KEEP_MS = 30 * 60000;
const COUNTS = new Set(['items', 'step_items', 'food', 'milestones', 'kills', 'frame']);
// Learned, not approached: the first time it is known is something.
const KNOWLEDGE = new Set(['fortress', 'blazes', 'cage']);
const bare = key => String(key).split('@')[0].split(':')[0];
const kindOf = key => COUNTS.has(bare(key)) ? 'count' : bare(key) === 'ground' ? 'ground' : 'distance';
const tolOf = key => bare(key) === 'food' ? 2 : kindOf(key) === 'ground' ? GROUND_CELLS : 1;
const label = s => String(s || '').replaceAll('_', ' ');
const round1 = v => Math.round(v * 10) / 10;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const P = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? { x: v.x, y: v.y, z: v.z } : null;
const dimOf = bot => String(bot?.game?.dimension || '').replace(/^minecraft:/, '').replace(/^the_/, '') || 'overworld';

// Deaths of what the rung hunts, counted near the bot (a blaze killed by
// the bot's sword, a shot, a fall it caused): the game says an entity died,
// not who killed it, so those within the fight's own reach are the bot's.
const HUNTED = /^(blaze|enderman)$/;
const KILL_RADIUS = 16;
function watchKills(bot) {
  if (!bot || typeof bot.on !== 'function' || bot.__killCount) return;
  bot.__killCount = true;
  bot.on('entityDead', e => {
    const name = e?.name, here = bot.entity?.position;
    if (!HUNTED.test(name || '') || !here || !e.position || dist(here, e.position) > KILL_RADIUS) return;
    const k = bot._kills ||= {};
    k[name] = (k[name] || 0) + 1;
  });
}

const popcount = n => { let c = 0; for (let x = n >>> 0; x; x &= x - 1) c++; return c; };
function groundCells(goal, dim) {
  const seen = goal?.fortressSearch?.coverage?.[dim]?.seen;
  if (!seen) return null;
  let n = 0;
  for (const mask of Object.values(seen)) n += popcount(mask);
  return n;
}

// The rung's parts now, read from the bot and the goal: { key: { v, what, at? } }.
// `items` are what the rung is for (tried.js rungItems), `target` the step's
// own target when it has one, `stepItems` the names the step in hand is for.
function parts(bot, goal, { rung, items = [], target = null, stepItems = [] } = {}) {
  const out = {};
  const here = bot?.entity?.position, dim = dimOf(bot);
  const put = (key, v, what, extra = {}) => { if (Number.isFinite(v)) out[key] = { v: round1(v), what, ...extra }; };
  const carried = names => (bot?.inventory?.items?.() || []).filter(i => names.includes(i.name)).reduce((n, i) => n + i.count, 0);
  items = [...new Set(items)];
  if (items.length) put('items', carried(items), items.map(label).join(' or '));
  const own = [...new Set(stepItems)].filter(n => !items.includes(n));
  if (own.length) put(`step_items:${own.slice().sort().join('+')}`, carried(own), own.map(label).join(' or '));
  const registry = bot?.registry?.foodsByName;
  if (registry) put('food', (bot.inventory?.items?.() || []).reduce((n, i) => n + i.count * (registry[i.name]?.foodPoints || 0), 0), 'food');
  put('milestones', Object.values(goal?.gameProgress?.milestones || {}).filter(Boolean).length, 'a milestone');
  const hunted = /blaze_rods/.test(rung) ? 'blaze' : /ender_pearls|craft_eyes/.test(rung) ? 'enderman' : null;
  if (hunted) { watchKills(bot); put('kills', bot._kills?.[hunted] || 0, `${hunted}s`, { hunted }); }
  const at = (name, p, what) => { const q = P(p); if (here && q) put(`${name}@${dim}`, dist(here, q), what, { at: q }); };
  const nearest = (list, what, name) => {
    const ps = (list || []).map(P).filter(Boolean).sort((a, b) => dist(a, here) - dist(b, here));
    if (here && ps[0]) at(name, ps[0], what);
  };
  if (/blaze_rods/.test(rung) && here) {
    const fs = goal?.fortressSearch;
    at('fortress', fs?.approach?.found || fs?.found, 'the fortress');
    nearest((goal?.mobHunt?.sightings || []).filter(s => !s.dimension || dimOf({ game: { dimension: s.dimension } }) === dim), 'the nearest place blazes were seen', 'blazes');
    nearest(fs?.map?.spawners, 'the nearest blaze cage known', 'cage');
    const g = dim === 'nether' && fs ? groundCells(goal, 'nether') : null;
    if (g !== null) put('ground', g, 'ground');
  }
  if (/reach_nether/.test(rung)) {
    const frame = goal?.portalFrame;
    if (Array.isArray(frame?.blocks) && typeof bot.blockAt === 'function') {
      let placed = 0;
      try { placed = frame.blocks.filter(p => { const b = bot.blockAt(p); return b?.name === 'obsidian'; }).length; } catch (_) { placed = 0; }
      put('frame', placed, "the portal frame's blocks standing");
    }
    // The frame's place, and the portals known in this dimension (a ruined
    // one found, one built earlier).
    const known = [frame?.origin, ...(goal?.portals || []).filter(p => !p.dimension || dimOf({ game: { dimension: p.dimension } }) === dim)];
    nearest(known, 'the nearest portal', 'portal');
  }
  const t = P(target);
  if (t && here) put(`step:${Math.round(t.x / 4)},${Math.round(t.y / 4)},${Math.round(t.z / 4)}@${dim}`, dist(here, t), "the step's target", { at: t });
  return out;
}
const values = p => Object.fromEntries(Object.entries(p || {}).map(([k, x]) => [k, x.v]));

// The nearest each distance has been, { key: { v, at } }, shared by every
// answer under the rung: an answer is a new nearest, or was in force while
// one was set. Begun from what the answer began with, so that where the bot
// stood is a baseline and not itself a gain.
function observe(p, store, at = Date.now()) {
  if (!store) return;
  for (const [key, x] of Object.entries(p || {})) {
    if (kindOf(key) !== 'distance') continue;
    const b = store[key];
    if (!b || at - b.at >= BEST_KEEP_MS || x.v < b.v - NEARER) store[key] = { v: x.v, at };
  }
  for (const [key, b] of Object.entries(store)) if (at - b.at >= 2 * BEST_KEEP_MS) delete store[key];
}

const gainSays = (key, x, was) => {
  const k = bare(key);
  if (k === 'items' || k === 'step_items') return `${x.v - was} more ${x.what}`;
  if (k === 'kills') return `${x.v - was === 1 ? 'a' : x.v - was} ${x.hunted}${x.v - was === 1 ? '' : 's'} killed`;
  if (k === 'ground') return `${plural(x.v - was, 'new column')} of ground looked over`;
  if (k === 'frame') return `${plural(x.v - was, 'more block')} of the portal frame standing`;
  if (k === 'milestones') return 'a milestone reached';
  if (k === 'food') return `${x.v - was} more food points carried`;
  return label(k);
};
const nothingSays = (key, x, was, base) => {
  const k = bare(key);
  if (k === 'items' || k === 'step_items') return `no ${label(x.what).replace(/^blaze /, '')}`;
  if (k === 'kills') return 'killed nothing';
  if (k === 'ground') return 'no new ground looked over';
  if (k === 'frame') return 'no more of the portal frame standing';
  if (k === 'food') return 'no food gained';
  if (kindOf(key) === 'distance') return `no nearer ${x.what} (${Math.round(x.v)} blocks off, the nearest yet ${Math.round(base ?? x.v)})`;
  return null;
};

// What came of an answer, from the parts at its beginning (`before`,
// values) and now (`parts`), against the nearest kept in `store`.
// -> { came: string|null, nothing: [{ key, says, distance? }] }; the store is brought up to date.
function judge({ before = {}, parts: now = {}, store = null, since = 0, at = Date.now() }) {
  const gains = [], nothing = [];
  for (const [key, x] of Object.entries(now)) {
    const kind = kindOf(key), was = before[key];
    if (kind !== 'distance') {
      if (was === undefined) continue;
      if (x.v >= was + tolOf(key)) gains.push(gainSays(key, x, was));
      else if (key !== 'milestones') nothing.push({ key: bare(key), says: nothingSays(key, x, was) });
      continue;
    }
    const b = store?.[key], fresh = b && at - b.at < BEST_KEEP_MS ? b : null;
    const base = Math.min(was ?? Infinity, fresh?.v ?? Infinity);
    if (base === Infinity) {
      if (KNOWLEDGE.has(bare(key))) gains.push(`${label(x.what)} learned, ${Math.round(x.v)} blocks off`);
      continue;
    }
    if (x.v < base - NEARER) gains.push(`nearer ${x.what}, ${Math.round(x.v)} blocks off from ${Math.round(base)}`);
    else if (fresh && fresh.at >= since && was !== undefined && fresh.v < was - NEARER) gains.push(`nearer ${x.what}, ${Math.round(fresh.v)} blocks off from ${Math.round(was)}`);
    else nothing.push({ key: bare(key), distance: true, says: nothingSays(key, x, was, base) });
  }
  observe(now, store, at);
  return { came: gains.length ? gains.join(', ') : null, nothing: nothing.filter(n => n.says) };
}

// The same by values alone, with no store: what the repeat rule asks of two
// looks a few seconds apart (decisions/repeats.js cameOf).
function changed(before = {}, now = {}) {
  const gains = [];
  for (const [key, v] of Object.entries(now)) {
    const was = before[key], kind = kindOf(key);
    if (kind !== 'distance') { if (was !== undefined && v >= was + tolOf(key)) gains.push(gainSays(key, { v, what: label(bare(key)) }, was)); continue; }
    if (was === undefined) { if (KNOWLEDGE.has(bare(key))) gains.push(`${label(bare(key))} learned`); continue; }
    if (v < was - NEARER) gains.push(`nearer ${label(bare(key))}`);
  }
  return gains.length ? gains.join(', ') : null;
}

// The reason an answer came to nothing, in the measure's own words:
// "killed nothing, no rod, ended 6 blocks from where it began". `nothing` is
// judge's list, each by its part; the parts that measure what the rung is for
// come first, the distances last; food only for a question about food.
const ORDER = ['kills', 'items', 'step_items', 'ground', 'frame'];
function says(nothing, moved, { food = false } = {}) {
  const ended = Number.isFinite(moved) ? (moved < 1.5 ? 'ended where it began' : `ended ${Math.round(moved)} blocks from where it began`) : null;
  const of = list => nothing.filter(n => list.includes(n.key)).map(n => n.says);
  const list = [...ORDER.flatMap(k => of([k])), ...(food ? of(['food']) : []),
    ...nothing.filter(n => n.distance).slice(0, 2).map(n => n.says), ended].filter(Boolean);
  return list.length ? `nothing gained on the rung: ${list.join(', ')}` : null;
}

module.exports = { parts, values, observe, judge, changed, says, watchKills, kindOf, NEARER, GROUND_CELLS, BEST_KEEP_MS, KNOWLEDGE };
