#!/usr/bin/env node
'use strict';
// Overworld deaths in the flight records (note 772): every death whose body
// was in the Overworld, with what killed it (the last hurt within ten
// seconds: a mob by kind, a fall, lava, drowning, suffocation), how far into
// its trial it came (artifacts/midgame/*.json, the trial's start) and into
// its connection, where it stood (y, underground by the last question's
// own state or by blocks to open sky, dark), the hour (timeOfDay of the
// last question or of the join survey, carried on at 20 ticks a second),
// the health, food, armor, shield, weapon and blocks carried at the start
// of the fatal minute, the work under way then (the goal's step and the
// survival action), the questions asked in the last 60 seconds with their
// answers and options, and whether a safer option was on offer: one whose
// own words priced the next fifteen seconds below the chosen one's and
// below the health then, with its text. Shapes are ranked by count.
//
//   node scripts/overworld-deaths.js [--since 2026-09-30T12:00Z] [--to ISO]
//        [--split 2026-10-01T00:41:25Z] [--port N] [--json] [--verbose]
//   node scripts/overworld-deaths.js --creepers [--since ...] [--to ...] [--json]
// --split counts each shape before and after a deploy.
// --creepers: every encounter_stance answered in the Overworld with a
// creeper within three blocks in the question's own state (the nearest
// threat's distance), by the stance answered: how many were followed within
// CREEPER_WINDOW_MS by a hurt from a creeper's blast before another stance
// answer, the health the blast took, and how many of those ended in the
// death; and the bot's distance from where it was answered a second on
// (the src/creeper-record.js figures, note 772).
// JEV_ROOT reads another checkout's records (from a worktree).
// Read-only.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
process.env.JEV_ROOT = ROOT;
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('--since', '2026-09-30T12:00:00Z'));
const to = arg('--to', null) ? Date.parse(arg('--to')) : Infinity;
const split = arg('--split', null) ? Date.parse(arg('--split')) : null;
const onlyPort = arg('--port', null);
const asJson = argv.includes('--json');
const verbose = argv.includes('--verbose');
const DIR = path.join(ROOT, '.bot-state', 'flight');
const CAUSE_MS = 10000, RING_MS = 75000, FATAL_MS = 60000;
const round = (n, d = 1) => n == null || !Number.isFinite(+n) ? null : Math.round(n * 10 ** d) / 10 ** d;

// What killed it, from the hurt's label ("hurt: mob attack by zombie",
// "hurt: arrow by skeleton", "hurt: player explosion by creeper", ...).
function causeOf(label) {
  const l = String(label || '').replace(/^hurt: /, '');
  const by = l.match(/ by (\w+)/)?.[1];
  if (/explosion/.test(l)) return by ? `${by} (blast)` : 'explosion';
  if (by) return /arrow/.test(l) ? `${by} (arrow)` : by;
  if (l === 'in wall') return 'suffocation';
  if (l === 'drown') return 'drowning';
  if (/^(lava|on fire|in fire|hot floor)$/.test(l)) return l === 'lava' ? 'lava' : 'burning';
  return l || 'unknown';
}
const kindOf = cause => /^(zombie|husk|drowned|zombie_villager|spider|cave_spider|skeleton|stray|creeper|witch|enderman|slime|silverfish|pillager|vindicator|phantom|bogged)/.test(cause)
  ? cause.replace(/ \(.*\)$/, '') : cause;

// "About 3.9 damage from the mobs here in the next fifteen seconds"
const DAMAGE = /About ([\d.]+) damage from the mobs here in the next fifteen seconds/;
const damageSaid = text => { const m = String(text || '').match(DAMAGE); return m ? +m[1] : null; };
const descOf = o => typeof o?.description === 'string' ? o.description : o?.description ? JSON.stringify(o.description) : '';
const flatOptions = (opts, pre = []) => Object.entries(opts || {}).flatMap(([k, o]) => o?.children ? flatOptions(o.children, [...pre, k]) : [[[...pre, k].join('/'), descOf(o)]]);

