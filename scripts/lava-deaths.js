'use strict';
// Lava in the flight records (note 756): every spell in lava, from the first
// "hurt: lava" to the bot's death or its last lava hurt (out), with what was
// running when it went in, how long it stayed, how long until the way out
// was first taken, and the longest gap between frames (a client that did not
// run). And every death by its cause (the last hurt within ten seconds of it).
//   node scripts/lava-deaths.js [--since 2026-09-29T23:00Z] [--port 25597] [--json] [--pushes]
// --pushes (note 769): every Nether death by lava, fire after lava or a
// fall, with where the bot stood before it went over (the footing: its
// floor's width across, the sides with a drop, the floor's block and
// whether the bot laid it, the height over the lava, read from the trial's
// saved world), what pushed it (the hurt before it left the ground, or a
// blow the shield took: a hop with no key held and no health lost, a mob
// at arm's length), the stance or action held, how long the pusher had
// been near, and what the options of the last question said of the push.
// Read-only. A spell is the hurts no more than SPELL_GAP_MS apart; lava hurts
// come each half second while the body is in it.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('--since', '2026-09-29T23:00:00Z'));
const port = arg('--port', null);
const asJson = argv.includes('--json');
const pushes = argv.includes('--pushes');
const dir = path.join(ROOT, '.bot-state', 'flight');
const SPELL_GAP_MS = 3000, DEATH_CAUSE_MS = 10000, BURN = /^hurt: (lava|on fire|in fire)$/;
const round = n => Math.round(n * 10) / 10;
const RING_MS = 90000;
let BUILDING = new Set();
try { BUILDING = require('../src/shelter').buildingMaterials; } catch (_) { /* counted as none */ }
// A frame kept for --pushes: where the body was, what ran, the mobs the
// full frames list, a hurt's kind, a question's answer and its options.
function compact(r, t) {
  const s = r.snapshot || {};
  const f = { t, at: r.at, kind: r.kind, label: r.label, pos: s.position || null, onGround: s.onGround, health: s.health, dim: s.dimension || null,
    keys: s.keys || [], sa: s.survivalAction?.action || s.goal?.survivalAction?.action || null, saAt: s.survivalAction?.at || s.goal?.survivalAction?.at || null,
    step: s.step?.action || s.goal?.step?.action || null, pathing: !!s.pathing, controller: s.controller?.name || null, turn: s.turn?.phase || null };
  if (Array.isArray(s.mobs)) f.mobs = s.mobs.map(m => ({ name: m.name, id: m.id, d: m.d, at: m.at, seen: m.seen }));
  if (r.kind === 'shot') f.shot = r.detail || {};
  if (s.inventory && typeof s.inventory === 'object') f.blocks = Object.entries(s.inventory).reduce((n, [k, v]) => n + (BUILDING.has(k) ? v : 0), 0);
  if (r.kind === 'damage') f.hurt = { label: r.label, ...(r.detail || {}) };
  if (r.kind === 'decision' && s.decision?.id) {
    f.decision = { id: s.decision.id, path: s.decision.path || [], options: Object.fromEntries(Object.entries(s.decision.options || {}).map(([k, v]) => [k, v?.description || ''])) };
  }
  return f;
}

// What was running at a frame: the held-key move, the survival action (with
// its age: a label set long before is not what moved the body), the goal's
// step, the turn, a question out, the pathfinder.
function running(s, at, connectedAt = 0) {
  if (!s) return null;
  const sa = s.survivalAction || s.goal?.survivalAction;
  const age = sa?.at ? round((Date.parse(at) - Date.parse(sa.at)) / 1000) : null;
  // Set in an earlier connection: a label the goal carried over, not a run.
  const stale = !!sa?.at && Date.parse(sa.at) < connectedAt;
  return {
    controller: s.controller?.name || null,
    survivalAction: sa?.action || null, survivalActionAgeS: age, ...(stale ? { survivalActionFromEarlierConnection: true } : {}),
    step: s.step?.action || s.goal?.step?.action || null,
    turn: s.turn ? `${s.turn.holder}${s.turn.phase ? `:${s.turn.phase}` : ''}` : null,
    question: s.question?.id || null,
    pathing: !!s.pathing,
    keys: s.keys || [],
  };
}
// What put the body in: a held-key move first, then the pathfinder's walk
// (named by the survival action set in this connection within ten seconds,
// else the step), then a survival action set so (a label with no keys held
// or walk: a block placed, a dig); "nothing held" where no key, walk or
// action of this connection was running (the water's flow, a knock, a
// floor gone).
const fresh = r => r.survivalAction && !r.survivalActionFromEarlierConnection && r.survivalActionAgeS != null && r.survivalActionAgeS <= 10;
function mover(r) {
  if (!r) return 'unknown';
  if (r.controller) return `move:${r.controller}`;
  if (r.pathing) return `walk:${fresh(r) ? r.survivalAction : r.step || r.turn || '?'}`;
  if (fresh(r)) return `survival:${r.survivalAction}`;
  return 'nothing held (drift, knock or floor gone)';
}

