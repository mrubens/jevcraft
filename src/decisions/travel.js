'use strict';
// Where to walk next when the place is not known yet.
const { define } = require('./index');

// The least-walked waypoint, then the one nearest the estimate.
const leastVisited = children => Object.keys(children).sort((a, b) =>
  (children[a].description.previousVisits - children[b].description.previousVisits) ||
  (children[a].description.remainingDistanceToEstimatedTarget - children[b].description.remainingDistanceToEstimatedTarget))[0];

define({
  id: 'stronghold_waypoint', area: 'endgame', kind: 'stronghold', primitive: 'choice', stakes: 'medium', tree: true, thinking: true,
  question: 'Following thrown Eyes of Ender, which surveyed waypoint should the bot walk to next?',
  trigger: 'Each step of the stronghold search once an Eye has given a bearing.',
  source: 'src/stronghold.js (walkBearing)',
  options: [{ pattern: 'walk_\\d+', label: 'walk this surveyed surface route', when: 'a surveyed route toward the Eye-indicated estimate', level: 'root', dynamic: true }],
  instructions: {
    task: 'Following thrown Eyes of Ender toward the stronghold: which waypoint should the bot walk to next?',
    guidance: 'The estimate is unverified. Previous visits and remaining distance are given for each waypoint.',
  },
  fallback: leastVisited,
});

// The way to a fortress seen. Both fortresses any trial found were lost
// within a second of the sighting, each by a way the code alone had
// chosen: mid-242-c walking the lava sea's shore toward one (note 264),
// mid-215-e on a span with a hoglin behind it (note 273). The order the
// code kept is the fallback, each way failed on this approach passed over.
const APPROACH_ORDER = ['walk_route', 'descend', 'cross_level', 'pillar_up', 'tunnel', 'keep_searching'];
const approachFallback = (children, path, context = {}) => {
  const failed = new Set(context.failed || []);
  return APPROACH_ORDER.find(k => children[k] && !failed.has(k)) || (children.keep_searching ? 'keep_searching' : Object.keys(children)[0]);
};
define({
  id: 'fortress_approach', area: 'endgame', kind: 'fortress', primitive: 'choice', stakes: 'high', tree: true,
  question: 'A Nether fortress is in view: which way should the bot go to it, or should it leave it and keep searching?',
  trigger: 'On the fortress search, when a fortress (two dozen or more of its bricks) is in view and the bot is not on its floors (at the height of a brick with room to stand on it, within six blocks), and again each time the way chosen ends no nearer; the way is to its nearest floor; the answer holds for the approach until it fails, five minutes at most.',
  source: 'src/mob-hunt.js (fortressApproaches, approachFortress), src/bridging.js (surveyCrossing), src/nether-travel.js (crossingSays)',
  options: [
    { key: 'walk_route', label: 'walk the pathfinder\'s route to it, level with the bot first, then at the bricks\' height', when: 'a pathfinder is at hand; said with its surveyed route (cells, blocks it would place and dig, how many beside lava, how much nearer it ends) and that it walks upright', level: 'root' },
    { key: 'descend', label: 'dig straight down to the bricks below', when: 'the bricks are more than two blocks below and within twelve blocks across; said with the drop and that a drop too deep for the health or ending in lava is refused', level: 'root' },
    { key: 'cross_level', label: 'go straight at it at the height the bot stands, digging rock and laying a one-wide span', when: 'the cells ahead at this height let it come a block or more nearer (surveyCrossing); said with the cells, the blocks to lay against those carried, how many over lava, how much nearer it ends, what stops it, about how long, and the mobs in view', level: 'root' },
    { key: 'pillar_up', label: 'pillar straight up to the height of its floor overhead', when: 'its nearest floor is two or more blocks up and within twelve across, a column near the bot has no lava or water in or beside it, and blocks to lay are carried; said with the height, the blocks against those carried, how far across the floor is from the top, and the fall a push would be', level: 'root' },
    { key: 'tunnel', label: 'dig a staircase through the rock toward it', when: 'a staircase is at hand', level: 'root' },
    { key: 'keep_searching', label: 'leave this fortress for ten minutes and go on searching', when: 'always', level: 'root' },
  ],
  instructions: {
    task: 'A Nether fortress is in view on the search for blazes. Choose the way to it, or leave it for now and keep searching.',
    guidance: 'Each way says what it meets, surveyed from here. The lava sea lies under most of the Nether: a fall into it is death and loses everything carried. threatsInView are the mobs in sight now; a hit on a one-wide span or at the lava\'s edge is the fall. failed is the ways tried on this approach that ended no nearer, and why; the same way again seldom ends differently.',
  },
  fallback: approachFallback,
  ungated: 'every way offered was surveyed and runs under the hard rules (a span laid crouched and never under a shooter\'s fire, no rock dug with lava behind it, no drop into lava, no swing or turn on a span); a way that fails is asked again with what failed, and the outage default is the order the code kept, a failed way passed over',
});