function compact(r, t) {
  const s = r.snapshot || {};
  const f = { t, kind: r.kind, label: r.label, pos: s.position || null, health: s.health, food: s.food, dim: s.dimension || null,
    step: s.step?.action || s.goal?.step?.action || null, phase: s.step?.phase || s.goal?.step?.phase || null,
    sa: s.survivalAction?.action || s.goal?.survivalAction?.action || null, turn: s.turn ? `${s.turn.holder}${s.turn.phase ? ':' + s.turn.phase : ''}` : null };
  if (Array.isArray(s.mobs)) f.mobs = s.mobs.slice(0, 8).map(m => ({ name: m.name, d: m.d, seen: m.seen }));
  if (r.kind === 'decision' && s.decision?.id) {
    const d = s.decision, w = d.judgments?.[0]?.probabilities || {};
    f.decision = { id: d.id, path: d.path || [], at: d.at, noneGood: !!d.noneGood, only: !!d.only, weights: w, options: flatOptions(d.options), state: d.state || {} };
  }
  return f;
}

async function readFile(file, out, trials) {
  const name = path.basename(file), port = name.match(/-(\d{5})-Jev-/)?.[1] || '?';
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const ring = [];
  let lastHurt = null, connectedAt = null, kit = null, join = null, lastState = null, lastTod = null;
  for await (const line of rl) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    const t = Date.parse(r.at);
    if (!Number.isFinite(t)) continue;
    const s = r.snapshot || {};
    if (r.kind === 'connection' && s.connected !== false) connectedAt = connectedAt && t - connectedAt < 1000 ? connectedAt : t;
    if (s.equipment || s.inventory) kit = { t, equipment: s.equipment || kit?.equipment || {}, inventory: s.inventory && typeof s.inventory === 'object' ? s.inventory : kit?.inventory || {} };
    if (r.kind === 'join_survey') join = { t, ...(r.detail || {}) };
    if (r.kind === 'decision' && s.decision?.state) {
      lastState = { t, state: s.decision.state };
      if (s.decision.state.timeOfDay != null) lastTod = { t, tod: s.decision.state.timeOfDay };
    }
    if (r.kind === 'join_survey' && r.detail?.timeOfDay != null) lastTod = { t, tod: r.detail.timeOfDay };
    if (t < since - RING_MS || t > to) continue;
    const c = compact(r, t);
    ring.push(c); while (ring.length && ring[0].t < t - RING_MS) ring.shift();
    if (r.kind === 'damage') lastHurt = { label: r.label, t, health: s.health };
    const died = (r.kind === 'danger' && s.health === 0) || (r.kind === 'connection' && r.detail?.reason === 'Respawning after death');
    if (!died || t < since) continue;
    // One death, not two: the danger frame and the respawn's connection,
    // or a new file's first frames, with no hurt since the last.
    const prior = out.lastDeath[port];
    if (prior && t - prior < 60000 && !(lastHurt && lastHurt.t > prior)) continue;
    out.lastDeath[port] = t;
    const dim = String(s.dimension || ring.filter(f => f.dim).at(-1)?.dim || '').replace(/^minecraft:/, '');
    if (dim !== 'overworld') { out.other.push({ port, at: r.at, dim }); continue; }
    if (onlyPort && port !== onlyPort) continue;
    const scene = sceneOf({ port, file: name, t, at: r.at, ring: ring.slice(), lastHurt, connectedAt, kit, join, lastState, lastTod, trials });
    if (scene) out.deaths.push(scene);
  }
}

