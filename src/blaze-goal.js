'use strict';
// Once blazes are known and rods are owed, the questions offer ways to the
// blazes, the rods' carry-out and the body's safety (note 783).
//
// The reviewer's check-in of 2026-10-01 05:43Z (problem 3): "once blazes are
// seen and rods are owed, offer only ways to those blazes, each priced".
// Measured (scripts/blaze-span.js over the flight records from 2026-09-30
// 06Z, the oldest kept, to 2026-10-01 05Z): 59 trials saw a blaze or a blaze
// spawner; 39 took a rod (median 2.8 minutes after), 1 carried seven, 1 left
// the Nether alive (with 3); 43 deaths there. Of the 1,132 Nether bot-minutes
// after the first sighting, 437 were busy but not progressing. Of the 2,026
// questions about the work asked there (not the body's in the moment), 328
// were answered with an errand that is no way to the blazes: the search for
// another fortress 119, wood and pickaxes 72, gathering 67, a food errand
// with food carried or hunger at 18 or more 38, mining 12, blocks 10,
// cooking 8, a rung set aside 2; 223 of them (110 bot-minutes held) with a
// way to the blazes offered in the same question or the bot within 32 blocks
// of where blazes were seen.
//
// Where they came from: every question about the work is built by its own
// asker from its own ladder (upkeep's spare pickaxe and stems, nether_gather's
// wood for the step under way, stillness_detour's and rung_progress's detours,
// the fortress leg's legs and floors, the approach's errands, the food
// questions), and none of them knew that the goal's next rods were within
// reach. Note 750e cut the fortress leg's searches where its own way to the
// blazes was offered; nothing did it for the other askers.
//
// The rule (gate, applied in decide() to every question about the work, not
// the body's questions in the moment): in the Nether with rods still needed,
// where blazes are known (in sight, seen at a place, or their spawner on the
// fortress map; not a place Jev left) and reachable as far as the record
// goes (a way to them offered in this question, or the bot within 32 blocks
// of them, the hunt's own look), an option that is none of
//   a way to the blazes (a walk, a crossing, a dig or climb, a wait or a box
//     at the spawner, a fight), each said with its record;
//   the rods' carry-out (bank, stash, pick up, the way back with rods);
//   the body's safety (heal, eat what is carried, wall in, cover, a pocket,
//     a stall's way free; a food errand when nothing safe to eat is carried
//     and hunger is under 18, where health stops coming back);
//   keeping on with what is under way;
// is not offered, said in toTheBlazes with the blazes known and the record.
// Where every option would be left out, all stay on offer, said so. Nothing
// is chosen here: Jev answers among what is left.
//
// classify(question, key) -> 'toward', 'carry', 'leave' (back through the
// portal: carry with rods, the body's for food, else off), 'food', 'body',
// 'keep', 'reflex', 'off' (family names it) or 'other' (not named: left).

const BLAZES_AT = 32;          // the hunt's look, and blazes "at" a fortress (mob-hunt.js BLAZES_AT)
const REGEN_HUNGER = 18;       // the game's: natural healing stops under 18 hunger
const off = () => process.env.JEV_BLAZE_GOAL === '0';

const REFLEX_Q = new Set(['turn_priority', 'encounter_stance', 'shot_answer', 'body_way', 'unstuck_move', 'way_down', 'climb_out', 'survival_priority', 'shelter_method', 'ranged_response']);

