#!/usr/bin/env node
'use strict';
// Pocket pressure (note 780): how full the pockets ran in the flight records,
// what filled them, what the room question was asked and answered, what
// failed for want of a slot, how often the tidy dropped anything against the
// time the pockets were full, and the same pockets with the tidy's rule
// (src/inventory-tidy.js tidyPlan) applied to each recorded frame.
//
//   node scripts/pocket-pressure.js [--since 2026-09-30T12:00:00Z] [--to ISO]
//        [--dir .bot-state/flight] [--logs artifacts] [--cache file.jsonl] [--json]
//
// Slots are counted from the frame's pockets (name -> count) as whole stacks
// of each kind: two part stacks of one kind count as one, so the slots used
// here are a floor on the slots the server saw. Time is weighted: a frame's
// pockets stand until the next frame of the record, a minute at most.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const arg = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const SINCE = Date.parse(arg('--since', '2026-09-30T12:00:00Z'));
const TO = Date.parse(arg('--to', '2100-01-01T00:00:00Z'));
const ROOT = path.join(__dirname, '..');
const DIR = arg('--dir', path.join(process.cwd(), '.bot-state', 'flight'));
const LOGS = arg('--logs', path.join(process.cwd(), 'artifacts'));
const CACHE = arg('--cache', null);
const JSON_OUT = args.includes('--json');
const POCKETS = 36, FULL = 34, HOLD_MS = 60000;

const registry = require('minecraft-data')('26.1');
const stackOf = name => registry.itemsByName[name]?.stackSize || 64;
const slotsOf = inv => Object.entries(inv || {}).reduce((n, [name, c]) => n + Math.ceil(c / stackOf(name)), 0);
const tidy = require(path.join(ROOT, 'src', 'inventory-tidy.js'));
// The tidy's caps before note 780, kind by kind, for the baseline.
const OLD_SURPLUS = Object.freeze({ cobblestone: 128, cobbled_deepslate: 64, dirt: 32, gravel: 16, sand: 0, red_sand: 0, diorite: 0, andesite: 0, granite: 0, tuff: 0, calcite: 0,
  netherrack: 128, soul_sand: 0, soul_soil: 0, leaf_litter: 32, short_grass: 0, seagrass: 0, kelp: 0, wheat_seeds: 32, raw_copper: 16, copper_ingot: 16, furnace: 2, crafting_table: 2,
  snowball: 0, ice: 0, clay_ball: 0, flint: 8 });

// What fills the pockets, by kind.
const FOOD = new Set(Object.keys(registry.foodsByName || {}));
function kindOf(name) {
  if (tidy.BUDGET_BLOCKS.test(name)) return 'building blocks (the crossing\'s kinds)';
  if (/^(tuff|diorite|andesite|granite|calcite|gravel|sand|red_sand|smooth_basalt|basalt|soul_sand|soul_soil|mud|clay|.*terracotta|end_stone|nether_bricks|polished_.*|.*_stone_bricks|stone_bricks|mossy_cobblestone|cobblestone_.*|sandstone|red_sandstone|ice|packed_ice|snow_block|magma_block|glowstone|obsidian|crying_obsidian|nether_wart_block|warped_wart_block|shroomlight|moss_block|dripstone_block)$/.test(name)) return 'other blocks';
  if (/(_ore|^raw_\w+|_ingot|_nugget|^coal|^charcoal|^diamond|^emerald|^lapis_lazuli|^redstone|^quartz|^amethyst_shard|^netherite_scrap)$/.test(name)) return 'ores, ingots and gems';
  if (/^(rotten_flesh|bone|bone_meal|string|gunpowder|spider_eye|feather|leather|slime_ball|ink_sac|glow_ink_sac|phantom_membrane|rabbit_hide|rabbit_foot|egg|blue_egg|brown_egg|arrow|ender_pearl|blaze_rod|blaze_powder|ghast_tear|magma_cream|.*_wool|white_wool)$/.test(name)) return 'mob drops';
  if (FOOD.has(name)) return 'food';
  if (/_(log|wood|stem|hyphae|planks)$|^stick$/.test(name)) return 'wood';
  if (/_(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots)$|^(bow|crossbow|shield|flint_and_steel|fishing_rod|shears|bucket|water_bucket|lava_bucket|torch|crafting_table|furnace|cauldron|chest|compass|clock)$/.test(name)) return 'gear and stations';
  if (tidy.NO_USE.test(name) || /_(sapling|seeds)$|^(short_grass|tall_grass|kelp|seagrass|vine|glow_lichen|hanging_roots|.*_roots|.*_fungus|weeping_vines|twisting_vines|.*_leaves)$/.test(name)) return 'plants and no-use finds';
  return 'other';
}

