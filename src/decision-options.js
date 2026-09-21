'use strict';
const { Vec3 } = require('vec3');
const pos = p => new Vec3(p.x, p.y, p.z);

// What Jev is asked to choose between when the bot needs a resource.
//
// Individually listed blocks two metres apart were never a decision, only a
// nearest-neighbour search dressed up as one: the recorded trails showed Jev
// picking "the oak log at 22,64,8" over "the oak log at 22,65,8". A source is
// something worth judging against another source: what block it is, how many
// are within reach, how far, how much climbing. Code picks the exact block
// inside the source Jev chose, nearest first.
//
// A source that failed within the last two minutes is left out entirely, so a
// route that just failed is not offered again as if nothing had happened.
const FAILURE_TTL_MS = 120000;

function resourceSources(bot, candidates, { radius = 6, limit = 4, failures = {}, now = Date.now() } = {}) {
  const origin = bot.entity.position;
  const remaining = candidates.map(pos).sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin));
  const sources = [];
  while (remaining.length && sources.length < limit) {
    const seed = remaining.shift(), block = bot.blockAt(seed)?.name;
    if (!block) continue;
    const blocks = [seed];
    for (let i = remaining.length - 1; i >= 0; i--) {
      const p = remaining[i];
      if (bot.blockAt(p)?.name === block && p.distanceTo(seed) <= radius) { blocks.push(p); remaining.splice(i, 1); }
    }
    const key = `source_${block}_${seed.x}_${seed.y}_${seed.z}`;
    if (failures[key]?.at > now - FAILURE_TTL_MS) continue;
    blocks.sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin));
    sources.push({ key, block, blocks, description: { block, blocksWithinReach: blocks.length,
      distance: Math.round(seed.distanceTo(origin)), elevationChange: seed.y - Math.floor(origin.y) } });
  }
  return sources;
}

// The block to work on inside a chosen source: the nearest one that is still
// the block it was when Jev was asked.
function nearestRemaining(bot, source) {
  return source.blocks.find(p => bot.blockAt(p)?.name === source.block) || null;
}

// A decision is only as good as the world it was made about. Comparing the
// whole observation, mob distances included, discarded almost a third of the
// recorded decisions because a zombie had shuffled one block while Jev was
// answering. These are the facts a next action actually depends on.
function decisionFingerprint(bot, { inventory, immediateThreat, needsAir }) {
  return JSON.stringify({ health: bot.health, food: bot.food, air: needsAir(bot), threat: !!immediateThreat(bot),
    dimension: bot.game?.dimension, inventory: inventory(bot) });
}

module.exports = { resourceSources, nearestRemaining, decisionFingerprint, FAILURE_TTL_MS };
