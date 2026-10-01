'use strict';
// What an answer was quoted at against what it cost (note 768; the
// reviewer's check-in of 2026-09-30 ~23:45Z, problem 3: "did it cost what
// was quoted"). Note 765 judges every answer's run for whether it changed
// anything (decisions/outcome.js); an option that carries a `quote`
// ({ seconds, uses, rise }: the seconds and pickaxe uses its figure says,
// for the blocks it rises) is also read, when it is judged, for what it
// took: the seconds since it was chosen, the pickaxe uses worn, the blocks
// risen. The rate per block risen against the rate quoted is kept by kind
// (the way, and by hand or with a pickaxe), and the next quote of that kind
// is its own figure times what the last ones measured took against theirs, said so.
// Climbs first: 25581 (mid-243-au, 23:38:01Z) was told "73 blocks up ...
// straight up the column, about 2 minutes. It wears 72 of the 153 uses",
// climbed by the staircase it had held since 23:36:48, and at 23:39:44 had
// risen 35 blocks for 106 uses. Over the flight records of 06:00Z to
// 23:45Z (scripts/climb-record.js, runs that rose three blocks or more) a
// staircase with a pickaxe was quoted 2.5 seconds and 2.44 uses a block and
// took 3.6 and 2.83; by hand quoted 14.1 seconds and took 23; straight up
// with a pickaxe quoted 1.5 and took 1.1, by hand 6.3 and 6.6. Note 768b
// put the record on one basis for every way (PRIOR below); it stands until
// the bot's own answers make one (MIN_OWN).

const KEEP = 20, MIN_RISE = 3, MIN_OWN = 3, MIN_SECONDS = 10;
const CLAMP = [0.5, 3];
// scripts/climb-record.js: the ratio of the
// seconds (and uses) a block risen taken to those quoted, and how many runs.
// Note 768b: one basis for every way, every run and every second of it,
// the runs that rose nothing included: the seconds taken over the seconds
// the quote gave for the blocks the run rose (a median over runs that rose
// three blocks or more had put straight up at 0.73 and the staircase at
// 1.44, leaving out the 74 staircases and 46 straight ups with a pickaxe
// that rose nothing).
const PRIOR = {
  'staircase/pickaxe': { seconds: 1.61, uses: 1.23, n: 681 },
  'staircase/hand': { seconds: 1.77, uses: null, n: 56 },
  'straight_up/pickaxe': { seconds: 1.18, uses: 1.05, n: 319 },
  'straight_up/hand': { seconds: 1.2, uses: null, n: 72 },
};
const PRIOR_WINDOW = 'the flight records of 2026-09-30 06:00Z to 2026-10-01 00:47Z, every second of every run';

const clamp = x => Math.min(CLAMP[1], Math.max(CLAMP[0], x));
const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

// The pickaxes carried and their uses left: the mark's side of the uses.
function picksOf(bot) {
  try {
    const picks = (bot?.inventory?.items?.() || []).filter(i => /_pickaxe$/.test(i.name));
    const uses = picks.reduce((n, i) => n + Math.max(0, (bot.registry?.itemsByName?.[i.name]?.maxDurability ?? 0) - (i.durabilityUsed || 0)), 0);
    return { names: picks.map(i => i.name).sort().join(','), uses };
  } catch (_) { return null; }
}

// Recorded when an answer carrying a quote is judged (outcome.js judge).
// `o`: the kept answer ({ key, at, mark, quote }); `here`: the mark now.
function record(goal, o, here, { now = Date.now() } = {}) {
  const q = o?.quote;
  if (!goal || !q?.kind || !o.mark?.p || !here?.p) return null;
  const rise = Math.round(here.p.y - o.mark.p.y);
  const seconds = (now - o.at) / 1000;
  const uses = o.mark.picks && here.picks && o.mark.picks.names === here.picks.names && o.mark.picks.names ? o.mark.picks.uses - here.picks.uses : null;
  const entry = { at: now, rise, seconds: Math.round(seconds), uses, quoted: { seconds: q.seconds, uses: q.uses ?? null, rise: q.rise } };
  const list = ((goal.quoteRecord ||= {})[q.kind] ||= []);
  list.push(entry);
  if (list.length > KEEP) list.splice(0, list.length - KEEP);
  return entry;
}

// The ratio a kind's quote is taken at now: the bot's own last answers of
// that kind (MIN_OWN of them at least, each run MIN_SECONDS or more),
// else the record's. -> { seconds, uses, n, own, says } or null.
function ratioOf(goal, kind) {
  // The same basis as the record's: the seconds taken over the seconds the
  // quotes gave for the blocks risen, summed, a run that rose nothing
  // counting its seconds and no quoted time (25590's staircase walked level
  // for three minutes). Runs under CLIMB_SECONDS are left out (a run cut at
  // once by a fight says nothing of the way).
  const own = (goal?.quoteRecord?.[kind] || []).filter(e => e.quoted?.rise > 0 && e.quoted.seconds > 0 && e.seconds >= MIN_SECONDS);
  if (own.length >= MIN_OWN) {
    const perBlock = e => e.quoted.seconds / e.quoted.rise;
    const took = own.reduce((n, e) => n + e.seconds, 0), gave = own.reduce((n, e) => n + Math.max(0, e.rise) * perBlock(e), 0);
    const s = gave > 0 ? took / gave : CLAMP[1];
    const withUses = own.filter(e => e.uses != null && e.quoted.uses > 0);
    const ut = withUses.reduce((n, e) => n + e.uses, 0), ug = withUses.reduce((n, e) => n + Math.max(0, e.rise) * e.quoted.uses / e.quoted.rise, 0);
    const u = withUses.length >= MIN_OWN ? (ug > 0 ? ut / ug : CLAMP[1]) : PRIOR[kind]?.uses ?? null;
    return { seconds: clamp(s), uses: u != null ? clamp(u) : null, n: own.length, own: true,
      says: `the last ${own.length} of this bot's ${words(kind)} took ${round(s)} times the seconds their figures gave for the blocks they rose${withUses.length >= MIN_OWN ? ` and ${round(u)} times the pickaxe uses` : ''}` };
  }
  const p = PRIOR[kind];
  if (!p) return null;
  return { seconds: clamp(p.seconds), uses: p.uses != null ? clamp(p.uses) : null, n: p.n, own: false,
    says: `${p.n} ${words(kind)} over ${PRIOR_WINDOW} took ${p.seconds} times the seconds their figures gave for the blocks they rose${p.uses != null ? ` and ${p.uses} times the pickaxe uses` : ''}` };
}
const words = kind => { const [way, by] = String(kind).split('/'); return `${way.replaceAll('_', ' ')}s ${by === 'hand' ? 'by hand' : 'with a pickaxe'}`; };

module.exports = { record, ratioOf, picksOf, PRIOR, MIN_RISE, MIN_OWN, MIN_SECONDS };
