#!/usr/bin/env node
'use strict';
// What each Nether stay carried in, and what came of it (note 791). Every
// entry into the Nether in the trials' flight records (a frame in the Nether
// after one elsewhere, or a trial begun there from a save), with the kit at
// the entry: the shield in the off hand, spare shields, the armour worn by
// piece and material, gold worn or carried, food points, building blocks by
// kind (and the ghast-proof ones), iron and gold ingots, the sword and axe,
// buckets; and the stay's outcome: deaths by what killed (the last hurts),
// rods got, minutes alive there, shields broken (the off hand's shield gone
// with none carried, alive). Then the questions about the kit asked in the
// twenty minutes before a crossing (crossing_kit, combat_kit, kit_food, and
// any other whose id names a kit), what each offered and what was answered.
// Then each kit feature: the stays with and without it, their Nether hours,
// deaths an hour by cause, rods a stay. Read-only.
//
//   node scripts/nether-kit.js [--since ISO] [--to ISO] [--list] [--asks] [--json out.json]
// The default window is 2026-09-30T06:00Z to 2026-10-01T04:57:47Z, when
// TypeSafe's credits ran out and every question came back 402 (note 781):
// Jev-down time is left out by ending there. JEV_ROOT reads another
// checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const MINUTE = 60000, GAP_MS = 5 * MINUTE, BEFORE_MS = 20 * MINUTE;
const round = (n, k = 1) => n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** k) / 10 ** k;
const median = a => { const b = a.filter(v => v != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const frameAt = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };
const midgameStart = at => { const m = at.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const dimOf = d => /nether/.test(String(d || '')) ? 'nether' : /end/.test(String(d || '')) ? 'end' : d ? 'overworld' : null;

// Food points of what is safe to eat (the registry's, for the kinds carried).
const FOOD = { cooked_beef: 8, cooked_porkchop: 8, cooked_mutton: 6, cooked_chicken: 6, cooked_salmon: 6, cooked_cod: 5, cooked_rabbit: 5, baked_potato: 5, bread: 5, golden_carrot: 6, golden_apple: 4, enchanted_golden_apple: 4, apple: 4, carrot: 3, pumpkin_pie: 8, mushroom_stew: 6, rabbit_stew: 10, beetroot_soup: 6, beef: 3, porkchop: 3, mutton: 2, rabbit: 3, cod: 2, salmon: 2, sweet_berries: 2, glow_berries: 2, melon_slice: 2, dried_kelp: 1, beetroot: 1, potato: 1, cookie: 2 };
const foodPoints = inv => Object.entries(inv || {}).reduce((n, [k, v]) => n + (FOOD[k] || 0) * v, 0);
// Building blocks, and which of them a ghast's fireball does not break
// (blast resistance 6: cobblestone and its kin, against netherrack's 0.4 and
// dirt's 0.5).
const BLOCKS = /^(cobblestone|cobbled_deepslate|netherrack|blackstone|stone|deepslate|dirt|andesite|diorite|granite|tuff|basalt|smooth_basalt|nether_bricks|end_stone|sandstone|polished_blackstone|cobblestone_slab)$/;
const GHAST_PROOF = /^(cobblestone|cobbled_deepslate|blackstone|stone|deepslate|andesite|diorite|granite|tuff|nether_bricks|end_stone|polished_blackstone|basalt|smooth_basalt)$/;
const sumOf = (inv, re) => Object.entries(inv || {}).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + v, 0);
const rodsOf = inv => (inv?.blaze_rod || 0) + Math.floor((inv?.blaze_powder || 0) / 2);
const TIERS = ['wooden', 'stone', 'golden', 'iron', 'diamond', 'netherite'];
const bestOf = (inv, kind) => Object.keys(inv || {}).filter(k => k.endsWith(`_${kind}`)).sort((a, b) => TIERS.indexOf(b.split('_')[0]) - TIERS.indexOf(a.split('_')[0]))[0] || null;
const KIT_Q = /^(crossing_kit|combat_kit|kit_food)$|kit/;

function killerOf(hurts) {
  const by = h => {
    const c = `${h.type} ${h.cause} ${h.direct}`;
    if (/lava/.test(c)) return 'lava';
    if (/fall/.test(c)) return 'fall';
    if (/blaze|small_fireball/.test(c)) return 'blaze';
    if (/wither_skeleton|wither\b/.test(c)) return 'wither skeleton';
    if (/ghast|fireball/.test(c)) return 'ghast';
    const m = c.match(/(zombified_piglin|piglin_brute|piglin|hoglin|magma_cube|skeleton|zombie|enderman)/);
    if (m) return m[1];
    if (/on_fire|in_fire/.test(c)) return 'fire';
    return h.type || '?';
  };
  const ks = hurts.slice(-3).map(by);
  // Fire after a blaze's hit is the blaze's.
  if (ks.at(-1) === 'fire' && ks.includes('blaze')) return 'blaze';
  return ks.at(-1) || '?';
}

function portFiles(port) {
  const identity = `127_0_0_1-${port}-Jev`;
  let names = []; try { names = fs.readdirSync(FLIGHT); } catch (_) { return []; }
  const files = names.filter(f => f.startsWith(identity + '-') && f.endsWith('.jsonl')).map(f => ({ f: path.join(FLIGHT, f), start: midgameStart(f.slice(identity.length + 1)) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  files.forEach((x, i) => { x.next = files[i + 1]?.start ?? Infinity; });
  return files;
}

// What a stay reads of a frame.
function slim(x, t) {
  const s = x.snapshot || {}, o = { t, kind: x.kind, dim: dimOf(s.dimension), hp: typeof s.health === 'number' ? s.health : null };
  if (s.inventory) o.inv = s.inventory;
  if (s.equipment) o.eq = s.equipment;
  // The off hand's uses left, recorded from note 791 on.
  if (typeof s.offhandUses === 'number') o.offUses = s.offhandUses;
  if (x.kind === 'damage') o.hurt = { type: x.detail?.type || null, cause: x.detail?.cause || null, direct: x.detail?.direct || null };
  const d = s.decision;
  if (x.kind === 'decision' && d && !d.stale && KIT_Q.test(d.id || '')) {
    o.ask = { id: d.id, chosen: (Array.isArray(d.path) ? d.path : [d.path]).filter(k => k && k !== 'list').at(-1) || d.judgments?.[0]?.choice || '?', keys: Object.keys(d.options || {}),
      words: Object.fromEntries(Object.entries(d.options || {}).map(([k, v]) => [k, String(typeof v === 'string' ? v : v?.description ?? '').slice(0, 600)])), held: !!d.held };
  }
  return o;
}

function readPort(port, from, to) {
  const out = [];
  for (const { f, start, next } of portFiles(port)) {
    if (next < from - BEFORE_MS || start > to) continue;
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const t = frameAt(line);
      if (!(t >= from - BEFORE_MS && t <= to)) continue;
      let x; try { x = JSON.parse(line); } catch (_) { continue; }
      out.push(slim(x, t));
    }
    text = null;
  }
  return out.sort((a, b) => a.t - b.t);
}

// A shield from the pockets as they are, smelting included: an iron ingot,
// or a raw iron with a furnace (or eight cobblestone for one) and fuel; six
// planks and a table, or ten planks' worth.
const FUEL = /^(coal|charcoal|coal_block|(?!crimson_|warped_).*_log|(?!crimson_|warped_).*_planks)$/;
function shieldFromPockets(inv) {
  inv = inv || {};
  const planks = sumOf(inv, /_planks$/) + 4 * sumOf(inv, /_(log|stem|wood|hyphae)$/);
  const furnace = (inv.furnace || 0) > 0 || sumOf(inv, /^(cobblestone|cobbled_deepslate|blackstone)$/) >= 8;
  const iron = (inv.iron_ingot || 0) >= 1 || ((inv.raw_iron || 0) >= 1 && furnace && sumOf(inv, FUEL) > 0);
  return iron && planks >= ((inv.crafting_table || 0) ? 6 : 10);
}

// The kit at a moment, from the last inventory and equipment before it.
function kitOf(inv, eq) {
  inv = inv || {};
  const worn = eq ? ['head', 'torso', 'legs', 'feet'].map(k => eq[k]).filter(Boolean) : [];
  const material = n => n.split('_')[0];
  const goldWorn = worn.some(n => /^golden_/.test(n)), goldCarried = sumOf(inv, /^golden_(helmet|chestplate|leggings|boots)$/);
  const blocks = Object.fromEntries(Object.entries(inv).filter(([k]) => BLOCKS.test(k)));
  const ghast = sumOf(inv, GHAST_PROOF), all = sumOf(inv, BLOCKS);
  const planks = sumOf(inv, /_planks$/) + 4 * sumOf(inv, /_(log|stem|wood|hyphae)$/);
  return {
    shield: eq ? eq.offhand === 'shield' : null, spareShields: inv.shield || 0,
    shieldMakeable: (inv.iron_ingot || 0) >= 1 && planks >= ((inv.crafting_table || 0) ? 6 : 10),
    shieldFromPockets: shieldFromPockets(inv),
    armour: eq ? worn.length : null, armourOf: worn.map(material).join('+') || 'none', iron4: worn.length === 4 && worn.every(n => /^(iron|diamond|netherite)_/.test(n)),
    goldWorn, goldCarried, gold: goldWorn || goldCarried > 0,
    food: foodPoints(inv), blocks: all, ghastProof: ghast, blockKinds: blocks, oneKind: Math.max(0, ...Object.values(blocks)),
    iron: inv.iron_ingot || 0, rawIron: inv.raw_iron || 0, goldIngots: inv.gold_ingot || 0, planks,
    sword: bestOf(inv, 'sword'), axe: bestOf(inv, 'axe'), pickaxes: Object.entries(inv).filter(([k]) => /_pickaxe$/.test(k)).reduce((n, [, v]) => n + v, 0),
    water: inv.water_bucket || 0, lava: inv.lava_bucket || 0, buckets: (inv.bucket || 0) + (inv.water_bucket || 0) + (inv.lava_bucket || 0),
    bow: !!inv.bow, arrows: inv.arrow || 0, rods: rodsOf(inv), pearls: inv.ender_pearl || 0, chest: !!inv.chest, cauldron: !!inv.cauldron,
  };
}

// The stays in one trial's frames. Pure.
function stays(frames, { start, end, world, port }) {
  const out = [];
  let lastDim = null, inv = null, eq = null, offUses = null, hp = null, cur = null, lastT = null, seenAny = false;
  const hurts = [];
  const asksBefore = t => frames.filter(f => f.ask && f.t >= t - BEFORE_MS && f.t <= t + MINUTE && f.dim !== 'nether').map(f => ({ t: f.t, ...f.ask }));
  const close = (t, how, killer = null) => {
    if (!cur) return;
    cur.end = t; cur.how = how; cur.killer = killer; cur.minutes = round((t - cur.start) / MINUTE, 2);
    cur.rodsGot = Math.max(0, cur.maxRods - cur.kit.rods);
    out.push(cur); cur = null;
  };
  for (const f of frames) {
    if (f.t > end) break;
    const inTrial = f.t >= start;
    if (f.inv) inv = f.inv;
    if (f.eq) eq = f.eq;
    if (f.offUses != null) offUses = f.offUses;
    if (f.hurt) { hurts.push({ t: f.t, ...f.hurt }); while (hurts.length && hurts[0].t < f.t - 10000) hurts.shift(); }
    if (cur && lastT !== null && f.t - lastT > GAP_MS) close(lastT, 'gap');
    if (f.hp !== null) {
      if (f.hp === 0 && hp > 0 && cur) close(f.t, 'death', killerOf(hurts.filter(h => h.t >= f.t - 10000)));
      hp = f.hp;
    }
    if (inTrial && f.dim) {
      if (f.dim === 'nether' && lastDim !== 'nether' && hp !== 0 && !cur) {
        const begun = !seenAny;
        cur = { world, port, start: f.t, begun, kit: null, maxRods: 0, breaks: 0, brokeAt: [], asks: begun ? [] : asksBefore(f.t), eq0: null };
      }
      if (cur && f.dim !== 'nether') close(f.t, hp > 0 ? 'left' : 'death-left');
      seenAny = true; lastDim = f.dim;
    }
    if (cur) {
      // The kit: the first frame of the stay with an inventory and equipment read (before or at it).
      if (!cur.kit && inv && eq) { cur.kit = kitOf(inv, eq); cur.kit.shieldUses = offUses; cur.inv0 = inv; cur.eq0 = eq; }
      if (f.inv) cur.maxRods = Math.max(cur.maxRods, rodsOf(f.inv));
      if (f.eq) {
        if (cur.lastOff === 'shield' && f.eq.offhand !== 'shield' && hp > 0 && !(inv?.shield > 0)) { cur.breaks++; cur.brokeAt.push({ t: f.t, fromPockets: shieldFromPockets(inv), iron: inv?.iron_ingot || 0, planks: sumOf(inv, /_planks$/) + 4 * sumOf(inv, /_(log|stem)$/), table: !!inv?.crafting_table }); }
        cur.lastOff = f.eq.offhand;
      }
    }
    lastT = f.t;
  }
  if (cur) close(Math.min(lastT ?? end, end), 'end');
  for (const s of out) { if (!s.kit) { s.kit = kitOf(inv, eq); s.inv0 = inv; s.eq0 = eq; } s.kit.rods = s.kit.rods ?? 0; delete s.lastOff; }
  return out.filter(s => s.minutes > 0);
}

// The features weighed: a name, and whether a stay's kit has it.
const FEATURES = [
  ['a shield in the off hand', k => k.shield === true],
  ['a spare shield carried', k => k.spareShields > 0],
  ['a spare shield carried or makeable (an iron ingot and 6 planks)', k => k.spareShields > 0 || k.shieldMakeable],
  ['a spare shield makeable from the pockets, smelting included', k => k.spareShields > 0 || k.shieldFromPockets],
  ['an iron ingot or more carried', k => k.iron >= 1],
  ['4 armour pieces worn', k => k.armour === 4],
  ['2 or more armour pieces worn', k => k.armour >= 2],
  ['all four iron or better', k => k.iron4],
  ['a golden piece worn or carried', k => k.gold],
  ['an iron sword or better', k => /^(iron|diamond|netherite)_sword$/.test(k.sword || '')],
  ['an axe', k => !!k.axe],
  ['food 40 points or more', k => k.food >= 40],
  ['64 blocks or more', k => k.blocks >= 64],
  ['64 ghast-proof blocks or more', k => k.ghastProof >= 64],
  ['64 or more of one block kind', k => k.oneKind >= 64],
  ['a water bucket', k => k.water > 0],
  ['a bow', k => k.bow],
];

function weigh(list, has) {
  const side = l => {
    const min = l.reduce((n, s) => n + s.minutes, 0), d = l.filter(s => /death/.test(s.how));
    const by = re => d.filter(s => re.test(s.killer || '')).length;
    return { stays: l.length, hours: round(min / 60, 2), deaths: d.length, perHour: min ? round(d.length / (min / 60), 2) : null,
      blaze: by(/^blaze$/), wither: by(/wither/), piglin: by(/piglin/), ghast: by(/ghast/), lava: by(/lava|fire/), other: d.length - by(/^blaze$|wither|piglin|ghast|lava|fire/),
      blazePerHour: min ? round(by(/^blaze$/) / (min / 60), 2) : null, witherPerHour: min ? round(by(/wither/) / (min / 60), 2) : null,
      rods: l.reduce((n, s) => n + s.rodsGot, 0), rodsPerHour: min ? round(l.reduce((n, s) => n + s.rodsGot, 0) / (min / 60), 2) : null,
      anyRod: l.filter(s => s.rodsGot > 0).length, aliveMedian: median(l.map(s => s.minutes)), breaks: l.reduce((n, s) => n + s.breaks, 0) };
  };
  return { with: side(list.filter(s => has(s.kit))), without: side(list.filter(s => !has(s.kit))) };
}

function main() {
  const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const since = Date.parse(opt('since', '2026-09-30T06:00:00Z')), to = Date.parse(opt('to', '2026-10-01T04:57:47Z'));
  const audit = require('./trials/progress-audit');
  const trials = audit.trialRecords({ since: since - 24 * 60 * MINUTE, flight: FLIGHT }).filter(t => t.port && t.start < to && t.end > since);
  const all = [];
  for (const port of [...new Set(trials.map(t => t.port))]) {
    const tr = trials.filter(t => t.port === port);
    const frames = readPort(port, Math.max(since, Math.min(...tr.map(t => t.start))), to);
    for (const t of tr) {
      const s = stays(frames.filter(f => f.t >= t.start - BEFORE_MS && f.t <= Math.min(t.end, to)), { start: t.start, end: Math.min(t.end, to), world: t.world, port });
      all.push(...s.filter(x => x.start >= since));
    }
  }
  report(all, { list: args.includes('--list'), asks: args.includes('--asks'), replay: args.includes('--replay') });
  const j = opt('json', null);
  if (j) fs.writeFileSync(j, JSON.stringify(all, null, 1));
}

function report(all, { list, asks, replay }) {
  const crossed = all.filter(s => !s.begun);
  const mins = all.reduce((n, s) => n + s.minutes, 0);
  const tally = (l, f) => { const t = {}; for (const x of l) { const k = f(x); t[k] = (t[k] || 0) + 1; } return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '); };
  console.log(`Nether stays: ${all.length} in ${new Set(all.map(s => s.world)).size} trials (${crossed.length} crossed through a portal, ${all.length - crossed.length} begun there), ${round(mins / 60, 1)} Nether hours`);
  console.log(`  ended: ${tally(all, s => s.how)}; deaths by cause: ${tally(all.filter(s => /death/.test(s.how)), s => s.killer)}`);
  console.log(`  rods got ${all.reduce((n, s) => n + s.rodsGot, 0)}, stays with a rod ${all.filter(s => s.rodsGot > 0).length}; shields broken ${all.reduce((n, s) => n + s.breaks, 0)} in ${all.filter(s => s.breaks).length} stays`);
  const k = all.map(s => s.kit);
  console.log(`  at entry: shield in hand ${k.filter(x => x.shield).length}, spare shield ${k.filter(x => x.spareShields).length}, shield makeable ${k.filter(x => x.shieldMakeable).length}; armour pieces ${tally(k, x => x.armour)}; armour ${tally(k, x => x.armourOf)}`);
  console.log(`  gold worn ${k.filter(x => x.goldWorn).length}, gold carried ${k.filter(x => x.goldCarried).length}; iron ingots median ${median(k.map(x => x.iron))} (none ${k.filter(x => !x.iron).length}); food median ${median(k.map(x => x.food))}; blocks median ${median(k.map(x => x.blocks))}, ghast-proof median ${median(k.map(x => x.ghastProof))}, one kind max median ${median(k.map(x => x.oneKind))}`);
  console.log(`  sword ${tally(k, x => x.sword || 'none')}; axe ${tally(k, x => x.axe || 'none')}; water bucket ${k.filter(x => x.water).length}, any bucket ${k.filter(x => x.buckets).length}; bow ${k.filter(x => x.bow).length}`);
  console.log('\nBy what was carried in (with | without): stays, Nether hours, deaths an hour (blaze, wither skeleton an hour), rods an hour, stays with a rod, shields broken');
  for (const [name, has] of FEATURES) {
    const w = weigh(all, has), f = x => `${x.stays} stays ${x.hours} h, ${x.perHour}/h (blaze ${x.blazePerHour}, wither ${x.witherPerHour}; piglin ${x.piglin}, ghast ${x.ghast}, lava/fire ${x.lava}), rods ${x.rodsPerHour}/h, ${x.anyRod} with a rod, ${x.breaks} breaks`;
    console.log(`  ${name}: ${f(w.with)} | ${f(w.without)}`);
  }
  const b = all.flatMap(s => s.brokeAt.map(x => ({ ...x, s })));
  const after = all.filter(s => s.breaks), afterMin = after.reduce((n, s) => n + (s.end - s.brokeAt[0].t) / MINUTE, 0), afterD = after.filter(s => /death/.test(s.how));
  const beforeMin = all.reduce((n, s) => n + (s.breaks ? (s.brokeAt[0].t - s.start) / MINUTE : s.minutes), 0), beforeD = all.filter(s => !s.breaks && /death/.test(s.how)).length;
  if (after.length) console.log(`\nAfter a shield broke (to the stay's end): ${round(afterMin)} Nether minutes, ${afterD.length} deaths (${afterD.filter(s => s.killer === 'blaze').length} blaze), ${round(afterD.length / (afterMin / 60), 2)} an hour; every other Nether minute ${round(beforeMin)}, ${beforeD} deaths, ${round(beforeD / (beforeMin / 60), 2)} an hour. Of the ${after.length} stays with a break, a spare was makeable from the pockets at the entry in ${after.filter(s => s.kit.shieldFromPockets).length}.`);
  if (b.length) console.log(`\nShield breaks ${b.length}: makeable from the pockets (smelting included) at ${b.filter(x => x.fromPockets).length}; an iron ingot carried at ${b.filter(x => x.iron).length}, and the planks for one (6 with a table, 10 without) at ${b.filter(x => x.iron && x.planks >= (x.table ? 6 : 10)).length}; the stay died within 2 minutes of ${b.filter(x => /death/.test(x.s.how) && x.s.end - x.t <= 2 * MINUTE).length}`);
  const a = crossed.flatMap(s => s.asks.map(q => ({ ...q, s })));
  console.log(`\nKit questions in the 20 minutes before a crossing: ${a.length} over ${crossed.filter(s => s.asks.length).length} of ${crossed.length} crossings; ${tally(a, q => q.id)}`);
  for (const id of [...new Set(a.map(q => q.id))]) {
    const qs = a.filter(q => q.id === id), offered = {};
    for (const q of qs) for (const k2 of q.keys) offered[k2] = (offered[k2] || 0) + 1;
    console.log(`  ${id}: answered ${tally(qs, q => q.chosen)}; offered ${Object.entries(offered).sort((x, y) => y[1] - x[1]).map(([x, v]) => `${x} ${v}`).join(', ')}`);
    const words = qs.flatMap(q => Object.values(q.words)).join(' ');
    console.log(`    said: shield ${/shield/i.test(words) ? 'yes' : 'never'}, armour ${/armou?r|helmet|chestplate|leggings/i.test(words) ? 'yes' : 'never'}, ghast ${/ghast/i.test(words) ? 'yes' : 'never'}; options naming a shield ${qs.filter(q => Object.values(q.words).some(w => /shield/i.test(w))).length} of ${qs.length}`);
  }
  if (replay) replayReport(crossed);
  if (asks) for (const q of a.slice(0, 40)) console.log(`  ${q.s.world} ${new Date(q.t).toISOString()} ${q.id} → ${q.chosen} [${q.keys.join(' ')}]`);
  if (list) for (const s of all) console.log(`${s.world} ${s.port} ${new Date(s.start).toISOString()} ${s.begun ? 'begun' : 'crossed'} ${s.minutes} min ${s.how}${s.killer ? ` (${s.killer})` : ''} rods +${s.rodsGot} breaks ${s.breaks} | shield ${s.kit.shield} spare ${s.kit.spareShields} armour ${s.kit.armourOf} gold ${s.kit.gold} food ${s.kit.food} blocks ${s.kit.blocks} (ghast-proof ${s.kit.ghastProof}) iron ${s.kit.iron} sword ${s.kit.sword} water ${s.kit.water}`);
}

// The crossing's offers (src/entry-kit.js, note 791) as they would have been
// made with each crossing's pockets at the entry: a bot built from the
// frame's inventory and equipment (the off hand's wear unknown before
// offhandUses was recorded: taken as new).
function botOf(inv, eq) {
  const registry = require('minecraft-data')('26.1');
  const items = Object.entries(inv || {}).filter(([n, c]) => c > 0 && registry.itemsByName[n]).map(([name, count], i) => ({ name, count, slot: 9 + i, durabilityUsed: 0 }));
  const slots = [];
  for (const [k, slot] of [['head', 5], ['torso', 6], ['legs', 7], ['feet', 8], ['offhand', 45]]) if (eq?.[k]) slots[slot] = { name: eq[k], count: 1, durabilityUsed: 0 };
  return { registry, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, entity: { position: { y: 64 } }, inventory: { items: () => items, slots } };
}
function replayReport(crossed) {
  const EK = require('../src/entry-kit');
  const rows = crossed.filter(s => s.inv0).map(s => ({ s, offers: EK.offers(botOf(s.inv0, s.eq0)) }));
  const by = k => rows.filter(r => r.offers.some(o => o.key === k));
  console.log(`\nReplayed at ${rows.length} crossings (the pockets at the entry), what crossing_kit now offers; before, none of these was offered or said:`);
  for (const k of ['shield', 'armour', 'stone']) {
    const r = by(k), o = r.map(x => x.offers.find(y => y.key === k)), pocket = o.filter(x => !x.mined);
    const whole = pocket.filter(x => !x.cut);
    console.log(`  top_up_${k}: offered at ${r.length}; the iron from the pockets (carried or smelted, no mining) at ${pocket.length}${pocket.length && pocket[0].seconds != null ? `, a median ${median(pocket.map(x => x.seconds))} s` : ''}${k === 'shield' ? `, the wood too (no log cut) at ${whole.length}${whole.length ? `, a median ${median(whole.map(x => x.seconds))} s` : ''}` : ''}; of those stays ${r.filter(x => /death/.test(x.s.how)).length} died, ${r.filter(x => x.s.breaks).length} broke a shield`);
  }
  const quiet = rows.filter(r => !r.offers.length).length;
  console.log(`  crossings with none of the three on offer: ${quiet}`);
}

if (require.main === module) main();
module.exports = { stays, kitOf, killerOf, weigh, FEATURES, foodPoints };
