'use strict';
// Where to walk next when the place is not known yet.
const { define } = require('./index');

// The least-walked waypoint, then the one nearest the estimate.
const leastVisited = children => Object.keys(children).sort((a, b) =>
  (children[a].description.previousVisits - children[b].description.previousVisits) ||
  (children[a].description.remainingDistanceToEstimatedTarget - children[b].description.remainingDistanceToEstimatedTarget))[0];

define({
  id: 'stronghold_waypoint', area: 'endgame', parent: 'rung_progress', kind: 'stronghold', primitive: 'choice', stakes: 'medium', tree: true, thinking: true,
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
const APPROACH_ORDER = ['walk_route', 'descend', 'dig_through', 'cover_lava', 'scoop_lava', 'span_round', 'cross_level', 'pillar_up', 'tunnel', 'other_way', 'keep_searching'];
const approachFallback = (children, path, context = {}) => {
  const failed = new Set(context.failed || []);
  return APPROACH_ORDER.find(k => children[k] && !failed.has(k)) || (children.keep_searching ? 'keep_searching' : children.other_way ? 'other_way' : Object.keys(children)[0]);
};
define({
  id: 'fortress_approach', area: 'endgame', parent: 'fortress_leg', kind: 'fortress', primitive: 'choice', stakes: 'high', tree: true,
  question: 'A Nether fortress is in view: which way should the bot go to it, or should it leave it and keep searching?',
  trigger: 'On the fortress search, when a fortress (two dozen or more of its bricks) is in view and the bot is not on its floors (at the height of a brick with room to stand on it, within six blocks), and again each time the way chosen ends no nearer; the way is to its nearest floor; the answer holds for the approach until it fails, five minutes at most. Also where a walk on foot to a place Jev chose failed (state.stretch says which: a stretch of the fortress\'s floors, or where blazes were seen): the way is then to that place, asked afresh for each, the failed walk among what failed, and leaving it (other_way) leaves that way, not the fortress.',
  source: 'src/mob-hunt.js (fortressApproaches, approachFortress, crossingOptions), src/bridging.js (surveyCrossing, crossAlong), src/fortress-map.js (crossing), src/nether-travel.js (crossingSays)',
  options: [
    { key: 'walk_route', label: 'walk the pathfinder\'s route to it, level with the bot first, then at the bricks\' height', when: 'a pathfinder is at hand; said with its surveyed route (cells, blocks it would place and dig, how many beside lava, how much nearer it ends) and that it walks upright', level: 'root' },
    { key: 'descend', label: 'dig straight down to the bricks below', when: 'the bricks are more than two blocks below and within twelve blocks across; said with the drop and that a drop too deep for the health or ending in lava is refused', level: 'root' },
    { key: 'cross_level', label: 'go straight at it at the height the bot stands, digging rock and laying a one-wide span', when: 'the cells ahead at this height let it come a block or more nearer (surveyCrossing); said with the cells, the blocks to lay against those carried, how many over lava, how much nearer it ends, what stops it, about how long, and the mobs in view', level: 'root' },
    { key: 'pillar_up', label: 'pillar straight up to the height of its floor overhead', when: 'its nearest floor is two or more blocks up and within twelve across, a column near the bot has no lava or water in or beside it, and blocks to lay are carried; said with the height, the blocks against those carried, how far across the floor is from the top, and the fall a push would be', level: 'root' },
    { key: 'tunnel', label: 'dig a staircase through the rock toward it', when: 'a staircase is at hand', level: 'root' },
    { key: 'cover_lava', label: 'cover the lava lying on the floor on the way along the ground, a block laid into each cell of it and walked on a block up', when: 'on the way to floors of the fortress seen unwalked, the way along the ground (fortress-map.js crossing) has lava lying on a floor; said with its cells (lava, rock, open air, floor), the blocks against those carried, the seconds, where the lava comes from (a source seen, or flowing down from above), and how many cells are beside lava and what a misstep into it costs', level: 'root' },
    { key: 'scoop_lava', label: 'scoop the lava on the way with the empty buckets carried, covering what is still lava when reached', when: 'as cover_lava, with empty buckets carried and lava sources among the cells on the way; said with how many are sources, that flowing lava cannot be scooped, and the rest as cover_lava', level: 'root' },
    { key: 'dig_through', label: 'dig through the rock filling the way along the ground (round the lava, where the way along the ground has lava on it)', when: 'on the way to floors of the fortress seen unwalked, a way along the ground digs natural rock (never with lava or water behind it); said with its cells, the blocks dug and the seconds with what is carried, and that netherrack dug by hand drops nothing', level: 'root' },
    { key: 'span_round', label: 'go round the lava along the ground, laying a one-wide span where there is no floor', when: 'as cover_lava, where the way round the lava digs nothing but crosses open air; said with its cells, the blocks against those carried and the seconds', level: 'root' },
    { key: 'keep_searching', label: 'leave this fortress for ten minutes and go on searching', when: 'on the way into a fortress (not a way on its floors)', level: 'root' },
    { key: 'other_way', label: 'leave this way for now: the place is set aside for ten minutes (not offered again until then), not the fortress, and the fortress\'s other ways are asked again', when: 'a way on the fortress\'s floors or to a place chosen from the search (where blazes were seen): state.stretch says which and why the walk failed', level: 'root' },
  ],
  instructions: {
    task: 'A Nether fortress is in view on the search for blazes. Choose the way to it, or leave it for now and keep searching.',
    guidance: 'blazesSeen, first when there, is what the search is for: the blazes about now (in sight or heard through the walls) and where the hunt has seen them. Each way says what it meets, surveyed from here. The lava sea lies under most of the Nether: a fall into it is death and loses everything carried. threatsInView are the mobs in sight now; a hit on a one-wide span or at the lava\'s edge is the fall. failed is the ways tried on this approach that ended no nearer, and why; the same way again seldom ends differently. The staircase steps on ground and digs rock: a gap of open air between floors (\"no floor to step onto\") is crossed by the span or a pillar, laid from blocks carried. Lava lying on a floor is crossed as a player crosses it: a block laid into lava takes its place, so the lava on the way is covered and walked on, scooped where it is a source and a bucket is carried, or gone round by digging through the rock where there is a way round.',
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
  if (children.wait_at_spawner) return 'wait_at_spawner';
  if (children.unwalked_1) return 'unwalked_1';
  if (children.stay_in_fortress && (context.passes || 0) < 6) return 'stay_in_fortress';
  if (children.go_to_blazes_about) return 'go_to_blazes_about';
  if (children.go_to_blazes) return 'go_to_blazes';
  const open = context.open || {};
  const keys = Object.keys(children).filter(k => k.startsWith('leg_'));
  const surveyed = keys.filter(k => Number.isFinite(open[k]));
  if (!surveyed.length) return children[context.current] ? context.current : keys[0] || Object.keys(children)[0];
  const best = Math.max(...surveyed.map(k => open[k]));
  return surveyed.includes(context.current) && open[context.current] === best ? context.current : surveyed.find(k => open[k] === best);
};
define({
  id: 'fortress_leg', area: 'endgame', parent: 'rung_progress', kind: 'fortress', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Searching the Nether for a fortress: which way should the next leg go, should the bot first dig toward the heights fortresses stand at, or first get blocks to lay spans with?',
  trigger: 'On the fortress search, each time a leg begins: at the start, when the last leg reached its end, when a leg ended within eight blocks of where it began (its heading then rests from there), when the sweep turned for a leg that made no ground, and on a fortress\'s floors when the bot has walked all it can reach of what it has seen of it (the map: floors seen through open air, walked, and running on into unseen space).',
  source: 'src/mob-hunt.js (chooseLeg, findFortressStep), src/nether-travel.js (surveyLeg, legSays)',
  options: [
    { pattern: 'leg_(east|south|west|north)', label: 'go this way ninety-six blocks at the height the bot stands', when: 'always, one for each heading; said with the cells ahead at this height (open air, how many of them over a drop of four or more, rock to dig at about six seconds a cell, and what stops it), the cells with no floor against the blocks carried and where they run out, about how long, whether it is back the way the last leg came, and how the last leg this way ended, kept on that heading', level: 'root', dynamic: true },
    { pattern: 'floor_(east|south|west|north)', label: 'go down to the floor below and walk it this way ninety-six blocks, bridging only across the lava and open air on it', when: 'ground four or more below under eight or more of the sixty-four columns round the bot, a way down to it found within thirty-two blocks (walked, dropped no more than a body takes at half its health, or stepped down through rock with a pickaxe), and eight or more cells of floor this way from the foot of it; said with the way down (steps, drops and their damage, rock dug, seconds), the floor this way (floor to walk, rises, drops, lava on it, open air, wall, blocks to lay against those carried, the first cells, the mobs by it), and how the last such leg this way ended', level: 'root', dynamic: true },
    { key: 'seek_fortress_height', label: 'dig a staircase toward y 64 first, along the most open heading', when: 'the bot stands more than eight blocks above or below y 64 and a staircase is at hand; said with the height to make up and where fortresses stand', level: 'root' },
    { key: 'restock_blocks', label: 'dig, in one go, the blocks the longest leg short of them still needs from what can be dug on foot from here, then choose the leg again', when: 'a leg runs out of the blocks carried and some a span is laid with can be dug from ground walked to from here; said with how many (the need past those carried, as far as can be had here), the kinds, the nearest and the walk to it, about how long, what lies within sixteen blocks out of reach, and what the last restock gained', level: 'root' },
    { key: 'stay_in_fortress', label: 'stay in the fortress and walk its corridors again for blazes for three minutes, the least lately walked first', when: 'the bot is on the fortress\'s floors, has walked every floor it has seen that it can reach running on into unseen space, and some floor it has walked is twelve or more steps off; said with the floors seen and walked, how far the floors joined to here run (a small room walked again is paced), the times asked there, the minutes there and the blazes seen near it', level: 'root' },
    { key: 'wait_at_spawner', label: 'wait by the spawner seen for three minutes, the hunt taking each blaze it makes', when: 'on the fortress\'s floors with nothing left to walk to, and a spawner has been seen through open air (never one behind a wall); said with where it is, whether floors seen join it to the bot and how many steps, how it makes blazes, and how the last wait there ended; the walk there is on foot, and where it finds no way the way there is asked once', level: 'root' },
    { pattern: 'unwalked_[1-3]', label: 'go to the fortress\'s unwalked floors seen across a gap, on foot first, the way there asked where the walk finds none', when: 'on the fortress\'s floors with nothing left to walk to, and floors of it are seen that no floor seen joins to the bot; up to three, nearest first, each said with how far, how many floors and how many run on unseen, the way across along the ground (fortress-map.js crossing: the cells of lava lying on the floor to cover, rock to dig and open air to span, and the seconds; round the lava too, where there is a way round), else the nearest crossing in a straight line and what lies between, and how the last try ended', level: 'root', dynamic: true },
    { key: 'back_to_fortress', label: 'go back into the fortress in view that was left or set aside', when: 'two dozen or more fortress bricks are in view but left behind or set aside, except where the bot stands on the spot it was set aside from as nothing to walk to (from there the same look sets it aside again at once) or where Jev chose to leave it over its ways in (from there going back asks the same ways again); said in the state instead; said with when and why, how far the nearest is, and the blazes seen near it', level: 'root' },
    { key: 'return_for_blocks', label: 'go back through the portal to the Overworld for stone', when: 'a leg runs out of the blocks carried and the way back through the portal is at hand; said with the nearest portal known', level: 'root' },
    { key: 'go_to_blazes_about', label: 'go to the blazes about now, on foot first, the way there asked where the walk finds none', when: 'blazes the bot knows of now (in sight or heard through the walls) are within ninety-six blocks and more than twelve off, not where the busiest sighting was made in the last minute, and not at a place Jev left; said with how many, how many in sight, the nearest and how far, and how the last try at them ended', level: 'root' },
    { key: 'go_to_blazes', label: 'go to where blazes were seen, on foot first, the way there asked where the walk finds none', when: 'the hunt has seen blazes in this dimension more than twelve blocks from the bot; said with the busiest place, how many times and how lately, how many were in sight and how many heard through walls, the hunt\'s own walks back and how they ended, and how the last try from the search ended; not a place Jev left (fortress_approach other_way) within its ten minutes', level: 'root' },
  ],
  instructions: {
    task: 'The bot is searching the Nether for a fortress, in legs of ninety-six blocks. Choose the next leg.',
    guidance: 'The search is for blazes: blazesSeen, when there, is the blazes about now (in sight or heard through the walls) and where the hunt has seen them, and they come back to where a spawner is. waysLeft are places Jev left the way to (fortress_approach), set aside for ten minutes and not offered until then. Fortresses stand mostly between y 48 and 75 over the lava sea at y 31, and their bricks are seen within 128 blocks through open air only: a leg through rock sees nothing however far it goes, at about six seconds a cell. Open air over a deep drop is a cavern or the sea\'s edge, where the view is long. The mobs in view, the blocks carried and the pickaxe are in the state; a leg over open air with no floor needs a block laid a cell, and stops where the blocks carried run out; rock is dug only with a pickaxe. Each leg says its first cells in order: what it meets before anything else. A player crosses the Nether on its floors where they are walkable (forests, soul sand valleys, netherrack caverns) and bridges only across lava or a void: a floor leg says the way down to the floor and what the floor that way holds. legsResting are legs that ended at once from here, no ground made, and why; they are not offered from here for a few minutes. fortressInView.map, on a fortress, is the fortress as the bot has seen it through open air: the floors seen and walked, how many are joined to where it stands, the ways on it can still walk to, the spawners, stairs, nether wart and chests seen, and the ways whose walk failed; a fortress\'s blaze spawners stand in rooms reached by its stairs, and nether wart and chests are in its other rooms.',
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
