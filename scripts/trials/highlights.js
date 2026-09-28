'use strict';
// Highlight moments of a day's midgame trials, for the README's videos:
// blaze kills and rods, other fights won (a wither skeleton, a hoglin, a
// ghast and its fireball sent back), milestones (a fresh world into the
// Nether, the first sight of a fortress) and the deaths worth watching.
// Each is found from the flight records (inventory, mobs about, Jev's
// decisions and what he gave each option), the trial records and the
// servers' logs; each is matched to the ServerReplay recording that covers
// it (checked by the replay's own start and length), copied into the
// ReplayMod instance as hl-NN-<what>-<trial>.mcpr, and given a third-person
// camera path over its own clip window (replay-camera.js, as the deaths'
// camera). Writes artifacts/highlights.json.
//   node scripts/trials/highlights.js [--day 2026-09-28] [--since <iso>] [--max 16] [--list] [--dry]
// --list prints every candidate found, scored, before the choice; --dry
// chooses and writes the JSON but copies nothing. REPLAY_RECORDINGS sets
// the replay folder; JEV_ROOT reads another checkout's servers and records
// (from a worktree). Server logs and recording names are in local time, so
// run it on the machine (and time zone) the servers ran in.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { replayMeta, cameraTimeline, writeTimeline } = require('./replay-camera');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..', '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const OUT = process.env.REPLAY_RECORDINGS || path.join(process.env.HOME, 'Library/Application Support/PrismLauncher/instances/Jev Replays/minecraft/replay_recordings');
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : process.argv[i + 1]; };
const flag = name => process.argv.includes(`--${name}`);
const DAY = arg('day', new Date().toISOString().slice(0, 10));
const SINCE = Date.parse(arg('since', `${DAY}T00:00:00Z`));
const MAX = Number(arg('max', 16));

const serverDir = port => path.join(ROOT, port === 25581 ? '.clean-run' : `.clean-run-${port}`);
const iso = t => new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');
const local = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const r1 = n => Math.round(n * 10) / 10;
const pretty = s => String(s).replace(/_/g, ' ');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// ---- Trials: the day's midgame trial records, each running until the
// next trial on its port began.
function trials() {
  const dir = path.join(ROOT, 'artifacts', 'midgame');
  const all = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    let t; try { t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    const start = Date.parse(t.startedAt);
    if (!Number.isFinite(start) || !t.port) continue;
    all.push({ world: t.world || f.replace(/\.json$/, ''), port: t.port, start, reached: t.verdict?.reachedAtMinute || {}, most: t.verdict?.most || {}, minutes: t.verdict?.minutes });
  }
  all.sort((a, b) => a.start - b.start);
  for (const t of all) {
    const next = all.find(o => o.port === t.port && o.start > t.start);
    t.end = Math.min(next ? next.start : Date.now(), Number.isFinite(t.minutes) ? t.start + (t.minutes + 3) * 60000 : Infinity);
    // Begun at a checkpoint in the Nether (the reached minutes are 0), or
    // from the overworld (a fresh world or its checkpoint before the portal).
    t.fresh = !(t.reached.nether === 0);
  }
  return all.filter(t => t.start >= SINCE && iso(t.start).startsWith(DAY));
}

// ---- Deaths: the servers' logs, as death-index.js reads them.
const DEATH = / Jev ((was|died|fell|drowned|blew|burned|hit the|tried|walked into|suffocated|experienced|went|froze|starved|withered|discovered)[^\n]*)/;
function deathsOn(port) {
  const logs = path.join(serverDir(port), 'logs'), out = [];
  if (!fs.existsSync(logs)) return out;
  for (const f of fs.readdirSync(logs).sort()) {
    const file = path.join(logs, f);
    let text;
    try { text = f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)).toString() : f === 'latest.log' ? fs.readFileSync(file, 'utf8') : null; } catch (_) { continue; }
    if (!text) continue;
    const day = f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || local(fs.statSync(file).mtimeMs).slice(0, 10);
    for (const line of text.split('\n')) {
      const d = line.match(DEATH), t = line.match(/^\[(\d\d:\d\d:\d\d)\]/);
      if (d && t) out.push({ t: new Date(`${day}T${t[1]}`).getTime(), cause: `Jev ${d[1]}`.trim() });
    }
  }
  return out;
}

