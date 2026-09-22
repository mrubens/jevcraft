'use strict';
const { setAside, isSetAside } = require('./progress');
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

// A failed source is remembered by its seed block, embedded in its key. The
// same tree comes back under a different nearest block once that one is
// gone, so suppression matches any cluster within `radius` of a failed seed
// of the same block, not the key string.
function failedSeeds(failures, now) {
  return Object.entries(failures).flatMap(([key, failure]) => {
    const match = /^source_(.+)_(-?\d+)_(-?\d+)_(-?\d+)$/.exec(key);
    return match && failure?.at > now - FAILURE_TTL_MS ? [{ block: match[1], seed: new Vec3(+match[2], +match[3], +match[4]) }] : [];
  });
}

function resourceSources(bot, candidates, { radius = 6, limit = 4, failures = {}, resting = () => false, now = Date.now() } = {}) {
  const origin = bot.entity.position;
  const failed = failedSeeds(failures, now);
  const remaining = candidates.map(pos).filter(p => !resting(p))
    .sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin));
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
    if (failed.some(f => f.block === block && blocks.some(p => p.distanceTo(f.seed) <= radius))) continue;
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

// Once Jev has chosen a source, the bot keeps working it until it is
// exhausted, fails, or the resource being gathered changes. Re-asking after
// every log made the model's job "which tree" seven times per tree, at a
// few hundred milliseconds each, when the answer had not changed. The
// choice is remembered on the goal so it survives a restart.
function rememberSource(goal, source, step) {
  goal.workingSource = { key: source.key, block: source.block, drops: step.drops,
    blocks: source.blocks.map(p => ({ x: p.x, y: p.y, z: p.z })), chosenAt: new Date().toISOString() };
}

function committedSource(bot, goal, step, { now = Date.now() } = {}) {
  const saved = goal.workingSource;
  if (!saved || saved.drops !== step.drops) return null;
  const source = { ...saved, blocks: saved.blocks.map(pos).filter(p => !isSetAside(goal, 'reach', p, now)) };
  if (!nearestRemaining(bot, source)) { delete goal.workingSource; return null; }
  return source;
}

// When one block of a source cannot be reached, the rest of that tree or
// vein is not going to be either. Setting the whole source aside is what
// lets the next step pick a different tree instead of the next log of this
// one, five times over, until the failure budget ends the request.
function setAsideSource(goal, source, why = 'the source could not be worked') {
  for (const p of source.blocks) setAside(goal, 'reach', p, why, FAILURE_TTL_MS);
}

module.exports = { resourceSources, nearestRemaining, decisionFingerprint, setAsideSource, failedSeeds, rememberSource, committedSource, FAILURE_TTL_MS };
