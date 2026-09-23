'use strict';
// Where to walk next when the place is not known yet.
const { define } = require('./index');

// The least-walked waypoint, then the one nearest the estimate.
const leastVisited = children => Object.keys(children).sort((a, b) =>
  (children[a].description.previousVisits - children[b].description.previousVisits) ||
  (children[a].description.remainingDistanceToEstimatedTarget - children[b].description.remainingDistanceToEstimatedTarget))[0];

define({
  id: 'stronghold_waypoint', area: 'endgame', kind: 'stronghold', primitive: 'choice', stakes: 'medium', tree: true, thinking: true,
  instructions: {
    task: 'Following thrown Eyes of Ender toward the stronghold: which waypoint should the bot walk to next?',
    guidance: 'The estimate is unverified. Previous visits and remaining distance are given for each waypoint.',
  },
  fallback: leastVisited,
});

module.exports = { leastVisited };
