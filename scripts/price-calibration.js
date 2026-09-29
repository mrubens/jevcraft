'use strict';
// How the stance prices compare with what the stances took (note 631 (3): the
// holding stances were priced two to three times what they took). From the
// flight records: every encounter_stance answer Jev gave, the damage its
// chosen option's description said ("About 3.7 damage from the mobs here in
// the next fifteen seconds this way"; the fight's "about 20.2 of it in the
// first fifteen seconds"; a run's or a charge's "about 7 damage ... over the
// 2.3 seconds"; a meal's), and the damage the bot took in that same window
// from the moment the answer was given (the game's damage events with the
// health drop that followed, as scripts/blaze-record.js reads them).
// Per option: how many answers, the median priced (raw, and capped at the
// health the bot had: it cannot take more than it has), the median taken,
// the ratio of the two, and a flag where |priced - taken| / taken exceeds 50%.
//
// What it can measure: the figure a description states for a window, against
// the damage events in that window, per option, over every answer whose
// window the record covers whole.
// What it cannot: (1) the price is only as stated, so an option whose
// description states no figure is counted as "no figure" and left out;
// (2) the taken damage is all damage (fire, falls, lava, a mob the price did
// not count), where the price is "from the mobs here"; (3) the stance often
// ends before the window does (it is held until it fails, the health falls by
// six, or another question is asked), and the bot may have done other
// things in it: this is the damage after the choice, not caused by the choice
// alone; (4) what was chosen is not chosen at random, so an option's rows say
// what happened where Jev picked it, not what it would have cost anywhere;
// (5) a window the record does not cover whole (the run ended, the bot
// reconnected) is dropped unless the bot died in it, which biases a little
// toward the kept; (6) the record cannot say what the priced option would
// have taken had another been chosen.
//
// Note 647 (the prices against what the options took, split by situation).
// Each answer also carries the mobs about (state.threats and the estimate's
// mobs), the health band, the dimension, the seconds to the next ask, how near
// the mobs of the kinds priced came, when in the window each hurt fell, and
// the seconds until the mobs priced were gone where that was inside the window
// (no mob of those kinds within reach in a later frame's mob list).
//
// The taken side, said which it is (--taken):
//   all       every damage event in the priced window (note 637's column);
//   mobs      the same without falls, lava, walls and hot floors, which the
//             price ("from the mobs here") never counts;
//   whole     mobs, over the answers whose mobs were still about at the end of
//             the window: a fight priced over fifteen seconds that was won in
//             four is not compared, so an early end cannot make a price look
//             high;
//   prorated  mobs, every answer, the price cut to the seconds an early-ended
//             engagement lasted (the price x the seconds it lasted / the
//             window): the fight up to its end against the price of the fight
//             up to its end, the price spread evenly over its window, which
//             the front-loaded fights make a floor of what it would have said.
// The window is always the priced window (a stance's fifteen seconds, a run's
// or a meal's own), taken from the answer.
//
// Repeated asks are one decision (--episodes): while mobs are about a stance is
// asked again every second or less (the median next ask came 0.3 seconds
// later), each afresh, so one loop outweighs a hundred decisions (one run asked
// the same fight 1,273 times about two spear piglins 14 blocks off that never
// came). An episode is the first ask of a stretch of the same option in a run
// with under two minutes between its asks.
//
// Whose prices these are: each answer was priced by the build the bot ran,
// and the records span builds (note 602's blaze cadence reached the bots at
// 12:46Z on 2026-09-28; before it a blaze in sight was 2 a second). Use --from
// 2026-09-28T13:00:00Z for the prices of the build before note 647: the model
// of that build reproduces 96 to 100 in 100 of the take_cover answers from
// then, within 15% or 0.3, where before it 71 to 77.
//
// --baseline-model and --model price the same records again (reprice below):
// the recorded price moved by what the second model says over the first for
// the same mobs.
//   node scripts/price-calibration.js [--dir <flight dir>] [--from ISO] [--to ISO] [--nether] [--min-n 5] [--json]
//     [--by situation|health|dimension|none] [--taken all|mobs|whole|prorated] [--episodes] [--dump file] [--load file]
//     [--baseline-model <combat-estimate.js of the build the records were made by> --model <the one to price by>]
// (the baseline is that build's src/combat-estimate.js, which requires nothing: git show <commit>:src/combat-estimate.js)
const fs = require('node:fs');
const path = require('node:path');
const { hurts, eachFile } = require('./blaze-record');

