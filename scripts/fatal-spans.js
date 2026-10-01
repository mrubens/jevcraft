#!/usr/bin/env node
'use strict';
// The Overworld deaths on fresh trials and their last seconds (note 793):
// every death `overworld-deaths.js` finds in the window, those in a Jev-down
// spell (scripts/lib/jev-down.js evidence in the minute before) counted
// apart, and for each of the rest:
//   - what killed it: a creeper's blast; a melee crowd (two or more that
//     bite within four blocks in the last ten seconds); one that bites; a
//     shooter (skeleton, pillager, witch); lava or fire; water; the event
//     loop held five seconds or more in the last thirty (the bot's log's
//     [lag]); else other;
//   - where: the surface (y 56 and up), underground (0 to 56), deep (under 0);
//   - how fast: seconds from the last frame at 14 health or more to the
//     death, and the questions answered between;
//   - the health 30, 20, 10 and 5 seconds before; hunger, and whether health
//     came back at it (18 or more) or food was carried;
//   - the last encounter_stance answered: the way, the health then, its own
//     price (expects) and the health its hold gave way at under the rule then
//     (its price's pace and one blow, or six health with no price) and under
//     note 793's (that, or half the health it was chosen at, whichever first);
//   - every encounter_stance question in the last minute whose retreat said
//     "No way found yet" or "No way out", and the way back along the bot's
//     own footing of the three minutes before (src/way-back.js find, on the
//     positions the frames carry, the mobs where the frames put them).
// Then the replays: (1) the ways back on offer; (2) the holds' damage ends,
// rule then against note 793's; (3) together: deaths with a way back found
// at a question asked or at the re-ask note 793's hold would have made.
//   node scripts/fatal-spans.js [--since ISO] [--to ISO] [--json] [--examples]
//   node scripts/fatal-spans.js --answers [--since ISO] [--to ISO] [--json]
// --answers: every Overworld stance answer, by what the retreat said, what
// was chosen and what followed, and the ways back where it said none.
// JEV_ROOT reads another checkout's records (from a worktree). Read-only.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const since = arg('--since', '2026-09-30T06:00:00Z');
const to = arg('--to', new Date().toISOString());
const asJson = argv.includes('--json'), examples = argv.includes('--examples');
const DIR = path.join(ROOT, '.bot-state', 'flight');
const JD = require('./lib/jev-down');
const WB = require('../src/way-back');

const r1 = n => n == null || !Number.isFinite(+n) ? null : Math.round(n * 10) / 10;
const med = a => { const b = a.filter(x => x != null && Number.isFinite(x)).sort((x, y) => x - y); return b.length ? r1(b[b.length >> 1]) : null; };
const BITERS = /^(zombie|husk|drowned|zombie_villager|spider|cave_spider|silverfish|slime|enderman|vindicator|piglin|piglin_brute|zoglin|hoglin|endermite|magma_cube|wolf)$/;
const SHOOTERS = /^(skeleton|stray|bogged|pillager|witch|blaze|ghast|parched)$/;
const STANCE_HEALTH = 6, LAG_S = 5, CROWD_MS = 10000, SPAN_MS = 60000, TRAIL_MS = WB.TRAIL_MS;
const HEALS = /^(cooked_|bread|apple|golden_apple|golden_carrot|carrot|baked_potato|beetroot|melon_slice|sweet_berries|glow_berries|mushroom_stew|rabbit_stew|beetroot_soup|pumpkin_pie|cookie|dried_kelp|honey_bottle|beef|porkchop|mutton|rabbit|cod|salmon|potato)$/;

// The hold's health line: what it was asked again at, the rule then (its
// price's pace and one blow, or six with none) and note 793's (that, or
// half the health it was chosen at, whichever is less).
function allowance(h0, ex, elapsed) {
  const then = ex ? ex.damage * Math.min(elapsed, ex.seconds) / Math.max(0.1, ex.seconds) + (ex.oneHit || 0) : STANCE_HEALTH;
  return { then, now: Math.min(then, h0 / 2) };
}

