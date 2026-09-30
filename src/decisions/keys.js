'use strict';
// An option's key names its thing (note 749).
//
// A key is how an option is known from one asking to the next: the ledger's
// tries and rests (tried.js), the least bad and the answer chosen again
// (least-bad.js), the answer that changed nothing (unchanged.js), the repeat
// rule (repeats.js) and Jev's own words on the option ("chosen 5 times ...
// came to nothing") all go by it. A key that is a place in a list (biome_2,
// seen_0, walk_to_1) names whatever came second, third or first this time:
// on 25594 biome_2 was the jungle to the north at 11:14:28 and the forest to
// the east nine seconds later (critic-20260930T1114Z item 1), and what had
// come of the one was said on the other. Of 23,043 askings from 06:00Z to
// 11:30Z on 2026-09-30, six questions offered a positional key for a
// different thing than at their last asking, 1,062 times (scripts/
// ask-loops.js).
//
// A key is also the label Jev reads. Keyed by its coordinates, the replay
// suite's spawner case (fortress-leg-spawner-known-full-health-25589) took
// go_to_spawner_at_-108_77_155 at 10 of 20 askings, where go_to_spawner took
// 18 and go_to_spawner_1 18: a label full of numbers reads as noise. So a
// thing without a name is given a number when it is first offered, kept with
// the goal and never given to another thing of its kind (ids below): the
// label reads as it did (seen_food_0, walk_to_1), and names the same thing at
// every asking. A thing with a name is keyed by it (biome_forest).
// define() requires every dynamic option in a catalogue to say what its key
// names (`names`), and a catalogue whose number is not such an id fails the
// lint (test/note-749).

const KEEP = 64;
// A name made a key: lower case, words joined by underscores.
const name = s => String(s || '').toLowerCase().replace(/^minecraft:/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
const off = (a, b) => Math.hypot(a.x - b.x, Number.isFinite(a.y) && Number.isFinite(b.y) ? a.y - b.y : 0, a.z - b.z);
const P = p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z)) ? { x: Number(p.x), ...(Number.isFinite(Number(p.y)) ? { y: Number(p.y) } : {}), z: Number(p.z) } : null;

// The ids of `points` (things of one `kind`, each a place): the number each
// was given when first offered within `near` blocks of where it is now, else
// the next number not given; two things offered together never share one.
// Kept on `holder` (the goal, saved with it), the last KEEP of each kind.
// -> [id, ...] in the order of `points`
function ids(holder, kind, points, { near = 4, base = 0, now = Date.now() } = {}) {
  // Kept with the world's survival state where the goal carries it: a
  // detour's scratch goal is made afresh at each detour and shares it (note
  // 749b: 25591's night mine numbered its ores from 0 again at 13:21:13Z).
  const home = holder?.survival && typeof holder.survival === 'object' ? holder.survival : holder;
  const reg = home && typeof home === 'object' ? (home.keyIds ||= {}) : {};
  const r = (reg[kind] ||= { next: base, seen: [] });
  const used = new Set(), out = [];
  for (const raw of points) {
    const p = P(raw);
    let hit = null;
    if (p) for (const e of r.seen) if (!used.has(e.n) && off(e, p) <= near && (!hit || off(e, p) < off(hit, p))) hit = e;
    if (hit) { Object.assign(hit, p, { at: now }); used.add(hit.n); out.push(hit.n); continue; }
    const e = { ...(p || {}), n: r.next++, at: now };
    if (p) r.seen.push(e);
    used.add(e.n); out.push(e.n);
  }
  if (r.seen.length > KEEP) r.seen.splice(0, r.seen.length - KEEP);
  return out;
}
// One thing's id: ids() for one.
const id = (holder, kind, point, opts) => ids(holder, kind, [point], opts)[0];

module.exports = { ids, id, name, KEEP };