// ---- Recordings: every .mcpr of a server, by the start in its name
// (local time); its real start and length are read from the replay itself
// for the ones asked about.
const recCache = new Map(), metaCache = new Map();
function recordingsOn(port) {
  if (recCache.has(port)) return recCache.get(port);
  const players = path.join(serverDir(port), 'recordings', 'players'), out = [];
  if (fs.existsSync(players)) for (const u of fs.readdirSync(players)) {
    for (const f of fs.readdirSync(path.join(players, u)).filter(f => f.endsWith('.mcpr'))) {
      const m = f.match(/(\d{4}-\d{2}-\d{2})--(\d\d)-(\d\d)-(\d\d)/);
      if (m) out.push({ file: path.join(players, u, f), named: new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}`).getTime() });
    }
  }
  out.sort((a, b) => a.named - b.named);
  recCache.set(port, out);
  return out;
}
function recordingFor(port, t) {
  const recs = recordingsOn(port).filter(r => r.named <= t + 2000).slice(-3).reverse();
  for (const r of recs) {
    if (!metaCache.has(r.file)) metaCache.set(r.file, replayMeta(r.file));
    const meta = metaCache.get(r.file);
    if (!meta?.duration) continue;
    const start = meta.date || r.named;
    if (t >= start && t <= start + meta.duration) return { file: r.file, start, duration: meta.duration };
  }
  return null;
}

// ---- The flight record of a trial, read once: Jev's track, what he
// carries (highest counts), mobs near him, decisions, damage, fireballs.
// What a kill leaves: the item, the mob it says was killed, and where.
const DROPS = {
  blaze_rod: { mob: 'blaze' },
  ghast_tear: { mob: 'ghast' },
  gunpowder: { mob: 'ghast', overworld: 'creeper' },
  wither_skeleton_skull: { mob: 'wither_skeleton' },
  coal: { mob: 'wither_skeleton', netherOnly: true },
  bone: { mob: 'wither_skeleton', overworld: 'skeleton' },
  porkchop: { mob: 'hoglin', netherOnly: true },
  leather: { mob: 'hoglin', netherOnly: true },
  magma_cream: { mob: 'magma_cube' },
  crossbow: { mob: 'piglin' },
  golden_sword: { mob: 'piglin' },
  rotten_flesh: { mob: 'zombified_piglin', overworld: 'zombie' },
  string: { mob: 'spider', overworldOnly: true },
};
// The stances new this week, and the other fighting answers worth naming.
const STANCES = new Set(['charge_nearest', 'close_in', 'shield_guard', 'block_creeper', 'fight_at_spawner', 'return_fireball', 'fight', 'dig_in_and_fight', 'hunt']);
const NEW_STANCES = new Set(['charge_nearest', 'close_in', 'shield_guard', 'block_creeper']);

function flightFiles(port, from, to) {
  const id = `127_0_0_1-${port}-Jev-`;
  const files = fs.readdirSync(FLIGHT).filter(f => f.startsWith(id) && f.endsWith('.jsonl')).map(f => {
    const m = f.slice(id.length).match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
    return { f, start: m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN };
  }).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  return files.filter((x, i) => x.start <= to && (files[i + 1]?.start ?? Infinity) >= from).map(x => path.join(FLIGHT, x.f));
}

function readTrial(trial) {
  const track = [], gains = [], sightings = [], decisions = [], damage = [], fireballs = [];
  const high = {};
  let fortressSeen = null;
  for (const file of flightFiles(trial.port, trial.start, trial.end)) {
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    for (const line of text.split('\n')) {
      const i = line.lastIndexOf('"at":"');
      if (i < 0) continue;
      const t = Date.parse(line.slice(i + 6, line.indexOf('"', i + 6)));
      if (!(t >= trial.start && t <= trial.end)) continue;
      let r; try { r = JSON.parse(line); } catch (_) { continue; }
      const s = r.snapshot || {};
      if (s.position) track.push({ t, p: s.position, dim: s.dimension, hp: s.health, kind: r.kind });
      if (s.inventory) {
        for (const item of Object.keys(DROPS)) {
          const n = +s.inventory[item] || 0;
          if (high[item] === undefined) { high[item] = n; continue; }
          if (n > high[item]) { gains.push({ t, item, from: high[item], to: n, dim: s.dimension, p: s.position }); high[item] = n; }
        }
      }
      for (const m of s.mobs || []) if (m.d <= 24) sightings.push({ t, id: m.id, name: m.name, d: m.d, at: m.at });
      if (r.kind === 'decision' && s.decision?.path) {
        const d = s.decision, choice = d.path[d.path.length - 1];
        const j = (d.judgments || []).find(j => j.choice === choice) || d.judgments?.[0];
        const p = j?.probabilities?.[choice] ?? j?.confidence;
        decisions.push({ t, question: d.id, choice: d.path.join(' → '), last: choice, probability: Number.isFinite(p) ? p : null });
        if (!fortressSeen && d.id === 'fortress_approach' && Number.isFinite(d.state?.fortress?.distance)) fortressSeen = { t, distance: d.state.fortress.distance, height: d.state.fortress.height, p: s.position, dim: s.dimension };
      }
      if (r.kind === 'damage') damage.push({ t, cause: r.detail?.cause || r.label, type: r.detail?.type, hp: s.health });
      if (/return fireball/.test(r.label || '')) fireballs.push({ t, p: s.position });
    }
  }
  track.sort((a, b) => a.t - b.t);
  return { track, gains, sightings, decisions, damage, fireballs, fortressSeen };
}

// Jev's answer at a moment: the fighting answer nearest before it (within
// `within` ms), else the last answer to any question.
function decisionAt(rec, t, within = 20000) {
  const before = rec.decisions.filter(d => d.t <= t + 500 && d.t >= t - within);
  const fight = before.filter(d => STANCES.has(d.last)).pop();
  const d = fight || before.filter(d => !/^vitals|Discarded/.test(d.choice)).pop();
  return d ? { at: iso(d.t), question: d.question, choice: d.choice, probability: d.probability } : null;
}
const saidDecision = d => d ? ` Jev's call: ${pretty(d.choice)} (${d.question}${d.probability != null ? `, p=${d.probability.toFixed(2)}` : ''}).` : '';
const where = (rec, t) => rec.track.reduce((a, b) => (!a || Math.abs(b.t - t) < Math.abs(a.t - t)) ? b : a, null);

// ---- The moments of a trial.
function momentsOf(trial) {
  const rec = readTrial(trial), out = [];
  const add = m => out.push({ trial: trial.world, port: trial.port, ...m });
  const lastNear = (name, t, maxD, span) => rec.sightings.filter(s => s.name === name && s.t <= t && s.t >= t - span && s.d <= maxD).pop();

  // Kills, known by what they left in the inventory: one kill per mob kind
  // within a few seconds (a wither skeleton's coal and bone are one kill).
  const kills = [];
  for (const g of rec.gains) {
    const info = DROPS[g.item], nether = /nether/.test(g.dim || '');
    if (info.netherOnly && !nether) continue;
    if (info.overworldOnly && nether) continue;
    const mob = nether ? info.mob : (info.overworld || info.mob);
    // A mob of that kind must have been near in the half minute before;
    // else the item was mined, bartered or found.
    const seen = lastNear(mob, g.t, 12, 30000);
    if (!seen) continue;
    const close = lastNear(mob, g.t, 6, 30000) || seen;
    const prev = kills.find(k => k.mob === mob && g.t - k.pickedAt < 6000);
    if (prev) { prev.items.push(`${g.item} ${g.from}→${g.to}`); continue; }
    kills.push({ mob, t: Math.min(close.t + 800, g.t), pickedAt: g.t, items: [`${g.item} ${g.from}→${g.to}`], rods: g.item === 'blaze_rod' ? g.to : null });
  }
  for (const k of kills) {
    const f = where(rec, k.t);
    const fireball = k.mob === 'ghast' && rec.fireballs.some(b => b.t <= k.pickedAt && b.t >= k.pickedAt - 30000);
    const dec = decisionAt(rec, k.t);
    const stanceNew = dec && NEW_STANCES.has(dec.choice.split(' → ').pop());
    const blazesAbout = new Set(rec.sightings.filter(s => s.name === 'blaze' && Math.abs(s.t - k.t) < 20000 && s.d <= 16).map(s => s.id)).size;
    if (k.mob === 'blaze') {
      const nth = k.rods === 1 ? 'his first blaze rod' : `blaze rod number ${k.rods}`;
      add({ category: 'rod', kind: 'blaze_kill', t: k.t, caption: `Jev kills a blaze and picks up ${nth}${blazesAbout > 1 ? ` with ${blazesAbout} blazes about` : ''}.${saidDecision(dec)}`, decision: dec, evidence: k.items, p: f?.p, dim: f?.dim,
        // A first rod soon after a trial begun at the fortress is quick work.
        score: 10 + (k.rods === 1 ? 3 : 1) + (trial.fresh ? 2 : 0) + (k.rods === 1 && !trial.fresh ? Math.max(0, 5 - (k.t - trial.start) / 60000) * 0.3 : 0) + (stanceNew ? 1 : 0) + Math.min(blazesAbout, 4) * 0.5, before: 14, after: Math.max(6, Math.ceil((k.pickedAt - k.t) / 1000) + 3) });
    } else {
      const worth = { ghast: 9, wither_skeleton: 8, hoglin: 7, piglin: 6, magma_cube: 4 }[k.mob] ?? 3;
      add({ category: 'kill', kind: `${k.mob}_kill`, t: k.t, caption: `Jev kills a ${pretty(k.mob)}${fireball ? ' by hitting its fireball back at it' : ''}.${saidDecision(dec)}`, decision: dec, evidence: k.items, p: f?.p, dim: f?.dim,
        score: worth + (fireball ? 3 : 0) + (stanceNew ? 1.5 : 0), before: fireball ? 10 : 12, after: Math.max(5, Math.ceil((k.pickedAt - k.t) / 1000) + 3) });
    }
  }

  // Fireballs sent back (a swing at a ghast's fireball), one per half minute.
  let lastBall = -Infinity;
  for (const b of rec.fireballs) {
    if (b.t - lastBall < 30000) continue;
    lastBall = b.t;
    if (kills.some(k => k.mob === 'ghast' && Math.abs(k.t - b.t) < 30000)) continue;
    const f = where(rec, b.t);
    add({ category: 'kill', kind: 'fireball_returned', t: b.t, caption: `A ghast fires at Jev and he swings its fireball back at it.${saidDecision(decisionAt(rec, b.t, 5000))}`, decision: decisionAt(rec, b.t, 5000), evidence: ['return fireball'], p: f?.p, dim: f?.dim, score: 6, before: 6, after: 6 });
  }

  // Milestones: into the Nether during the trial, and a fortress first seen.
  for (let i = 1; i < rec.track.length; i++) {
    const a = rec.track[i - 1], b = rec.track[i];
    // The crossing the trial record counts (its minute), not a later one
    // back through the portal.
    if (!(trial.reached.nether > 0)) break;
    if (a.dim === 'overworld' && b.dim === 'the_nether' && Math.abs(b.t - (trial.start + trial.reached.nether * 60000)) < 3 * 60000) {
      const minutes = Math.round((b.t - trial.start) / 60000);
      add({ category: 'milestone', kind: 'nether_entered', t: b.t, caption: `${trial.fresh && !/-(nether|fortress)-/.test(trial.world) ? 'Fresh world' : 'From the overworld'}: Jev steps through his portal into the Nether ${minutes} minutes in.`, decision: decisionAt(rec, a.t, 60000), p: b.p, dim: b.dim,
        score: 7 + Math.max(0, 20 - minutes) / 4 + (trial.most.blazeRods > 0 ? 1 : 0), before: 10, after: 8, camera: { back: 5, up: 3 } });
      break;
    }
  }
  // Only a trial that came into the Nether itself: a checkpoint begun near a
  // fortress sees it at once.
  if (rec.fortressSeen && trial.reached.fortress > 0 && trial.reached.nether > 0) {
    const f = rec.fortressSeen, nether = rec.track.find(x => x.dim === 'the_nether');
    const since = nether ? Math.round((f.t - nether.t) / 60000) : null;
    add({ category: 'milestone', kind: 'fortress_sighted', t: f.t, caption: `Jev sights a Nether fortress ${f.distance} blocks off${since != null ? `, ${since} minutes after entering the Nether` : ''}.${saidDecision(decisionAt(rec, f.t, 2000))}`, decision: decisionAt(rec, f.t, 2000), p: f.p, dim: f.dim,
      score: 7 + (since != null ? Math.max(0, 15 - since) / 5 : 0) + (trial.most.blazeRods > 0 ? 1 : 0), before: 4, after: 10, camera: { back: 6, up: 4 } });
  }

  // Deaths, from the server's log, with what was about in the last half minute.
  for (const d of deathsOn(trial.port).filter(d => d.t >= trial.start && d.t <= trial.end + 5000)) {
    // Mobs are listed only in some frames: count the last minute's.
    const near = rec.sightings.filter(s => s.t <= d.t + 1000 && s.t >= d.t - 60000);
    const count = name => new Set(near.filter(s => s.name === name && s.d <= 16).map(s => s.id)).size;
    const blazes = count('blaze'), ghasts = new Set(near.filter(s => s.name === 'ghast').map(s => s.id)).size;
    const f = rec.track.filter(x => x.t <= d.t + 1000).pop();
    const hurt = rec.damage.filter(x => x.t <= d.t + 1000 && x.t >= d.t - 30000);
    const dec = decisionAt(rec, d.t, 30000);
    const c = d.cause;
    let kind = 'other', caption = `${c}.`, score = 4, before = 20;
    if (/lava to escape Ghast|doomed to fall by Ghast|fireballed by Ghast/.test(c)) {
      kind = 'ghast'; score = /lava/.test(c) ? 9.5 : 9; before = 15;
      if (hurt.some(h => /ghast|fireball/i.test(h.cause) && h.t >= d.t - 10000)) score += 1;
      caption = /lava/.test(c) ? 'A ghast\'s fireball knocks Jev off his footing and into lava.' : /fall/.test(c) ? 'A ghast\'s fireball knocks Jev off a ledge to his death.' : 'A ghast\'s fireball kills Jev.';
    } else if (/Blaze/.test(c)) {
      kind = blazes >= 3 ? 'blaze_swarm' : 'blaze'; score = 5 + Math.min(blazes, 6); before = 30;
      // A rod picked up as the blazes killed him: the story of the trial.
      const rod = rec.gains.find(g => g.item === 'blaze_rod' && Math.abs(g.t - d.t) < 20000);
      if (rod) score += 3;
      // At a spawner, where they come four at a time.
      const spawner = rec.decisions.some(x => x.last === 'fight_at_spawner' && x.t <= d.t && x.t >= d.t - 60000);
      if (spawner) { score += 2; kind = 'blaze_swarm'; }
      const at = f?.p ? ` at (${Math.round(f.p.x)}, ${Math.round(f.p.y)}, ${Math.round(f.p.z)})` : '';
      caption = `${spawner ? `Jev takes on the blazes at their spawner${at} and they kill him` : blazes >= 3 ? `${blazes} blazes swarm Jev${at}` : `A blaze gets Jev${at}`} (${c.replace(/^Jev /, '')})${rod ? `, as he picks up blaze rod number ${rod.to}` : ''}.`;
    } else if (/Wither Skeleton/.test(c)) {
      kind = 'wither_skeleton'; score = 8; before = 15;
      caption = `A wither skeleton cuts Jev down (${c.replace(/^Jev /, '')}).`;
    } else if (/Creeper/.test(c)) {
      kind = 'creeper'; score = 8; before = 10;
      caption = 'A creeper blows Jev up.';
    } else if (/lava|floor was lava|burned to death/.test(c)) { kind = 'lava'; score = 5; }
    if (dec && NEW_STANCES.has(dec.choice.split(' → ').pop())) score += 1;
    add({ category: 'death', kind: `death_${kind}`, t: d.t, cause: c, caption: `${caption}${saidDecision(dec)}`, decision: dec, p: f?.p, dim: f?.dim,
      evidence: [`${hurt.length} hits in the last 30 s${hurt.length ? `: ${[...new Set(hurt.map(h => pretty(h.cause)))].join(', ')}` : ''}`, `${blazes} blazes, ${ghasts} ghasts, ${count('wither_skeleton')} wither skeletons within 16 blocks`],
      score, before, after: 3, death: true });
  }
  return { moments: out, track: rec.track };
}

// ---- Choosing: a mix, the best of each kind first, one moment per trial
// and kind (a death and the rod taken as it came stay apart only if 20 s
// apart), then the best of what is left.
function choose(all) {
  // Best first; of equal scores the later (the newer code) first.
  const byScore = [...all].sort((a, b) => b.score - a.score || b.t - a.t);
  const chosen = [];
  const clash = m => chosen.some(c => c.trial === m.trial && Math.abs(c.t - m.t) < 20000);
  const take = m => { if (m && !chosen.includes(m) && !clash(m) && chosen.length < MAX) { chosen.push(m); return true; } return false; };
  const best = (pred, n, distinct = m => m.kind) => {
    const seen = new Set();
    for (const m of byScore.filter(pred)) { if (seen.size >= n) break; if (seen.has(distinct(m))) continue; if (take(m)) seen.add(distinct(m)); }
  };
  // The deaths: one of each kind asked for, then the best other one.
  for (const kind of ['death_ghast', 'death_blaze_swarm', 'death_wither_skeleton', 'death_creeper']) best(m => m.kind === kind, 1);
  best(m => m.category === 'death', 1, m => m.trial);
  // The rods: the best from each of five trials.
  best(m => m.category === 'rod', 5, m => m.trial);
  // Milestones: the fastest into the Nether, the quickest fortress seen.
  for (const kind of ['nether_entered', 'fortress_sighted']) best(m => m.kind === kind, 1);
  // Fights won in the Nether: the best of each mob.
  best(m => m.category === 'kill' && m.score >= 5, 4);
  // Then the best of what is left, none of the everyday overworld kills.
  for (const m of byScore) if (m.score >= 6) take(m);
  return chosen.sort((a, b) => a.t - b.t);
}

// ---- Main.
const list = trials();
console.error(`${list.length} trials begun ${DAY}${arg('since') ? ` since ${arg('since')}` : ''}`);
const all = [], tracks = new Map();
for (const [i, t] of list.entries()) {
  process.stderr.write(`\r${i + 1}/${list.length} ${t.world}`.padEnd(70));
  const { moments, track } = momentsOf(t);
  if (moments.length) tracks.set(t.world, track);
  for (const m of moments) {
    m.recording = recordingFor(t.port, m.t);
    if (!m.recording) m.skipped = 'no recording covers it';
    all.push(m);
  }
}
process.stderr.write('\n');
const usable = all.filter(m => !m.skipped);
if (flag('list')) for (const m of [...all].sort((a, b) => b.score - a.score)) console.log(`${m.score.toFixed(1).padStart(5)} ${m.category.padEnd(9)} ${m.kind.padEnd(22)} ${iso(m.t)} ${String(m.port)} ${m.trial.padEnd(34)} ${m.skipped ? `[${m.skipped}] ` : ''}${m.caption}`);
const chosen = choose(usable);

const out = [];
chosen.forEach((m, i) => {
  const n = String(i + 1).padStart(2, '0');
  const rec = m.recording;
  const slug = m.kind.replace(/_/g, '-');
  const file = `hl-${n}-${slug}-${m.trial}.mcpr`;
  // The clip: before..after around the moment, within the replay (a death's
  // replay ends as Jev leaves; stop short of its end).
  const end = rec.start + rec.duration - 700;
  const to = Math.min(m.t + m.after * 1000, end), from = Math.max(rec.start, m.t - m.before * 1000);
  const entry = {
    n: i + 1, category: m.category, kind: m.kind, trial: m.trial, port: m.port,
    utc: iso(m.t), local: local(m.t), caption: m.caption,
    decision: m.decision || null,
    position: m.p ? { x: r1(m.p.x), y: r1(m.p.y), z: r1(m.p.z) } : null, dimension: m.dim || null,
    evidence: m.evidence || [], ...(m.cause ? { cause: m.cause } : {}),
    recording: rec.file, recordingStartUtc: iso(rec.start), recordingSeconds: Math.round(rec.duration / 1000),
    secondsIn: Math.round((m.t - rec.start) / 1000),
    clip: { fromSeconds: Math.round((from - rec.start) / 1000), toSeconds: Math.round((to - rec.start) / 1000), before: m.before, after: m.after },
    file, score: r1(m.score),
  };
  if (!flag('dry')) {
    try {
      fs.mkdirSync(OUT, { recursive: true });
      const target = path.join(OUT, file);
      fs.copyFileSync(rec.file, target);
      // The camera: Jev's frames over the clip; a death's stop at it (the
      // respawn is elsewhere, and in the replay he is gone).
      const frames = (tracks.get(m.trial) || []).filter(f => f.t >= from - 3000 && f.t <= to && (!m.death || (f.t <= m.t + 500 && f.dim === (m.dim || f.dim))));
      if (frames.length >= 3) {
        const cam = cameraTimeline({ frames, from, to, recStart: rec.start, ...(m.camera || {}) });
        writeTimeline(target, cam.timeline);
        entry.camera = { keyframes: cam.keyframes, fromSeconds: Math.round(cam.t0 / 1000), toSeconds: Math.round(cam.t1 / 1000) };
      } else entry.cameraError = `too few frames (${frames.length})`;
    } catch (err) { entry.copyError = err.message; }
  }
  out.push(entry);
});

// What was asked for and not found among the candidates.
const wanted = { rod: 4, kill: 0, milestone: 2, death: 4 };
const have = c => out.filter(m => m.category === c).length;
const missing = [];
if (have('rod') + have('kill') < 4) missing.push(`only ${have('rod') + have('kill')} kills or rods`);
for (const [c, n] of Object.entries(wanted)) if (n && have(c) < n) missing.push(`${c}: ${have(c)} of ${n}`);
for (const k of ['death_ghast', 'death_blaze_swarm', 'death_wither_skeleton', 'death_creeper', 'nether_entered', 'fortress_sighted', 'ghast_kill', 'wither_skeleton_kill', 'hoglin_kill', 'piglin_kill']) if (!out.some(m => m.kind === k)) missing.push(`${k}: ${all.some(m => m.kind === k) ? 'found, but no recording covers it or it was left out' : 'none found'}`);

fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts', 'highlights.json'), JSON.stringify({ day: DAY, since: iso(SINCE), generated: iso(Date.now()), replayFolder: OUT, candidates: all.length, withRecording: usable.length, missing, moments: out }, null, 2));
for (const m of out) console.log(`${String(m.n).padStart(2)} ${m.utc} ${m.port} ${m.trial.padEnd(30)} ${m.category.padEnd(9)} ${Math.floor(m.secondsIn / 60)}:${String(m.secondsIn % 60).padStart(2, '0')} in (clip ${m.clip.fromSeconds}-${m.clip.toSeconds}s)  ${m.caption}${m.copyError ? `  [copy failed: ${m.copyError}]` : ''}${m.cameraError ? `  [${m.cameraError}]` : ''}`);
console.log(`${out.length} moments chosen of ${usable.length} with a recording (${all.length} found); artifacts/highlights.json`);
if (missing.length) console.log(`not found: ${missing.join('; ')}`);