function lagOf(world, t0, t1) {
  if (!world) return null;
  let text = null;
  for (const f of [`midgame-${world}.log`, `midgame-${world}.log.gz`]) {
    try { const b = fs.readFileSync(path.join(ROOT, 'artifacts', f)); text = f.endsWith('.gz') ? zlib.gunzipSync(b).toString('utf8') : b.toString('utf8'); break; } catch (_) { /* next */ }
  }
  if (text == null) return null;
  let s = 0;
  for (const m of text.matchAll(/^\[lag\] event loop held ([\d.]+)s \{.*?"at":"([^"]+)"/gm)) { const at = Date.parse(m[2]); if (at >= t0 && at <= t1 + 1000) s += +m[1]; }
  return r1(s);
}

const readFrames = (() => {
  let file = null, frames = null;
  return f => {
    if (f === file) return frames;
    file = f;
    frames = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(Boolean).map(l => { try { const r = JSON.parse(l); r.t = Date.parse(r.at); return r; } catch (_) { return null; } }).filter(r => r && Number.isFinite(r.t));
    return frames;
  };
})();

const mobsAt = (frames, t) => {
  let mobs = null;
  for (const r of frames) { if (r.t > t + 500) break; if (r.snapshot?.mobs?.length && r.snapshot.mobs[0].at) mobs = r.snapshot.mobs; }
  return (mobs || []).filter(m => m.at && m.d <= 24 && m.name !== 'bat').map(m => ({ name: m.name, x: m.at.x, y: m.at.y, z: m.at.z, d: m.d }));
};
// The trail the frames give up to `t`: each on-ground position, loops cut
// as way-back.js keeps it on the bot.
function trailAt(frames, t) {
  const trail = { cells: [] };
  for (const r of frames) {
    if (r.t > t) break;
    if (r.t < t - TRAIL_MS) continue;
    const p = r.snapshot?.position;
    if (!p || r.snapshot.onGround === false || r.snapshot.dimension && r.snapshot.dimension !== 'overworld') continue;
    WB.noteCell(trail, WB.feetOf(p), r.t);
  }
  return trail;
}
const wayBackAt = (frames, t, here) => {
  const mobs = mobsAt(frames, t);
  return WB.find(trailAt(frames, t), here, mobs, { now: t, explain: true, coarse: true });
};

function classOf(d, f) {
  const k = d.kind || '';
  if (f.lag >= LAG_S && !/creeper|lava|burn|drown|fall/.test(k)) return 'event loop held';
  if (/creeper/.test(k) || /explosion/.test(d.cause || '')) return 'creeper';
  if (/^(lava|burning)$/.test(k)) return 'lava or fire';
  if (/^(drowning)$/.test(k) || (k === 'drowned' && f.crowd < 2)) return 'water';
  if (SHOOTERS.test(k)) return 'shooter';
  if (BITERS.test(k)) return f.crowd >= 2 ? 'melee crowd' : 'one that bites';
  return 'other';
}

function deathSpan(d) {
  const end = Date.parse(d.at);
  const frames = readFrames(d.file).filter(r => r.t >= end - TRAIL_MS - SPAN_MS && r.t <= end + 200);
  const span = frames.filter(r => r.t >= end - SPAN_MS);
  // Jev down in the minute before: the death is its own class (note 781).
  const jevDown = span.some(r => r.t <= end && JD.evidenceOf(r)?.down);
  const hpAt = s => { let h = null; for (const r of span) { if (r.t > end - s * 1000) break; if (r.snapshot?.health != null) h = r.snapshot.health; } return r1(h); };
  let crowd = 0;
  for (const r of span) if (r.t >= end - CROWD_MS && r.t <= end) crowd = Math.max(crowd, (r.snapshot?.mobs || []).filter(m => BITERS.test(m.name) && m.d <= 4).length);
  let high = null;
  for (const r of frames) { if (r.t >= end) break; if ((r.snapshot?.health ?? 0) >= 14) high = r.t; }
  const decs = frames.filter(r => r.kind === 'decision' && r.snapshot?.decision?.path?.length && r.t <= end);
  const answered = decs.filter(r => r.t > (high ?? end - TRAIL_MS) && r.snapshot.decision.id !== 'turn_priority');
  const inv = [...span].reverse().find(r => r.snapshot?.inventory && typeof r.snapshot.inventory === 'object')?.snapshot.inventory || {};
  const hunger = [...span].reverse().find(r => r.snapshot?.food != null)?.snapshot.food ?? null;
  const food = Object.keys(inv).filter(k => HEALS.test(k));
  const f = { lag: lagOf(d.world, end - 30000, end) ?? 0, crowd };
  // The last stance and its hold's damage end, then and by note 793.
  const st = decs.filter(r => r.snapshot.decision.id === 'encounter_stance' && r.t >= end - SPAN_MS).at(-1);
  let hold = null;
  if (st) {
    const dd = st.snapshot.decision, choice = dd.path[0], ex = dd.options?.[choice]?.expects || null;
    const h0 = dd.state?.health ?? st.snapshot.health, next = decs.find(r => r.t > st.t && r.snapshot.decision.id === 'encounter_stance');
    let thenAt = null, nowAt = null;
    for (const r of frames) {
      if (r.t <= st.t || r.t > end || r.snapshot?.health == null) continue;
      const a = allowance(h0, ex, (r.t - st.t) / 1000), lost = h0 - r.snapshot.health;
      if (!thenAt && lost > a.then) thenAt = { t: r.t, health: r1(r.snapshot.health) };
      if (!nowAt && lost > a.now) nowAt = { t: r.t, health: r1(r.snapshot.health) };
    }
    hold = { choice, health: r1(h0), secondsBefore: r1((end - st.t) / 1000), priced: ex ? r1(ex.damage) : null, pricedSeconds: ex ? r1(ex.seconds) : null,
      pricedPastHealth: !!ex && ex.damage >= h0, then: thenAt && { health: thenAt.health, secondsBefore: r1((end - thenAt.t) / 1000) },
      now: nowAt && { health: nowAt.health, secondsBefore: r1((end - nowAt.t) / 1000) }, t: st.t, here: st.snapshot.position || null };
  }
  // The ways back at the questions whose retreat said no way.
  const noWay = [];
  for (const q of decs.filter(r => r.snapshot.decision.id === 'encounter_stance' && r.t >= end - SPAN_MS)) {
    const rt = q.snapshot.decision.options?.retreat, desc = typeof rt?.description === 'string' ? rt.description : '';
    if (!rt || !/No way out|No way found yet|Nowhere to run to/.test(desc)) continue;
    const here = q.snapshot.position;
    if (!here) continue;
    const way = wayBackAt(frames, q.t, here);
    noWay.push({ secondsBefore: r1((end - q.t) / 1000), health: r1(q.snapshot.decision.state?.health ?? q.snapshot.health), chose: (q.snapshot.decision.path || []).join('/'),
      said: /No way out/.test(desc) ? 'no way out' : /Nowhere/.test(desc) ? 'nowhere to run' : 'no way found yet', retreatSaid: desc.match(/ (No way found yet|No way out|Nowhere to run to)[^.]*\./)?.[0]?.trim() || null,
      way: way && !way.none ? { blocks: way.blocks, gain: way.gain, cells: way.cells.length, secondsAgo: way.secondsAgo, says: WB.says(way).trim() } : null, why: way?.none ? way.why : null });
  }
  // At note 793's re-ask (the hold's new line reached before the rule then
  // and before the next stance question): a way back from there?
  let reask = null;
  if (hold?.now && (!hold.then || hold.now.secondsBefore > hold.then.secondsBefore)) {
    const t = Date.parse(d.at) - hold.now.secondsBefore * 1000;
    const nextQ = decs.find(r => r.t > hold.t && r.snapshot.decision.id === 'encounter_stance');
    if (!nextQ || nextQ.t > t + 500) {
      const here = [...frames].reverse().find(r => r.t <= t && r.snapshot?.position)?.snapshot.position;
      const way = here ? wayBackAt(frames, t, here) : null;
      reask = { health: hold.now.health, secondsBefore: hold.now.secondsBefore, way: way && !way.none ? { blocks: way.blocks, gain: way.gain } : null, why: way?.none ? way.why : null };
    }
  }
  if (hold) { delete hold.t; delete hold.here; }
  const y = d.position?.y;
  return { jevDown, at: d.at, port: d.port, world: d.world, cause: d.cause, kind: d.kind, cls: classOf(d, f), y: r1(y), place: y == null ? null : y < 0 ? 'deep' : y >= 56 ? 'surface' : 'underground', night: d.night,
    armour: (d.atFatalMinute?.armour || []).length, deathsBefore: d.deathsBefore, health: { s30: hpAt(30), s20: hpAt(20), s10: hpAt(10), s5: hpAt(5) }, crowd, lag: f.lag,
    fromHigh: high ? r1((end - high) / 1000) : null, answered: answered.length, hunger, heals: hunger != null && hunger >= 18, food,
    hold, noWay, reask };
}

function summarize(rows) {
  const n = (a, p) => a.filter(p).length;
  const by = k => Object.entries(rows.reduce((o, r) => { o[r[k]] = (o[r[k]] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]);
  const fast = n(rows, r => r.fromHigh != null && r.fromHigh <= 10), slow = n(rows, r => r.fromHigh == null || r.fromHigh > 30);
  const noWayDeaths = rows.filter(r => r.noWay.length), wayDeaths = noWayDeaths.filter(r => r.noWay.some(q => q.way));
  const qs = rows.flatMap(r => r.noWay), qWay = qs.filter(q => q.way);
  const held = rows.filter(r => r.hold);
  const neverThen = held.filter(r => !r.hold.then), pastHealth = held.filter(r => r.hold.pricedPastHealth);
  const earlier = held.filter(r => r.hold.now && (!r.hold.then || r.hold.now.secondsBefore > r.hold.then.secondsBefore));
  const reasked = rows.filter(r => r.reask);
  const covered = rows.filter(r => r.noWay.some(q => q.way) || r.reask?.way);
  return {
    deaths: rows.length, byClass: by('cls'), byPlace: by('place'),
    byClassAndPlace: Object.entries(rows.reduce((o, r) => { const k = `${r.cls} · ${r.place}`; o[k] = (o[k] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]),
    fastWithin10s: fast, slowOver30s: slow,
    slowHungerUnder18: n(rows.filter(r => r.fromHigh == null || r.fromHigh > 30), r => !r.heals), slowNoHealingFood: n(rows.filter(r => r.fromHigh == null || r.fromHigh > 30), r => !r.heals && !r.food.length),
    retreatNoWay: { deaths: noWayDeaths.length, questions: qs.length, deathsWithWayBack: wayDeaths.length, questionsWithWayBack: qWay.length, medianBlocks: med(qWay.map(q => q.way.blocks)), medianGain: med(qWay.map(q => q.way.gain)), medianHealth: med(qWay.map(q => q.health)),
      whyNone: Object.entries(qs.filter(q => !q.way).reduce((o, q) => { const k = String(q.why || '').replace(/passes the [a-z ]+ [\d.]+ blocks off/, 'passes a mob'); o[k] = (o[k] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]) },
    holds: { lastStanceInSpan: held.length, endNeverReachedThen: neverThen.length, pricedPastHealth: pastHealth.length, endEarlierNow: earlier.length,
      medianSecondsEarlier: med(earlier.map(r => r.hold.now.secondsBefore - (r.hold.then?.secondsBefore ?? 0))), medianHealthAtNewEnd: med(earlier.map(r => r.hold.now.health)), medianSecondsBeforeDeathAtNewEnd: med(earlier.map(r => r.hold.now.secondsBefore)),
      reaskedBeforeAnyQuestion: reasked.length, reaskWithWayBack: n(reasked, r => r.reask.way) },
    covered: covered.length,
  };
}

// Every Overworld encounter_stance answer in the window (Jev up, any trial):
// what the retreat said (a way found, no way found yet, no way out), what
// was chosen, what followed in the next ten seconds (health lost, 6 or more,
// a death, how far the bot got from where it was asked), and, where the
// retreat said no way, whether a way back along its own footing was there.
async function answersRecord() {
  const readline = require('readline');
  const t0 = Date.parse(since), t1 = Date.parse(to), W = 10000;
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).filter(f => fs.statSync(path.join(DIR, f)).mtimeMs >= t0).sort();
  const rows = [];
  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(DIR, f)), crlfDelay: Infinity });
    const open = [], trail = { cells: [] };
    let mobs = [], down = false;
    for await (const line of rl) {
      if (!line) continue;
      const i = line.lastIndexOf('"at":"'), t = i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6)));
      if (!(t >= t0 - TRAIL_MS && t <= t1 + W)) continue;
      const decision = line.startsWith('{"kind":"decision"');
      const cheap = !decision && !line.includes('"mobs":[{') && !line.includes('"jevDown"') && !line.startsWith('{"kind":"jev_');
      let r = null;
      if (!cheap) { try { r = JSON.parse(line); } catch (_) { continue; } }
      const s = r?.snapshot || {};
      const hm = /"health":(-?[\d.]+)/.exec(line), pm = /"position":\{"x":(-?[\d.]+),"y":(-?[\d.]+),"z":(-?[\d.]+)\}/.exec(line);
      const ground = !/"onGround":false/.test(line), overworld = !/"dimension":"(the_nether|the_end)"/.test(line);
      if (r) { const e = JD.evidenceOf(r); if (e?.down) down = true; else if (e?.back) down = false; }
      if (pm && ground && overworld) WB.noteCell(trail, WB.feetOf({ x: +pm[1], y: +pm[2], z: +pm[3] }), t);
      if (s.mobs?.[0]?.at) mobs = s.mobs.filter(m => m.at && m.d <= 24 && m.name !== 'bat').map(m => ({ name: m.name, x: m.at.x, y: m.at.y, z: m.at.z }));
      for (const o of open) if (t - o.t <= W) { if (hm) o.low = Math.min(o.low, +hm[1]); if (pm) o.far = Math.max(o.far, Math.hypot(pm[1] - o.p.x, pm[3] - o.p.z)); if (hm && +hm[1] <= 0) o.died = true; }
      while (open.length && t - open[0].t > W) open.shift();
      if (!decision || t < t0 || t > t1 || down) continue;
      const d = s.decision;
      if (d?.id !== 'encounter_stance' || !d.path?.length || String(d.state?.dimension || '') !== 'overworld' || !s.position) continue;
      const desc = typeof d.options?.retreat?.description === 'string' ? d.options.retreat.description : null;
      const said = desc == null ? 'none' : /No way found yet/.test(desc) ? 'no way found yet' : /No way out|Nowhere to run/.test(desc) ? 'no way out' : /A way is found/.test(desc) ? 'a way found' : 'other';
      const h = d.state?.health ?? s.health;
      const row = { t, said, chose: d.path[0], h, low: h, far: 0, died: false, p: s.position };
      if (/^no way/.test(said)) { const w = WB.find(trail, s.position, mobs, { now: t, coarse: true }); row.back = !!w?.end; }
      rows.push(row); open.push(row);
    }
  }
  const group = (list) => ({ answers: list.length, lost6: list.filter(r => r.h - r.low >= 6).length, died: list.filter(r => r.died).length, got6: list.filter(r => r.far >= 6).length, meanLost: r1(list.reduce((n, r) => n + (r.h - r.low), 0) / Math.max(1, list.length)) });
  const out = {};
  for (const said of ['a way found', 'no way found yet', 'no way out']) {
    const l = rows.filter(r => r.said === said);
    out[said] = { answers: l.length, retreat: group(l.filter(r => r.chose === 'retreat')), other: group(l.filter(r => r.chose !== 'retreat')), ...(/^no way/.test(said) ? { wayBack: l.filter(r => r.back).length } : {}) };
  }
  if (asJson) { console.log(JSON.stringify({ since, to, answers: rows.length, out }, null, 2)); return; }
  console.log(`Overworld encounter_stance answers ${since} to ${to}, Jev up: ${rows.length}.`);
  for (const [said, o] of Object.entries(out)) console.log(`  retreat said ${said}: ${o.answers}; retreat chosen ${o.retreat.answers} (in the 10 s after: 6+ lost ${o.retreat.lost6}, died ${o.retreat.died}, 6+ blocks got ${o.retreat.got6}); others ${o.other.answers} (6+ lost ${o.other.lost6}, died ${o.other.died}, 6+ blocks got ${o.other.got6})${o.wayBack != null ? `; a way back along its own footing at ${o.wayBack}` : ''}.`);
}