function sceneOf({ port, file, t, at, ring, lastHurt, connectedAt, kit, join, lastState, lastTod, trials }) {
  const cause = lastHurt && t - lastHurt.t <= CAUSE_MS ? causeOf(lastHurt.label) : 'unknown';
  // The trial on this port begun last before the death, if it had not ended
  // more than five minutes before.
  const trial = trials.filter(tr => String(tr.port) === port && tr.start <= t).sort((a, b) => b.start - a.start)[0] || null;
  if (trial && t > trial.end + 5 * 60000) return null;
  const fatalStart = t - FATAL_MS;
  const before = ring.filter(f => f.t <= fatalStart + 2000 && f.health != null).at(-1) || ring.find(f => f.health != null) || {};
  const positioned = ring.filter(f => f.pos);
  const last = positioned.at(-1) || {};
  const decisions = ring.filter(f => f.decision && f.t >= fatalStart && !f.decision.only);
  const st = [...decisions].reverse().find(d => d.decision.state && Object.keys(d.decision.state).length)?.decision.state || (lastState && t - lastState.t < 5 * 60000 ? lastState.state : {});
  // The hour: the last question's timeOfDay, else the join survey's,
  // carried on at 20 ticks a second.
  const tod = lastTod && t - lastTod.t < 20 * 60000 ? (lastTod.tod + Math.round((t - lastTod.t) / 50)) % 24000 : null;
  const night = tod == null ? null : tod >= 12542 && tod <= 23460;
  const y = last.pos ? round(last.pos.y) : null;
  const underground = st.underground != null ? !!st.underground : st.blocksToOpenSky != null ? st.blocksToOpenSky > 0 : y != null ? y < 50 : null;
  const eq = kit?.equipment || {}, inv = kit?.inventory || {};
  const armour = ['head', 'torso', 'legs', 'feet'].map(k => eq[k]).filter(Boolean);
  const blocks = st.buildingBlocks ?? st.carriedBuildingBlocks ?? null;
  const asked = decisions.map(f => {
    const d = f.decision;
    const chosen = d.path.join('/');
    const priced = d.options.map(([k, text]) => ({ k, dmg: damageSaid(text), text }));
    const mine = priced.find(p => p.k === chosen || chosen.startsWith(p.k + '/') || p.k.startsWith(chosen + '/'));
    const hp = d.state?.health ?? f.health;
    // A safer way on offer: priced below the chosen one by 2 or more, and
    // below the health then (or the chosen one unpriced and this one under
    // half the health), one that is a stance (not none_good).
    const safer = priced.filter(p => p.dmg != null && p.k !== chosen && p.k !== 'none_good'
      && (mine?.dmg != null ? p.dmg + 2 <= mine.dmg && (hp == null || p.dmg < hp) : false)).sort((a, b) => a.dmg - b.dmg)[0] || null;
    return { at: new Date(f.t).toISOString(), secondsBefore: round((t - f.t) / 1000), id: d.id, chosen, noneGood: d.noneGood, health: round(hp),
      weight: round(d.weights[d.path[0]] ?? null, 2), offered: d.options.map(([k]) => k), chosenDamage: mine?.dmg ?? null,
      safer: safer && { option: safer.k, damage: safer.dmg, text: safer.text.slice(0, 600) } };
  });
  const mobsAt = ring.filter(f => f.mobs && f.t <= t).at(-1)?.mobs || [];
  return {
    port, file, at, world: trial?.world || null, source: trial ? (String(trial.source || '').match(/first-days-(\d+)|stages\/([\w-]+)/) || [])[0] || trial.source : null,
    minutesIntoTrial: trial ? round((t - trial.start) / 60000) : null, minutesIntoConnection: connectedAt ? round((t - connectedAt) / 60000) : null,
    cause, kind: kindOf(cause), position: last.pos ? { x: round(last.pos.x), y, z: round(last.pos.z) } : null,
    underground, blocksToOpenSky: st.blocksToOpenSky ?? null, dark: st.darkHere ?? null, timeOfDay: tod, night,
    atFatalMinute: { health: round(before.health), food: before.food ?? null, armour, shield: eq.offhand === 'shield' || st.shield === true, weapon: st.weapon || null,
      blocks, food: before.food ?? null, step: before.step, phase: before.phase, survivalAction: before.sa, turn: before.turn },
    atDeath: { step: last.step, survivalAction: last.sa, turn: last.turn },
    mobsAtDeath: mobsAt.map(m => `${m.name}@${m.d}${m.seen === false ? '?' : ''}`),
    hurtsInFatalMinute: ring.filter(f => f.kind === 'damage' && f.t >= fatalStart).map(f => `${f.label.replace(/^hurt: /, '')}${f.health != null ? `→${round(f.health)}` : ''}`),
    asked,
    saferOnOffer: asked.some(a => a.safer),
    join: join && trial && Math.abs(join.t - trial.start) < 5 * 60000 ? { y: join.position?.y, floor: join.floor, mobs: (join.mobs || []).map(m => `${m.name} ${m.distance}${m.seen ? '' : '?'}`), timeOfDay: join.timeOfDay, health: join.health } : null,
  };
}

// The shape a death takes: what killed it, where (underground or surface,
// night or day), and how early (under 15 minutes into the trial).
function shapeOf(d) {
  const kind = /creeper/.test(d.kind) ? 'creeper' : /^(zombie|husk|drowned|zombie_villager)$/.test(d.kind) ? 'zombie' : /^(skeleton|stray|bogged)$/.test(d.kind) ? 'skeleton' : /spider/.test(d.kind) ? 'spider' : d.kind;
  const where = d.underground == null ? '?' : d.underground ? 'underground' : 'surface';
  const when = d.minutesIntoTrial == null ? '?' : d.minutesIntoTrial < 15 ? 'early (<15 min)' : 'later';
  return `${kind} · ${where} · ${when}`;
}

