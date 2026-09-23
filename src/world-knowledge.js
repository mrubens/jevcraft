'use strict';
// What the bot has learned about the world, as opposed to what it is doing
// in it. Portals, villages, the End portal and the stronghold search were
// kept on whichever goal found them, and a goal is thrown away when the next
// one starts: a player's "get me wood" in the middle of the run and the
// dream came back knowing no portal, planned a second one, and could not
// find its way home from the Nether. The eyes milestone is the sharpest
// case: it is credited while twelve eyes are carried, and once they are in
// the frame it can never be credited again, so a relaunched run could never
// be finished.
//
// One store per world. Every goal is filled from it when it launches, and
// every save of that goal writes the fields back, deletions included: the
// running goal is the freshest copy there is.
// The explored map and the landmarks found (exploration.js) are the
// world's too: an area walked once is known to every goal after.
const WORLD_FIELDS = ['portals', 'portalFrame', 'villages', 'endPortal', 'strongholdSearch', 'explored', 'landmarks'];
// Progress toward beating the game belongs to the run, and every run of it
// in this world is the same run: the milestones are observations of this
// bot in this world.
const RUN_FIELDS = ['gameProgress'];
// The idle loop climbs the same ladder when beating the game is the dream,
// so it shares the run's progress rather than keeping a second copy.
const fieldsFor = goal => goal?.kind === 'win' || goal?.dream === 'beat_the_game' ? [...WORLD_FIELDS, ...RUN_FIELDS] : WORLD_FIELDS;

// The store is the authority at launch: a field it does not have is taken
// off the goal too, or a resumed goal's old portal plan, long since built
// or given up, would be written back as news. A goal that has been filled
// owns those fields from then on; one that has not (built and saved before
// its launch) must not write its blanks over what the world knows.
function hydrate(goal, known = {}) {
  for (const field of fieldsFor(goal)) {
    // A copy: a portal pushed onto the goal's list must still look like a
    // change when the goal is saved, not already be in the store.
    if (known[field] !== undefined) goal[field] = structuredClone(known[field]); else delete goal[field];
  }
  goal.worldKnowledge = true;
  return goal;
}

function harvest(goal, known = {}) {
  if (!goal?.worldKnowledge) return { known, changed: false };
  let changed = false;
  for (const field of fieldsFor(goal)) {
    const value = goal[field];
    if (JSON.stringify(value) === JSON.stringify(known[field])) continue;
    if (value === undefined) delete known[field]; else known[field] = structuredClone(value);
    changed = true;
  }
  return { known, changed };
}

// The first start after this store existed: whatever the last goal and the
// idle loop knew, the last goal first.
function seed(...goals) {
  const known = {};
  for (const field of [...WORLD_FIELDS, ...RUN_FIELDS]) {
    const from = goals.find(goal => goal?.[field] !== undefined);
    if (from) known[field] = from[field];
  }
  return known;
}

class WorldKnowledge {
  constructor(store, { seedFrom = [] } = {}) {
    this.store = store;
    this.known = store.read()?.known || seed(...seedFrom);
  }
  hydrate(goal) { return hydrate(goal, this.known); }
  harvest(goal) {
    const { changed } = harvest(goal, this.known);
    if (changed) this.store.save({ version: 1, known: this.known });
    return changed;
  }
}

module.exports = { WorldKnowledge, hydrate, harvest, seed, WORLD_FIELDS, RUN_FIELDS };
