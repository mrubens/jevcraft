#!/usr/bin/env node
'use strict';
// The Nether deaths after a blaze was first known, and the busy minutes
// there, read from the flight records (note 786). Over blaze-span.js's spans
// (note 783): each death in the Nether with its last 30 seconds (what hurt the
// bot and how much, the health, food, armour pieces and shield then, the rods
// carried, the blazes within 16 and in sight, who held the turn, and every
// question asked with its answer, the health it was asked at, and whether a
// way out of the fire or to heal was offered and what it said of itself),
// sorted into shapes; then each busy-not-progressing minute of the spans
// (wasted-minutes.js's waste: shelter sitting, stuck/unstuck, standing still)
// by what held it (the survival action or step most of the minute) and the
// question answered in it. With --shields, every shield's life in the
// spans' Nether (raised, then gone from the off hand with none carried): the
// fireball shots met in it, its minutes, what was carried at the break, the
// deaths within two and five minutes after, and the bot-minutes with and
// without a shield in hand (src/shield-wear.js RECORD). With --escapes,
// every way out of the fire or to heal chosen there (leave_and_heal,
// step_out_and_eat, out_of_sight, back_to_wall, corner_ambush, take_cover,
// eat...) and whether its walk got there (the next asking's
// failedHereJustNow, a no_route within 2.5 s). Read-only.
//
//   node scripts/blaze-deaths.js [--since ISO] [--to ISO] [--port N] [--list] [--options] [--shields] [--escapes] [--json out.json]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');
const BS = require('./blaze-span');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const WINDOW_MS = 30000, MINUTE = 60000;
const round = (n, k = 1) => n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** k) / 10 ** k;
const hms = t => new Date(t).toISOString().slice(11, 21);
const frameAt = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };
const tally = (list, f) => { const t = {}; for (const x of list) { const k = f(x); if (k == null) continue; t[k] = (t[k] || 0) + 1; } return Object.entries(t).sort((a, b) => b[1] - a[1]); };
const said = rows => rows.map(([k, v]) => `${k} ${v}`).join(', ');

// The option families read at the fatal moments.
const FAMILY = [
  ['heal', /^(leave_and_heal|heal_first|step_out_and_eat|eat|eat_first|eat_golden_apple|wall_in_first|seal|bunker|dig_in(_and_fight)?|dig_down|pull_back|wait_far_off|leave_reach)$/],
  ['out of the line', /^(out_of_sight|out_of_their_line|take_cover|behind_cover|retreat|nook|out_of_the_push|box_here|box_in_line|low_ceiling)$/],
  ['rods kept', /^(stash_rods|bank_rods|pick_up_rods)$/],
  ['attack', /^(fight|close_in|charge_nearest|charge_shooter|fight_at_spawner|fight_from_footing|hunt_\d+|strike_at_arm|rise_to_strike|corner_ambush|stay_and_fight|rail_and_fight|return_fireball|strike_first)$/],
  ['shield', /^(shield_up|shield_guard|back_to_wall|await_in_reach|shield_the_blast|keep_on)$/],
];
const familyOf = k => (FAMILY.find(([, re]) => re.test(k)) || ['other'])[0];

// The death's kind by its last hurts: the blaze's fire and its blows, lava,
// a fall, another mob.
function killerOf(hurts, blazesNear) {
  const last = hurts.slice(-3);
  const by = h => {
    const c = `${h.type} ${h.cause} ${h.direct}`;
    if (/lava/.test(c)) return 'lava';
    if (/fall/.test(c)) return 'fall';
    if (/blaze|small_fireball/.test(c)) return 'blaze';
    if (/wither_skeleton|wither\b/.test(c)) return 'wither skeleton';
    if (/ghast|fireball/.test(c)) return 'ghast';
    if (/piglin|hoglin|magma|skeleton|zombie/.test(c)) return (c.match(/(zombified_piglin|piglin_brute|piglin|hoglin|magma_cube|skeleton|zombie)/) || [])[1];
    if (/on_fire|in_fire/.test(c)) return blazesNear ? 'blaze' : 'fire';
    return h.type || '?';
  };
  const ks = last.map(by);
  return ks.find(k => k !== 'blaze' && k !== 'fire' && k !== '?') && ks.at(-1) !== 'blaze' ? ks.at(-1) : ks.at(-1) || '?';
}

