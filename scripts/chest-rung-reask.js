'use strict';
// Note 760's before and after on the crossing kit's chest, on recorded
// win_strategy questions (the flight records from --from): asked of Jev
// again as recorded and with the chest rung said as it is now
// (crossing-kit.js chestRungSays, strategy.js RUNG_WHY and WITHOUT).
//   --mode priced (default): the questions that offered rung_nether_chest,
//     its words and nether_first's "Without nether chest" line rewritten.
//   --mode crossing: crossing_kit questions with no chest carried and the
//     wood for one; the after arm has top_up_chest as work.js offers it.
//   --mode added: the questions with the kit's rungs open, no chest carried
//     and the wood for one, where the rung was not offered (it opened only
//     while the wood was short); the after arm has it, made now.
// Counts how often the chest rung is chosen in each arm. A before and after
// of Jev's answers to the same words, not of what the bot then did.
//   node scripts/chest-rung-reask.js [--dir <flight dir>] [--from ISO] [--mode priced|added] [--alone] [--runs 3] [--limit 30]
require('../src/env').loadEnv();
const path = require('path');
const { eachFile } = require('./blaze-record');

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
const from = Date.parse(args.from || '2026-09-29T23:00:00Z');
const mode = args.mode || 'priced', runs = Number(args.runs || 3), limit = Number(args.limit || 30);
const OLD_WITHOUT = 'rods carried are lost with a death; a chest is made there only from wood carried or the Nether\'s stems';
const text = v => String(typeof v === 'string' ? v : v?.description ?? '');

function newWithout() {
  // strategy.js's WITHOUT is not exported; said as it is there.
  return 'every rod carried is lost with a death (none of 122 Nether entries since 2026-09-29 carried a chest, note 760); a chest is made there only from wood carried or the Nether\'s stems';
}
// The rung's words as they are now, from what the recorded words said.
function priced(old) {
  const { chestRungSays } = require('../src/crossing-kit');
  const m = old.match(/(\d+) planks' worth of wood carried( and no crafting table)?/);
  const carried = m ? Number(m[1]) : 0, wants = m && m[2] ? 12 : 8;
  const tail = old.includes(' From the pockets as they are') ? old.slice(old.indexOf(' From the pockets as they are')) : '';
  return `Get a chest to keep the blaze rods in through a death in the Nether.${chestRungSays({ carried, wants, makesNow: carried >= wants })}${tail.replace(OLD_WITHOUT, newWithout())}`;
}
function woodOf(inv) {
  const sum = re => Object.entries(inv || {}).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + v, 0);
  const planks = sum(/_planks$/) + 4 * sum(/_(log|stem|wood|hyphae)$/), table = (inv?.crafting_table || 0) > 0;
  return { planks, wants: table ? 8 : 12 };
}

function recorded() {
  const out = [];
  eachFile(dir, from, mode === 'priced' ? '"rung_nether_chest"' : mode === 'crossing' ? '"crossing_kit"' : '"win_strategy"', frames => {
    for (const f of frames) {
      const d = f.snapshot?.decision;
      if (mode === 'crossing') {
        if (f.kind !== 'decision' || d?.id !== 'crossing_kit' || !d.options || !d.state) continue;
        const inv = f.snapshot.inventory || {};
        if ((inv.chest || 0) > 0 || (inv.blaze_rod || 0) >= 7) continue;
        const w = woodOf(inv);
        if (w.planks < w.wants) continue;
        out.push({ at: f.at, d, wood: w, table: (inv.crafting_table || 0) > 0 });
        continue;
      }
      if (f.kind !== 'decision' || d?.id !== 'win_strategy' || !d.options || !d.state) continue;
      const keys = Object.keys(d.options);
      if (mode === 'priced' && !keys.includes('rung_nether_chest')) continue;
      // --alone: the chest the only rung left, beside nether_first.
      if (args.alone && keys.some(k => /^rung_/.test(k) && k !== 'rung_nether_chest')) continue;
      if (mode === 'added') {
        const inv = f.snapshot.inventory || {};
        if (keys.includes('rung_nether_chest') || !keys.some(k => /^rung_nether_(pickaxe|blocks|food)$/.test(k)) || (inv.chest || 0) > 0) continue;
        const w = woodOf(inv);
        if (w.planks < w.wants) continue;
        out.push({ at: f.at, d, wood: w });
        continue;
      }
      out.push({ at: f.at, d });
    }
  });
  // Spread over the window: every nth, up to the limit.
  out.sort((a, b) => a.at - b.at);
  const step = Math.max(1, Math.floor(out.length / limit));
  return out.filter((_, i) => i % step === 0).slice(0, limit);
}