// Per question first, then any question.
const TOWARD_Q = {
  fortress_approach: /^(walk_route|cross_level|tunnel|pillar_up|blocks_then_pillar|blocks_then_cross|dig_through|descend|cover_lava|scoop_lava|span_round|head_toward)$/,
  fortress_visit: /^go_in$/,
  empty_spawner: /^(box_here|stand_by_spawner|hunt_on|open_slit|box_in_line|box_at_spawner|dig_in_at_spawner|pull_back)$/,
  hunt_target: /^(hunt_\d+|charge_nearest|close_in|fight_at_spawner|back_to_wall|box_here|box_at_spawner|box_in_line|dig_in_and_fight|fetch_rod_\d+|rise_to_strike|await_in_reach|stay_and_fight)$/,
  combat_kit: /^fight_with_carried$/,
  fortress_leg: /^(blazes_\w+|go_to_blazes(_about)?|go_to_spawner(_\d+)?|wait_at_spawner|stay_in_fortress|back_to_fortress|unwalked_\d+|blocks_then_cross|pillar_up|blocks_then_pillar)$/,
};
const TOWARD = /^(blazes_\w+|go_to_blazes(_about)?|go_to_blaze_about|go_to_spawner(_\d+)?|wait_at_spawner|stay_in_fortress|take_up_obtain_blaze_rods|stay_and_fight)$/;
const CARRY = /^(bank_rods|stash_rods|pick_up_rods|collect_rod_stash|the_way_in)$/;
const LEAVE = /^(go_back|return_to_portal|return_overworld)$/;
const BODY = /^(heal_first|leave_and_heal|wall_in_first|eat_first|eat|step_out_and_eat|eat_golden_apple|seal|bunker|take_cover|out_of_sight|retreat|leave_reach|tunnel_out|work_free|rise_through|recover_\w+|step_out|nook|dig_in)$/;
const FOOD = /^(restock_food|return_for_food|hoglin_\w+|cook_meat|mushroom_stew|get_food_here|top_up_food(_near)?|top_up_cook|cook_food)$/;
const KEEP = /^(carry_on|keep_on|keep_at_it|go_on|keep_working|without|defer|none_good|differently|until_rest_ends|search_on|continue_request)$/;
// Named errands, by family.
const OFF = [
  ['the search for another fortress', /^(leg_\w+|round_\w+|floor_(north|south|east|west)|widen_search|seek_fortress_height|keep_searching|other_way|leave_fortress)$/],
  ['exploring', /^explore$/],
  ['gathering', /^(cross_to_\d+|walk_to_\d+|floor_to_\d+|climb_to_\d+|wood_in_view|dig_in_reach|portal_trip|stock_wood)$/],
  ['wood and pickaxes', /^(fetch_stems|spare_pickaxe|make_pickaxe)$/],
  ['blocks', /^(block_reserve|restock_blocks|return_for_blocks|back_to_ground)$/],
  ['mining', /^(mine_nearby|night_mine|mine_first|dig_stone)$/],
  ['a rung set aside or another taken up', /^(set_aside_rung|take_up_(?!obtain_blaze_rods$)\w+)$/],
  ['cooking', /^leave_cooking$/],
  ['a bastion', /^(raid_bastion|bastion_\w+)$/],
];
// The kind of way a 'toward' answer is, for its record.
const WAY_KINDS = [
  ['a fight', /^(hunt_\d+|charge_nearest|close_in|fight_at_spawner|back_to_wall|rise_to_strike|await_in_reach|fetch_rod_\d+|dig_in_and_fight|stay_and_fight|fight_with_carried)$/],
  ['a box or slit at the spawner', /^(box_here|box_in_line|box_at_spawner|dig_in_at_spawner|open_slit)$/],
  ['a wait at the spawner', /^(wait_at_spawner|stand_by_spawner|stay_in_fortress|hunt_on|pull_back)$/],
  ['a bridge or crossing', /^(blazes_)?(cross_level|blocks_then_cross|span_round|cover_lava|scoop_lava)$/],
  ['a dig or climb', /^(blazes_)?(tunnel|descend|dig_through|pillar_up|blocks_then_pillar)$/],
  ['a walk of the fortress\'s floors', /^unwalked_\d+$/],
  ['a walk', /^(blazes_walk_route|blazes_head_toward|walk_route|head_toward|go_to_blazes(_about)?|go_to_blaze_about|go_to_spawner(_\d+)?|back_to_fortress|go_in|take_up_obtain_blaze_rods)$/],
];
const wayKind = key => (WAY_KINDS.find(([, re]) => re.test(String(key || ''))) || [null])[0];

// The record (scripts/blaze-span.js --record, the flight records 2026-09-30
// 06:08Z to 2026-10-01 05:00Z): answers given with blazes known and within
// reach (a way to them offered, or within 32 blocks of where they were seen),
// by kind: chosen, a rod within five minutes after, a death within five
// minutes after, and the bot-minutes the answer held (to the next answer
// about the work, ten at most).
const RECORD = Object.freeze({ from: '2026-09-30T06:08Z', to: '2026-10-01T05:00Z',
  ways: {
    'a walk': [159, 38, 12, 51.1],
    'a walk of the fortress\'s floors': [35, 11, 3, 5.8],
    'a bridge or crossing': [82, 24, 7, 53.2],
    'a dig or climb': [120, 40, 13, 70.3],
    'a wait at the spawner': [96, 26, 27, 72.6],
    'a box or slit at the spawner': [149, 31, 30, 130.1],
    'a fight': [248, 106, 63, 150.1],
  },
  errands: [223, 38, 23, 110.4] });

