'use strict';
// Wood in the Nether: the stems of its forests. A crimson or warped stem
// (or hyphae) is a log of the Nether: four crimson or warped planks, and
// from them sticks, a crafting table and wooden tools, as from any log.
// A stem needs no tool to drop and breaks by hand in about three seconds.
//
// No trial fetched them for itself. 25583 (mid-243-cg, note 655) stood on a
// cell of a basalt delta with thirty iron ingots, no pickaxe and no wood,
// nineteen warped stems eleven blocks north of it: the pickaxe could not be
// made (mob-hunt.js pickaxeFirst: no wood for the sticks and the table), so
// make_pickaxe was not offered and nothing offered the wood. 25585 tunnelled
// its legs by hand with one plank. The stems are asked for like any mine
// step (work.js acquireStep): the stems in reach are dug, and where none
// are, the Nether's gathering asks the way (nether-gather.js: to each place
// they are known on foot, straight across, down to the floor, or legs of a
// search where none is known). This offers the trip, with the shortfall said
// against what is wanted and why, before the bot is stranded as well as
// after.
const { goals } = require('mineflayer-pathfinder');
const { setAside, isSetAside } = require('./progress');

const inNether = bot => /nether/.test(String(bot.game?.dimension || ''));
const words = s => String(s).replaceAll('_', ' ');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const at3 = p => `(${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`;
const retryable = err => !['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name);
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const compass = (from, to) => COMPASS[((Math.round(Math.atan2(to.z - from.z, to.x - from.x) / (Math.PI / 4)) % 8) + 8) % 8];

// Planks a table, a pickaxe's head, and a craft of sticks (two planks make
// four sticks, two pickaxes' handles).
const TABLE = 4, HEAD = 3, STICK_CRAFT = 2, STICKS_PER_CRAFT = 4, STICKS_PER_PICK = 2;
// Wood of any kind: a log, stem, wood or hyphae makes four planks.
const LOGLIKE = /^(?:stripped_)?[a-z_]+_(?:log|wood|stem|hyphae)$/;
// A stem of the Nether's forests.
const STEM = /^(?:crimson|warped)_(?:stem|hyphae)$/;
// The places the stems are known looked at within this when a pickaxe is
// carried: a top-up offered while a forest is near (the look's own reach,
// nether-gather.js SEE). With no pickaxe and none to be made, anywhere.
const NEAR = 128;
// The fetch: acquire steps at most, a time for all of them, the steps in a
// row that gain no wood and come no nearer before it ends.
const FETCH_STEPS = 24, FETCH_MS = 12 * 60000, IDLE_STEPS = 3;
// A fetch that gained nothing rests this long.
const REST_MS = 10 * 60000;
// An axe's speed on wood by its material (26.1.2 tool tiers).
const AXE_SPEED = { wooden: 2, stone: 4, copper: 5, iron: 6, diamond: 8, netherite: 9, golden: 12 };

const items = bot => bot.inventory?.items?.() || [];
const sum = (bot, re) => items(bot).filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);

// The wood carried, counted in planks.
function woodCarried(bot) {
  const logs = sum(bot, LOGLIKE), planks = sum(bot, /_planks$/), sticks = sum(bot, /^stick$/), table = sum(bot, /^crafting_table$/) > 0;
  const said = [logs && plural(logs, 'log or stem', 'logs or stems'), planks && plural(planks, 'plank'), sticks && plural(sticks, 'stick'), table && 'a crafting table'].filter(Boolean).join(', ');
  return { logs, planks: logs * 4 + planks, sticks, table, said: said || 'no wood' };
}

