'use strict';
// The bot's own record of falls off its footing in the Nether (note 769),
// measured by scripts/lava-deaths.js --pushes over the flight records of
// 2026-09-29T23:00Z to 2026-09-30T21:00Z: every Nether death by lava or a
// fall that began with the body going over an edge (27; five more burned or
// fell where they stood), where it stood (the floor's width across, read
// from the trial's saved world), what put it over, and what it was holding.
const RECORD = {
  since: '2026-09-29T23:00Z', until: '2026-09-30T21:00Z',
  falls: 27,
  // The floor's width where it stood, by the save: two where a square of
  // two by two cells stood on held the feet (narrow-footing.js widthAt).
  width: { 1: 24, 2: 3 },
  // What put it over.
  by: { ghast: 11, piglin: 4, hoglin: 2, magma_cube: 1, skeleton: 1, unrecorded: 2, own: 6 },
  // What it held when it went over: the stances that stand still, and the
  // walks and walls under a ghast.
  held: {
    shield_guard: { n: 6, width1: 6, by: 'put over by a hoglin 3 times (a blow that landed and threw it, blows the shield took with no health lost, each knocking the body back with a hop, and a hop off a slope\'s edge with one four blocks off), and by a magma cube\'s blow, a piglin\'s arrow and a ghast\'s fireball once each' },
    eat: { n: 1, width1: 1, by: 'put over by a piglin\'s blow' },
    out_of_the_push: { n: 5, width1: 5, by: 'put over by a ghast\'s fireball each time, on the walk to the footing' },
    rail_span: { n: 2, width1: 1, by: 'put over by a ghast\'s fireball each time, while the walls went up' },
    hold_on_span: { n: 1, width1: 1, by: 'nothing recorded put it over' },
  },
};
// Said on a stance's option where the footing is narrow or a push is about:
// the record for that stance, and the whole.
function says(choice) {
  const r = RECORD, h = r.held[choice];
  const whole = ` The bot's own record (${r.since} to ${r.until}): ${r.falls} Nether deaths began with a fall off its footing, ${r.width[1]} of them from footing one block wide; ${r.by.ghast} were put over by a ghast's fireball, ${r.by.piglin} by a piglin, ${r.by.hoglin} by a hoglin, ${r.by.magma_cube} by a magma cube.`;
  if (!h) return whole;
  return `${whole} Held as ${choice.replaceAll('_', ' ')}: ${h.n} of them, ${h.width1 === h.n ? `${h.n === 1 ? 'on' : 'all on'} footing one wide` : `${h.width1} on footing one wide`}, ${h.by}.`;
}
module.exports = { RECORD, says };