function family(q, key) {
  const k = String(key || '');
  if (q === 'while_cooking' && /^wait_here$/.test(k)) return 'cooking';
  if (q === 'nether_gather' && /^leg_\w+$/.test(k)) return 'gathering';
  for (const [name, re] of OFF) if (re.test(k)) return name;
  return null;
}

function classify(q, key) {
  const k = String(key || '');
  if (REFLEX_Q.has(q)) return 'reflex';
  if (TOWARD_Q[q]?.test(k) || TOWARD.test(k)) return 'toward';
  if (CARRY.test(k)) return 'carry';
  if (LEAVE.test(k)) return 'leave';
  if (FOOD.test(k)) return 'food';
  if (BODY.test(k) || (q === 'pocket_next' && /^(stay|leave)$/.test(k))) return 'body';
  if (KEEP.test(k)) return 'keep';
  if (family(q, k)) return 'off';
  return 'other';
}

// What an option is for here, with the body and the rods as they are:
// a food errand is the body's when nothing safe to eat is carried and hunger
// is under 18; back through the portal is the carry-out with rods carried,
// the body's for food as a food errand is, else an errand.
function purpose(q, key, { rodsCarried = 0, needsFood = false } = {}) {
  const c = classify(q, key);
  if (c === 'food') return needsFood ? 'body' : 'off';
  if (c === 'leave') return rodsCarried > 0 ? 'carry' : needsFood ? 'body' : 'off';
  return c;
}
function familyOf(q, key) {
  const c = classify(q, key);
  if (c === 'food') return 'a food errand with food carried or hunger at 18 or more';
  if (c === 'leave') return 'back through the portal with no rod carried';
  return family(q, key);
}

// The options kept and those withheld, pure: the replay reads the same rule.
// `atBlazes`: the bot within BLAZES_AT of blazes known. -> { gated, keep, withheld: [{ key, family }], toward }
function sieve(q, keys, { rodsOwed = 0, known = false, atBlazes = false, rodsCarried = 0, needsFood = false } = {}) {
  const none = { gated: false, keep: keys, withheld: [], toward: [] };
  if (REFLEX_Q.has(q) || !(rodsOwed > 0) || !known) return none;
  const toward = keys.filter(k => classify(q, k) === 'toward');
  if (!toward.length && !atBlazes) return { ...none, toward };
  const withheld = keys.filter(k => purpose(q, k, { rodsCarried, needsFood }) === 'off').map(k => ({ key: k, family: familyOf(q, k) }));
  const keep = keys.filter(k => !withheld.some(w => w.key === k));
  if (!withheld.length || !keep.length) return { gated: false, keep: keys, withheld: [], toward, allOff: !keep.length && withheld.length > 0 };
  return { gated: true, keep, withheld, toward };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const words = s => String(s || '').replaceAll('_', ' ');
const P = v => v && Number.isFinite(v.x) ? `(${Math.round(v.x)}, ${Math.round(v.y)}, ${Math.round(v.z)})` : '';

function recordSays(kind) {
  const r = RECORD.ways[kind];
  if (!r) return '';
  return ` The record (trials of ${RECORD.from} to ${RECORD.to}, blazes known within reach): ${kind} chosen ${plural(r[0], 'time')}; a rod came within five minutes after ${r[1]} (${Math.round(100 * r[1] / r[0])}%), a death within five minutes after ${r[2]} (${Math.round(100 * r[2] / r[0])}%).`;
}
function errandRecordSays() {
  const [n, rod, death, min] = RECORD.errands, ways = Object.values(RECORD.ways);
  const w = i => ways.reduce((a, r) => a + r[i], 0), pct = (a, b) => Math.round(100 * a / b);
  return `In the trials of ${RECORD.from} to ${RECORD.to}, ${n} such errands were chosen with blazes known within reach: they held ${Math.round(min)} bot-minutes, and a rod came within five minutes after ${rod} (${pct(rod, n)}%), a death after ${death} (${pct(death, n)}%); the ways to the blazes were chosen ${w(0)} times, a rod within five minutes after ${pct(w(1), w(0))}%, a death after ${pct(w(2), w(0))}%`;
}

// The blazes the bot knows of in this dimension, nearest first: in sight now,
// where they were seen, their spawners on the fortress map; not a place Jev
// left (mob-hunt.js waysLeft).
function knownBlazes(bot, goal) {
  const here = bot?.entity?.position;
  if (!here || !goal) return [];
  let mh; try { mh = require('./mob-hunt'); } catch (_) { return []; }
  const state = goal.fortressSearch || {};
  const left = p => { try { return !!mh.wayLeft(state, p); } catch (_) { return false; } };
  const out = [];
  try { for (const b of mh.blazesAbout(bot)) if (b.visible && !left(b.entity.position)) out.push({ kind: 'in sight', at: b.entity.position, off: b.off, says: `a blaze in sight ${b.off} blocks off` }); } catch (_) { /* no world */ }
  try {
    for (const s of mh.spawnersKnown(bot, state)) if (!left(s.s)) out.push({ kind: 'spawner', at: s.s, off: s.off, says: `the blaze spawner at ${P(s.s)}, ${s.off} blocks off${s.s.rods ? `, ${plural(s.s.rods, 'rod')} taken within 16 of it` : ''}` });
  } catch (_) { /* no map */ }
  try {
    for (const s of mh.blazeSpots(bot, goal)) if (!left(s.spot)) {
      const mins = Math.round((Date.now() - (s.spot.at || Date.now())) / 60000);
      out.push({ kind: 'seen', at: s.spot, off: s.off, says: `blazes seen ${plural(s.spot.seen || 1, 'time')} at ${P(s.spot)}, ${s.off} blocks off, last ${mins ? `${plural(mins, 'minute')} ago` : 'just now'}${s.spot.tries ? `; walked back toward ${plural(s.spot.tries, 'time')}, the last ending: ${s.spot.why || 'unsaid'}` : ''}` });
    }
  } catch (_) { /* no sightings */ }
  return out.sort((a, b) => a.off - b.off);
}

// The rods the hunt still needs, as the hunt counts them (blaze-stand.js
// rodsNeeded: the ladder's eyes on the way to the dragon, else the request's
// count, less what is carried and in the bot's chests).
function rodsOwed(bot, goal) {
  try { return require('./blaze-stand').rodsNeeded(bot, goal) || 0; } catch (_) { return 0; }
}
const countOf = (bot, re) => { try { return (bot.inventory.items() || []).filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0); } catch (_) { return 0; } };
function needsFood(bot) {
  if (!(Number.isFinite(bot?.food) && bot.food < REGEN_HUNGER)) return false;
  try { return !require('./vitals').chooseFood(bot); } catch (_) { return false; }
}