const WINDOW_S = 15, FLAG = 0.5;

// The damage a description prices, the seconds it prices it over and the
// health it starts from: { priced, seconds, health } or null where it states
// no figure. Sentences saying what the arena measured are other figures.
function priceOf(desc) {
  const sentences = String(desc || '').split(/(?<=\.) (?=[A-Z])/).filter(s => !/^(Measured in the arena|Measured with|The arena's)/.test(s));
  const num = x => (x === 'fifteen' ? 15 : Number(x));
  const healthOf = s => { const h = /from ([\d.]+) health/.exec(s); return h ? Number(h[1]) : null; };
  for (const s of sentences) {
    let m = /about ([\d.]+) of it in the first (fifteen|[\d.]+) seconds/i.exec(s);
    if (m) return { priced: Number(m[1]), seconds: num(m[2]), health: healthOf(s) ?? healthOf(desc) };
    m = /^About ([\d.]+) damage over the ([\d.]+) seconds/.exec(s);
    if (m) return { priced: Number(m[1]), seconds: Number(m[2]), health: healthOf(s) };
    m = /[Aa]bout ([\d.]+) damage.*? in the (?:next )?(fifteen|[\d.]+) seconds/.exec(s);
    if (m) return { priced: Number(m[1]), seconds: num(m[2]), health: healthOf(s) };
    m = /^About ([\d.]+) damage from the shooters in range over those seconds/.exec(s);
    const run = /about ([\d.]+) seconds at a run/.exec(desc);
    if (m && run) return { priced: Number(m[1]), seconds: Number(run[1]), health: healthOf(s) };
    m = /^About ([\d.]+) damage from the mobs here while it eats/.exec(s);
    const meal = /about ([\d.]+) seconds standing still/.exec(desc);
    if (m && meal) return { priced: Number(m[1]), seconds: Number(meal[1]), health: healthOf(s) };
  }
  return null;
}


// Damage the price never counts: the game's own hurts that are not from a
// mob (a fall, lava, a wall, a hot floor); the rest are the mobs' and their
// fire, wither, poison and blasts.
const NOT_MOB = new Set(['fall', 'lava', 'in_wall', 'hot_floor', 'drown', 'starve', 'cactus', 'fly_into_wall', 'out_of_world', 'cramming', 'freeze', 'sweet_berry_bush', 'stalagmite', 'falling_block', 'falling_anvil', 'dry_out', 'outside_border', 'generic_kill', 'kill']);
// The situation an answer was given in, by the mobs the question counted: the
// first of these kinds present names it (a blaze fight is a blaze fight
// whatever else is about).
const KINDS = [['blaze', ['blaze']], ['ghast', ['ghast']], ['wither_skeleton', ['wither_skeleton']], ['piglin', ['piglin', 'piglin_brute', 'zombified_piglin']], ['hoglin', ['hoglin', 'zoglin']], ['creeper', ['creeper']], ['skeleton', ['skeleton', 'stray', 'bogged', 'parched']], ['zombie', ['zombie', 'husk', 'drowned', 'zombie_villager']], ['spider', ['spider', 'cave_spider']], ['magma_cube', ['magma_cube', 'slime']]];
function kindOf(names) {
  for (const [k, list] of KINDS) if (names.some(n => list.includes(n))) return k;
  return names.length ? 'other' : 'none';
}
const bandOf = h => h == null ? 'unknown' : h < 8 ? 'under 8' : h <= 14 ? '8 to 14' : 'over 14';

// The answers in one connection's frames (sorted by time), each with the
// damage taken in its window: { option, priced, capped, taken, seconds,
// health, died, at }, or `dropped` counts where the record does not cover it.
function calibrate(frames, { from = -Infinity, to = Infinity, nether = false } = {}) {
  const out = [], dropped = { noFigure: 0, unfinished: 0 };
  const ev = hurts(frames), last = frames.length ? frames[frames.length - 1].at : 0, seen = new Set();
  // When each stance question was answered, so an answer can say when the next one came (the stance it set was then no longer the one held).
  const asked = [...new Set(frames.filter(f => f.kind === 'decision' && f.snapshot?.decision?.id === 'encounter_stance' && f.snapshot.decision.judgments?.length && !f.snapshot.decision.stale).map(f => Date.parse(f.snapshot.decision.at) || f.at))].sort((a, b) => a - b);
  for (let i = 0; i < frames.length; i++) {
    const x = frames[i];
    const d = x.kind === 'decision' && x.snapshot?.decision;
    if (!d || d.id !== 'encounter_stance' || !d.judgments?.length || d.stale) continue;
    const t0 = Date.parse(d.at) || x.at, key = t0;
    if (seen.has(key) || !(t0 >= from && t0 <= to)) continue;
    seen.add(key);
    if (nether && x.snapshot.dimension !== 'the_nether') continue;
    // shoot_<entity id> is one option, aimed at a different mob each time.
    const chosen = d.path?.[0], option = /^shoot_\d+$/.test(chosen) ? 'shoot' : chosen, price = priceOf(d.options?.[chosen]?.description);
    const threats = d.state?.threats || [], names = [...new Set(threats.map(t => t.name))];
    const situation = { kind: kindOf(names), names, est: d.state?.est || [], armour: d.state?.armour || [], weapon: d.state?.weapon || null, shield: !!d.state?.shield, hp: d.state?.health ?? null, fire: d.state?.fire || 0, coming: d.state?.coming || [], nether: x.snapshot.dimension === 'the_nether', n: threats.length, seen: threats.filter(t => t.visible).length, near: threats.length ? Math.round(Math.min(...threats.map(t => t.distance ?? 99)) * 10) / 10 : null, desc: String(d.options?.[chosen]?.description || '').slice(0, 1500) };
    if (!price) { dropped.noFigure++; out.push({ option, none: true, ...situation }); continue; }
    const end = t0 + price.seconds * 1000;
    let died = false, prev = x.snapshot.health, reconnected = false, over = null, closest = null;
    // The engagement ends at the first frame whose mob list has none of the
    // kinds the question counted within reach of where they were.
    const reach = Math.min(48, Math.max(16, ...threats.map(t => (t.distance || 0) + 4)));
    for (let j = i; j < frames.length && frames[j].at <= end; j++) {
      const f = frames[j];
      if (f.at < t0) continue;
      if (f.kind === 'connection') reconnected = true;
      const h = f.snapshot?.health;
      if (typeof h === 'number') { if (h === 0 && prev > 0) died = true; prev = h; }
      if (names.length && Array.isArray(f.snapshot?.mobs)) for (const m of f.snapshot.mobs) if (names.includes(m.name) && Number.isFinite(m.d)) closest = closest == null ? m.d : Math.min(closest, m.d);
      if (over == null && names.length && Array.isArray(f.snapshot?.mobs) && f.at > t0 + 500 && !f.snapshot.mobs.some(m => names.includes(m.name) && (m.d ?? 0) <= reach)) over = (f.at - t0) / 1000;
    }
    if (!died && (last < end + 1000 || reconnected)) { dropped.unfinished++; continue; }
    const inWindow = ev.filter(e => e.t >= t0 && e.t <= end);
    const taken = inWindow.reduce((n, e) => n + e.drop, 0);
    const takenMob = inWindow.filter(e => !NOT_MOB.has(e.detail?.type)).reduce((n, e) => n + e.drop, 0);
    // When in the window each of those hurts fell (seconds after the answer, the health it took): where the taken sits in it.
    const when = inWindow.filter(e => !NOT_MOB.has(e.detail?.type) && e.drop > 0).map(e => [Math.round((e.t - t0) / 100) / 10, Math.round(e.drop * 10) / 10, e.detail?.type === 'on_fire' ? 'fire' : e.detail?.type || 'other']);
    const health = price.health ?? x.snapshot.health ?? null;
    out.push({ option, priced: price.priced, capped: health != null ? Math.min(price.priced, health) : price.priced, taken: Math.round(taken * 100) / 100, takenMob: Math.round(takenMob * 100) / 100, when,
      seconds: price.seconds, next: (t => t == null ? null : Math.round((t - t0) / 100) / 10)(asked.find(t => t > t0 + 200)), health, band: bandOf(health), died, at: t0, ...situation, ...(closest != null ? { closest: Math.round(closest * 10) / 10 } : {}),
      // Seconds until the mobs priced were gone, where they went before the window ended (the price over that length is priced * over / seconds).
      ...(over != null && !died && over < price.seconds - 1 ? { over: Math.round(over * 10) / 10 } : {}) });
  }
  return { answers: out, dropped };
}

const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const r1 = x => x === null ? null : Math.round(x * 10) / 10;

// Priced against taken: OVER where the price is above what was taken by more
// than half of it, UNDER where below; with nothing taken, a price over half
// a point is OVER.
function flagOf(priced, taken) {
  const off = taken > 0 ? (priced - taken) / taken : priced > 0.5 ? Infinity : 0;
  return Math.abs(off) > FLAG ? (off > 0 ? 'OVER' : 'UNDER') : '';
}

// Answers to one row per option. Two flags, since most windows take nothing
// and a median of zeros hides the ones that did: the medians', and the
// means' (the total priced against the total taken, which is where note 631's
// two to three times was read).
// `view` says which taken and which answers (see the header): 'all' (default),
// 'mobs', 'whole' (mobs, over the answers whose mobs were still about at the
// window's end) and 'prorated' (mobs, the price cut to the seconds an early-
// ended engagement lasted). `by` groups the rows: 'situation', 'health',
// 'dimension' or none.
const VIEWS = {
  all: a => ({ capped: a.capped, taken: a.taken }),
  mobs: a => ({ capped: a.capped, taken: a.takenMob ?? a.taken }),
  whole: a => a.over != null ? null : ({ capped: a.capped, taken: a.takenMob ?? a.taken }),
  prorated: a => ({ capped: a.over != null ? a.capped * a.over / a.seconds : a.capped, taken: a.takenMob ?? a.taken }),
};
const GROUPS = { situation: a => a.kind || 'none', health: a => a.band || 'unknown', dimension: a => a.nether ? 'nether' : 'overworld', none: () => '' };
const SEP = '|';
function table(answers, { minN = 5, view = 'all', by = 'none' } = {}) {
  const pick = VIEWS[view] || VIEWS.all, grp = GROUPS[by] || GROUPS.none;
  const groups = {}, none = {};
  for (const a of answers) {
    const key = `${grp(a)}${SEP}${a.option}`;
    if (a.none) { none[key] = (none[key] || 0) + 1; continue; }
    const v = pick(a);
    if (v) (groups[key] ||= []).push({ ...a, ...v });
  }
  const rows = Object.entries(groups).map(([key, list]) => {
    const [group, option] = key.split(SEP);
    const p = median(list.map(a => a.priced)), c = median(list.map(a => a.capped)), t = median(list.map(a => a.taken));
    const mc = mean(list.map(a => a.capped)), mt = mean(list.map(a => a.taken));
    return { group, option, n: list.length, noFigure: none[key] || 0, medianPriced: r1(p), medianCapped: r1(c), medianTaken: r1(t), ratio: t > 0 ? Math.round(c / t * 100) / 100 : null,
      meanCapped: r1(mc), meanTaken: r1(mt), meanRatio: mt > 0 ? Math.round(mc / mt * 100) / 100 : null, died: list.filter(a => a.died).length,
      tookAny: list.filter(a => a.taken > 0).length, flag: flagOf(c, t), meanFlag: flagOf(mc, mt), few: list.length < minN };
  }).sort((a, b) => a.group.localeCompare(b.group) || b.n - a.n);
  const noFigureOnly = Object.entries(none).filter(([key]) => !groups[key]).map(([key, n]) => ({ group: key.split(SEP)[0], option: key.split(SEP)[1], n }));
  return { rows, noFigureOnly };
}

function print(t, dropped, total, minN) {
  const grouped = t.rows.some(r => r.group);
  const head = [...(grouped ? ['group'] : []), 'option', 'n', 'took any', 'priced (median)', 'capped at health', 'taken (median)', 'ratio', 'flag (median)', 'mean capped / taken', 'flag (mean)', 'died'];
  const few = r => r.few ? ` (n<${minN})` : '';
  const body = t.rows.map(r => [...(grouped ? [r.group] : []), r.option, r.n, r.tookAny, r.medianPriced, r.medianCapped, r.medianTaken, r.ratio ?? '-', r.flag + (r.flag ? few(r) : ''),
    `${r.meanCapped} / ${r.meanTaken}${r.meanRatio ? ` (${r.meanRatio})` : ''}`, r.meanFlag + (r.meanFlag ? few(r) : ''), r.died].map(String));
  const width = head.map((h, i) => Math.max(h.length, ...body.map(r => r[i].length)));
  const line = r => r.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd();
  const lines = [line(head), ...body.map(line)];
  lines.push('', `${total} encounter_stance answers by Jev; ${t.rows.reduce((n, r) => n + r.n, 0)} in this table (a stated figure and a whole window), ${dropped.noFigure} with no figure in the chosen option's description, ${dropped.unfinished} dropped (the record ends inside the window or the bot reconnected, and it did not die).`);
  if (t.noFigureOnly.length) lines.push('Options whose description states no figure (not measured): ' + t.noFigureOnly.map(o => `${o.group ? o.group + ' ' : ''}${o.option} ${o.n}`).join(', ') + '.');
  lines.push(`Flags: |capped price - taken| / taken over ${FLAG * 100}%, on the medians and on the means; "(n<${minN})" marks a row too small to lean on; "took any" is how many of the n took any damage in the window. Priced is the damage the chosen option's text said for its window (15 seconds unless it says otherwise); capped is the price held to the health the bot had; taken is the damage events in that window after the answer (the view says which: see the header).`);
  return lines.join('\n');
}

// What one flight file's frames keep for this table: the health, dimension
// and the mobs' names and distances of every frame, and of each stance
// answer the state's threats and the chosen option's text.
const slim = f => {
  const s = f.snapshot || {}, d = s.decision;
  const keepDecision = f.kind === 'decision' && d?.id === 'encounter_stance' && d.judgments?.length;
  const st = d?.state || {};
  return { at: f.at, kind: f.kind, detail: f.kind === 'damage' ? f.detail : undefined, snapshot: { health: s.health, dimension: s.dimension,
    ...(Array.isArray(s.mobs) ? { mobs: s.mobs.map(m => ({ name: m.name, d: m.d })) } : {}),
    ...(keepDecision ? { decision: { id: d.id, at: d.at, stale: d.stale, path: d.path, judgments: [1], options: { [d.path?.[0]]: { description: d.options?.[d.path?.[0]]?.description } },
      state: { threats: (st.threats || []).map(t => ({ name: t.name, distance: t.distance, visible: t.visible, shoots: t.shoots })), health: st.health, food: st.food, armour: st.armour, weapon: st.weapon, shield: st.shield,
        // The mobs the question priced, as the estimate recorded them (enough to price them again).
        est: (st.estimate?.mobs || []).map(m => ({ name: m.name, distance: m.distance, shoots: m.shoots, visible: m.visible, unseen: m.unseen, apart: m.apart, quiet: m.quiet, inCell: m.inCell, spear: m.spear, far: m.far })), coming: (st.comingAtTheBot || []).map(c => ({ name: c.name, distance: c.distance })), fire: Number(/alight: about ([\d.]+) seconds? of fire left/.exec(`${st.effectsNow || ''} ${st.estimate?.fightHere?.fire || ''}`)?.[1]) || 0 } } } : {}) } };
};

// The answers of every flight file in `dir` (or a dump written before).
function collect({ dir, from = -Infinity, to = Infinity, nether = false }) {
  const answers = [], dropped = { noFigure: 0, unfinished: 0 };
  eachFile(dir, Number.isFinite(from) ? from : 0, '"encounter_stance"', (frames, f) => {
    const r = calibrate(frames, { from, to, nether });
    answers.push(...r.answers.map(a => ({ ...a, run: f }))); dropped.noFigure += r.dropped.noFigure; dropped.unfinished += r.dropped.unfinished;
  }, slim);
  return { answers, dropped };
}

// Prices again by another model of the mobs (note 647): each answer's mobs as
// the question recorded them, priced by `baseline` and by `model` (each a
// combat-estimate module) in the way the chosen option prices its stretch (the
// setup seconds its text says, the fight it makes, whether shooters still
// reach the bot after it), and the recorded price scaled by what the model
// changed: after = recorded + (model - baseline), never below nothing.
// It is the change of the models on the same mobs and the same way of
// standing, not the option's own geometry (a wall's cover, a route's length),
// which the record does not hold: what the model changes is added to what was
// priced, and what it cannot move (a fire already on the body, a drop, a
// blaze's spawner) stays as it was.
const FIGHTS = new Set(['fight', 'rail_and_fight', 'fight_from_footing', 'charge_nearest', 'charge_shooter', 'close_in', 'hold_on_span', 'shield_guard', 'fight_at_spawner', 'dig_in_and_fight', 'nook', 'bunker']);
function stanceOf(a) {
  const text = a.desc || '';
  const setup = /the ([\d.]+) seconds of [^,.]*? (?:included|not done)/.exec(text) || /about ([\d.]+) seconds at a run/.exec(text) || /over the ([\d.]+) seconds/.exec(text);
  const sec = a.seconds || 15, set = Math.min(sec, setup ? Number(setup[1]) : 0);
  const none = /none of them reaches it|none of them reach it|Out of their line, none/.test(text) && !/still reach/.test(text);
  return { setup: set, seconds: sec, fight: FIGHTS.has(a.option) ? { lead: true } : null, shootersReach: a.option === 'retreat' ? false : !none && !/^(seal|dig_down)$/.test(a.option) && !(set >= sec) };
}
function priceWith(mod, a) {
  const threats = (a.est || []).map(m => ({ name: m.name, distance: m.distance, shoots: m.shoots, visible: m.visible, ...(m.unseen ? { unseen: true } : {}), ...(m.apart ? { apart: true } : {}), ...(m.quiet ? { quiet: m.quiet } : {}), ...(m.inCell ? { inCell: true } : {}), ...(m.spear ? { held: 'iron_spear' } : {}) }));
  if (!threats.length) return null;
  const est = mod.fightEstimate({ threats, armour: a.armour || [], weapon: a.weapon && a.weapon !== 'bare hands' ? a.weapon : null, health: a.hp ?? 20, shield: !!a.shield, atOnce: 4, burningFor: a.fire || 0 });
  const { stanceCost } = mod, st = stanceOf(a);
  // keep_working said what the shooters in sight take in fifteen seconds by
  // its own sum (a hit over the shot's interval, every shooter in sight):
  // the old sum by the baseline's mobs, the new by the stance's figure.
  // A fight with nothing to swing at said the shooters' fifteen seconds by that
  // same sum (survival.js shotsIn15): the baseline's, then the stance's figure.
  if (a.option === 'fight' && /standing in their line of fire/.test(a.desc || '')) {
    const seen = est.mobs.filter(m => m.shoots && m.visible && !m.quiet);
    return mod.landsPerSecond ? stanceCost({ mobs: seen, setup: 15, seconds: 15, health: a.hp ?? null }).damage : seen.reduce((n, m) => n + (m.hitsBot || 0) / (m.every || 2), 0) * 15;
  }
  if (a.option === 'keep_working') {
    const seen = est.mobs.filter(m => m.shoots && m.visible && !m.quiet);
    return mod.landsPerSecond ? stanceCost({ mobs: seen, setup: 15, seconds: 15, health: a.hp ?? null }).damage : seen.reduce((n, m) => n + m.hitsBot / (m.every || 2), 0) * 15;
  }
  if (a.option === 'fight') return est.fightHere.inFifteenSeconds;
  const mobs = est.mobs.map(m => Object.assign(m, m.name === 'creeper' ? {} : {}));
  const shooters = mobs.filter(m => m.shoots);
  const c = stanceCost({ mobs, setup: st.setup, seconds: st.seconds, ...(st.fight ? { fight: st.fight } : {}), reaches: m => st.shootersReach && !!m.shoots, shield: !!a.shield, health: a.hp ?? null });
  return shooters.length || st.fight || c.damage > 0 ? c.damage : null;
}
// The answers with `capped` moved by the model over the baseline (`repriced`
// where one was), the taken side unchanged.
function reprice(answers, baseline, model) {
  return answers.map(a => {
    if (a.none || !a.est?.length) return a;
    let was = null, now = null;
    try { was = priceWith(baseline, a); now = priceWith(model, a); } catch (_) { return a; }
    if (was == null || now == null) return a;
    const priced = Math.max(0, a.priced + now - was);
    const health = a.health ?? Infinity;
    return { ...a, priced: Math.round(priced * 100) / 100, capped: Math.round(Math.min(priced, health) * 100) / 100, repriced: true };
  });
}

// Repeated asks are one decision: while mobs are about the stance is asked
// again every second or less (the median next answer came 0.3 seconds later),
// and each ask is priced afresh, so one long loop (one run asked the same fight
// 1,273 times) outweighs a hundred decisions. An episode is the first answer
// of a stretch of the same option in the same run with under `gap` ms between
// its asks; its window is the priced window from that first answer.
function episodes(answers, gap = 120000) {
  const last = {};
  return [...answers].sort((a, b) => (a.at || 0) - (b.at || 0)).filter(a => { const k = a.run + '|' + a.option, p = last[k]; last[k] = a.at; return !(p != null && a.at - p < gap); });
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
  const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
  const from = args.from ? Date.parse(args.from) : -Infinity, to = args.to ? Date.parse(args.to) : Infinity, minN = Number(args['min-n']) || 5;
  const got = args.load ? JSON.parse(fs.readFileSync(args.load, 'utf8')) : collect({ dir, from, to, nether: !!args.nether });
  if (args.dump) fs.writeFileSync(args.dump, JSON.stringify(got));
  const answers = got.answers.filter(a => (a.at == null || (a.at >= from && a.at <= to)) && (!args.nether || a.nether));
  const ok = args['baseline-model'] && args.model;
  const repriced = ok ? reprice(answers, require(path.resolve(args['baseline-model'])), require(path.resolve(args.model))) : answers;
  const shown = args.episodes ? episodes(repriced) : repriced;
  const t = table(shown, { minN, view: args.taken || 'all', by: args.by || 'none' });
  const total = answers.length + got.dropped.unfinished;
  console.log(args.json ? JSON.stringify({ ...t, dropped: got.dropped, total }, null, 1) : print(t, got.dropped, total, minN));
}

if (require.main === module) main();
module.exports = { priceOf, calibrate, table, print, collect, episodes, reprice, priceWith, stanceOf, kindOf, bandOf, WINDOW_S };
