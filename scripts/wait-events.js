'use strict';
// The waits Jev chose, and which of them waited for nothing (note 698).
// Read from the flight records; read-only. Each decision frame whose answer
// is a wait (the options declared `wait: true`, and the waits of the rest's
// hold) is put through the rule of src/waits.js as far as the frame tells
// it: the option's own words (idle: "Nothing else is on offer from here
// meanwhile"; note 679's pocket "Nothing this wait could wait for is
// coming"; by day "daylight is what the bot already has") and the rest's
// cause (leave_nether's state.why, the stall's escalation or failure). The
// minutes are the time from the answer to the next question asked (at most
// ten), and the still minutes those in which the bot moved under two blocks.
//   node scripts/wait-events.js [--since 2026-09-29T18:00Z] [--until ...] [--port 25591]
const fs = require('node:fs');
const path = require('node:path');
const { timeChanges } = require('../src/waits');
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', new Date(Date.now() - 3 * 3600000).toISOString()));
const until = Date.parse(arg('until', new Date().toISOString()));
const port = arg('port');
const CAP_MS = 10 * 60000;

const WAITS = /^(leave_nether|rung_progress|stillness_detour|portal_way|while_cooking|pocket_next|survival_priority|evening_chore|fortress_leg):(wait_here|until_rest_ends|wait_rest|stay|wait_for_day_sealed|rest_to_heal|wait_for_bedtime|wait_at_spawner)$/;
const IDLE = /Nothing else is on offer from here meanwhile/;
const FOOD = /^(cooked_\w+|beef|porkchop|mutton|chicken|rabbit|bread|apple|golden_apple|carrot|golden_carrot|potato|baked_potato|rotten_flesh|cod|salmon|tropical_fish|\w+_stew|melon_slice|sweet_berries|glow_berries|cookie|pumpkin_pie|dried_kelp|beetroot)$/;
const desc = o => String(o?.description ?? o ?? '');
// -> null (offered under the rule) or why it would not be.
function withdrawn(q, key, d, snap) {
  const words = desc(d.options?.[key]);
  const bot = { game: { dimension: String(snap?.dimension || 'overworld') }, health: snap?.health, food: snap?.food };
  if (key === 'stay') {
    if (/Nothing this wait could wait for is coming/.test(words)) return 'the pocket: what it was sealed against gone, no daylight, no health to gain';
    // Off the Overworld, nothing to gain and no mob within 16 or in sight
    // (pocket-wait.js noneAbout), no spawner said.
    const hp = snap?.health ?? 20, food = snap?.food ?? 20;
    const noFood = !Object.keys(d.state?.inventory || {}).some(n => FOOD.test(n));
    const noGain = hp >= 20 || (food < 18 && noFood);
    const about = (d.state?.threats || []).filter(x => x.distance <= 16 || x.visible);
    return !/overworld/.test(bot.game.dimension) && noGain && !about.length && !/spawner \d+ blocks off makes more/.test(words) ? 'the pocket: no mob within 16 or in sight, no daylight, no health to gain' : null;
  }
  if (key === 'wait_for_day_sealed') return /daylight is what the bot already has/.test(words) ? 'by day: daylight is what it has' : null;
  if (key === 'wait_here' && q === 'leave_nether') return IDLE.test(words) && !timeChanges(d.state?.why, bot) ? `idle, rests for: ${String(d.state?.why || '').slice(0, 80)}` : null;
  if (key === 'until_rest_ends') {
    const s = d.state || {};
    const cause = [s.stalled?.escalated?.says, s.stalled?.error, s.stalled?.failure, s.stalled?.whatFailedBelow, s.stalled?.rung].filter(Boolean).map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
    return IDLE.test(words) && !timeChanges(cause, bot) ? `idle, rests for: ${cause.slice(0, 80) || '(not recorded)'}` : null;
  }
  return null;
}

const dir = path.join(ROOT, '.bot-state', 'flight');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!port || f.includes(`-${port}-Jev-`)))
  .filter(f => { try { return fs.statSync(path.join(dir, f)).mtimeMs >= since; } catch (_) { return false; } });
const tally = {};
const row = k => (tally[k] ||= { chosen: 0, ms: 0, stillMs: 0, gone: 0, goneMs: 0, goneStillMs: 0, why: {} });
let all = { chosen: 0, ms: 0, stillMs: 0, goneMs: 0, goneStillMs: 0, gone: 0 };
for (const f of files) {
  const frames = [];
  let text = ''; try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { continue; } // rotated away meanwhile
  for (const l of text.split('\n')) {
    if (!l || !l.includes('"decision"') && !l.includes('"position"')) continue;
    let o; try { o = JSON.parse(l); } catch (_) { continue; }
    const t = Date.parse(o.at || o.snapshot?.decision?.at || '');
    if (!Number.isFinite(t) || t < since || t > until) continue;
    frames.push({ o, t });
  }
  for (let i = 0; i < frames.length; i++) {
    const { o, t } = frames[i];
    const d = o.snapshot?.decision;
    if (o.kind !== 'decision' || !d?.id) continue;
    const key = d.path?.at?.(-1) || o.label;
    const k = `${d.id}:${key}`;
    if (!WAITS.test(k)) continue;
    // To the next question; the still share by the positions in between.
    let end = t + CAP_MS, still = 0, last = { t, p: o.snapshot?.position };
    for (let j = i + 1; j < frames.length; j++) {
      const f2 = frames[j];
      if (f2.o.kind === 'decision') { end = Math.min(end, f2.t); break; }
      if (f2.t >= end) break;
      const p = f2.o.snapshot?.position;
      if (p && last.p && Math.hypot(p.x - last.p.x, p.z - last.p.z, p.y - last.p.y) < 2) still += f2.t - last.t;
      if (p) last = { t: f2.t, p };
    }
    const ms = Math.max(0, end - t), stillMs = Math.min(ms, still);
    const r = row(k); r.chosen++; r.ms += ms; r.stillMs += stillMs; all.chosen++; all.ms += ms; all.stillMs += stillMs;
    const why = withdrawn(d.id, key, d, { ...o.snapshot, dimension: o.snapshot?.dimension || d.dimension });
    if (why) { r.gone++; r.goneMs += ms; r.goneStillMs += stillMs; r.why[why] = (r.why[why] || 0) + 1; all.gone++; all.goneMs += ms; all.goneStillMs += stillMs; }
  }
}
const h = ms => `${(ms / 3600000).toFixed(2)} h`;
console.log(`Waits chosen since ${new Date(since).toISOString()}: ${all.chosen}, ${h(all.ms)} to the next question (${h(all.stillMs)} of it standing).`);
console.log(`Not offered under note 698's rule: ${all.gone} (${h(all.goneMs)}, ${h(all.goneStillMs)} standing). Left offered: ${all.chosen - all.gone} (${h(all.ms - all.goneMs)}, ${h(all.stillMs - all.goneStillMs)} standing).`);
for (const [k, r] of Object.entries(tally).sort((a, b) => b[1].ms - a[1].ms)) {
  console.log(`  ${k.padEnd(40)} ${String(r.chosen).padStart(4)} chosen ${h(r.ms).padStart(8)} (${h(r.stillMs)} standing); withdrawn ${r.gone}, ${h(r.goneMs)} (${h(r.goneStillMs)} standing)`);
  for (const [w, n] of Object.entries(r.why).sort((a, b) => b[1] - a[1]).slice(0, 3)) console.log(`      ${n} x ${w}`);
}