// decide()'s gate. -> { tree, facts }
function gate(bot, goal, id, tree, { area = null } = {}) {
  const none = { tree, facts: [] };
  if (off() || !bot || !goal || !tree || area === 'combat' || REFLEX_Q.has(id)) return none;
  if (!/nether/.test(String(bot.game?.dimension || ''))) return none;
  const owed = rodsOwed(bot, goal);
  if (!(owed > 0)) return none;
  const keys = Object.keys(tree);
  // Cheap first: nothing here to withhold.
  const rodsCarried = countOf(bot, /^blaze_rod$/), hungry = needsFood(bot);
  if (!keys.some(k => purpose(id, k, { rodsCarried, needsFood: hungry }) === 'off')) return none;
  const known = knownBlazes(bot, goal);
  if (!known.length) return none;
  const atBlazes = known[0].off <= BLAZES_AT;
  const s = sieve(id, keys, { rodsOwed: owed, known: true, atBlazes, rodsCarried, needsFood: hungry });
  if (!s.gated) return none;
  const out = {};
  for (const k of s.keep) {
    const kind = classify(id, k) === 'toward' ? wayKind(k) : null;
    const node = tree[k];
    out[k] = kind && node && typeof node.description === 'string' && !node.children ? { ...node, description: `${node.description}${recordSays(kind)}` } : node;
  }
  const byFamily = {};
  for (const w of s.withheld) (byFamily[w.family] ||= []).push(words(w.key));
  const blazes = known.slice(0, 3).map(b => b.says).join('; ');
  const ways = s.toward.length ? `the ways to them offered here: ${s.toward.map(words).join(', ')}` : `the bot is within ${BLAZES_AT} blocks of them (the hunt's look)`;
  const facts = [`${plural(owed, 'blaze rod')} still needed, and blazes are known: ${blazes}; ${ways}.`,
    `Not offered while that holds: ${Object.entries(byFamily).map(([f, ks]) => `${ks.join(', ')} (${f})`).join('; ')}. Offered are the ways to the blazes, the rods' carry-out, the body's safety and keeping on.`,
    `${errandRecordSays()}.`];
  return { tree: out, facts };
}

module.exports = { gate, sieve, classify, purpose, family, familyOf, wayKind, knownBlazes, rodsOwed, needsFood, recordSays, RECORD, WAY_KINDS, REFLEX_Q, BLAZES_AT, REGEN_HUNGER };
