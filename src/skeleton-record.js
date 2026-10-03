'use strict';
// What the first answer to a skeleton cost, from the record (note 1100).
// Measured over the flight records of 2026-10-02 and 2026-10-03, the
// Overworld: each encounter (no stance asked in the thirty seconds before)
// with a skeleton among those named first, by the stance chosen first and
// whether a shield was carried: the arrows that landed in the minute after,
// whatever was chosen next. Ten of the forty-three deaths of 2026-10-03
// 14:00 to 20:00Z were a skeleton's arrows, six of them with nothing worn
// and one in a chestplate alone (read ten seconds before each death; note
// 1100's count of eight read the frame after it), and seven of the ten
// began with a run: the run's own words priced it at about a tenth of an
// arrow.
const RECORD = {
  from: '2026-10-02', to: '2026-10-03',
  // choice: { bare: [encounters, arrows], shield: [encounters, arrows] }
  retreat: { bare: [29, 35], shield: [19, 9] },
  take_cover: { bare: [45, 37], shield: [49, 25] },
  out_of_sight: { bare: [20, 5], shield: [29, 13] },
};
const rate = ([n, arrows]) => Math.round(arrows / n * 10) / 10;
const WORDS = { retreat: 'a run', take_cover: 'cover laid', out_of_sight: 'a walk out of its sight' };
// -> ' In the record ...' for `choice`, the other two beside it; '' where
// the choice has no record.
function says(choice, shielded) {
  const side = shielded ? 'shield' : 'bare';
  if (!RECORD[choice]) return '';
  const one = k => `${WORDS[k]} ${rate(RECORD[k][side])} (${RECORD[k][side][0]} times)`;
  const rest = Object.keys(WORDS).filter(k => k !== choice).map(one).join(', ');
  return ` In the record (${RECORD.from} to ${RECORD.to}, the Overworld, ${shielded ? 'a shield carried' : 'no shield carried'}), the arrows a skeleton landed in the minute after the first answer to it: ${one(choice)}; against ${rest}.`;
}
module.exports = { RECORD, says };
