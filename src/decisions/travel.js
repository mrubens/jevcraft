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
const APPROACH_ORDER = ['walk_route', 'descend', 'cross_level', 'tunnel', 'keep_searching'];
const approachFallback = (children, path, context = {}) => {
  const failed = new Set(context.failed || []);
  return APPROACH_ORDER.find(k => children[k] && !failed.has(k)) || (children.keep_searching ? 'keep_searching' : Object.keys(children)[0]);
};
define({
  id: 'fortress_approach', area: 'endgame', kind: 'fortress', primitive: 'choice', stakes: 'high', tree: true,
  question: 'A Nether fortress is in view: which way should the bot go to it, or should it leave it and keep searching?',
  trigger: 'On the fortress search, when a fortress (two dozen or more of its bricks) comes into view more than six blocks off, and again each time the way chosen ends no nearer; the answer holds for the approach until it fails, five minutes at most.',
  source: 'src/mob-hunt.js (fortressApproaches, approachFortress), src/bridging.js (surveyCrossing), src/nether-travel.js (crossingSays)',
  options: [
    { key: 'walk_route', label: 'walk the pathfinder\'s route to it, level with the bot first, then at the bricks\' height', when: 'a pathfinder is at hand; said with its surveyed route (cells, blocks it would place and dig, how many beside lava, how much nearer it ends) and that it walks upright', level: 'root' },
    { key: 'descend', label: 'dig straight down to the bricks below', when: 'the bricks are more than two blocks below and within twelve blocks across; said with the drop and that a drop too deep for the health or ending in lava is refused', level: 'root' },
    { key: 'cross_level', label: 'go straight at it at the height the bot stands, digging rock and laying a one-wide span', when: 'the cells ahead at this height let it come a block or more nearer (surveyCrossing); said with the cells, the blocks to lay against those carried, how many over lava, how much nearer it ends, what stops it, about how long, and the mobs in view', level: 'root' },
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

module.exports = { leastVisited, approachFallback };

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