const stamp = f => { const m = f.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const inTrialsOf = trials => trials.filter(tr => tr.start >= since && tr.start <= to && !String(tr.source || '').includes('/stages/'));

// The creeper record: each answer with a creeper within three blocks, and
// what the blast did before the next answer or CREEPER_WINDOW_MS.
const CREEPER_WINDOW_MS = 6000;
async function creeperRecord() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).map(f => path.join(DIR, f)).filter(f => fs.statSync(f).mtimeMs >= since).sort();
  const rows = [];
  for (const file of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    let open = null, health = null, pos = null;
    for await (const line of rl) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch (_) { continue; }
      const t = Date.parse(r.at);
      if (!(t >= since && t <= to)) continue;
      const s = r.snapshot || {};
      // The health the blast took: the damage frame carries the health
      // before it; the readings over the next second and a half the after.
      if (open?.blast && t - open.blastAt <= 1500 && s.health != null) open.blast.took = Math.max(open.blast.took, open.blast.before - s.health);
      if (open && t - open.t > CREEPER_WINDOW_MS && !(open.blast && t - open.blastAt <= 1500)) open = null;
      if (s.position) { pos = s.position; if (open && open.movedAt1 == null && t - open.t >= 1000) open.movedAt1 = Math.hypot(pos.x - open.p.x, pos.z - open.p.z); }
      if (r.kind === 'damage' && /explosion by creeper/.test(r.label || '') && open && !open.blast) {
        open.blast = { seconds: (t - open.t) / 1000, before: s.health ?? health ?? 20, took: 0 }; open.blastAt = t;
      }
      if (r.kind === 'danger' && s.health === 0 && open?.blast) { open.died = true; open.blast.took = open.blast.before; }
      if (s.health != null) health = s.health;
      const d = s.decision;
      if (r.kind !== 'decision' || d?.id !== 'encounter_stance') continue;
      const st = d.state || {};
      if (/nether|end/.test(String(st.dimension || d.dimension || ''))) { open = null; continue; }
      const near = (st.threats || []).filter(x => x.name === 'creeper' && x.distance <= 3);
      if (!near.length) { open = null; continue; }
      const p = st.position || pos;
      open = { t, stance: (d.path || [])[0] || '?', distance: Math.min(...near.map(x => x.distance)), p: p ? { x: p.x, z: p.z } : { x: 0, z: 0 }, health: st.health, shield: !!st.shield, offered: Object.keys(d.options || {}) };
      rows.push(open);
    }
  }
  const by = {};
  for (const r of rows) {
    const b = by[r.stance] ||= { answers: 0, blasted: 0, took: [], died: 0, blastSeconds: [], moved: [] };
    b.answers++;
    if (r.blast) { b.blasted++; b.took.push(r.blast.took); b.blastSeconds.push(r.blast.seconds); }
    if (r.died) b.died++;
    if (r.movedAt1 != null) b.moved.push(r.movedAt1);
  }
  const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? round(b[b.length >> 1]) : null; };
  const out = Object.entries(by).sort((a, b) => b[1].answers - a[1].answers).map(([stance, b]) => ({ stance, answers: b.answers, blasted: b.blasted, died: b.died,
    meanTakenPerAnswer: round(b.took.reduce((x, y) => x + y, 0) / b.answers), medianTakenWhenBlasted: med(b.took), medianSecondsToBlast: med(b.blastSeconds), medianMovedInOneSecond: med(b.moved) }));
  if (asJson) { console.log(JSON.stringify({ since: new Date(since).toISOString(), to: Number.isFinite(to) ? new Date(to).toISOString() : null, rows: out }, null, 2)); return; }
  console.log(`encounter_stance answers with a creeper within 3 blocks, Overworld, ${new Date(since).toISOString()} on: ${rows.length}`);
  for (const o of out) console.log(`  ${o.stance}: ${o.answers} answered, ${o.blasted} caught by the blast within ${CREEPER_WINDOW_MS / 1000} s (median ${o.medianSecondsToBlast ?? '-'} s after, ${o.medianTakenWhenBlasted ?? '-'} health taken), ${o.died} died; mean taken per answer ${o.meanTakenPerAnswer}; moved ${o.medianMovedInOneSecond ?? '-'} blocks in the first second (median)`);
}

