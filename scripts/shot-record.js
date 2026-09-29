'use strict';
// Every shot that landed on the bot, from the flight records (note 676): a
// damage frame whose direct cause is a projectile (a blaze's small fireball,
// a ghast's fireball, an arrow, a trident...). For each: whether a shield was
// carried in the off-hand, whether it was up at the impact (the frame's keys
// carry 'shield' while raised, recorder/observer.js), how long it had been up
// (the lighter frames between, four a second while keys are held), whether
// the bot faced the shot (the shot's first recorded position, else the
// nearest shooter of its kind in sight, within the half in front of the
// look), how long the shot was in view before it landed, and what the bot
// was doing (the work's step, the survival answer, who had the turn).
// Shots that did not land: the frames of kind 'shot' (src/shot-reflex.js
// settle, from note 676 on: every shot on a line to the bot, landed or not,
// with the shield up or down as it ended); records before have none.
//   node scripts/shot-record.js [--from 2026-09-28T00:00:00Z] [--to ISO] [--dir <flight dir>] [--label <prefix>] [--list]
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const dir = opt('--dir', path.join(__dirname, '..', '.bot-state', 'flight'));
const from = Date.parse(opt('--from', '2026-09-28T00:00:00Z')), to = Date.parse(opt('--to', '2100-01-01T00:00:00Z'));
const label = opt('--label', '');

const SHOTS = /^(small_fireball|fireball|dragon_fireball|arrow|spectral_arrow|trident|wither_skull|shulker_bullet|llama_spit|wind_charge|breeze_wind_charge)$/;
const SHOOTER = { small_fireball: ['blaze'], fireball: ['ghast'], arrow: ['skeleton', 'stray', 'bogged', 'pillager', 'piglin'], trident: ['drowned'], wither_skull: ['wither'] };
const round = n => Math.round(n * 10) / 10;

// The angle, in degrees, between where the bot looks (flat) and a point.
function angleTo(yaw, here, there) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), dx = there.x - here.x, dz = there.z - here.z, n = Math.hypot(dx, dz);
  if (!n) return null;
  return Math.round(Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / n))) * 180 / Math.PI);
}

const lightRe = { at: /"at":"([^"]+)"\}\s*$/, keys: /"keys":\[([^\]]*)\]/, kind: /^\{"kind":"([a-z_]+)"/ };
const projRe = /\{"id":(\d+),"name":"([a-z_]+)","position":\{"x":([-\d.e]+),"y":([-\d.e]+),"z":([-\d.e]+)\},"kind":"projectile"\}/g;

async function readFile(file, hits, blocks) {
  const seen = new Map();   // projectile id -> { t, pos, name }
  let raised = [];          // [t, up] from every frame with keys
  let policy = null;        // the last shield_policy answer
  let times = [];           // every frame's time, for the gaps before a hit (the event loop held)
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const at = lightRe.at.exec(line)?.[1];
    if (!at) continue;
    const t = Date.parse(at);
    if (!(t >= from - 60000 && t <= to)) continue;
    const kind = lightRe.kind.exec(line)?.[1];
    times.push(t); if (times.length > 400) times = times.slice(-200);
    const keys = lightRe.keys.exec(line)?.[1];
    if (keys !== undefined) { raised.push([t, /"shield"/.test(keys)]); if (raised.length > 200) raised = raised.slice(-100); }
    if (line.includes('"kind":"projectile"')) {
      for (const m of line.matchAll(projRe)) {
        const id = +m[1];
        if (!seen.has(id)) seen.set(id, { t, pos: { x: +m[3], y: +m[4], z: +m[5] }, name: m[2] });
      }
      if (seen.size > 2000) for (const [id, s] of seen) if (t - s.t > 30000) seen.delete(id);
    }
    if (kind === 'decision' && line.includes('"id":"shield_policy"')) {
      const o = JSON.parse(line);
      policy = { choice: o.snapshot?.decision?.path?.[0], t };
    }
    if (kind === 'shot') { if (t >= from) { const d = JSON.parse(line).detail || {}; blocks.push({ file: path.basename(file), t, shield: d.shield, landed: !!d.landed, by: d.by || null }); } continue; }
    if (kind !== 'damage' || t < from) continue;
    const o = JSON.parse(line), d = o.detail || {}, s = o.snapshot || {};
    const direct = d.direct || null;
    if (!(direct && SHOTS.test(direct)) && !['arrow', 'trident', 'fireball', 'unattributed_fireball', 'wither_skull', 'mob_projectile'].includes(d.type)) continue;
    const name = direct || d.type;
    const here = s.position;
    if (!here) continue;
    // The shot that hit: of its kind, nearest the bot in this frame.
    const eye = { x: here.x, y: here.y + 1.6, z: here.z };
    const dist = p => Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
    const shots = (s.entities || []).filter(e => e.kind === 'projectile' && e.name === name && e.position).sort((a, b) => dist(a.position) - dist(b.position));
    const shot = shots[0], first = shot && seen.get(shot.id);
    const shooters = (s.mobs || []).filter(m => (SHOOTER[name] || [d.cause]).includes(m.name) && m.at).sort((a, b) => a.d - b.d);
    const shooterSeen = shooters.find(m => m.seen) || shooters[0];
    const origin = first && first.t < t ? first.pos : shooterSeen?.at || shot?.position || null;
    const ang = origin && typeof s.yaw === 'number' ? angleTo(s.yaw, here, origin) : null;
    // Up at the impact, and since when; down since when.
    const up = (s.keys || []).includes('shield');
    let since = null, downSince = null;
    for (let i = raised.length - 1; i >= 0; i--) {
      const [rt, r] = raised[i];
      if (rt > t) continue;
      if (up && !r) { since = t - rt; break; }
      if (!up && r) { downSince = t - rt; break; }
    }
    // The longest silence in the recorder's frames in the three seconds
    // before: the observer samples every second (four a second with keys
    // held), so a gap well over a second is the event loop held up.
    let gapMs = 0;
    for (let i = times.length - 1; i > 0 && times[i] > t - 3000; i--) if (times[i] <= t) gapMs = Math.max(gapMs, times[i] - times[i - 1]);
    const question = s.question ? { id: s.question.id, outMs: t - Date.parse(s.question.at) } : null;
    const upWithin1s = raised.some(([rt, r]) => r && rt <= t && t - rt <= 1000);
    hits.push({ file: path.basename(file), at: o.at, t, name, cause: d.cause, carried: s.equipment?.offhand === 'shield', up, upForMs: since, downForMs: downSince, upWithin1s,
      angle: ang, facing: ang == null ? null : ang < 90, flightMs: first && first.t < t ? t - first.t : null, shooterD: shooterSeen?.d ?? null,
      step: s.goal?.step?.action || s.step?.action || null, survival: s.goal?.survivalAction?.action || null, holder: s.turn?.holder || null, phase: s.turn?.phase || null,
      moving: (s.keys || []).some(k => ['forward', 'back', 'left', 'right', 'sprint', 'jump'].includes(k)) || !!s.pathing, onGround: s.onGround, health: s.health,
      policy: policy && t - policy.t < 60000 ? policy.choice : null, gapMs, question, holderMs: s.turn?.forMs ?? null });
  }
}