function main() {
  if (argv.includes('--answers')) return answersRecord();
  const out = execFileSync(process.execPath, [path.join(__dirname, 'overworld-deaths.js'), '--json', '--since', since, '--to', to], { env: { ...process.env, JEV_ROOT: ROOT }, maxBuffer: 1 << 28 }).toString();
  const deaths = JSON.parse(out).deaths.filter(d => !/stages\//.test(d.source || ''));
  const rows = deaths.map(deathSpan);
  const up = rows.filter(r => !r.jevDown), down = rows.filter(r => r.jevDown);
  const result = { since, to, jevDown: { deaths: down.length, afterAnEarlierDeath: down.filter(r => r.deathsBefore).length }, firstDeathsOnly: summarize(up.filter(r => !r.deathsBefore)), all: summarize(up), rows: up };
  if (asJson) { console.log(JSON.stringify(result, null, 2)); return; }
  const s = result.all;
  console.log(`Overworld deaths on fresh trials ${since} to ${to}: ${rows.length}; in a Jev-down spell ${down.length} (apart, note 781); Jev up ${up.length} (${up.filter(r => r.deathsBefore).length} after an earlier death in the trial).`);
  console.log(`By what killed: ${s.byClass.map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  console.log(`By place: ${s.byPlace.map(([k, v]) => `${k} ${v}`).join(', ')}. Shapes: ${s.byClassAndPlace.slice(0, 10).map(([k, v]) => `${k} ${v}`).join('; ')}.`);
  console.log(`From 14 health or more to the death: within 10 s ${s.fastWithin10s}; over 30 s ${s.slowOver30s} (hunger under 18 in ${s.slowHungerUnder18}, and nothing that heals carried in ${s.slowNoHealingFood}).`);
  const w = s.retreatNoWay;
  console.log(`Retreat said no way at a stance question in the last minute: ${w.deaths} deaths, ${w.questions} questions; a way back along its own footing at ${w.questionsWithWayBack} of them, in ${w.deathsWithWayBack} deaths (median ${w.medianBlocks} blocks, ${w.medianGain} further from every mob, at ${w.medianHealth} health). None: ${w.whyNone.slice(0, 6).map(([k, v]) => `${k} ${v}`).join('; ')}.`);
  const h = s.holds;
  console.log(`Holds: the last stance in the minute ${h.lastStanceInSpan}; its damage end never reached by the rule then ${h.endNeverReachedThen} (priced at or past the health it was chosen at ${h.pricedPastHealth}); reached sooner by note 793's ${h.endEarlierNow} (median ${h.medianSecondsEarlier} s sooner, at ${h.medianHealthAtNewEnd} health, ${h.medianSecondsBeforeDeathAtNewEnd} s before the death); asked again there before any other stance question ${h.reaskedBeforeAnyQuestion}, a way back from there ${h.reaskWithWayBack}.`);
  console.log(`Covered (a way back at a question asked or at note 793's re-ask): ${s.covered} of ${s.deaths}. First deaths only: ${result.firstDeathsOnly.covered} of ${result.firstDeathsOnly.deaths}.`);
  if (examples) for (const r of up.filter(x => x.noWay.some(q => q.way)).slice(0, 12)) {
    const q = r.noWay.find(x => x.way);
    console.log(`\n${r.at} ${r.port} ${r.world} ${r.cls} y ${r.y}: ${q.secondsBefore} s before, ${q.health} health, ${q.chose}.\n  said:  ${q.retreatSaid}\n  after: ${q.way.says}`);
  }
}

main();