(async () => {
  if (argv.includes('--creepers')) return creeperRecord();
  const { trialRecords } = require('./trials/progress-audit');
  const trials = trialRecords({ now: Date.now() });
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl') && (!onlyPort || f.includes(`-${onlyPort}-Jev-`)))
    .map(f => path.join(DIR, f)).filter(f => fs.statSync(f).mtimeMs >= since).sort();
  const out = { deaths: [], other: [], lastDeath: {} };
  for (const f of files) await readFile(f, out, trials);
  const deaths = out.deaths.sort((a, b) => a.at < b.at ? -1 : 1);
  // A death after an earlier one in the same trial: the bot respawned
  // without its kit (keepInventory is off), a different start.
  const seen = new Map();
  for (const d of deaths) { const k = d.world || `${d.port}?`; d.deathsBefore = seen.get(k) || 0; seen.set(k, d.deathsBefore + 1); }
  // The bot's event loop held in the fatal minute (the bot log's [lag]).
  for (const d of deaths) {
    if (!d.world) continue;
    let text = ''; try { text = fs.readFileSync(path.join(ROOT, 'artifacts', `midgame-${d.world}.log`), 'utf8'); } catch (_) { continue; }
    const t = Date.parse(d.at), held = [];
    for (const m of text.matchAll(/^\[lag\] event loop held ([\d.]+)s \{.*?"at":"([^"]+)"/gm)) { const at = Date.parse(m[2]); if (at >= t - FATAL_MS && at <= t + 1000) held.push(+m[1]); }
    d.lagInFatalMinute = { count: held.length, seconds: round(held.reduce((a, b) => a + b, 0)) };
  }
  // Each trial's start: where the join survey read the ground.
  const starts = new Map();
  const names = fs.readdirSync(DIR);
  for (const tr of inTrialsOf(trials)) {
    const id = `127_0_0_1-${tr.port}-Jev-`;
    const files = names.filter(f => f.startsWith(id)).map(f => ({ f, t: stamp(f) })).filter(x => x.t >= tr.start - 60000 && x.t <= tr.start + 5 * 60000).sort((a, b) => a.t - b.t);
    for (const { f } of files) {
      let text = ''; try { text = fs.readFileSync(path.join(DIR, f), 'utf8'); } catch (_) { continue; }
      const i = text.indexOf('{"kind":"join_survey"');
      if (i < 0) continue;
      try { const r = JSON.parse(text.slice(i, text.indexOf('\n', i))); starts.set(tr.world, { y: r.detail?.position?.y, health: r.detail?.health, mobs: (r.detail?.mobs || []).length }); } catch (_) {}
      break;
    }
  }
  const tally = (list, f) => Object.entries(list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const inTrials = inTrialsOf(trials);
  const first = deaths.filter(d => !d.deathsBefore);
  const srcOf = tr => (String(tr.source || '').match(/first-days-(\d+)/) || [])[1] || '?';
  const bySource = {};
  for (const tr of inTrials) {
    const k = srcOf(tr), b = bySource[k] = bySource[k] || { trials: 0, endedInOverworldDeath: 0, within15: 0, startY: [] };
    b.trials++;
    const st = starts.get(tr.world); if (st?.y != null) b.startY.push(st.y);
    const d = first.find(d => d.world === tr.world);
    if (d) { b.endedInOverworldDeath++; if (d.minutesIntoTrial < 15) b.within15++; }
  }
  const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
  const summary = {
    since: new Date(since).toISOString(), files: files.length,
    overworldDeaths: deaths.length, afterAnEarlierDeathInTheTrial: deaths.filter(d => d.deathsBefore).length, otherDeaths: out.other.length,
    trialsBegun: inTrials.length, trialsWithAnOverworldDeath: first.length,
    firstDeathsWithin15Minutes: first.filter(d => d.minutesIntoTrial != null && d.minutesIntoTrial < 15).length,
    bySourceWorld: Object.fromEntries(Object.entries(bySource).sort((a, b) => b[1].trials - a[1].trials).map(([k, b]) => [k, `${b.endedInOverworldDeath} of ${b.trials} trials ended in an Overworld death (${Math.round(100 * b.endedInOverworldDeath / b.trials)}%), ${b.within15} within 15 minutes; start y ${med(b.startY) ?? '?'} (median)`])),
    firstDeathsBy: { kind: tally(first, d => d.kind), shape: tally(first, shapeOf), lagOver4sInFatalMinute: first.filter(d => d.lagInFatalMinute?.seconds >= 4).length },
    byKind: tally(deaths, d => d.kind),
    byShape: tally(deaths, shapeOf),
    early: deaths.filter(d => d.minutesIntoTrial != null && d.minutesIntoTrial < 15).length,
    underground: deaths.filter(d => d.underground).length,
    atNight: deaths.filter(d => d.night).length,
    noShield: deaths.filter(d => !d.atFatalMinute.shield).length,
    noArmour: deaths.filter(d => !d.atFatalMinute.armour.length).length,
    saferOnOffer: deaths.filter(d => d.saferOnOffer).length,
    noQuestionInLastMinute: deaths.filter(d => !d.asked.length).length,
    lastAnswer: tally(deaths.filter(d => d.asked.length), d => `${d.asked.at(-1).id}:${d.asked.at(-1).chosen}`),
    stepAtFatalMinute: tally(deaths, d => d.atFatalMinute.step || '-'),
    survivalActionAtFatalMinute: tally(deaths, d => d.atFatalMinute.survivalAction || '-'),
    bySource: tally(deaths, d => d.source || '?'),
    ...(split ? { split: new Date(split).toISOString(),
      before: { deaths: deaths.filter(d => Date.parse(d.at) < split).length, trials: inTrials.filter(tr => tr.start < split).length, byShape: tally(deaths.filter(d => Date.parse(d.at) < split), shapeOf) },
      after: { deaths: deaths.filter(d => Date.parse(d.at) >= split).length, trials: inTrials.filter(tr => tr.start >= split || tr.end > split).length, byShape: tally(deaths.filter(d => Date.parse(d.at) >= split), shapeOf) } } : {}),
  };
  if (asJson) { console.log(JSON.stringify({ summary, deaths }, null, 2)); return; }
  for (const [k, v] of Object.entries(summary)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) { console.log(`${k}:`); for (const [k2, v2] of Object.entries(v)) console.log(`  ${k2}: ${Array.isArray(v2) ? v2.map(([a, n]) => `${a} ${n}`).join('; ') : v2}`); }
    else console.log(`${k}: ${Array.isArray(v) ? v.map(([a, n]) => `${a} ${n}`).join('; ') : v}`);
  }
  console.log('\nEach Overworld death:');
  for (const d of deaths) {
    const a = d.atFatalMinute;
    console.log(`\n${d.at} ${d.port} ${d.world || '?'} (${d.source || '?'}) ${d.minutesIntoTrial ?? '?'} min in (${d.minutesIntoConnection ?? '?'} into the connection${d.deathsBefore ? `; after ${d.deathsBefore} earlier death${d.deathsBefore > 1 ? 's' : ''} in the trial` : ''}${d.lagInFatalMinute?.count ? `; event loop held ${d.lagInFatalMinute.seconds} s in ${d.lagInFatalMinute.count} stalls` : ''}): ${d.cause}; y ${d.position?.y ?? '?'} ${d.underground ? 'underground' : d.underground === false ? 'surface' : '?'}${d.blocksToOpenSky != null ? ` (${d.blocksToOpenSky} to sky)` : ''}${d.dark ? ', dark' : ''}, time ${d.timeOfDay ?? '?'}${d.night ? ' (night)' : ''}`);
    console.log(`  fatal minute from ${a.health} health, food ${a.food}, armor ${a.armour.join(',') || 'none'}, shield ${a.shield ? 'yes' : 'no'}, weapon ${a.weapon || '?'}, blocks ${a.blocks ?? '?'}; step ${a.step || '-'}${a.phase ? ':' + a.phase : ''}, survival ${a.survivalAction || '-'}, turn ${a.turn || '-'}; at death ${d.atDeath.step || '-'} / ${d.atDeath.survivalAction || '-'}`);
    console.log(`  mobs ${d.mobsAtDeath.join(', ') || 'none'}; hurts ${d.hurtsInFatalMinute.join(', ')}`);
    if (d.join) console.log(`  joined at y ${d.join.y} on ${d.join.floor}, health ${d.join.health}, time ${d.join.timeOfDay}, mobs ${d.join.mobs.join(', ') || 'none'}`);
    for (const q of d.asked) {
      console.log(`  -${q.secondsBefore}s ${q.id} -> ${q.chosen}${q.noneGood ? ' (none good)' : ''} ${q.weight ?? ''} at ${q.health} hp${q.chosenDamage != null ? ` (priced ${q.chosenDamage})` : ''} of ${q.offered.join(',')}`);
      if (q.safer) console.log(`      safer: ${q.safer.option} priced ${q.safer.damage}${verbose ? ': ' + q.safer.text : ''}`);
    }
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