async function readFile(file, out) {
  const name = path.basename(file), m = name.match(/-(\d{5})-Jev-/);
  const p = m ? m[1] : '?';
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let prev = null, spell = null, lastHurt = null, lastFrameAt = null, connectedAt = 0;
  // The lava escape's own frames (note 756's [lava-escape]): the ways it
  // had and took, kept for the spell they fall in or the one they begin a
  // moment before (the body can be read in lava before the first hurt).
  // And the heights stood at in the five seconds before, for the fall in.
  let lastEscape = null;
  const heights = [];
  // The last forty seconds of frames, compact, for --pushes.
  const ring = [];
  const escapeOf = r => ({ at: r.at, took: r.detail?.took || null, offered: r.detail?.offered || [], health: r.detail?.health ?? null, workedOutMs: r.detail?.workedOutMs ?? null });
  const close = (how, at) => {
    if (!spell) return;
    spell.end = how; spell.seconds = round(((how === 'death' ? Date.parse(at) : spell.lastLava + 500) - spell.startMs) / 1000);
    delete spell.startMs; delete spell.lastLava; delete spell.ranSinceLava;
    out.spells.push(spell); spell = null;
  };
  for await (const line of rl) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    const t = Date.parse(r.at);
    if (!(t >= since)) { prev = r; continue; }
    const s = r.snapshot || {};
    if (pushes) { ring.push(compact(r, t)); while (ring.length && ring[0].t < t - RING_MS) ring.shift(); }
    if (s.position && s.onGround) { heights.push({ at: t, y: s.position.y }); while (heights.length && heights[0].at < t - 5000) heights.shift(); }
    if (r.kind === 'lava_escape') { if (spell) spell.escapes.push(escapeOf(r)); else lastEscape = { t, frame: escapeOf(r) }; }
    if (spell) {
      if (lastFrameAt) spell.longestFrameGapS = Math.max(spell.longestFrameGapS, round((t - lastFrameAt) / 1000));
      if (!spell.firstWayS && (r.kind === 'lava_escape' || s.controller?.name === 'out_of_lava' || s.survivalAction?.action === 'leave_lava' || s.survivalAction?.action === 'lava_escape')) spell.firstWayS = round((t - spell.startMs) / 1000);
      if (!spell.bodyWayAskedS && (s.question?.id === 'body_way' || s.decision?.id === 'body_way')) spell.bodyWayAskedS = round((t - spell.startMs) / 1000);
      if (s.question?.id && s.question.id !== 'body_way') spell.questionsAsked.add(s.question.id);
      // Out only when the client ran on without a lava hurt: a frame after
      // a gap in the frames (a client that did not run) is no exit.
      // (the time since the last lava hurt counted only over frames at most
      // a second and a half apart).
      if (t - lastFrameAt <= 1500) spell.ranSinceLava += t - lastFrameAt;
      if (spell.ranSinceLava > SPELL_GAP_MS - 1000 && t - spell.lastLava > SPELL_GAP_MS && r.label !== 'hurt: lava' && r.kind !== 'danger') close('out', r.at);
    }
    lastFrameAt = t;
    if (r.kind === 'connection' && r.detail?.connected) connectedAt = t;
    if (r.kind === 'damage') {
      lastHurt = { label: r.label, at: t };
      if (r.label === 'hurt: lava') {
        if (!spell) {
          const pos = s.position;
          spell = { port: p, file: name, at: r.at, startMs: t, lastLava: t, position: pos && { x: round(pos.x), y: round(pos.y), z: round(pos.z) },
            dimension: s.dimension || prev?.snapshot?.dimension || null, healthIn: round(prev?.snapshot?.health ?? s.health ?? 20),
            atFirstHurt: running(s, r.at, connectedAt), before: running(prev?.snapshot, prev?.at, connectedAt), hurts: 0, longestFrameGapS: 0, questionsAsked: new Set(),
            escapes: lastEscape && t - lastEscape.t <= 1500 ? [lastEscape.frame] : [],
            fellS: null };
          // The fall in: the highest the feet stood on ground in the five
          // seconds before, over where the lava first hurt.
          const top = heights.filter(h => h.at >= t - 5000).reduce((m, h) => Math.max(m, h.y), -Infinity);
          if (Number.isFinite(top) && pos) spell.fellBlocks = round(Math.max(0, top - pos.y));
          spell.putIn = mover(spell.before && (spell.before.controller || spell.before.pathing || spell.before.survivalAction) ? spell.before : spell.atFirstHurt);
        }
        spell.lastLava = t; spell.ranSinceLava = 0; spell.hurts++;
      }
    }
    const died = (r.kind === 'danger' && s.health === 0) || (r.kind === 'connection' && r.detail?.reason === 'Respawning after death');
    if (died && !(out.lastDeath[p] && t - out.lastDeath[p] < 5000)) {
      out.lastDeath[p] = t;
      const cause = lastHurt && t - lastHurt.at <= DEATH_CAUSE_MS ? lastHurt.label.replace(/^hurt: /, '') : 'unknown';
      out.deaths.push({ port: p, at: r.at, cause, inLavaSpell: !!spell });
      const dim = s.dimension || prev?.snapshot?.dimension || '';
      if (pushes && /nether/.test(dim) && (/^(lava|fall)$/.test(cause) || spell)) out.scenes.push({ port: p, file: name, at: r.at, t, cause, frames: ring.slice() });
      if (spell) close('death', r.at);
    }
    prev = r;
  }
  if (spell) close('record ends', new Date(spell.lastLava + 500).toISOString());
}