function trees(q) {
  const before = Object.fromEntries(Object.entries(q.d.options).filter(([k]) => k !== 'none_good').map(([k, v]) => [k, { description: text(v) }]));
  const after = JSON.parse(JSON.stringify(before));
  if (mode === 'priced') after.rung_nether_chest.description = priced(before.rung_nether_chest.description);
  else if (mode === 'crossing') {
    const { chestRungSays } = require('../src/crossing-kit');
    after.top_up_chest = { description: `Make a chest from the wood carried first and carry it in (8 planks${q.table ? ' at the crafting table carried' : ', and a crafting table of 4 more'}, a few seconds, one slot).${chestRungSays({ carried: q.wood.planks, wants: q.wood.wants, makesNow: true })}` };
  } else {
    const { chestRungSays } = require('../src/crossing-kit');
    after.rung_nether_chest = { description: `Get a chest to keep the blaze rods in through a death in the Nether.${chestRungSays({ carried: q.wood.planks, wants: q.wood.wants, makesNow: true })} From the pockets as they are it takes: ${q.wood.wants > 8 ? 'craft 1 crafting table, ' : ''}craft 1 chest. Until it is done, ${newWithout()}.` };
  }
  if (after.nether_first) after.nether_first.description = after.nether_first.description.replace(`Without nether chest for now: ${OLD_WITHOUT}.`, `Without nether chest for now: ${newWithout()}.`);
  return { before, after };
}

if (require.main === module) (async () => {
  const { TypeSafe } = require('../src/typesafe');
  const { decide } = require('../src/decisions');
  const client = new TypeSafe();
  const qs = recorded();
  const tally = { before: {}, after: {} }, ps = {};
  for (const q of qs) {
    const t = trees(q);
    const line = {};
    for (const arm of ['before', 'after']) {
      if (mode === 'added' && arm === 'before') { const k = q.d.path?.at(-1); line.before = `recorded ${k}`; }
      for (let i = 0; i < runs; i++) {
        if (mode === 'added' && arm === 'before') break;
        let k;
        try {
          const r = await decide(q.d.id, { client, bot: null, goal: {}, tree: JSON.parse(JSON.stringify(t[arm])), state: q.d.state }); k = r.noneGood ? 'none_good' : r.path[0];
          const p = r.judgments?.[0]?.probabilities?.[mode === 'crossing' ? 'top_up_chest' : 'rung_nether_chest'];
          if (typeof p === 'number') (ps[arm] ||= []).push(p);
        } catch (err) { k = 'error'; }
        tally[arm][k] = (tally[arm][k] || 0) + 1;
        (line[arm] ||= []).push(k);
      }
    }
    console.log(`${new Date(q.at).toISOString().slice(5, 19)} recorded ${q.d.path?.at(-1)}: before ${JSON.stringify(line.before)} after ${JSON.stringify(line.after)}`);
  }
  console.log(JSON.stringify({ mode, questions: qs.length, runs, tally, chestChosen: { before: tally.before.rung_nether_chest || tally.before.top_up_chest || 0, after: tally.after.rung_nether_chest || tally.after.top_up_chest || 0 },
    chestProbability: Object.fromEntries(Object.entries(ps).map(([arm, a]) => { const b = [...a].sort((x, y) => x - y); return [arm, { median: Math.round(b[b.length >> 1] * 100) / 100, mean: Math.round(b.reduce((n, v) => n + v, 0) / b.length * 100) / 100, max: Math.round(b.at(-1) * 100) / 100 }]; })) }, null, 1));
})();
module.exports = { priced, trees };