function windowFrames(port, from, to) {
  const out = [];
  for (const { f, start, next } of BS.portFiles(port)) {
    if (next < from - MINUTE || start > to) continue;
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const t = frameAt(line);
      if (!(t >= from && t <= to)) continue;
      try { out.push({ t, ...JSON.parse(line) }); } catch (_) { /* torn */ }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

const armourOf = eq => eq ? ['head', 'torso', 'legs', 'feet'].filter(k => eq[k]).length : null;
const lead = s => String(s && typeof s === 'object' ? JSON.stringify(s) : s || '').replace(/^At [\d.]+ health[^:]*:[^.]*\.\s*/, '').replace(/^Hitting the bot now:[^.]*(\([^)]*\)[^.]*)*\.\s*/, '');

// One death's last 30 seconds. Pure over the frames.
function deathWindow(frames, death) {
  const t0 = death.t - WINDOW_MS;
  // The health at a moment: the last frame's at or before it, else the first after.
  const hpAt = t => { let v = null; for (const f of frames) { if (typeof f.snapshot?.health !== 'number') continue; if (f.t > t && v !== null) break; v = f.snapshot.health; if (f.t > t) break; } return v; };
  const first = frames.find(f => f.snapshot?.equipment) || {};
  const lastWith = k => [...frames].reverse().find(f => f.snapshot?.[k]);
  const eq0 = first.snapshot?.equipment, eqEnd = lastWith('equipment')?.snapshot?.equipment;
  const inv = [...frames].reverse().find(f => f.kind === 'observation' && f.snapshot?.inventory)?.snapshot?.inventory || {};
  const mobsAt = f => (f?.snapshot?.mobs || []);
  const blz = f => mobsAt(f).filter(m => m.name === 'blaze' && m.d <= 16);
  const mid = [...frames].reverse().find(f => f.t <= death.t - 5000 && f.snapshot?.mobs);
  const end = [...frames].reverse().find(f => f.snapshot?.mobs);
  const hurts = frames.filter(f => f.kind === 'damage').map(f => ({ t: f.t, hp: f.snapshot?.health, type: f.detail?.type || null, cause: f.detail?.cause || null, direct: f.detail?.direct || null, label: f.label }));
  const decisions = frames.filter(f => f.kind === 'decision' && f.snapshot?.decision && !f.snapshot.decision.stale).map(f => {
    const d = f.snapshot.decision, keys = Object.keys(d.options || {});
    const p = d.judgments?.[0]?.probabilities || {};
    const chosen = (d.path || []).filter(x => x !== 'list').at(-1) || '?';
    return { t: Date.parse(d.at) || f.t, id: d.id, chosen, hp: d.state?.health ?? f.snapshot?.health, keys, p: p[chosen] ?? null, noneGood: !!d.noneGood,
      families: [...new Set(keys.map(familyOf))], words: Object.fromEntries(keys.map(k => [k, lead(d.options[k]?.description)])), state: Object.keys(d.state || {}) };
  });
  const turns = tally(frames.filter(f => f.snapshot?.turn), f => f.snapshot.turn.holder + (f.snapshot.turn.phase ? `:${String(f.snapshot.turn.phase).replace(/^stance: /, '')}` : ''));
  const sas = tally(frames.filter(f => f.snapshot?.survivalAction?.action), f => f.snapshot.survivalAction.action);
  const near = blz(mid || end).length, seen = blz(mid || end).filter(m => m.seen).length;
  const killer = killerOf(hurts, blz(end).length);
  const hp30 = hpAt(t0 + 1), hp15 = hpAt(death.t - 15000), hp5 = hpAt(death.t - 5000);
  // The first moment health was under 8 in the window, and what was asked after it.
  const lowAt = frames.find(f => typeof f.snapshot?.health === 'number' && f.snapshot.health > 0 && f.snapshot.health < 8)?.t ?? null;
  // Note 759's shapes, by the last minute's health and the blazes about.
  const shape = killer !== 'blaze' && killer !== 'fire' ? `not a blaze (${killer})`
    : near <= 3 ? 'three or fewer blazes'
      : hp15 >= 16 ? 'a burst at a swarm (16+ to dead in 15 s)'
        : hp15 != null && hp15 < 8 ? 'low 15 s and more before'
          : 'worn down among four or more';
  return {
    world: death.world, port: death.port, t: death.t, rods: death.rods, min: death.min, killer, shape,
    hp30, hp15, hp5, food: first.snapshot?.food ?? null, armour: armourOf(eq0), shield0: eq0?.offhand === 'shield', shieldEnd: eqEnd?.offhand === 'shield',
    sword: Object.keys(inv).find(k => /_sword$/.test(k)) || null, blocks: Object.entries(inv).filter(([k]) => /^(netherrack|cobblestone|cobbled_deepslate|blackstone|basalt|dirt|stone|deepslate)$/.test(k)).reduce((n, [, v]) => n + v, 0),
    food_items: Object.entries(inv).filter(([k]) => /cooked|bread|beef|porkchop|mutton|apple|carrot|potato|chicken|rabbit|cod|salmon/.test(k)).reduce((n, [, v]) => n + v, 0),
    blazesNear: near, blazesSeen: seen, blazesEnd: blz(end).length, hurts, decisions, turns, sas, lowAt,
    lastAsk: decisions.at(-1) ? round((death.t - decisions.at(-1).t) / 1000) : null,
  };
}

// What held a busy minute: the survival action or step most of it, the
// question answered in it.
function busyRows(spans) {
  const rows = [];
  for (const s of spans) for (const b of s.busy || []) {
    const doing = Object.entries(b.doing || {}).sort((x, y) => y[1] - x[1])[0]?.[0] || 'no step';
    rows.push({ world: s.world, port: s.port, from: b.from, botMs: b.botMs, pattern: b.pattern, why: b.why, doing, question: b.question, step: b.step });
  }
  return rows;
}

function main() {
  const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const since = Date.parse(opt('since', '2026-09-29T00:00:00Z')), to = Date.parse(opt('to', '')) || Infinity;
  const port = opt('port', null);
  const audit = require('./trials/progress-audit');
  let trials = audit.trialRecords({ since: since - 1, flight: FLIGHT }).filter(t => t.port && t.start < to);
  if (port) trials = trials.filter(t => String(t.port) === String(port));
  const byPort = new Map(), spans = [];
  for (const tr of trials) {
    if (!byPort.has(tr.port)) byPort.set(tr.port, BS.portFiles(tr.port));
    const end = Math.min(tr.end, to);
    const frames = BS.readTrial({ ...tr, end }, byPort.get(tr.port));
    if (!frames) continue;
    const m = BS.measure(frames, { trialStart: tr.start, end });
    if (m) spans.push({ world: tr.world, port: tr.port, end, ...m });
  }
  const deaths = [];
  for (const s of spans) for (const d of s.deaths) {
    if (d.dim !== 'nether') continue;
    const frames = windowFrames(s.port, d.t - WINDOW_MS, d.t + 500);
    deaths.push(deathWindow(frames, { ...d, world: s.world, port: s.port }));
  }
  report(deaths, busyRows(spans), { list: args.includes('--list'), options: args.includes('--options') });
  let scan = null;
  if (args.includes('--shields') || args.includes('--escapes')) {
    scan = spanScan(spans, deaths);
    if (args.includes('--shields')) shieldReport(scan, deaths);
    if (args.includes('--escapes')) escapeReport(scan, deaths);
  }
  const j = opt('json', null);
  if (j) fs.writeFileSync(j, JSON.stringify({ deaths, busy: busyRows(spans), ...(scan ? { breaks: scan.breaks, answers: scan.answers } : {}) }, null, 1));
}

function report(deaths, busy, { list = false, options = false } = {}) {
  console.log(`Nether deaths after a blaze was known: ${deaths.length}; carrying rods ${deaths.filter(d => d.rods > 0).length}, rods dropped ${deaths.reduce((n, d) => n + (d.rods || 0), 0)}`);
  console.log(`  by what killed: ${said(tally(deaths, d => d.killer))}`);
  console.log(`  by shape: ${said(tally(deaths, d => d.shape))}`);
  const bl = deaths.filter(d => d.killer === 'blaze' || d.killer === 'fire');
  console.log(`  blaze deaths ${bl.length}: no shield at -30 s ${bl.filter(d => !d.shield0).length}, shield lost by the death ${bl.filter(d => d.shield0 && !d.shieldEnd).length}; armour pieces ${said(tally(bl, d => d.armour))}; health at -30 s ${said(tally(bl, d => d.hp30 == null ? '?' : d.hp30 >= 16 ? '16+' : d.hp30 >= 8 ? '8-16' : 'under 8'))}; blazes within 16 at -5 s ${said(tally(bl, d => d.blazesNear >= 8 ? '8+' : d.blazesNear >= 4 ? '4-7' : '0-3'))}`);
  console.log(`  blaze deaths with no food that heals carried ${bl.filter(d => !d.food_items).length}; no blocks ${bl.filter(d => d.blocks < 6).length}; rods carried ${bl.filter(d => d.rods > 0).length} (${bl.reduce((n, d) => n + d.rods, 0)} rods)`);
  const qs = bl.flatMap(d => d.decisions.map(q => ({ ...q, d })));
  console.log(`  questions in the last 30 s of the blaze deaths: ${qs.length}; by question: ${said(tally(qs, q => q.id))}`);
  console.log(`  answers: ${said(tally(qs, q => `${q.id}→${q.chosen}`).slice(0, 30))}`);
  console.log(`  answered by family: ${said(tally(qs, q => familyOf(q.chosen)))}`);
  const offered = fam => bl.filter(d => d.decisions.some(q => q.families.includes(fam))).length;
  const chosen = fam => bl.filter(d => d.decisions.some(q => familyOf(q.chosen) === fam)).length;
  for (const fam of ['heal', 'out of the line', 'rods kept', 'attack', 'shield'])
    console.log(`  deaths whose last 30 s offered ${fam}: ${offered(fam)}, chose it: ${chosen(fam)}`);
  console.log(`  deaths with no question in the last 30 s: ${bl.filter(d => !d.decisions.length).length}; last question a median ${(() => { const a = bl.map(d => d.lastAsk).filter(v => v != null).sort((x, y) => x - y); return a[a.length >> 1]; })()} s before the death`);
  console.log(`  turn held most of the last 30 s: ${said(tally(bl, d => d.turns[0]?.[0] || '?'))}`);
  console.log(`  survival action most of the last 30 s: ${said(tally(bl, d => d.sas[0]?.[0] || '-'))}`);
  // Attacks chosen below a health, and the attack's price said.
  const lowAttack = qs.filter(q => familyOf(q.chosen) === 'attack' && q.hp < 12);
  console.log(`  attacks chosen under 12 health in the last 30 s: ${lowAttack.length} in ${new Set(lowAttack.map(q => q.d.t)).size} deaths`);
  if (list) for (const d of deaths) {
    console.log(`\n${d.world} ${d.port} ${new Date(d.t).toISOString()} rods ${d.rods}: ${d.killer}, ${d.shape}; hp ${d.hp30}→${d.hp15}→${d.hp5}; food ${d.food}; armour ${d.armour}; shield ${d.shield0}/${d.shieldEnd}; sword ${d.sword}; blocks ${d.blocks}; food items ${d.food_items}; blazes ${d.blazesNear} (${d.blazesSeen} seen); turn ${said(d.turns.slice(0, 3))}; sa ${said(d.sas.slice(0, 4))}`);
    console.log(`  hurts: ${d.hurts.map(h => `${hms(h.t).slice(3)} ${round(h.hp)} ${h.type}${h.cause ? '/' + h.cause : ''}`).join('; ')}`);
    for (const q of d.decisions) {
      console.log(`  ${hms(q.t)} hp ${round(q.hp)} ${q.id} → ${q.chosen} ${q.p != null ? q.p.toFixed(2) : ''}${q.noneGood ? ' (none good)' : ''} [${q.keys.join(' ')}]`);
      if (options) for (const k of q.keys.filter(k => ['heal', 'out of the line', 'rods kept'].includes(familyOf(k)) || k === q.chosen)) console.log(`      ${k}: ${q.words[k].slice(0, 260)}`);
    }
  }
  // Busy minutes.
  const mins = list => round(list.reduce((n, r) => n + r.botMs, 0) / MINUTE);
  console.log(`\nBusy-not-progressing minutes in the spans: ${mins(busy)}`);
  for (const pat of ['shelter sitting', 'stuck/unstuck', 'standing still']) {
    const rows = busy.filter(r => r.pattern === pat);
    const by = (f, n = 12) => { const t = {}; for (const r of rows) { const k = f(r); t[k] = (t[k] || 0) + r.botMs; } return Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${round(v / MINUTE)}`).join(', '); };
    console.log(`  ${pat} ${mins(rows)} min: held by ${by(r => r.doing)}`);
    console.log(`    question answered in them: ${by(r => r.question)}`);
    console.log(`    trials: ${by(r => `${r.world}`, 8)}`);
  }
}

// One read of every port's files over the spans' Nether frames: the
// shields' lives and the answers with what followed them.
const ANSWERED = /^(encounter_stance|hunt_target|body_way|empty_spawner|shot_answer)$/;
function spanScan(spans, deaths) {
  const breaks = [], answers = [];
  const t = { blocked: 0, landedUp: 0, landedDown: 0, withMs: 0, withoutMs: 0 };
  for (const port of [...new Set(spans.map(s => s.port))]) {
    const sp = spans.filter(s => s.port === port);
    const spanOf = at => sp.find(s => at >= s.start && at <= s.end);
    for (const { f } of BS.portFiles(port)) {
      let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
      const fr = [];
      for (const line of text.split('\n')) {
        if (!line || !line.includes('nether')) continue;
        const at = frameAt(line), s0 = spanOf(at);
        if (!s0) continue;
        let x; try { x = JSON.parse(line); } catch (_) { continue; }
        if (!/nether/.test(x.snapshot?.dimension || '')) continue;
        fr.push({ t: at, x, world: s0.world });
      }
      text = null;
      // Shields.
      let last, lastT = null, blocked = 0, landed = 0, since = null, inv = null;
      for (const { t: at, x, world } of fr) {
        const s = x.snapshot || {};
        if (x.kind === 'observation' && s.inventory) inv = s.inventory;
        const o = s.equipment ? s.equipment.offhand : undefined;
        if (lastT !== null && at - lastT < 5000 && last !== undefined) { if (last === 'shield') t.withMs += at - lastT; else t.withoutMs += at - lastT; }
        if (o !== undefined) {
          if (last === 'shield' && o !== 'shield' && s.health > 0 && !(inv?.shield > 0)) {
            const n = re => Object.entries(inv || {}).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0);
            breaks.push({ port, world, t: at, blocked, landed, hp: s.health, lifeS: since ? Math.round((at - since) / 1000) : null, iron: inv?.iron_ingot || 0, planks: n(/_planks$/), wood: n(/_(log|stem)$/), table: inv?.crafting_table || 0, rods: inv?.blaze_rod || 0,
              deadIn2: deaths.some(d => d.port === port && d.t > at && d.t <= at + 2 * MINUTE), deadIn5: deaths.some(d => d.port === port && d.t > at && d.t <= at + 5 * MINUTE) });
          }
          if (o === 'shield' && last !== 'shield') { blocked = 0; landed = 0; since = at; }
          last = o;
        }
        lastT = at;
        if (x.kind === 'shot' && /fireball/.test(x.detail?.name || '')) {
          if (x.detail.landed === false && x.detail.shield === 'up') { t.blocked++; blocked++; }
          else if (x.detail.landed) { landed++; if (/up|rising/.test(x.detail.shield || '')) t.landedUp++; else t.landedDown++; }
        }
      }
      // Answers and what followed.
      for (let i = 0; i < fr.length; i++) {
        const { t: at, x } = fr[i], d = x.snapshot.decision;
        if (x.kind !== 'decision' || !d || d.stale || !ANSWERED.test(d.id)) continue;
        const chosen = (d.path || []).filter(k => k !== 'list').at(-1);
        const hp0 = d.state?.health ?? x.snapshot.health;
        let noRoute = false, failed = null, hpMin = hp0;
        for (let j = i + 1; j < fr.length && fr[j].t <= at + 10000; j++) {
          const y = fr[j];
          if (y.t <= at + 2500 && y.x.kind === 'no_route') noRoute = true;
          if (typeof y.x.snapshot?.health === 'number') hpMin = Math.min(hpMin, y.x.snapshot.health);
          const e = y.x.snapshot?.decision;
          if (e && !e.stale && y.t > at + 50 && e.id === d.id && failed === null) { failed = (e.state?.failedHereJustNow || []).find(z => z.choice === chosen)?.why || false; }
        }
        answers.push({ port, t: at, id: d.id, chosen, hp: hp0, noRoute, failed: failed || null, lost10: hp0 - hpMin, died: deaths.some(z => z.port === port && z.t > at && z.t <= at + 10000) });
      }
    }
  }
  return { breaks, answers, totals: t };
}
function shieldReport({ breaks, totals: t }, deaths) {
  const med = a => { const b = a.filter(v => v != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
  console.log(`\nShields broken in the spans' Nether (in the off hand, then gone with none carried): ${breaks.length}; the bot dead within two minutes ${breaks.filter(b => b.deadIn2).length}, within five ${breaks.filter(b => b.deadIn5).length}`);
  console.log(`  a shield's life there: a median ${round(med(breaks.map(b => b.lifeS)) / 60)} minutes, ${med(breaks.map(b => b.blocked))} fireballs met with it up; at the break an iron ingot carried ${breaks.filter(b => b.iron > 0).length}, rods carried ${breaks.filter(b => b.rods > 0).length}`);
  const bl = deaths.filter(d => d.killer === 'blaze' || d.killer === 'fire');
  const w = bl.filter(d => d.shieldEnd).length, wo = bl.length - w;
  console.log(`  bot-minutes with a shield in hand ${round(t.withMs / MINUTE)}, without ${round(t.withoutMs / MINUTE)}; blaze deaths with one ${w} (${round(w / (t.withMs / MINUTE) * 60)} a bot-hour), without ${wo} (${round(wo / (t.withoutMs / MINUTE) * 60)} a bot-hour); of those without, broken in the last 30 s ${bl.filter(d => d.shield0 && !d.shieldEnd).length}`);
  console.log(`  fireballs met: blocked ${t.blocked}, landed with the shield up or rising ${t.landedUp}, landed with it down or none ${t.landedDown}`);
}
const ESCAPES = /^(leave_and_heal|step_out_and_eat|out_of_sight|back_to_wall|corner_ambush|take_cover|retreat|eat|out_of_their_line|box_here|rise_to_strike|leave_reach)$/;
function escapeReport({ answers }, deaths) {
  const cut = (k, from) => answers.filter(a => a.t >= from && a.id === 'encounter_stance' && ESCAPES.test(a.chosen));
  for (const from of [-Infinity, Date.parse('2026-10-01T00:00:00Z')]) {
    const l = cut(null, from), f = l.filter(a => a.failed);
    console.log(`\nWays out of the fire or to heal chosen in encounter_stance${from > 0 ? ` since ${new Date(from).toISOString().slice(0, 16)}Z` : ''}: ${l.length}, failed at once ${f.length}: ${said(tally(l, a => a.chosen).map(([k, v]) => [`${k} ${l.filter(a => a.chosen === k && a.failed).length}/`, v]))}`);
    console.log(`  the walk did not get there: ${f.filter(a => /did not get there|ended [\d.]+ blocks short|No route|noPath|navigation timed out/.test(a.failed)).length}; a block not carried: ${f.filter(a => /Need more/.test(a.failed)).length}`);
  }
  const bl = deaths.filter(d => d.killer === 'blaze' || d.killer === 'fire');
  const near = bl.filter(d => answers.some(a => a.port === d.port && a.t >= d.t - WINDOW_MS && a.t <= d.t && a.failed && ESCAPES.test(a.chosen)));
  console.log(`  blaze deaths with a way out that failed at once in their last 30 s: ${near.length} of ${bl.length}`);
}

if (require.main === module) main();
module.exports = { deathWindow, killerOf, familyOf, busyRows, spanScan };
