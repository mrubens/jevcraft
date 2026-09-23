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

module.exports = { leastVisited };

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