const NOROOM = [
  ['craft', /(after crafting.*\b0 free slots|No free slot for the \d+ |made nothing twice.*0 free slots)/],
  ['furnace take', /(would not come out of the furnace: no free slot|no room to take it|after smelting.*\b0 free slots)/],
  ['pick-up', /(pockets are full\. I need to make some room|no room in my pockets)/],
];

function rowOf(o, port, file, invPool) {
  const t = Date.parse(o.at);
  if (!Number.isFinite(t)) return null;
  const s = o.snapshot || {};
  const msg = String(o.detail?.message || (o.kind === 'error' ? o.label : '') || '');
  const row = { t, port, file };
  if (s.inventory) {
    const key = JSON.stringify(s.inventory);
    if (!invPool.has(key)) invPool.set(key, invPool.size);
    row.i = invPool.get(key);
    row.dim = /nether/.test(String(s.dimension || '')) ? 'nether' : /end/.test(String(s.dimension || '')) ? 'end' : 'overworld';
  }
  const step = s.goal?.step;
  if (step) row.step = { action: step.action, item: step.item, block: step.block, drops: step.drops, from: step.from, consumes: step.consumes && Object.keys(step.consumes), requires: step.requires && Object.keys(step.requires) };
  if (s.goal?.kind) row.goal = s.goal.kind;
  if (s.decision?.at) row.dat = s.decision.at;
  if (s.goal?.blocksShort) row.short = true;
  if (o.kind === 'chat' && o.detail?.from === 'Jev' && /^My pockets are full, so I'm leaving/.test(msg)) row.tidied = msg;
  for (const [k, re] of NOROOM) if (re.test(msg)) row.noroom = k;
  if (row.i === undefined && !row.tidied && !row.noroom && !row.dat) return null;
  return row;
}

async function extract() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).map(f => {
    const m = /-(\d{5})-Jev-(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3})Z/.exec(f);
    return m ? { f, port: m[1], start: Date.parse(`${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) } : null;
  }).filter(Boolean).filter(x => x.start <= TO && fs.statSync(path.join(DIR, x.f)).mtimeMs >= SINCE).sort((a, b) => a.start - b.start);
  const invPool = new Map(), rows = [];
  for (const { f, port } of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(DIR, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      const t = Date.parse(o.at);
      if (!(t >= SINCE && t <= TO)) continue;
      const r = rowOf(o, port, f, invPool);
      if (r) rows.push(r);
    }
  }
  return { invs: [...invPool.keys()].map(k => JSON.parse(k)), rows };
}

// The room question's answers, from the trials' logs ("[room] for X: Jev
// chose drop_Y (N Y)" or "none"), timed by the last timestamp the log said.
function roomAnswers() {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(LOGS).filter(f => f.endsWith('.log')).map(f => path.join(LOGS, f)).filter(f => fs.statSync(f).mtimeMs >= SINCE); } catch (_) { files = []; }
  for (const f of files) {
    let last = null, lastDecision = null;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const ts = line.match(/"at":"(20\d\d-\d\d-\d\dT[\d:.]+Z)"/);
      if (ts) last = Date.parse(ts[1]);
      const dm = line.match(/"decision":\{"at":"(20[^"]+Z)"/);
      if (dm) lastDecision = dm[1];
      const m = /^\[room\] for (\w+): Jev chose (\w+)(?: \((\d+) (\w+)\))?/.exec(line);
      if (!m || !(last >= SINCE && last <= TO)) continue;
      out.push({ t: last, dat: lastDecision, log: path.basename(f), forItem: m[1], pick: m[2], count: m[3] ? +m[3] : 0, item: m[4] || null });
    }
  }
  return out;
}

function analyse({ invs, rows }) {
  const byRecord = {};
  for (const r of rows) (byRecord[r.file] ||= []).push(r);
  const out = { records: 0, botHours: 0, minutes: 0, fullMinutes: 0, fullMinutesSim: 0, fullMinutesOld: 0, crowdedMinutes: 0, crowdedNothingOverCap: 0, crowdedNothingSim: 0,
    perTrial: [], fillAtFull: {}, itemsAtFull: {}, noRoom: {}, tidyChats: 0, tidyDropped: {}, simDropped: {}, simDroppedNames: {}, simDroppedSlots: 0, slotsHist: {}, slotsHistSim: {} };
  for (const [file, list] of Object.entries(byRecord)) {
    list.sort((a, b) => a.t - b.t);
    const frames = list.filter(r => r.i !== undefined);
    let mins = 0, full = 0, fullSim = 0, fullOld = 0;
    let step = null, short = false, goalKind = null;
    for (const r of list) {
      if (r.noroom) out.noRoom[r.noroom] = (out.noRoom[r.noroom] || 0) + 1;
      if (r.tidied) {
        out.tidyChats++;
        for (const m of r.tidied.matchAll(/(\d+) ([a-z ]+?)(?=,| here)/g)) out.tidyDropped[m[2]] = (out.tidyDropped[m[2]] || 0) + +m[1];
      }
    }
    for (let k = 0; k < list.length; k++) {
      const r = list[k];
      if (r.step) step = r.step;
      if (r.goal) goalKind = r.goal;
      if (r.short !== undefined) short = !!r.short;
      if (r.i === undefined) continue;
      const next = frames.find(x => x.t > r.t);
      const dt = Math.min(HOLD_MS, next ? next.t - r.t : 10000) / 60000;
      const inv = invs[r.i];
      const used = slotsOf(inv);
      mins += dt;
      out.slotsHist[used] = (out.slotsHist[used] || 0) + dt;
      if (used >= FULL) {
        full += dt;
        for (const [name, c] of Object.entries(inv)) {
          const slots = Math.ceil(c / stackOf(name)), kind = kindOf(name);
          out.fillAtFull[kind] = (out.fillAtFull[kind] || 0) + slots * dt;
          out.itemsAtFull[name] = (out.itemsAtFull[name] || 0) + slots * dt;
        }
      }
      // The tidy as it was: crowded (under four free) with nothing over a
      // cap to drop.
      const crowded = POCKETS - used < tidy.FREE_SLOTS;
      const keep = new Set([step?.item, step?.block, step?.drops, step?.from, ...(step?.consumes || []), ...(step?.requires || [])].filter(Boolean));
      if (short) for (const n of ['netherrack', 'blackstone', 'basalt', 'cobblestone', 'cobbled_deepslate']) keep.add(n);
      const ruleKeep = new Set(keep);
      if (!Object.keys(inv).some(n => FOOD.has(n) && n !== 'rotten_flesh')) ruleKeep.add('rotten_flesh');
      if (crowded) {
        out.crowdedMinutes += dt;
        const over = Object.entries(inv).some(([n, c]) => n in OLD_SURPLUS && !keep.has(n) && c > OLD_SURPLUS[n]);
        if (!over) out.crowdedNothingOverCap += dt;
      }
      // The tidy as it was (each kind's own cap, the biggest surplus first,
      // until four are free), applied to the frame the same way: what the
      // rule changes, apart from when the tidy gets its turn.
      {
        const before = { ...inv };
        let freeOld = POCKETS - used;
        if (freeOld < tidy.FREE_SLOTS) {
          for (const [n, c] of Object.entries(inv).filter(([n, c]) => n in OLD_SURPLUS && !keep.has(n) && c > OLD_SURPLUS[n]).sort((a, b) => b[1] - a[1])) {
            before[n] = OLD_SURPLUS[n]; if (!before[n]) delete before[n];
            freeOld = POCKETS - slotsOf(before);
            if (freeOld >= tidy.FREE_SLOTS) break;
          }
        }
        if (POCKETS - freeOld >= FULL) fullOld += dt;
      }
      // The tidy's rule applied to the frame's pockets.
      const plan = tidy.tidyPlan(inv, { free: POCKETS - used, dimension: r.dim, keep: ruleKeep, blocksShort: short, kitWants: goalKind === 'win' && r.dim === 'overworld' ? 128 : 0, stackOf });
      const after = { ...inv };
      for (const d of plan) { after[d.name] -= d.count; if (after[d.name] <= 0) delete after[d.name]; }
      const usedSim = slotsOf(after);
      out.slotsHistSim[usedSim] = (out.slotsHistSim[usedSim] || 0) + dt;
      if (usedSim >= FULL) fullSim += dt;
      if (crowded && !plan.length) out.crowdedNothingSim += dt;
      if (plan.length) { out.simDroppedSlots += (used - usedSim) * dt; for (const d of plan) { out.simDropped[d.why] = (out.simDropped[d.why] || 0) + dt; out.simDroppedNames[d.name] = (out.simDroppedNames[d.name] || 0) + dt; } }
    }
    if (!frames.length) continue;
    out.records++;
    out.minutes += mins; out.fullMinutes += full; out.fullMinutesSim += fullSim; out.fullMinutesOld += fullOld;
    const m = /-(\d{5})-Jev-(.*)\.jsonl$/.exec(file);
    out.perTrial.push({ port: m?.[1], start: m?.[2], minutes: Math.round(mins), fullShare: mins ? +(full / mins).toFixed(3) : 0, fullShareSim: mins ? +(fullSim / mins).toFixed(3) : 0, fullShareOld: mins ? +(fullOld / mins).toFixed(3) : 0 });
  }
  out.botHours = out.minutes / 60;
  // The room question's asks and answers.
  const answers = roomAnswers();
  out.room = { asks: answers.length, perBotHour: out.botHours ? +(answers.length / out.botHours).toFixed(2) : 0, none: answers.filter(a => a.pick === 'none').length, dropped: {}, droppedKinds: {}, forItem: {} };
  // Each answer's pockets: the record whose decision the log last showed,
  // its last frame with pockets at or before the answer. Would the tidy's
  // rule have made the room with no question?
  const fileOfDecision = new Map();
  for (const r of rows) if (r.dat) fileOfDecision.set(r.dat, r.file);
  const framesOf = {};
  for (const r of rows) if (r.i !== undefined) (framesOf[r.file] ||= []).push(r);
  for (const list of Object.values(framesOf)) list.sort((a, b) => a.t - b.t);
  out.room.matched = 0; out.room.ruleMakesRoom = 0; out.room.ruleDrops = {}; out.room.notMet = {};
  for (const a of answers) {
    const file = a.dat && fileOfDecision.get(a.dat);
    const list = file && framesOf[file];
    if (!list) continue;
    let frame = null;
    for (const r of list) { if (r.t <= a.t + 1000) frame = r; else break; }
    if (!frame || a.t - frame.t > 60000) continue;
    out.room.matched++;
    const inv = invs[frame.i];
    const plan = tidy.tidyPlan(inv, { free: 0, dimension: frame.dim, keep: new Set([a.forItem]), stackOf, headroom: 1 });
    if (plan.length) { out.room.ruleMakesRoom++; for (const d of plan) out.room.ruleDrops[d.name] = (out.room.ruleDrops[d.name] || 0) + 1; }
    else if (a.item) out.room.notMet[a.item] = (out.room.notMet[a.item] || 0) + 1;
  }
  for (const a of answers) {
    out.room.forItem[a.forItem] = (out.room.forItem[a.forItem] || 0) + 1;
    if (a.item) { out.room.dropped[a.item] = (out.room.dropped[a.item] || 0) + 1; const k = kindOf(a.item); out.room.droppedKinds[k] = (out.room.droppedKinds[k] || 0) + 1; }
  }
  return out;
}

const top = (m, n = 12) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
const r1 = x => Math.round(x * 10) / 10;

(async () => {
  let data;
  if (CACHE && fs.existsSync(CACHE)) data = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  else { data = await extract(); if (CACHE) fs.writeFileSync(CACHE, JSON.stringify(data)); }
  const out = analyse(data);
  if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); return; }
  const pct = (a, b) => `${(100 * a / Math.max(1e-9, b)).toFixed(1)}%`;
  console.log(`${out.records} records since ${new Date(SINCE).toISOString()}, ${r1(out.botHours)} bot-hours`);
  console.log(`minutes at ${FULL}+ of ${POCKETS} slots: ${Math.round(out.fullMinutes)} of ${Math.round(out.minutes)} (${pct(out.fullMinutes, out.minutes)}) as recorded; the old tidy applied to every frame ${Math.round(out.fullMinutesOld)} (${pct(out.fullMinutesOld, out.minutes)}); the tidy's rule (tidyPlan) applied to every frame ${Math.round(out.fullMinutesSim)} (${pct(out.fullMinutesSim, out.minutes)})`);
  const trials = out.perTrial.filter(t => t.minutes >= 10);
  const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  console.log(`per record (10+ minutes, ${trials.length}): median share at ${FULL}+ ${median(trials.map(t => t.fullShare))} recorded, ${median(trials.map(t => t.fullShareOld))} old tidy, ${median(trials.map(t => t.fullShareSim))} rule; records full half the time or more ${trials.filter(t => t.fullShare >= 0.5).length}, ${trials.filter(t => t.fullShareOld >= 0.5).length}, ${trials.filter(t => t.fullShareSim >= 0.5).length}`);
  console.log(`crowded (under ${tidy.FREE_SLOTS} free) ${Math.round(out.crowdedMinutes)} min; of them nothing over a cap for the tidy as it was ${Math.round(out.crowdedNothingOverCap)} (${pct(out.crowdedNothingOverCap, out.crowdedMinutes)}); with the rule ${Math.round(out.crowdedNothingSim)}`);
  console.log(`tidy chat lines ("leaving ... here", said at most once in ten minutes): ${out.tidyChats}; dropped ${top(out.tidyDropped, 8).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log('\nslots at full, by kind (slot-minutes):');
  const fillTotal = Object.values(out.fillAtFull).reduce((a, b) => a + b, 0);
  for (const [k, v] of top(out.fillAtFull)) console.log(`  ${pct(v, fillTotal).padStart(6)}  ${k}`);
  console.log('items at full (average slots held while full):');
  for (const [k, v] of top(out.itemsAtFull, 30)) console.log(`  ${(v / Math.max(1, out.fullMinutes)).toFixed(2).padStart(5)}  ${k}`);
  console.log(`\nroom questions answered: ${out.room.asks} (${out.room.perBotHour} a bot-hour), none ${out.room.none}`);
  console.log(`  for: ${top(out.room.forItem, 10).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  dropped: ${top(out.room.dropped, 14).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  dropped by kind: ${top(out.room.droppedKinds).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  matched to a record's pockets ${out.room.matched}; the tidy's rule frees a slot with no question in ${out.room.ruleMakesRoom} (dropping ${top(out.room.ruleDrops, 10).map(([k, v]) => `${k} ${v}`).join(', ')}); still asked, Jev dropped ${top(out.room.notMet, 10).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`failed for no room (frames): ${top(out.noRoom).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`the rule's drops by reason (minutes it acted): ${top(out.simDropped).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ')}`);
  console.log(`  by kind: ${top(out.simDroppedNames, 16).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ')}`);
})();
