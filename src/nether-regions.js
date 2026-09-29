'use strict';
// Where Nether fortresses can begin, as the game places them: the Nether is
// cut into regions of 27 by 27 chunks (432 by 432 blocks, the first from
// x 0, z 0), and each region holds one fortress or one bastion, never both
// (the structure set nether_complexes: spacing 27, separation 4, a fortress
// two times in five). Each begins in its region's first 23 chunks along x and
// along z (its west and north 368 blocks); a fortress's corridors run up to
// about 112 blocks from where it begins, a bastion's up to about 80.
//
// mid-243-ch's search (25581, note 652) walked thirteen legs of ninety-six
// blocks over x -62 to 132, z 6 to 443 for twenty-two minutes, three of them
// round the bastion it had seen at (89, 43, 324): the region x 0 to 431, z 0
// to 431, which holds that bastion and so no fortress begins in it. Nothing
// told Jev so; each leg was offered on the ground unseen beside it alone.
const REGION = 432, STARTS = 368;
const REACH = { bastion: 80, nether_fortress: 128 };
const WHAT = { bastion: 'bastion', nether_fortress: 'fortress' };

const regionOf = (x, z) => ({ rx: Math.floor(x / REGION), rz: Math.floor(z / REGION) });
const bounds = ({ rx, rz }) => ({ x0: rx * REGION, x1: rx * REGION + REGION - 1, z0: rz * REGION, z1: rz * REGION + REGION - 1 });
const regionName = r => { const b = bounds(r); return `x ${b.x0} to ${b.x1}, z ${b.z0} to ${b.z1}`; };
const sameRegion = (a, b) => a.rx === b.rx && a.rz === b.rz;

// The regions a structure seen at `p` can have begun in: those whose start
// ground (its first 368 blocks along each axis), widened by how far the kind
// runs from its start, holds the point.
function ownersOnAxis(v, reach) {
  const r = Math.floor(v / REGION), out = [];
  for (const c of [r - 1, r, r + 1]) if (v >= c * REGION - reach && v < c * REGION + STARTS + reach) out.push(c);
  return out;
}
function owners(kind, p) {
  const reach = REACH[kind] ?? 0, out = [];
  for (const rx of ownersOnAxis(p.x, reach)) for (const rz of ownersOnAxis(p.z, reach)) out.push({ rx, rz });
  return out;
}

// What is known of each region from the landmarks remembered in the Nether
// (exploration.js): a bastion or fortress seen whose start can lie only in
// one region settles that region; one that could have begun in more than one
// settles none, and is said as such.
function known(landmarks = []) {
  const settled = [], unsure = [];
  for (const l of landmarks) {
    if (!WHAT[l.kind] || !/nether/.test(String(l.dimension || ''))) continue;
    const o = owners(l.kind, l);
    (o.length === 1 ? settled : unsure).push({ kind: l.kind, at: l, region: o[0], regions: o });
  }
  return { settled, unsure };
}
const at = l => `(${l.x}, ${l.y ?? '?'}, ${l.z})`;
function heldBy(r, k) {
  const s = k.settled.find(e => sameRegion(e.region, r));
  if (s) return s.kind === 'bastion' ? `holds the bastion seen at ${at(s.at)}, so no fortress begins in it` : `holds the fortress remembered at ${at(s.at)}`;
  const u = k.unsure.find(e => e.regions.some(o => sameRegion(o, r)));
  if (u) return `may hold the ${WHAT[u.kind]} seen at ${at(u.at)}, which could have begun in it or in a region beside it`;
  return 'nothing of a fortress or bastion known there';
}

// How much of a region the search has seen at fortress heights
// (nether-coverage.js): its seen columns of 4 by 4 against its 11,664.
function seenShare(state, dim, r) {
  const cov = state?.coverage?.[dim]?.seen;
  if (!cov) return 0;
  const b = bounds(r);
  let n = 0;
  for (const [key, mask] of Object.entries(cov)) {
    const [cx, cz] = key.split(',').map(Number);
    if (cx * 16 < b.x0 || cx * 16 > b.x1 || cz * 16 < b.z0 || cz * 16 > b.z1) continue;
    for (let m = mask; m; m >>>= 1) n += m & 1;
  }
  return n / ((REGION / 4) * (REGION / 4));
}
const pct = s => s > 0 && s < 0.01 ? 'under 1%' : `${Math.round(s * 100)}%`;
function regionSays(r, k, state, dim) {
  return `the region ${regionName(r)} ${heldBy(r, k)}; about ${pct(seenShare(state, dim, r))} of it seen at fortress heights`;
}

// One heading's way out of the region the bot stands in: the blocks to its
// edge that way, and what is known of the region past it.
function headingRegion(here, [dx, dz]) {
  const r = regionOf(here.x, here.z), b = bounds(r);
  const out = dx > 0 ? b.x1 + 1 - here.x : dx < 0 ? here.x - b.x0 : dz > 0 ? b.z1 + 1 - here.z : here.z - b.z0;
  return { region: r, blocks: Math.max(1, Math.ceil(out)), next: { rx: r.rx + dx, rz: r.rz + dz } };
}
function headingRegionSays(here, heading, k, state, dim) {
  const h = headingRegion(here, heading);
  return ` This way the bot leaves the region it stands in after about ${h.blocks} blocks, into ${regionSays(h.next, k, state, dim)}.`;
}

// The facts for the leg's question: the rule, the region the bot stands in,
// and every other region something is known of.
const RULE = 'The Nether is cut into regions of 432 by 432 blocks (27 by 27 chunks, the first from x 0, z 0), and each region holds one fortress or one bastion, never both: a fortress about two times in five. Each begins in its region\'s west and north 368 blocks (along x and along z), and a fortress\'s corridors run up to about 112 blocks from where it begins, so one begun in a region beside can reach a little way into this one. A region holding a bastion has no fortress of its own; a region with nothing known of it holds one or the other.';
function regionFacts(here, landmarks, state, dim) {
  const k = known(landmarks), r = regionOf(here.x, here.z);
  const others = [...k.settled.map(e => e.region), ...k.unsure.flatMap(e => e.regions)]
    .filter((o, i, all) => !sameRegion(o, r) && all.findIndex(q => sameRegion(q, o)) === i)
    .map(o => regionSays(o, k, state, dim));
  return { rule: RULE, standingIn: regionSays(r, k, state, dim), ...(others.length ? { otherRegionsKnown: others } : {}) };
}

module.exports = { REGION, STARTS, regionOf, bounds, owners, known, seenShare, regionSays, headingRegion, headingRegionSays, regionFacts, RULE };
