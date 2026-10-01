'use strict';
// The tests' stand-in for Jev (note 707). The suite runs without a live
// Jev, and there is no fallback in play any more: a question Jev cannot
// answer is held and asked again (src/jev-down.js). A test that gives no
// client is answered here instead, deterministically, by the order the code
// kept before note 707 (each question's old fallback, moved here unchanged
// from src/decisions/*.js): the answers the tests were written against.
// Loaded for every test file by the test script (package.json: node --test
// --require ./test/support/jev-stand-in.js); a test may require it itself.
// It is never loaded in play.
// A plan question waits out a fight in play for up to fifteen seconds (note
// 696, danger.js waitOutFight), in real time: every test whose scene has a
// mob about sat out the whole of it, 15 to 45 seconds a test, a third of the
// suite's time (note 797). The wait's own test sets its own length.
process.env.JEV_FIGHT_WAIT_MS ||= '50';
const decisions = require('../../src/decisions');
const { walk, firstOption } = decisions;
const jevDown = require('../../src/jev-down');

// A held question under the test runner comes round in milliseconds.
jevDown.setBackoff([5, 10, 20]);
// And a question held for its last answer changing nothing (note 724).
require('../../src/decisions/unchanged').setHold([5, 10, 20]);

// Shelter before food before the request: the order a careful player
// keeps when nobody is weighing the trade.
const safetyOrder = children => ['sleep_in_bed', 'sleep_in_nook', 'go_home_for_night', 'secure_shelter', 'obtain_food'].find(key => children[key]) || Object.keys(children)[0];
// The least-walked waypoint, then the one nearest the estimate.
const leastVisited = children => Object.keys(children).sort((a, b) =>
  (children[a].description.previousVisits - children[b].description.previousVisits) ||
  (children[a].description.remainingDistanceToEstimatedTarget - children[b].description.remainingDistanceToEstimatedTarget))[0];
// The fortress approach's old order, each way failed on this approach passed over.
const APPROACH_ORDER = ['walk_route', 'descend', 'dig_through', 'cover_lava', 'scoop_lava', 'span_round', 'make_pickaxe', 'cross_level', 'blocks_then_cross', 'pillar_up', 'blocks_then_pillar', 'tunnel', 'fetch_stems', 'return_for_blocks', 'other_way', 'keep_searching'];
const approachFallback = (children, path, context = {}) => {
  const failed = new Set(context.failed || []);
  return APPROACH_ORDER.find(k => children[k] && !failed.has(k)) || (children.keep_searching ? 'keep_searching' : children.other_way ? 'other_way' : Object.keys(children)[0]);
};
// The fortress search's old order: a fortress in view kept six passes, then the leg with the most ground unseen, the most open air, the compass's heading.
const legFallback = (children, path, context = {}) => {
  if (children.back_to_fortress) return 'back_to_fortress';
  if (children.blocks_then_cross) return 'blocks_then_cross';
  if (children.wait_at_spawner) return 'wait_at_spawner';
  const spawner = Object.keys(children).find(k => /^go_to_spawner_/.test(k));
  if (spawner) return spawner;
  const unwalked = Object.keys(children).find(k => /^unwalked_/.test(k));
  if (unwalked) return unwalked;
  if (children.stay_in_fortress && (context.passes || 0) < 6) return 'stay_in_fortress';
  if (children.go_to_blazes_about) return 'go_to_blazes_about';
  if (children.go_to_blazes) return 'go_to_blazes';
  const open = context.open || {};
  let keys = Object.keys(children).filter(k => k.startsWith('leg_'));
  // The most ground unseen that way first, counted in chunks (sixteen
  // columns of 4 by 4): a leg over ground already looked across shows
  // nothing new (nether-coverage.js, note 572).
  // A leg whose own line runs mostly over ground stood on walks it again
  // (its own tunnel back, often, all open air) and goes after the rest.
  const unseen = context.unseen || {}, stood = context.stood || {};
  const fresh = keys.filter(k => !(stood[k] >= 48));
  if (fresh.length) keys = fresh;
  const chunks = k => Number.isFinite(unseen[k]) ? Math.round(unseen[k] / 16) : null;
  const counted = keys.filter(k => chunks(k) !== null);
  if (counted.length) { const most = Math.max(...counted.map(chunks)); keys = counted.filter(k => chunks(k) === most); }
  // The spiral's side where its heading is among the most unseen: the
  // search widens rather than turning back over itself (note 688).
  const widen = context.widen;
  if (children.widen_search && widen && keys.includes(widen.leg)) return 'widen_search';
  const surveyed = keys.filter(k => Number.isFinite(open[k]));
  if (!surveyed.length) return children[context.current] && keys.includes(context.current) ? context.current : keys[0] || Object.keys(children)[0];
  const best = Math.max(...surveyed.map(k => open[k]));
  return surveyed.includes(context.current) && open[context.current] === best ? context.current : surveyed.find(k => open[k] === best);
};
// The dragon fight's fixed order: out of danger, the crystals, a bed by the head, the head, an arrow, a better position, a watch.
function endFallback(safe) {
  return children => {
    const keys = Object.keys(children), find = test => keys.find(test);
    return (!safe && find(k => k.startsWith('move_'))) || find(k => k.startsWith('crystal_')) || find(k => k === 'bed_bomb') || find(k => k === 'strike_head') ||
      find(k => k === 'shoot_dragon') || find(k => k.startsWith('move_')) || keys[0];
  };
}
// The wood in view, then each place as the tree lists them (nearest first; a
// key names its place, note 749) on foot, down to the floor, across; then
// the portal.
const GATHER_ORDER = children => {
  const keys = Object.keys(children), places = [...new Set(keys.map(k => /^(?:walk|floor|cross)_to_(.+)$/.exec(k)?.[1]).filter(Boolean))];
  return ['wood_in_view', ...places.flatMap(p => ['walk', 'floor', 'cross'].map(m => `${m}_to_${p}`)), 'portal_trip'];
};

