'use strict';
// Writes docs/decisions.md from the registry in src/decisions: every
// question Jev is asked, with its stakes, bar and fallback. The page is
// generated so it cannot drift from the code; a test fails when it is stale.
//
//   node scripts/decisions-doc.js           # write it
//   node scripts/decisions-doc.js --check   # exit 1 if it is out of date
const fs = require('fs');
const path = require('path');
const { all } = require('../src/decisions');

function render() {
  const areas = {};
  const questions = all().filter(q => q.area !== 'test');
  for (const q of questions) (areas[q.area] ||= []).push(q);
  const cell = text => String(text).replaceAll('|', '\\|').replace(/\s+/g, ' ');
  const lines = ['# Every question Jev is asked', '',
    'Generated from `src/decisions` by `node scripts/decisions-doc.js`. Do not edit by hand: change the definition and regenerate.', '',
    'Each question is defined once, with its stakes (what a wrong answer costs), its bar (a confidence below it is not acted on as asked, and what happens instead), and, for the in-game trees, the code\'s own answer when Jev cannot be reached. Every tree decision is asked through one runner (`decide`), and every batched question through `ask`; nothing else in `src` calls the model.', '',
    `${questions.length} questions.`, ''];
  for (const [area, questions] of Object.entries(areas)) {
    lines.push(`## ${area}`, '', '| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |', '| --- | --- | --- | --- | --- | --- |');
    for (const q of questions) {
      const bar = q.gate ? `${q.gate.threshold}: ${q.gate.why}` : q.ungated ? `none: ${q.ungated}` : 'none';
      const fallback = q.tree ? (q.fallback === 'throws' ? 'stops: no safe default' : 'code default') : 'the caller\'s own handling';
      lines.push(`| \`${q.id}\` | ${q.primitive} | ${q.stakes} | ${q.kind} | ${cell(bar)} | ${fallback} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const file = path.join(__dirname, '..', 'docs', 'decisions.md');
if (process.argv.includes('--check')) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current !== render()) { console.error('docs/decisions.md is out of date: run node scripts/decisions-doc.js'); process.exit(1); }
} else if (require.main === module) { fs.writeFileSync(file, render()); console.log(`wrote ${file}`); }

module.exports = { render };