(async () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!port || f.includes(`-${port}-Jev-`)))
    .map(f => path.join(dir, f)).filter(f => fs.statSync(f).mtimeMs >= since).sort();
  const out = { spells: [], deaths: [], lastDeath: {}, scenes: [] };
  for (const f of files) await readFile(f, out);
  if (pushes) { require('./lib/push-scene').report(out.scenes, { root: ROOT, asJson }); return; }
  for (const s of out.spells) {
    s.questionsAsked = [...s.questionsAsked];
    // Whether the escape fired, what it took, and whether it ever had a way
    // a swim or a block reaches (into water, onto a dry cell, the block into
    // the lava): with none, only back toward the last footing or up.
    s.escapeFired = s.escapes.length > 0;
    s.firstEscapeS = s.escapes.length ? round((Date.parse(s.escapes[0].at) - Date.parse(s.at)) / 1000) : null;
    s.waysTaken = [...new Set(s.escapes.map(e => e.took).filter(Boolean))];
    s.waysOffered = [...new Set(s.escapes.flatMap(e => e.offered))];
    s.reachableWay = s.waysOffered.some(w => /^(to_water|to_dry_ground|pillar_out|eat_golden_apple|drink_fire_resistance)$/.test(w));
    s.slowestWorkOutMs = Math.max(0, ...s.escapes.map(e => e.workedOutMs || 0));
    delete s.escapes; delete s.fellS;
  }
  const deaths = out.deaths, burn = deaths.filter(d => /^(lava|on fire|in fire)$/.test(d.cause));
  const spells = out.spells, died = spells.filter(s => s.end === 'death'), escaped = spells.filter(s => s.end === 'out');
  const tally = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
  const summary = {
    since: new Date(since).toISOString(), files: files.length,
    deaths: deaths.length, deathsByCause: tally(deaths, d => d.cause),
    lavaOrBurningDeaths: burn.length, lavaOrBurningDeathsInALavaSpell: burn.filter(d => d.inLavaSpell).length,
    lavaSpells: spells.length, spellsEndedInDeath: died.length, spellsOut: escaped.length,
    secondsInLava: { death: { median: med(died.map(s => s.seconds)), each: died.map(s => s.seconds) }, out: { median: med(escaped.map(s => s.seconds)), max: Math.max(0, ...escaped.map(s => s.seconds)) } },
    putInBy: tally(spells, s => s.putIn), putInByOnDeath: tally(died, s => s.putIn),
    firstWayTakenS: { death: died.map(s => s.firstWayS ?? null), out: { median: med(escaped.filter(s => s.firstWayS != null).map(s => s.firstWayS)) } },
    bodyWayAskedS: { median: med(spells.filter(s => s.bodyWayAskedS != null).map(s => s.bodyWayAskedS)), death: died.map(s => s.bodyWayAskedS ?? null) },
    otherQuestionsAskedInLava: spells.filter(s => s.questionsAsked.length).length,
    frameGapOver2sInSpell: spells.filter(s => s.longestFrameGapS > 2).length,
    escapeFired: { death: died.filter(s => s.escapeFired).length, out: escaped.filter(s => s.escapeFired).length },
    deathsWithNoWayASwimOrBlockReaches: died.filter(s => !s.reachableWay).length,
  };
  if (asJson) { console.log(JSON.stringify({ summary, spells, deaths }, null, 2)); return; }
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nSpells that ended in death:');
  for (const s of died) console.log(`  ${s.port} ${s.at} ${s.dimension || ''} at ${JSON.stringify(s.position)} from ${s.healthIn} health, ${s.seconds} s in, ${s.hurts} hurts; put in by ${s.putIn}; fell ${s.fellBlocks ?? '?'} blocks in; escape ${s.escapeFired ? `at ${s.firstEscapeS} s took ${s.waysTaken.join('/')} of ${s.waysOffered.join(',')} (worked out in ${s.slowestWorkOutMs} ms at most)` : 'never fired'}; ${s.reachableWay ? 'a way out a swim or a block reaches was on offer' : 'no way out a swim or a block reaches'}; first way ${s.firstWayS ?? 'never'} s, body_way asked ${s.bodyWayAskedS ?? 'never'} s; longest frame gap ${s.longestFrameGapS} s; other questions ${s.questionsAsked.join(',') || 'none'}; at first hurt ${JSON.stringify(s.atFirstHurt)}`);
})().catch(err => { console.error(err); process.exitCode = 1; });
