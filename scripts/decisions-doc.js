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
        for (const o of q.options) lines.push(`| \`${cell(o.key || o.pattern)}\`${o.pattern ? ' (pattern)' : ''} | ${o.level || 'root'} | ${cell(o.label)} | ${cell(o.when)} |`);
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