// What the wood carried is wanted for: the pickaxe to make now where none is
// carried, and a spare after it (the Nether's pickaxes wear out on the legs:
// note 654's iron one did, with no wood for another). Each wants two sticks
// and a head (three iron ingots, three cobblestone or blackstone, else three
// planks), and one crafting table makes them. The heads carried are used
// first. Counted in planks, against the planks' worth carried.
function woodWanted(bot) {
  const picked = items(bot).some(i => /_pickaxe$/.test(i.name));
  const picks = (picked ? 0 : 1) + 1;
  const iron = Math.floor(sum(bot, /^iron_ingot$/) / 3), stone = Math.floor(sum(bot, /^(cobblestone|cobbled_deepslate|blackstone)$/) / 3);
  const heads = [...Array(iron).fill('iron'), ...Array(stone).fill('stone')].slice(0, picks);
  while (heads.length < picks) heads.push('wooden');
  const carried = woodCarried(bot);
  const sticksShort = Math.max(0, STICKS_PER_PICK * picks - carried.sticks);
  const stickPlanks = Math.ceil(sticksShort / STICKS_PER_CRAFT) * STICK_CRAFT;
  const headPlanks = heads.filter(h => h === 'wooden').length * HEAD;
  const tablePlanks = carried.table ? 0 : TABLE;
  const want = tablePlanks + stickPlanks + headPlanks;
  const short = Math.max(0, want - carried.planks);
  const named = heads.map((h, i) => `${i === 0 && !picked ? 'the pickaxe to make now' : 'a spare'} (${h === 'iron' ? 'iron, from the ingots carried' : h === 'stone' ? 'stone, from the cobblestone or blackstone carried' : 'wooden, its head three planks'})`);
  const parts = [tablePlanks && `a crafting table (${TABLE} planks)`, stickPlanks && `the sticks for ${plural(picks, 'pickaxe')} (${STICKS_PER_PICK * picks} sticks, ${carried.sticks ? `${carried.sticks} carried, ` : ''}${stickPlanks} planks)`,
    headPlanks && `${headPlanks / HEAD === 1 ? 'a wooden head' : `${headPlanks / HEAD} wooden heads`} (${headPlanks} planks)`].filter(Boolean);
  return { picked, picks, heads, carried, want, short, stems: Math.ceil(short / 4),
    says: `Wanted in wood: ${want} planks' worth for ${named.join(' and ')}${parts.length ? `: ${parts.join(', ')}` : ''}; carried: ${carried.said} (${carried.planks} planks' worth)${short ? `, ${short} short: ${plural(Math.ceil(short / 4), 'stem')} (${Math.ceil(short / 4) * 4} planks)` : ''}.` };
}

// The places stems are known (nether-gather.js knownPlaces: in view within
// 128, remembered, or a Nether forest noticed or in the loaded ground).
// The upkeep looks between every work step: the look is kept ten seconds
// while the bot stays within four blocks.
const looked = new WeakMap();
function stemPlaces(bot, goal, { fresh = false } = {}) {
  const here = bot.entity.position, last = looked.get(bot);
  if (!fresh && last && Date.now() - last.at < 10000 && last.from.distanceTo(here) <= 4) return last.places;
  const names = Object.keys(bot.registry?.blocksByName || {}).filter(n => STEM.test(n));
  let places = [];
  try { places = require('./nether-gather').knownPlaces(bot, goal, names); } catch (_) { places = []; }
  looked.set(bot, { at: Date.now(), from: here.clone ? here.clone() : here, places });
  return places;
}
const kindOf = name => /^warped/.test(name) ? 'warped' : 'crimson';
// What lives in each forest, from the game's spawn tables (26.1.2).
const FOREST_SAYS = {
  crimson: 'a crimson forest: hoglins (hostile on sight, they charge and toss, 40 health; they shy from warped fungus) and piglins (hostile unless gold is worn) spawn there',
  warped: 'a warped forest: endermen spawn there (and striders on its lava), no hoglin or piglin does; an enderman turns on a look at its head from as far as 64 blocks, and every look the bot makes, a dig\'s among them, is kept off endermen\'s eyes (gaze.js)',
};
// The mobs of that kind about the place, as far as loaded.
function mobsAbout(bot, at) {
  const kinds = ['hoglin', 'piglin', 'enderman', 'zombified_piglin', 'ghast'];
  const n = {};
  for (const e of Object.values(bot.entities || {})) if (kinds.includes(e?.name) && e.position && e.position.distanceTo(at) <= 24) n[e.name] = (n[e.name] || 0) + 1;
  return Object.entries(n).map(([k, c]) => `${c} ${words(k)}${c === 1 ? '' : 's'}`).join(', ');
}
// A stem by hand, and with the best axe carried.
function stemSeconds(bot) {
  const hardness = bot.registry?.blocksByName?.warped_stem?.hardness ?? 2;
  const axe = items(bot).map(i => /^([a-z]+)_axe$/.exec(i.name)?.[1]).filter(m => AXE_SPEED[m]).sort((a, b) => AXE_SPEED[b] - AXE_SPEED[a])[0];
  const hand = Math.round(hardness * 1.5 * 10) / 10;
  return `a stem needs no tool to drop and breaks by hand in about ${hand} seconds${axe ? `, about ${Math.round(hardness * 1.5 / AXE_SPEED[axe] * 10) / 10} with the ${axe} axe carried` : ''}`;
}
// The pathfinder's look at the walk there, half a second.
async function routeSays(bot, task, at) {
  const m = bot.pathfinder?.movements;
  if (!m || !(bot.pathfinder.getPathFromTo || bot.pathfinder.getPathTo)) return '';
  let r = null;
  try { r = await require('./skills').surveyRoute(bot, task, m, new goals.GoalNear(at.x, at.y, at.z, 3), 500); }
  catch (err) { if (!retryable(err) || err.name === 'Stalled') throw err; return ''; }
  if (r?.status === 'success') return ` A route survey from here found a way there on foot, ${plural(r.path?.length || 0, 'step')}.${r.lava?.beside ? ` ${require('./movement').lavaAlongSays(r.lava, bot)}` : ''}`;
  if (r?.status === 'noPath') return ' A route survey from here found no way there on foot (the bot\'s own walks in the Nether take a cell with lava round it at its cost, crouched, but none with the lava a block to a side while a touch of it is death, nor one in line with something that can push the bot); the way there is asked on the spot as the gathering asks it: on foot as far as it goes, straight across at this height with the blocks carried, or down to the floor and along it.';
  return ' A half-second route survey from here did not finish (far, or a long way round); the way there is asked on the spot as the gathering asks it.';
}