// The old order of each question, by id.
const OLD_ORDER = {
  bastion_raid: children => children.gold_only ? 'gold_only' : Object.keys(children)[0],
  climb_out: (children, path, context = {}) => children[context.quicker] ? context.quicker : Object.keys(children)[0],
  combat_kit: (children, path, context = {}) => children[context.oldOrder] ? context.oldOrder : Object.keys(children)[0],
  corpse_run: () => 'go_back',
  crossing_kit: (children, path, context = {}) => children[context.oldOrder] ? context.oldOrder : 'cross_now',
  dragon_fight: (children, path, context = {}) => endFallback(context.safe)(children),
  dug_into_liquid: () => 'plug',
  empty_spawner: children => {
      if (children.stash_rods) return 'stash_rods';
      if (children.heal_first) return 'heal_first';
      if (children.box_at_spawner) return 'box_at_spawner';
      if (children.box_here) return 'box_here';
      if (children.stand_by_spawner && !children.go_back) return 'stand_by_spawner';
      return children.go_back ? 'go_back' : children.get_food_here ? 'get_food_here' : Object.keys(children)[0];
    },
  encounter_stance: 'throws',
  evening_chore: children => ['stock_stash', 'harvest_and_bake', 'tend_farm', 'breed_cows'].find(k => children[k]) || Object.keys(children).find(k => k !== 'wait_for_bedtime') || 'wait_for_bedtime',
  fortress_approach: approachFallback,
  fortress_leg: legFallback,
  fortress_visit: children => children.go_in ? 'go_in' : Object.keys(children)[0],
  gather_more: () => 'take_more',
  // Note 787's question had no fallback: the step went on with what it cut.
  wood_while_up: () => 'go_on',
  home_site: firstOption,
  house_build_step: firstOption,
  hunt_target: firstOption,
  idle_work: firstOption,
  inventory_drop: () => 'none',
  kit_food: (children, path, context = {}) => children[context.oldOrder] ? context.oldOrder : 'go_without',
  leave_nether: children => Object.keys(children).find(k => k !== 'go_back') || 'go_back',
  nether_food_kit: children => children.go_on ? 'go_on' : Object.keys(children)[0],
  nether_gather: (children, path, context = {}) => GATHER_ORDER(children).find(k => children[k])
      || Object.keys(children).filter(k => k.startsWith('leg_')).sort((a, b) => (context.unseen?.[b] ?? 0) - (context.unseen?.[a] ?? 0))[0]
      || (children.without ? 'without' : Object.keys(children)[0]),
  night_mine_target: children => Object.keys(children).find(k => k !== 'branch') || 'branch',
  pocket_next: (children, path, context = {}) => children[context.rule] ? context.rule : children.stay ? 'stay' : Object.keys(children)[0],
  // The portal plan (note 782): the route held, a new site where the frame has failed ten times there, else the cheapest route priced.
  portal_plan: (children, path, context = {}) => (context.leaveSite && Object.keys(children).find(k => k.startsWith('new_site_'))) || (children[context.current] ? context.current : children[context.oldOrder] ? context.oldOrder : 'build_new'),
  portal_way: children => ['portal_here', 'wait_rest'].find(k => children[k]) || Object.keys(children)[0],
  ranged_response: (children, path, context = {}) => (context.health ?? 20) >= 12 ? Object.keys(children)[0] : (children.retreat ? 'retreat' : Object.keys(children)[0]),
  resource_source: firstOption,
  restock_food: children => ['cook_meat', 'mushroom_stew', 'keep_on', 'return_for_food', 'hoglin_pillar', 'hoglin_walk'].find(k => children[k]) || Object.keys(children).find(k => k !== 'raid_bastion') || Object.keys(children)[0],
  rung_elsewhere: children => Object.keys(children).find(k => k.startsWith('go_')) || Object.keys(children)[0],
  rung_progress: (children) => children.set_aside_rung ? 'set_aside_rung' : children.differently ? 'differently' : Object.keys(children).find(k => k !== 'keep_at_it' && !/^(take_up|pearls)_/.test(k)) || Object.keys(children)[0],
  sculk_work: children => children.move_away ? 'move_away' : 'work_crouched',
  search_heading: children => Object.keys(children)[0],
  sheep_search: () => 'explore_here',
  shelter_method: children => ['saved_shelter', 'build_at_site', 'seal_here', 'shaft_pocket', 'night_mine', 'bed_nook'].find(k => children[k]) || Object.keys(children)[0],
  stillness_detour: (children, path, context = {}) => {
      const strikes = context.stalled?.strikes ?? 2;
      if (strikes === 1 && children.differently) return 'differently';
      if (strikes >= 3 && children.set_aside_rung) return 'set_aside_rung';
      return Object.keys(children).find(k => !['differently', 'set_aside_rung'].includes(k) && !/^(take_up|pearls)_/.test(k)) || Object.keys(children)[0];
    },
  stronghold_waypoint: leastVisited,
  surface_trip: children => children.dig_site ? 'dig_site' : children.climb ? 'climb' : Object.keys(children)[0],
  survival_priority: safetyOrder,
  trade_choice: firstOption,
  turn_priority: children => require('../../src/arbiter').rulesPick(Object.entries(children).map(([layer, o]) => ({ layer, urgency: o.urgency ?? o.description?.urgency })))?.layer || Object.keys(children)[0],
  unstuck_move: children => Object.keys(children)[0],
  upkeep: children => ['make_pickaxe', 'spare_pickaxe', 'wood_reserve', 'fetch_stems', 'block_reserve'].find(k => children[k]) || 'carry_on',
  way_down: (children, path, context = {}) => children[context.oldOrder] ? context.oldOrder : Object.keys(children)[0],
  while_cooking: children => ['dig_in_reach', 'mine_nearby', 'dig_stone'].find(k => children[k]) || 'wait_here',
  win_strategy: firstOption,
};

