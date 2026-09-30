'use strict';
// The job in hand, and what a walk away from it costs, said on the stall's
// options that leave it (note 755).
//
// 25584 (12:13 to 12:19Z) stood beside the iron ore its step was mining for
// (three raw iron, for the bucket the cast's water needs), chose
// rung_progress travel_river, walked 64 blocks west, then came back for the
// iron and went west again: x 3 to -67 to -15 to -47 to 2, about 200 blocks
// for 50 net. travel_river said the river had water "and an empty one fills
// at any water", with no empty bucket carried; nothing said the step's iron
// was 3 blocks from where it stood. 25588 (12:34 to 12:45Z) left a portal
// frame 8 of ten cast, a lava and a water bucket in hand, for a food top-up
// at hunger 19 and detours 90 blocks south; no option it was offered named
// the frame two blocks from done.
//
// So a stall's question says the job in hand once: the frame begun (how
// many of ten, how far, what is carried toward the next block) and the
// step's own need (what it mines and the nearest known), and each way that
// walks off says how far its end is from them.

const named = s => String(s || '').replaceAll('_', ' ');
const plain = p => p && Number.isFinite(p.x) && Number.isFinite(p.z) ? p : null;
const dist = (a, b) => (a && b) ? Math.hypot(a.x - b.x, (Number.isFinite(a.y) && Number.isFinite(b.y) ? a.y - b.y : 0), a.z - b.z) : Infinity;
const distXZ = (a, b) => (a && b) ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity;

// The step's need in words, with the nearest known source from `here`:
// a mine step (its count of drops, the block), a craft step (the item). ->
// string or ''.
function stepNeedSays(step, { here = null, nearest = null } = {}) {
  if (!step?.action) return '';
  if (step.action === 'mine' && (step.block || step.sources)) {
    const block = named(step.block || step.sources?.[0]);
    const what = step.drops && step.drops !== step.block ? `${step.count ? `${step.count} ` : ''}${named(step.drops)} (${block})` : `${step.count ? `${step.count} ` : ''}${block}`;
    const at = plain(nearest);
    return `the step waiting mines ${what}: ${at && here ? `the nearest known ${Math.round(dist(at, here))} blocks from here` : 'none known in view from here'}`;
  }
  if (step.action === 'tunnel' && plain(step.target)) return `the step waiting tunnels to (${step.target.x}, ${step.target.y}, ${step.target.z})${here ? `, ${Math.round(dist(step.target, here))} blocks from here` : ''}`;
  if (step.action === 'craft' && step.item) return `the step waiting crafts ${step.count > 1 ? `${step.count} ` : ''}${named(step.item)}`;
  if (step.action === 'smelt' && step.item) return `the step waiting smelts ${step.count > 1 ? `${step.count} ` : ''}${named(step.item)}`;
  return '';
}

// -> { says, short, places: [{ what, at }] } or null. `find(names)` gives
// the nearest block of those names (a Vec3-like) or null; `frame` is
// { at, placed, cast } from framePending; `carried` counts buckets.
function jobInHand({ step = null, here = null, frame = null, find = null, carried = {} } = {}) {
  const parts = [], places = [];
  if (frame?.at && Number.isFinite(frame.placed) && frame.placed < 10) {
    const left = 10 - frame.placed;
    const toward = [carried.lava ? `${carried.lava} lava bucket${carried.lava === 1 ? '' : 's'}` : null, carried.water ? `${carried.water} water bucket${carried.water === 1 ? '' : 's'}` : null].filter(Boolean);
    parts.push(`the portal frame at (${frame.at.x}, ${frame.at.y}, ${frame.at.z}), ${frame.placed} of ten ${frame.cast ? 'cast' : 'placed'}, ${left} block${left === 1 ? '' : 's'} from done, ${Math.round(dist(frame.at, here))} blocks from here${toward.length ? `, ${toward.join(' and ')} carried toward the next` : ''}`);
    places.push({ what: 'the frame', at: frame.at });
  }
  let nearest = null;
  if (step?.action === 'mine' && (step.sources || step.block)) {
    try { nearest = typeof find === 'function' ? find(step.sources || [step.block]) : null; } catch (_) { nearest = null; }
    nearest = plain(nearest) || plain(step.target);
  }
  const need = stepNeedSays(step, { here, nearest });
  if (need) {
    parts.push(need);
    if (nearest) places.push({ what: named(step.block || step.sources?.[0]), at: nearest });
    else if (step.action === 'tunnel' && plain(step.target)) places.push({ what: 'the tunnel\'s end', at: step.target });
  }
  if (!parts.length) return null;
  const says = `The job in hand: ${parts.join('; ')}.`;
  return { says, short: parts[0], places };
}

// For a way that walks to `dest` ({ x, z }): how far its end is from each
// place the job needs, against how far they are from here.
function awaySays(job, dest, here) {
  if (!job?.places?.length || !plain(dest)) return '';
  const far = job.places.map(p => ({ ...p, fromHere: Math.round(dist(p.at, here)), fromThere: Math.round(distXZ(p.at, dest)) }))
    .filter(p => p.fromThere > p.fromHere + 8);
  if (!far.length) return '';
  return ` Away from the job in hand: ${far.map(p => `${p.what} is ${p.fromHere} blocks from here and about ${p.fromThere} from there`).join('; ')}, walked back for after.`;
}

module.exports = { jobInHand, stepNeedSays, awaySays };