(async () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!label || f.startsWith(label))).filter(f => {
    const m = /(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d)/.exec(f);
    const st = fs.statSync(path.join(dir, f));
    return st.mtimeMs >= from && (!m || Date.parse(m[1].replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3Z')) <= to);
  });
  const hits = [], blocks = [];
  for (const f of files) await readFile(path.join(dir, f), hits, blocks);
  if (args.includes('--list')) { for (const h of hits) console.log(JSON.stringify(h)); return; }
  const count = (list, key) => list.reduce((m, h) => { const k = key(h); m[k] = (m[k] || 0) + 1; return m; }, {});
  const carried = hits.filter(h => h.carried);
  const why = h => !h.up ? (h.upWithin1s ? 'lowered within the second before' : 'not raised')
    : h.facing === false ? 'raised, facing away' : h.upForMs != null && h.upForMs < 250 ? 'raised under a quarter second before' : h.facing == null ? 'raised, facing unknown' : 'raised and facing (leaked)';
  const doing = h => h.holder === 'survival' ? `survival: ${h.survival || '?'}` : h.holder === 'work' ? `work: ${h.step || '?'}` : h.holder ? `${h.holder}${h.holder === 'decision' ? `: ${String(h.phase || '').replace('asking Jev: ', '')}` : ''}` : 'unknown';
  const report = {
    files: files.length, from: new Date(from).toISOString(),
    shotsLanded: hits.length, byShot: count(hits, h => h.name),
    shieldCarried: carried.length, shieldUpAtImpact: carried.filter(h => h.up).length,
    // From the shot frames (note 676 on): each shot on a line to the bot by
    // the shield as it ended and whether it landed.
    shotsOnALine: count(blocks, b => `shield ${b.shield}, ${b.landed ? 'landed' : 'did not land'}`),
    whyCarriedShotsLanded: count(carried, why),
    facingWhenCarried: count(carried, h => h.facing == null ? 'unknown' : h.facing ? 'shot within the front half' : 'shot from behind or the side'),
    angleWhenCarried: count(carried.filter(h => h.angle != null), h => `${Math.floor(h.angle / 45) * 45}-${Math.floor(h.angle / 45) * 45 + 45}`),
    whoHadTheTurn: count(carried, doing),
    notRaisedByTurn: count(carried.filter(h => !h.up), doing),
    moving: count(carried, h => h.moving ? 'moving' : 'still'),
    policy: count(carried, h => h.policy || 'none standing'),
    flightMs: (() => { const f = carried.map(h => h.flightMs).filter(n => n != null).sort((a, b) => a - b); return f.length ? { n: f.length, median: f[f.length >> 1], p25: f[f.length >> 2], p75: f[(f.length * 3) >> 2] } : null; })(),
    // Decision latency against the event loop: a question out at the
    // impact (and for how long), and the recorder's longest silence before.
    questionOutAtImpact: count(carried.filter(h => !h.up), h => h.question ? `out ${h.question.outMs < 250 ? 'under 0.25 s' : h.question.outMs < 1000 ? '0.25-1 s' : h.question.outMs < 3000 ? '1-3 s' : 'over 3 s'}` : 'none out'),
    questionsOut: count(carried.filter(h => !h.up && h.question), h => h.question.id),
    loopGapBefore: count(carried.filter(h => !h.up), h => h.gapMs > 3000 ? 'over 3 s' : h.gapMs > 1500 ? '1.5-3 s' : 'under 1.5 s'),
    shooterDistance: (() => { const f = carried.map(h => h.shooterD).filter(n => n != null).sort((a, b) => a - b); return f.length ? { n: f.length, median: round(f[f.length >> 1]) } : null; })(),
  };
  console.log(JSON.stringify(report, null, 1));
})();
