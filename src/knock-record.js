'use strict';
// What a hit that lands throws the bot, measured (note 662).
//
// The overnight run of 2026-09-29 (04:49Z to 11:37Z) had 20 deaths "tried to
// swim in lava" and two falls that were the same thing, and every one was a
// knock: a ghast's fireball (10), a magma cube's hit (7), a hoglin's, a
// piglin's blow or arrow (3), on a cell within a throw of the lava sea. The
// bot looked for a drop within three blocks and priced the fall in the one
// case it saw; the fireballs threw it 4.1, 4.2, 4.3 and 4.5 blocks before
// it went over.
//
// Measured over the flight records of 2026-09-28T04:45Z to 09-29T11:45Z
// (scripts/knock-record.js): for each hit that landed in the Nether, how far
// over the ground the body was 1.5 seconds later (the throw and whatever the
// bot did itself in that time; a portal jump left out), and whether the lava
// was touched within six seconds.
//   ghast fireball   106 landed: median 1.7 blocks, nine in ten within 4.2,
//                    6.1 the most; 30 of the 106 ended in lava
//   magma cube       55 landed: median 1.4, nine in ten within 2.5, 3.7 the
//                    most; 18 of the 55 ended in lava
//   hoglin           64 landed: median 0.9, nine in ten within 2.1; 10 of 64
//   skeleton arrow   200 landed: none ended in lava (a bow's push is small)
// So one landed ghast fireball or cube hit in three was the lava, wherever
// the bot stood within a throw of it.
const RECORD = {
  ghast: { what: 'a ghast\'s fireball that lands', n: 106, median: 1.7, p90: 4.2, most: 6.1, lava: 30 },
  magma_cube: { what: 'a magma cube\'s hit', n: 55, median: 1.4, p90: 2.5, most: 3.7, lava: 18 },
  hoglin: { what: 'a hoglin\'s blow', n: 64, median: 0.9, p90: 2.1, most: 7.3, lava: 10 },
};
// What followed each stance chosen in the Nether with a drop that kills within
// three blocks and a ghast (or a magma cube, the second table) about, once per
// stretch of the same answer (under a minute between askings): how many, how
// many touched the lava within 30 seconds. The answers taken over 2026-09-28T04:45Z to
// 2026-09-29T11:45Z; scripts/knock-record.js reproduces it.
const STANCES = {
  ghast: { take_cover: [195, 10], out_of_sight: [152, 10], rail_and_fight: [85, 8], seal: [81, 3], fight_from_footing: [80, 5], out_of_the_push: [63, 2], hold_on_span: [53, 5], keep_working: [36, 3], retreat: [32, 1], fight: [27, 4], nook: [20, 1], return_fireball: [13, 0], pillar: [9, 2] },
  magma_cube: { fight: [54, 1], shield_guard: [47, 2], pillar: [31, 4], fight_from_footing: [25, 2], retreat: [22, 1], rail_and_fight: [12, 0] },
  // With a hoglin about (note 966), the answers over 2026-09-30T00:00Z to
  // 2026-10-03T03:00Z: 25595 (mid-243-ia-fortress-6, 02:36:10Z) held
  // shield_guard on its own span against a hoglin, took the first blow with
  // the shield not yet up and went ten down into the lava with its rod.
  hoglin: { shield_guard: [15, 4], pillar: [14, 0] },
};
// Said on an option in that situation (n of 8 or more).
function optionSays(choice, names) {
  const kind = (names || []).includes('ghast') ? 'ghast' : (names || []).includes('magma_cube') ? 'magma_cube' : (names || []).includes('hoglin') ? 'hoglin' : null;
  const r = kind && STANCES[kind]?.[choice];
  if (!r || r[0] < 8) return '';
  return ` Measured on this bot: ${choice.replaceAll('_', ' ')} chosen with a drop that kills within three blocks and ${kind === 'ghast' ? 'a ghast' : kind === 'hoglin' ? 'a hoglin' : 'magma cubes'} about, ${r[0]} times (each stretch counted once): ${r[1]} of them had the bot in lava within 30 seconds.`;
}
// The blocks along the ground a drop is looked for from the bot's feet: the
// throw that covers nine in ten of that kind's hits, rounded up (a ghast's 5;
// three for anything else, as before).
const DEFAULT_REACH = 3;
const reachFor = names => Math.max(DEFAULT_REACH, ...[...new Set(names || [])].map(n => RECORD[n] ? Math.ceil(RECORD[n].p90) : 0));
const BLAST_THROW = Math.ceil(RECORD.ghast.p90);
// Said with a drop that kills, for the kinds about that have a record.
function knockSays(names) {
  const kinds = [...new Set(names || [])].filter(n => RECORD[n]);
  if (!kinds.length) return '';
  const said = kinds.map(n => { const r = RECORD[n]; return `${r.what}: of ${r.n} that landed on this bot in the Nether, the body went ${r.median} blocks (half of them), up to ${r.p90} (nine in ten)${r.most > r.p90 ? `, ${r.most} the most` : ''}, and ${r.lava} ended in lava`; });
  return ` Measured: ${said.join('; ')}.`;
}
module.exports = { RECORD, STANCES, reachFor, knockSays, optionSays, BLAST_THROW, DEFAULT_REACH };
