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
// is its own figure times the median of the last ones measured, said so.
// Climbs first: 25581 (mid-243-au, 23:38:01Z) was told "73 blocks up ...
// straight up the column, about 2 minutes. It wears 72 of the 153 uses",
// climbed by the staircase it had held since 23:36:48, and at 23:39:44 had
// risen 35 blocks for 106 uses. Over the flight records of 06:00Z to
// 23:45Z (scripts/climb-record.js, runs that rose three blocks or more) a
// staircase with a pickaxe was quoted 2.5 seconds and 2.44 uses a block and
// took 3.6 and 2.83; by hand quoted 14.1 seconds and took 23; straight up
// with a pickaxe quoted 1.5 and took 1.1, by hand 6.3 and 6.6. Those are
// the record until the bot's own answers make one (MIN_OWN).

const KEEP = 20, MIN_RISE = 3, MIN_OWN = 3, SLOW_SECONDS = 60;
const CLAMP = [0.5, 3];
// scripts/climb-record.js, 2026-09-30 06:00Z to 23:45Z: the ratio of the
// seconds (and uses) a block risen taken to those quoted, and how many runs.
const PRIOR = {
  'staircase/pickaxe': { seconds: 1.44, uses: 1.16, n: 497 },
  'staircase/hand': { seconds: 1.63, uses: null, n: 33 },
  'straight_up/pickaxe': { seconds: 0.73, uses: 0.98, n: 254 },
  'straight_up/hand': { seconds: 1.05, uses: null, n: 47 },
};
const PRIOR_WINDOW = 'the flight records of 2026-09-30 06:00Z to 23:45Z';

const median = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
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
// that kind that rose MIN_RISE blocks or more (MIN_OWN of them at least),
// else the record's. -> { seconds, uses, n, own, says } or null.
function ratioOf(goal, kind) {
  // A run that rose MIN_RISE or more, or one that ran a minute or more and
  // rose less (25590's staircase walked level for three minutes): counted at
  // a block risen at the least, so it reads as slow as it was (the clamp).
  const counts = e => e.quoted?.rise > 0 && e.quoted.seconds > 0 && (e.rise >= MIN_RISE || e.seconds >= SLOW_SECONDS);
  const own = (goal?.quoteRecord?.[kind] || []).filter(counts);
  const rose = e => Math.max(1, e.rise);
  if (own.length >= MIN_OWN) {
    const s = median(own.map(e => (e.seconds / rose(e)) / (e.quoted.seconds / e.quoted.rise)));
    const withUses = own.filter(e => e.uses != null && e.quoted.uses > 0);
    const u = withUses.length >= MIN_OWN ? median(withUses.map(e => (e.uses / rose(e)) / (e.quoted.uses / e.quoted.rise))) : PRIOR[kind]?.uses ?? null;
    return { seconds: clamp(s), uses: u != null ? clamp(u) : null, n: own.length, own: true,
      says: `the last ${own.length} of this bot's ${words(kind)} took ${round(s)} times the seconds a block their figure said${withUses.length >= MIN_OWN ? ` and ${round(u)} times the pickaxe uses` : ''}` };
  }
  const p = PRIOR[kind];
  if (!p) return null;
  return { seconds: clamp(p.seconds), uses: p.uses != null ? clamp(p.uses) : null, n: p.n, own: false,
    says: `${p.n} ${words(kind)} runs over ${PRIOR_WINDOW} took ${p.seconds} times the seconds a block their figure said${p.uses != null ? ` and ${p.uses} times the pickaxe uses` : ''}` };
}
const words = kind => { const [way, by] = String(kind).split('/'); return `${way.replaceAll('_', ' ')}s ${by === 'hand' ? 'by hand' : 'with a pickaxe'}`; };

module.exports = { record, ratioOf, picksOf, PRIOR, MIN_RISE, MIN_OWN };
