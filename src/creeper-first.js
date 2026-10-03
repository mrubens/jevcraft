'use strict';
// What the first answer to a creeper came to, from the record (note 1123).
// Measured over the flight records of 2026-10-02 and 2026-10-03: each
// encounter with a creeper among the mobs (no stance asked in the thirty
// seconds before), by the stance chosen first: how many were followed within
// forty seconds by a blast that hurt the bot, whatever was chosen next
// (artifacts/handoff-live/creeper.js). 25593 (2026-10-03 21:49:31Z), come
// back bare at 16 health, ran at 0.90 and then laid the block five times in
// thirty seconds; the blast at 2.5 blocks ended it.
const RECORD = {
  from: '2026-10-02', to: '2026-10-03',
  // choice: [encounters, blasts that hurt]
  block_creeper: [251, 25], retreat: [118, 20], creeper_dance: [42, 2], fight: [29, 8], shield_the_blast: [23, 2],
};
const WORDS = { block_creeper: 'the block laid between', retreat: 'a run', creeper_dance: 'the dance in and out of its reach', fight: 'a fight', shield_the_blast: 'the shield held to the blast' };
const one = k => `${WORDS[k]} ${RECORD[k][1]} of ${RECORD[k][0]}`;
// -> ' In the record ...' for `choice`, the others beside it; '' where the
// choice has no record.
function says(choice) {
  if (!WORDS[choice]) return '';
  const rest = Object.keys(WORDS).filter(k => k !== choice).map(one).join(', ');
  return ` In the record (${RECORD.from} to ${RECORD.to}), a blast that hurt the bot within forty seconds of the first answer to a creeper: ${one(choice)} times; against ${rest}.`;
}
module.exports = { RECORD, says };