// The option, said: the shortfall and what it is for, the nearest forest
// (its distance, direction, kind and mobs, the route survey), what a stem
// takes, and what the wood carried does later. Null where nothing is short,
// the fetch rests, or (with a pickaxe carried) no stems are known within
// 128 blocks.
async function fetchStemsOffer(bot, task, goal) {
  if (!inNether(bot) || bot.game?.gameMode === 'creative' || !bot.entity?.position) return null;
  if (isSetAside(goal, 'fetch_stems', 'nether')) return null;
  const wanted = woodWanted(bot);
  if (!wanted.short) return null;
  const here = bot.entity.position;
  const stranded = !wanted.picked && require('./mob-hunt').pickaxeFirst(bot).none;
  const places = typeof bot.findBlocks === 'function' ? stemPlaces(bot, goal) : [];
  const place = places[0] || null;
  if (!stranded && !(place && place.at.distanceTo(here) <= NEAR)) return null;
  // Said without the route survey at once, and with it by `describe` (half a
  // second of the pathfinder), for a question about to be asked.
  // Where the stems are leads, before the wood's sums: 25590's upkeep
  // (2026-09-30 01:35Z) said them after four hundred characters of planks
  // and sticks, and carry_on was taken over it 0.68 to 0.31 (note 709).
  const say = route => {
    let lead, where = '';
    if (place) {
      const kind = kindOf(place.name), off = Math.round(place.at.distanceTo(here)), dy = Math.round(place.at.y - here.y);
      const mobs = mobsAbout(bot, place.at);
      lead = `The nearest stems: ${place.n ? `${plural(place.n, words(place.name))} known` : `none known yet in ${place.forest}`} at ${at3(place.at)}, ${off} blocks ${compass(here, place.at)}${Math.abs(dy) >= 2 ? ` and ${Math.abs(dy)} ${dy > 0 ? 'up' : 'down'}` : ''}.`;
      where = `${capital(FOREST_SAYS[kind])}${mobs ? `; about it now: ${mobs}` : ''}.` +
        route + (places[1] ? ` Next nearest: ${words(places[1].name)}s ${Math.round(places[1].at.distanceTo(here))} blocks ${compass(here, places[1].at)}.` : '');
    } else lead = 'No stem is known: none seen within 128 blocks or remembered, and no crimson or warped forest noticed or in the loaded ground. The fetch then asks the legs of the gathering\'s search, each said with the Nether forests that way as far as loaded.';
    // What the pickaxe is short of, which this fetch brings (note 705).
    const short = stranded ? require('./mob-hunt').pickaxeFirst(bot).short : null;
    const pick = wanted.picked ? '' : stranded
      ? ` No pickaxe is carried: it is short of ${short ? `${short.planks} planks (${plural(short.stems, 'stem')}) for ${short.for || 'it'}, which this fetch brings; then ${short.then}` : 'wood, which this fetch brings'}. Until then rock is dug by hand and drops nothing.`
      : ' No pickaxe is carried.';
    const later = LATER;
    const makes = wanted.picked ? '' : ' The pickaxe is made as soon as the wood for it is carried.';
    return `Fetch ${plural(wanted.stems, 'stem')} of the Nether's forests now. ${lead}${pick} ${wanted.says}${where ? ` ${where}` : ''} ${capital(stemSeconds(bot))}.${makes}${later}`;
  };
  return { wanted, place, stranded, description: say(''), describe: async () => say(place ? await routeSays(bot, task, place.at) : '') };
}
const capital = s => `${s[0].toUpperCase()}${s.slice(1)}`;
// What the wood does later, said last: left out where the pickaxe is not
// what the work needs now (work.js upkeepStep at the cage, note 700).
const LATER = ' Wood carried is sticks for the next pickaxe wherever one wears out (two a pickaxe) and a crafting table wherever the bot is; with any pickaxe, blackstone (basalt deltas, bastions) makes a stone one, three of it and two sticks.';