// A question with no safe default of its own (the stance's): the caller
// stops, as it did without Jev before note 707.
const blocked = (id, reason) => Object.assign(new Error(`${id}: the stand-in has no answer (${reason})`), { name: 'Blocked' });

// The stand-in itself: { decide(id, { tree, context }) -> { path, action } }.
// A question defined by a test is answered by its first option; the body's
// physics (body_way, shot_answer) by its safety rule. `answers`
// ({ id: picker }) overrides the old order for one test (withAnswers).
const standIn = {
  answers: {},
  decide(id, { tree, context = {} }) {
    // The body's physics answers by its own safety rule, as in play.
    const own = this.answers[id] || OLD_ORDER[id] || decisions.question(id).safetyRule || firstOption;
    if (own === 'throws') throw blocked(id, 'no safe default');
    return walk(tree, (children, path) => own(children, path, context));
  },
};
decisions.useStandIn(standIn);
// A question held to the test runner's limit is a test whose client never
// answers: said at the end, so it is not passed over as a pass.
process.on('exit', () => { if (jevDown.testHeld.length) console.error(`[stand-in] held to the test limit: ${[...new Set(jevDown.testHeld)].join(', ')}`); });

// For one test: other answers, put back after.
async function withAnswers(answers, fn) {
  const was = standIn.answers;
  standIn.answers = { ...was, ...answers };
  try { return await fn(); } finally { standIn.answers = was; }
}
// The old order of one question, as a function (children, path, context).
const oldOrder = id => { const f = OLD_ORDER[id]; return typeof f === 'function' ? (children, path = [], context = {}) => f(children, path, context) : f; };

module.exports = { standIn, withAnswers, oldOrder, OLD_ORDER, safetyOrder, leastVisited, approachFallback, legFallback, endFallback, GATHER_ORDER };