// The next leg of the fortress search. mid-205-m's thirteen legs went the
// way the compass said at the height the bot stood, y 96 to 104, straight
// through solid netherrack at six seconds a cell, and saw nothing in fifty-
// one minutes (note 394). Each heading is surveyed now and the leg is
// Jev's; the outage default is the heading with the most open air ahead,
// the compass's own heading at a tie or unsurveyed.
// A fortress in view (stay_in_fortress, back_to_fortress) is kept over any
// leg until six passes of it came to nothing, as the code kept it before
// the choice was Jev's (mid-235-p, note 507).
const legFallback = (children, path, context = {}) => {
  if (children.back_to_fortress) return 'back_to_fortress';
  if (children.stay_in_fortress && (context.passes || 0) < 6) return 'stay_in_fortress';
  const open = context.open || {};
  const keys = Object.keys(children).filter(k => k.startsWith('leg_'));
  const surveyed = keys.filter(k => Number.isFinite(open[k]));
  if (!surveyed.length) return children[context.current] ? context.current : keys[0] || Object.keys(children)[0];
  const best = Math.max(...surveyed.map(k => open[k]));
  return surveyed.includes(context.current) && open[context.current] === best ? context.current : surveyed.find(k => open[k] === best);
};
define({
  id: 'fortress_leg', area: 'endgame', kind: 'fortress', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Searching the Nether for a fortress: which way should the next leg go, should the bot first dig toward the heights fortresses stand at, or first get blocks to lay spans with?',
  trigger: 'On the fortress search, each time a leg begins: at the start, when the last leg reached its end, when the sweep turned for a leg that made no ground, and when a pass over every stretch of a fortress in view ended.',
  source: 'src/mob-hunt.js (chooseLeg, findFortressStep), src/nether-travel.js (surveyLeg, legSays)',
  options: [
    { pattern: 'leg_(east|south|west|north)', label: 'go this way ninety-six blocks at the height the bot stands', when: 'always, one for each heading; said with the cells ahead at this height (open air, how many of them over a drop of four or more, rock to dig at about six seconds a cell, and what stops it), the cells with no floor against the blocks carried and where they run out, about how long, whether it is back the way the last leg came, and how the last leg this way ended, kept on that heading', level: 'root', dynamic: true },
    { key: 'seek_fortress_height', label: 'dig a staircase toward y 64 first, along the most open heading', when: 'the bot stands more than eight blocks above or below y 64 and a staircase is at hand; said with the height to make up and where fortresses stand', level: 'root' },
    { key: 'restock_blocks', label: 'mine a stack of the most plentiful block a span is laid with nearby, then choose the leg again', when: 'a leg runs out of the blocks carried and some within sixteen blocks can be mined; said with each kind counted, the nearest, and about how long', level: 'root' },
    { key: 'stay_in_fortress', label: 'stay in the fortress in view and walk its stretches again for blazes', when: 'a pass over every stretch of the fortress in view has ended; said with the bricks in view, where its floors are against the bot, the passes made and minutes spent there, how many stretches the last pass reached and why the rest were not, and the blazes seen near it', level: 'root' },
    { key: 'wait_at_spawner', label: 'wait by the spawner in view for three minutes, the hunt taking each blaze it makes', when: 'a pass over every stretch of the fortress in view has ended and a spawner is within twenty-four blocks; said with where it is, how it makes blazes, and how the last wait there ended', level: 'root' },
    { key: 'back_to_fortress', label: 'go back into the fortress in view that was left or set aside', when: 'two dozen or more fortress bricks are in view but left behind or set aside; said with when and why, how far the nearest is, and the blazes seen near it', level: 'root' },
    { key: 'return_for_blocks', label: 'go back through the portal to the Overworld for stone', when: 'a leg runs out of the blocks carried and the way back through the portal is at hand; said with the nearest portal known', level: 'root' },
  ],
  instructions: {
    task: 'The bot is searching the Nether for a fortress, in legs of ninety-six blocks. Choose the next leg.',
    guidance: 'Fortresses stand mostly between y 48 and 75 over the lava sea at y 31, and their bricks are seen within 128 blocks through open air only: a leg through rock sees nothing however far it goes, at about six seconds a cell. Open air over a deep drop is a cavern or the sea\'s edge, where the view is long. The mobs in view and the blocks carried are in the state; a leg over open air with no floor needs a block laid a cell, and stops where the blocks carried run out.',
  },
  fallback: legFallback,
});

module.exports = { leastVisited, approachFallback, legFallback };

// A boat for a crossing the code has already checked: level water, room for
// the boat and a safe shore at each end.
define({
  id: 'boat_crossing', area: 'travel', kind: 'travel', primitive: 'choice', stakes: 'low',
  question: 'Code has checked a water crossing: take a boat, or keep walking and swimming?',
  trigger: 'A travel leg meets a level water route of useful length with a safe shore at each end.',
  source: 'src/boats.js (boatTravelStep)',
  unreachable: 'counted as a failed boat choice; the bot walks or swims',
  build: () => require('../typesafe').choice(
    'Choose how to travel for this request. Code has verified a level water route, boat clearance and a safe shore at each end. Boats are useful for long river/lake crossings; small puddles are already excluded. Prefer a boat when this makes meaningful progress and saves a long swim. Respect an explicit request to swim, stay on land or avoid crafting. A boat already in inventory costs no crafting. New boats cost five planks plus access to a crafting table. Do not abandon the main task for an unnecessary boat.', {
      boat: 'Use a carried boat, or make a wooden boat, for this water crossing.',
      walk_or_swim: 'Continue ordinary walking/swimming without a boat.',
    }),
});
