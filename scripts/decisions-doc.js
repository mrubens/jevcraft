'use strict';
// Writes docs/decisions.md from the registry in src/decisions: every
// question Jev is asked, with its stakes, bar and what an outage does. The page is
// generated so it cannot drift from the code; a test fails when it is stale.
//
//   node scripts/decisions-doc.js           # write it
//   node scripts/decisions-doc.js --check   # exit 1 if it is out of date
const fs = require('fs');
const path = require('path');
const { all } = require('../src/decisions');

function render() {
  const questions = all().filter(q => q.area !== 'test');
  const areas = {};
  for (const q of questions) (areas[q.area] ||= []).push(q);
  const cell = text => String(text).replaceAll('|', '\\|').replace(/\s+/g, ' ');
  const batches = {};
  for (const q of questions) if (q.batch) (batches[q.batch] ||= []).push(q.id);
  const lines = ['# Every question Jev is asked', '',
    'Generated from `src/decisions` by `node scripts/decisions-doc.js`. Do not edit by hand: change the definition and regenerate.', '',
    'Each question is defined once: what it asks and when, what a wrong answer costs (stakes), the bar its answer must clear and what happens below it, what happens when Jev cannot be reached, and where its options are built. No question has a fallback: when Jev cannot be reached nothing is decided by code (the user, 2026-09-30); the bot holds where it is, says once in chat that it is waiting for Jev, asks again with a backoff, and asks the question fresh when Jev answers (src/jev-down.js, note 707). The one exception is the body\'s own physics: `body_way` and `shot_answer` carry a safety rule that answers at once, and the reflexes that are rules (lava, fire, a hot floor, a head in a block, the breath, a shot in the air, the one-shot line) run through an outage as they always do. The decision trees also declare every option they can offer, and the runner checks each tree against that catalogue: an undeclared option fails the tests and is logged as a bug in play. Every tree is asked through one runner (`decide`) and every batched question through `ask`; nothing else in `src` calls the model.', '',
    'One rule holds for every question about playing the game (`src/decisions/unchanged.js`, note 724): each answer is kept with the block the bot stood in, what it carried, the blocks dug or placed, its health band and the question\'s own facts (since note 749: the options offered, by their keys, and the kinds of mob that threaten; counts, distances and readings drift and are not compared). Asked again with none of the first four changed, the answer changed nothing, and the asking says so, in the facts (`answerChangedNothing`) and on the option. With the facts the same too, the question is not asked yet: the bot holds, its reflexes watching, until one of them changes (the question is then built afresh) or a stated wait passes: ten seconds after the answer, thirty after two such answers in a row, a minute after three. The body\'s own questions (`body_way`, `shot_answer`), the stance and the routing (`encounter_stance`, `ranged_response`, `turn_priority`, `stillness_detour`) are said, never held. An option whose builder marks it `satisfied` (its goal already so) is not offered, and that is said (`alreadySo`).', '',
    'Three more rules from note 749 (`src/decisions/loops.js`, `src/decisions/keys.js`, `src/intention.js`). A key names its thing: every dynamic option says what its key names (`names`: by name, by where it is, by entity id), never its place in the list, so what came of an option is said on the same thing at the next asking. A question asked round and round goes up: its askings each within a minute of the one before are its spell, said from the third (`spellSoFar`: how many, what was answered, how far the bot walked and how far it is from where they began, whether anything new is carried, how often none of the options was good); when none good was Jev\'s likeliest at three of its last five askings, or six askings over ninety seconds or more have left the bot within 48 blocks of where they began with nothing new carried, the answers it gave rest from there and the question above is asked with that said (not the stance, the body\'s way, the shield or the routing, which are said only). And a trip holds: an answer to a question about the plan whose option walks to a target, or whose catalogue entry says where it goes (`trip`), is the intention until it arrives, is done, fails, the dimension changes, health falls a blow\'s worth, a walk brings nothing for three minutes or ten minutes pass; its own question asked again offers only it. A rung set aside holds the same way (`src/decisions/asides.js`): an option that would take it back (`takeBack` on its node) is not offered for five minutes unless the bot is 16 blocks from where it was set aside, carries a new kind of thing or its health band changes (`asideHolds`). An answer thrown away as stale that keeps on with what is under way is kept, and from the second stale answer in a row within 30 seconds a question is watched a second first and not sent while its facts are still changing.', '',
    `${questions.length} questions: ${questions.filter(q => q.tree).length} decision trees and ${questions.filter(q => !q.tree).length} batched questions.`, '',
    '## Batches', '', 'Questions that ride in one call together (the intake batch is one call per chat message):', ''];
  for (const [batch, ids] of Object.entries(batches)) lines.push(`- **${batch}** (${ids.length}): ${ids.map(id => `\`${id}\``).join(', ')}`);
  lines.push('');
  for (const [area, list] of Object.entries(areas)) {
    lines.push(`## ${area}`, '');
    for (const q of list) {
      const bar = q.gate ? `${q.gate.threshold}${q.tree ? ' at every level of the tree' : ''}: ${q.gate.why}` : q.ungated ? `none: ${q.ungated}` : 'none';
      const unreachable = q.tree ? (q.safetyRule ? `the body's safety rule answers at once: ${q.safetyWhy}` : 'no fallback: nothing is decided by code; the bot holds, says once that it is waiting for Jev, asks again with a backoff, and asks it fresh when Jev answers') : q.unreachable;
      lines.push(`### \`${q.id}\``, '', `**${cell(q.question)}**`, '',
        `- When: ${cell(q.trigger)}`,
        `- ${q.tree ? 'Decision tree' : 'Batched question'}, ${q.primitive}; stakes ${q.stakes}; ledger kind \`${q.kind}\`${q.batch ? `; batch **${q.batch}**` : ''}`,
        `- Bar: ${cell(bar)}`,
        `- Jev unreachable: ${cell(unreachable)}`,
        `- Options built in: ${cell(q.source)}`,
        ...(q.overworldOnly ? ['- Asked only on the Overworld (its words speak of the day, the night, beds or the surface; asked elsewhere, the tests fail: note 677)'] : []),
        ...(Object.hasOwn(q, 'parent') ? [`- Nothing left to try: ${q.parent ? `asks \`${q.parent}\` next up, with this one's failure said` : 'the stall\'s question, as before (nothing above it)'}`] : []), '');
      if (q.tree) {
        lines.push('| Option | Level | What it is | Offered when |', '| --- | --- | --- | --- |');
        for (const o of q.options) lines.push(`| \`${cell(o.key || o.pattern)}\`${o.pattern ? ` (pattern${o.names ? `: names ${cell(o.names)}` : ''})` : ''}${o.trip ? ` (trip: ${cell(o.trip)})` : ''} | ${o.level || 'root'} | ${cell(o.label)} | ${cell(o.when)} |`);
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}

const file = path.join(__dirname, '..', 'docs', 'decisions.md');
if (process.argv.includes('--check')) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current !== render()) { console.error('docs/decisions.md is out of date: run node scripts/decisions-doc.js'); process.exit(1); }
} else if (require.main === module) { fs.writeFileSync(file, render()); console.log(`wrote ${file}`); }

module.exports = { render };