// The fetch: the stems of the nearest kind known, asked for as a mine step
// (acquireStep), which digs those in reach and otherwise asks the way there
// (nether_gather), step by step until the planks' worth wanted is carried,
// a step comes no nearer and gains nothing three times in a row, or twelve
// minutes pass; then the pickaxe, where none is carried. A fetch that
// gained nothing rests ten minutes and says why.
async function fetchStems(bot, task, goal, save, { acquireStep, count = (b, n) => sum(b, new RegExp(`^${n}$`)) } = {}) {
  const wanted = woodWanted(bot);
  const start = woodCarried(bot).planks;
  const began = Date.now();
  goal.step = { action: 'fetch_stems', want: wanted.stems, have: start }; save();
  // What the gathering's questions are asked for meanwhile: going on without
  // is going without these stems and the pickaxe they make, not the rung
  // (nether-gather.js withoutOption, note 700).
  const errandWas = bot._errand;
  bot._errand = { key: 'fetch_stems', stems: wanted.stems, for: wanted.picked ? 'a spare pickaxe and sticks' : 'a pickaxe' };
  try { return await fetchStemsRun(bot, task, goal, save, { acquireStep, count, wanted, start, began }); }
  finally { bot._errand = errandWas; }
}
async function fetchStemsRun(bot, task, goal, save, { acquireStep, count, wanted, start, began }) {
  const target = start + wanted.stems * 4;
  let idle = 0, why = null, stepped = 0;
  const near = () => { const p = stemPlaces(bot, goal, { fresh: true })[0]; return p ? p.at.distanceTo(bot.entity.position) : null; };
  for (let n = 0; n < FETCH_STEPS && woodCarried(bot).planks < target && Date.now() - began < FETCH_MS && idle < IDLE_STEPS; n++) {
    task.check();
    const place = stemPlaces(bot, goal, { fresh: true })[0];
    const stem = place ? `${kindOf(place.name)}_stem` : 'crimson_stem';
    const before = woodCarried(bot).planks, was = place ? place.at.distanceTo(bot.entity.position) : null;
    const left = Math.ceil((target - before) / 4);
    try { await acquireStep(bot, task, stem, count(bot, stem) + left, goal, save); stepped++; }
    catch (err) { task.check(); if (!retryable(err)) throw err; why = String(err.message || err).slice(0, 200); }
    // Jev chose to go on without the wood (nether_gather's without).
    if (goal.step?.action === 'go_without' || goal.stemsWithout?.at >= began) return { gained: woodCarried(bot).planks - start, without: true };
    const now = near();
    idle = woodCarried(bot).planks > before || (was !== null && now !== null && was - now >= 4) ? 0 : idle + 1;
  }
  const gained = woodCarried(bot).planks - start;
  if (gained <= 0) {
    const said = `No stems were fetched${why ? `: ${why}` : stepped ? '' : ': no step was taken'}`;
    setAside(goal, 'fetch_stems', 'nether', said, REST_MS); save();
    throw new Error(said);
  }
  // The pickaxe, where none is carried and the wood now makes one.
  if (!items(bot).some(i => /_pickaxe$/.test(i.name))) {
    const pick = require('./mob-hunt').pickaxeFirst(bot);
    if (!pick.carried && !pick.none && pick.item) {
      goal.step = { action: 'make_pickaxe', item: pick.item, for: 'fetch_stems' }; save();
      for (let n = 0; n < 8 && !items(bot).some(i => /_pickaxe$/.test(i.name)); n++) {
        task.check();
        try { await acquireStep(bot, task, pick.item, count(bot, pick.item) + 1, goal, save); }
        catch (err) { task.check(); if (!retryable(err)) throw err; return { gained, unmade: `${pick.name} was not made: ${err.message}` }; }
      }
    }
  }
  return { gained };
}

module.exports = { LATER, woodCarried, woodWanted, fetchStemsOffer, fetchStems, stemPlaces, FOREST_SAYS, NEAR, REST_MS };
