#!/usr/bin/env node
'use strict';
// The night on fresh trials, by place (note 789). Per fresh trial
// (progress-audit.js trialRecords, not a fortress or nether checkpoint),
// every Overworld bot-second from its start to its end, Jev-down frames left
// out (scripts/lib/jev-down.js, note 781), is put to:
//   - the hour: night (11500 to 23000, day.js NIGHT to DAWN) or day, from the
//     last timeOfDay a frame carried (a question's state, the join survey),
//     carried on at 20 ticks a second, unknown more than ten minutes after;
//   - the place: surface (y 56 or more), underground (0 to 56) or deep
//     (under 0);
//   - what the bot did: sealed (in a pocket or shelter it sealed, from the
//     seal to a way out or a step of three blocks from it), night mine, slept
//     (or walking to the bed, waiting for bedtime), holding (a stance against
//     mobs: a pillar, a nook, out of sight, a fight), or working (the rest:
//     the work, staying up, food).
// Per place and hour: the minutes of each, the damage taken (health lost
// between frames, not counting a death's fall to 0) and the deaths, each
// per bot-hour; the sealed spells (a seal to its end) with what threatened
// the bot there while sealed (a hostile within 16 blocks or in sight in the
// frames that carry the mobs, a hurt), and the reason the game gives at the
// seal (seal-reason.js on the facts at the seal: a hostile, the surface's
// night, health under 20); the night's questions asked (survival_priority,
// shelter_method, pocket_next, wait_for_day, encounter_stance) per hour.
//
// The replay prices each recorded sealed spell under note 789's hold
// (src/night-record.js holdEnds, replaySpell below): a stay is held until
// the seal's reasons end (dawn for the surface's night, nothing hostile within
// 16 blocks or in sight for 30 s for a threat, health back for healing), so a
// pocket_next asked after a stay answer while it holds, with no hurt and no
// mob within 5 blocks since, is not asked; one is asked at the hold's end.
// The minutes after are those to the hold's end and its question, had a way
// out been taken then (an upper bound on what is saved); a seal with no reason
// under the rock is counted apart (not offered since note 773). Sleeps: each
// sleep or refusal reported, the nearest monster then and the hurt in the
// minute after.
//
//   node scripts/night-time.js [--since 2026-09-30T12:00:00Z] [--from ISO]
//        [--to ISO] [--json] [--examples N]
// JEV_ROOT reads another checkout's records (from a worktree). Read-only.
const fs = require('fs');
const path = require('path');
const W = require('./wasted-minutes');
const audit = require('./trials/progress-audit');
const { sealReason } = require('../src/seal-reason');
const NR = require('../src/night-record');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const has = name => args.includes(name);
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const GAP_MS = 30000, TOD_STALE_MS = 10 * 60000, CURRENT_MS = 20000, MOVED = 3;
const NIGHT = 11500, DAWN = 23000;
const round = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;
const HOSTILE = new Set(['zombie', 'zombie_villager', 'husk', 'drowned', 'skeleton', 'stray', 'bogged', 'parched', 'creeper', 'spider', 'cave_spider', 'witch', 'pillager', 'vindicator',
  'evoker', 'ravager', 'phantom', 'slime', 'silverfish', 'enderman', 'warden', 'breeze', 'creaking', 'vex', 'guardian', 'elder_guardian']);

// What the bot did, from the survival action while it is current.
const SEAL = /^(sheltered|wait_in_shelter|wait_for_day_sealed|seal_shelter|dig_in|shaft_pocket|work_in_pocket|box_here|dig_nook)$/;
const SEAL_START = /^(sheltered|wait_for_day_sealed|seal_shelter|dig_in|shaft_pocket|box_here)$/;
const LEAVE = /^(leave_shelter|tunnel_out|night_mine|surface|return_to_surface|keep_working|leave_and_heal|stay_up|seal_failed|no_shelter_here|shelter_unreachable|night_hunt|search_food|go_home_for_food|bed_recover)$/;
const SLEEP = /^(sleep|sleep_in_bed|sleep_failed|bed_nook|bed_left|bed_recovered|bed_lost|wait_for_bedtime|go_home_for_night|village_bed|evening_chore)$/;
const HOLD = /^(pillar_hold|out_of_sight_hold|out_of_sight|fight|defend|charge|charge_nearest|take_cover|back_to_wall|nook_hold|shield_guard|block_shot|block_creeper|creeper_close_in|creeper_back_off|creeper_hold|hold_on_span|dig_in_bunker|dig_in_and_fight|fight_from_footing|fight_at_spawner|close_on_shooter|corner_ambush|shield_the_blast|escape_threat|out_of_line|fight_in_pocket|pillar_from|strike_from_above|close_in|await_in_reach|open_on_watcher|hold_defensive_position|leave_reach|shoot)$/;
const ASKS = new Set(['survival_priority', 'shelter_method', 'pocket_next', 'encounter_stance', 'turn_priority']);
const NIGHT_ASKS = new Set(['survival_priority', 'shelter_method', 'pocket_next']);

const bandOf = y => !Number.isFinite(y) ? null : y >= NR.SURFACE_Y ? 'surface' : y >= NR.DEEP_Y ? 'underground' : 'deep';
const isNight = tod => Number.isFinite(tod) && tod >= NIGHT && tod < DAWN;

function slimFrame(line, t) {
  let raw; try { raw = JSON.parse(line); } catch (_) { return null; }
  const o = W.slim(raw, t);
  const s = raw.snapshot || {};
  const tm = line.match(/"timeOfDay":(\d+)/);
  if (tm) o.tod = +tm[1];
  if (raw.kind === 'join_survey' && Number.isFinite(raw.detail?.timeOfDay)) o.tod = raw.detail.timeOfDay;
  if (Array.isArray(s.mobs)) {
    const h = s.mobs.filter(m => HOSTILE.has(m.name) && Number.isFinite(m.d));
    o.mobs = { near16: h.filter(m => m.d <= 16).length, seen24: h.filter(m => m.seen && m.d <= 24).length, nearest: h.length ? Math.min(...h.map(m => m.d)) : null,
      list: h.filter(m => m.d <= 24).map(m => ({ name: m.name, distance: m.d, visible: !!m.seen })) };
  }
  if (raw.kind === 'decision' && s.decision?.id) {
    const d = s.decision, st = d.state || {};
    o.ask = { id: d.id, path: d.path || [], standIn: !!d.standIn, stale: !!d.stale,
      underground: st.underground ?? st.survivalFacts?.underground ?? (st.blocksToOpenSky != null ? st.blocksToOpenSky > 0 : null),
      count: st.riskNow?.hostilesWithin?.count ?? null, inSight: st.riskNow?.hostilesWithin?.inSight ?? null };
  }
  return o;
}

function readTrial(tr, files, to) {
  const end = Math.min(tr.end, to);
  const frames = [];
  for (const { f, start: fs0, next } of files) {
    if (next < tr.start - 60000 || fs0 > end) continue;
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const i = line.lastIndexOf('"at":"');
      const t = i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6)));
      if (!(t >= tr.start && t <= end)) continue;
      const o = slimFrame(line, t);
      if (o) frames.push(o);
    }
  }
  frames.sort((a, b) => a.t - b.t);
  return frames;
}

function blank() { return { ms: 0, hurt: 0, deaths: 0 }; }

// One trial's nights and days.
function measure(frames, { examples = [], maxExamples = 0 } = {}) {
  const cells = {};            // `${band}|${hour}|${doing}` -> { ms, hurt, deaths }
  const spells = [];           // sealed spells
  const asks = {};             // `${band}|${hour}` -> { id -> n }
  let anchor = null, sa = null, lastHp = null, spell = null, lastUg = null;
  const lastAsks = [], sleeps = [];
  let lastSaAt = null;
  const cell = k => cells[k] ||= blank();
  const todAt = t => anchor && t - anchor.t <= TOD_STALE_MS ? Math.floor(anchor.tod + (t - anchor.t) / 50) % 24000 : null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (Number.isFinite(f.tod)) anchor = { t: f.t, tod: f.tod };
    if (f.ask && f.ask.underground != null) lastUg = { t: f.t, ug: f.ask.underground, p: f.p };
    if (f.sa) sa = f.sa;
    // Sleeps (and refusals) as they are reported: the monsters about then
    // (the nearest frame that carries the mobs), and the hurt in the minute after.
    if (f.sa && f.sa.at !== lastSaAt) {
      lastSaAt = f.sa.at;
      if (/^(sleep|sleep_failed|sleep_interrupted)$/.test(f.sa.a) && f.t - f.sa.at < 5000) {
        const near = frames.slice(Math.max(0, i - 20), i + 20).filter(x => x.mobs && Math.abs(x.t - f.t) <= 5000).sort((a, b) => Math.abs(a.t - f.t) - Math.abs(b.t - f.t))[0];
        const after = frames.slice(i, i + 400).filter(x => x.t - f.t <= 60000 && Number.isFinite(x.hp));
        let hurt = 0, died = false, prev = f.hp;
        for (const x of after) { if (x.hp <= 0 && prev > 0) died = true; else if (x.hp < prev) hurt += prev - x.hp; prev = x.hp; }
        sleeps.push({ t: f.t, a: f.sa.a, nearest: near?.mobs?.nearest ?? null, list: (near?.mobs?.list || []).slice(0, 4), within8: (near?.mobs?.list || []).filter(m => m.distance <= 8).length, within16: near?.mobs?.near16 ?? null, hurt, died });
      }
    }
    if (f.ask && !f.ask.standIn && !f.ask.stale) { lastAsks.push(f); if (lastAsks.length > 12) lastAsks.shift(); }
    if (f.jd) { lastHp = f.hp ?? lastHp; continue; }
    if (f.dim && f.dim !== 'overworld') { if (spell) { spell.end = f.t; spells.push(spell); spell = null; } lastHp = f.hp ?? lastHp; continue; }
    const tod = todAt(f.t);
    const hour = tod == null ? 'unknown' : isNight(tod) ? 'night' : 'day';
    const band = bandOf(f.p?.y);
    const cur = sa && sa.at && f.t - sa.at < CURRENT_MS ? sa.a : null;
    // Sealed spells: from a seal to a way out or a step away.
    if (!spell && sa && SEAL_START.test(sa.a) && sa.at && f.t - sa.at < CURRENT_MS && f.p) {
      const atSeal = frames.slice(Math.max(0, i - 40), i + 1).reverse().find(x => x.mobs);
      const ug = lastUg && f.t - lastUg.t < 120000 ? lastUg.ug : band !== 'surface';
      spell = { start: f.t, p: f.p, band, hour, tod, hp0: f.hp ?? 20, food0: f.food ?? 20, ug, hurt: 0, deaths: 0, near16: 0, seen: 0, threatAt: [],
        mobs0: atSeal?.mobs?.list || [], asks: 0, pocketAsks: 0, pocket: [], hurts: [], close: [], hpBackAt: null, clearSince: null, clearAt: null, sa: sa.a, todEnd: null };
      const by = lastAsks.slice().reverse().find(x => f.t - x.t <= 20000 && /^(survival_priority|shelter_method|encounter_stance|pocket_next|turn_priority)$/.test(x.ask.id) && x.ask.id !== 'turn_priority');
      spell.by = by ? `${by.ask.id}>${by.ask.path.join('/')}` : 'no question within 20 s';
      spell.why = sealReason({ health: spell.hp0, food: spell.food0, underground: !!ug, night: isNight(tod), hostiles: spell.mobs0 });
      if (spell.why.kinds.includes('threat')) spell.clearSince = null; else spell.clearAt = f.t;
    }
    if (spell) {
      const moved = f.p && Math.hypot(f.p.x - spell.p.x, f.p.y - spell.p.y, f.p.z - spell.p.z) > MOVED;
      const left = sa && LEAVE.test(sa.a) && sa.at > spell.start;
      if (moved || left || f.t - spell.start > 30 * 60000) { spell.end = f.t; spell.how = moved ? 'stepped away' : sa.a; spells.push(spell); spell = null; }
    }
    const doing = spell ? 'sealed' : cur === 'night_mine' ? 'night_mine' : cur && SLEEP.test(cur) ? 'slept' : cur && HOLD.test(cur) ? 'holding' : 'working';
    // The time to the next frame.
    const n = frames[i + 1];
    const dt = n ? n.t - f.t : 0;
    if (band && dt > 0 && dt <= GAP_MS) cell(`${band}|${hour}|${doing}`).ms += dt;
    // Hurt and deaths at this frame, put to the place and hour.
    if (band && Number.isFinite(f.hp) && Number.isFinite(lastHp)) {
      if (f.hp <= 0 && lastHp > 0) { cell(`${band}|${hour}|${doing}`).deaths++; if (spell) spell.deaths++; }
      else if (f.hp < lastHp && f.hp > 0) { cell(`${band}|${hour}|${doing}`).hurt += lastHp - f.hp; if (spell) { spell.hurt += lastHp - f.hp; spell.hurts.push(f.t); } }
    }
    if (Number.isFinite(f.hp)) lastHp = f.hp;
    if (spell) {
      if (f.mobs) {
        if (f.mobs.near16) spell.near16++;
        if (f.mobs.seen24) spell.seen++;
        if (f.mobs.nearest != null && f.mobs.nearest <= 5) spell.close.push(f.t);
        const threat = f.mobs.near16 > 0 || f.mobs.seen24 > 0;
        if (threat) spell.clearAt = null; else if (spell.clearAt == null) spell.clearAt = f.t;
      }
      if (spell.clearAt != null && f.t - spell.clearAt >= NR.CLEAR_MS && spell.threatGoneAt == null && spell.why.kinds.includes('threat')) spell.threatGoneAt = f.t;
      if (spell.hpBackAt == null && Number.isFinite(f.hp) && f.hp >= 20 && spell.hp0 < 20) spell.hpBackAt = f.t;
      if (spell.todEnd == null && tod != null && !isNight(tod) && spell.hour === 'night') spell.todEnd = f.t;
    }
    if (f.ask && !f.ask.standIn && !f.ask.stale && ASKS.has(f.ask.id) && band) {
      const k = `${band}|${hour}`;
      const a = asks[k] ||= {};
      a[f.ask.id] = (a[f.ask.id] || 0) + 1;
      if (spell) { if (NIGHT_ASKS.has(f.ask.id)) spell.asks++; if (f.ask.id === 'pocket_next') { spell.pocketAsks++; spell.pocket.push({ t: f.t, answer: f.ask.path[0] }); } }
    }
  }
  if (spell) { spell.end = frames.at(-1)?.t ?? spell.start; spell.how = 'trial ended'; spells.push(spell); }
  for (const s of spells) { s.min = (s.end - s.start) / 60000; if (maxExamples && examples.length < maxExamples && s.min >= 1) examples.push(s); }
  return { cells, spells, asks, sleeps };
}

function portFiles(port) {
  const identity = `127_0_0_1-${port}-Jev`;
  let names = [];
  try { names = fs.readdirSync(FLIGHT); } catch (_) { return []; }
  const ms = s => { const m = s.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
  const files = names.filter(f => f.startsWith(identity + '-') && f.endsWith('.jsonl'))
    .map(f => ({ f: path.join(FLIGHT, f), start: ms(f.slice(identity.length + 1)) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  files.forEach((x, i) => { x.next = files[i + 1]?.start ?? Infinity; });
  return files;
}

// The hold's end under note 789 (night-record.js holdEnds), from the spell's
// own frames: -> { held: false } (no hold: asked as before), or { held: true,
// endMs } with endMs the ms after the seal its last reason ended, null when
// one of them outlasted the spell.
function replayEnd(s) {
  const r = NR.holdEnds({ reason: s.why });
  if (!r.held) return { held: false };
  // The hold lasts while any of its reasons holds: it ends when the last
  // of them ends.
  const ends = [];
  if (r.dawn) ends.push(s.todEnd != null ? s.todEnd - s.start : null);
  if (r.threat) ends.push(s.threatGoneAt != null ? s.threatGoneAt - s.start : null);
  if (r.heal) ends.push(s.hpBackAt != null ? s.hpBackAt - s.start : s.hp0 >= 20 ? 0 : null);
  return { held: true, endMs: ends.includes(null) ? null : Math.max(...ends) };
}

// One spell replayed: the pocket's asks and the minutes sealed under the
// hold. A pocket_next asked after a stay answer while the hold holds, with no
// hurt and no mob within 5 blocks since that answer, is not asked; one is
// asked at the hold's end when the spell outlived it. The minutes: sealed
// to the hold's end and the question then (five seconds), had Jev taken a
// way out at that question (an upper bound on what is saved); a seal with no
// reason under the rock is not offered (note 773's rule, live from 02:16Z).
function replaySpell(s) {
  const durMs = s.end - s.start;
  if (s.why.none && s.ug) return { asks: 0, ms: 0, pastMs: 0, offered: false };
  const h = replayEnd(s);
  let asks = 0, lastStay = null;
  for (const a of s.pocket) {
    const holds = h.held && (h.endMs == null || a.t - s.start < h.endMs);
    const quiet = lastStay != null && !s.hurts.some(t => t > lastStay && t <= a.t) && !s.close.some(t => t > lastStay && t <= a.t);
    if (!(holds && quiet)) asks++;
    lastStay = a.answer === 'stay' ? a.t : null;
  }
  if (!h.held || h.endMs == null || h.endMs >= durMs) return { asks, ms: durMs, pastMs: 0, offered: true };
  if (!s.pocket.some(a => a.t - s.start >= h.endMs && a.t - s.start <= h.endMs + 10000)) asks++;
  return { asks, ms: Math.min(durMs, h.endMs + 5000), pastMs: durMs - h.endMs, offered: true };
}

function main() {
  const since = Date.parse(opt('--since', '2026-09-30T12:00:00Z'));
  const to = opt('--to', null) ? Date.parse(opt('--to', null)) : Infinity;
  const maxExamples = Number(opt('--examples', 0)) || 0;
  const from = opt('--from', null) ? Date.parse(opt('--from')) : -Infinity;
  const trials = audit.trialRecords({ since: since - 1, flight: FLIGHT }).filter(t => t.port && t.start < to && t.end > from && !/\/stages\/(fortress|nether)\//.test(t.source || ''));
  const filesBy = new Map();
  const cells = {}, asks = {}, spells = [], examples = [], worlds = {}, sleeps = [];
  const sourceOf = tr => (String(tr.source || '').match(/first-days-(\d+)/) || String(tr.world || '').match(/^mid-(\d+)/) || [])[1] || '?';
  trials.forEach((tr, i) => {
    if (!filesBy.has(tr.port)) filesBy.set(tr.port, portFiles(tr.port));
    process.stderr.write(`\r${i + 1}/${trials.length} ${tr.world}`.padEnd(60));
    const m = measure(readTrial(tr, filesBy.get(tr.port), to).filter(f => f.t >= from), { examples, maxExamples });
    for (const [k, c] of Object.entries(m.cells)) { const o = cells[k] ||= blank(); o.ms += c.ms; o.hurt += c.hurt; o.deaths += c.deaths;
      const [, hour, doing] = k.split('|'); const w = worlds[sourceOf(tr)] ||= {}; const key = hour === 'night' ? doing : 'day'; w[key] = (w[key] || 0) + c.ms / 60000; w.all = (w.all || 0) + c.ms / 60000; }
    for (const [k, a] of Object.entries(m.asks)) { const o = asks[k] ||= {}; for (const [id, n] of Object.entries(a)) o[id] = (o[id] || 0) + n; }
    for (const s of m.spells) spells.push({ ...s, port: tr.port, world: tr.world });
    for (const s of m.sleeps) sleeps.push({ ...s, port: tr.port });
  });
  process.stderr.write('\n');
  const BANDS = ['surface', 'underground', 'deep'], DOING = ['working', 'sealed', 'night_mine', 'holding', 'slept'];
  const out = { since: new Date(since).toISOString(), trials: trials.length, places: {}, spells: {}, asks, sleeps, worlds };
  for (const band of BANDS) for (const hour of ['night', 'day']) {
    const row = out.places[`${band}|${hour}`] = {};
    for (const doing of DOING) {
      const c = cells[`${band}|${hour}|${doing}`]; if (!c || c.ms < 1000) continue;
      const h = c.ms / 3600000;
      row[doing] = { minutes: round(c.ms / 60000), damage: round(c.hurt), deaths: c.deaths, damagePerHour: round(c.hurt / h), deathsPerHour: round(c.deaths / h, 2) };
    }
  }
  // Sealed spells, by place and hour, with the threat while sealed.
  for (const s of spells) {
    const k = `${s.band}|${s.hour}`;
    const byKey = String(s.by).replace(/^(\w+)>([^/]+).*$/, '$1>$2');
    const o = out.spells[k] ||= { spells: 0, by: {}, minutes: 0, threatened: 0, hurt: 0, deaths: 0, quiet: 0, quietMinutes: 0, byReason: {}, asks: 0, pocketAsks: 0, replayMinutes: 0, replayAsks: 0 };
    o.spells++; o.minutes += s.min;
    const b = o.by[byKey] ||= { n: 0, min: 0, quiet: 0 }; b.n++; b.min = round(b.min + s.min); if (!(s.near16 > 0 || s.seen > 0 || s.hurt > 0 || s.deaths > 0)) b.quiet++; o.asks += s.asks; o.pocketAsks += s.pocketAsks;
    const threatened = s.near16 > 0 || s.seen > 0 || s.hurt > 0 || s.deaths > 0;
    if (threatened) o.threatened++; else { o.quiet++; o.quietMinutes += s.min; }
    o.hurt += s.hurt; o.deaths += s.deaths;
    const why = s.why.none ? 'none' : s.why.kinds[0];
    o.byReason[why] = (o.byReason[why] || 0) + 1;
    const r = replaySpell(s);
    o.replayMinutes += r.ms / 60000; o.replayAsks += r.asks; o.pastReasons = (o.pastReasons || 0) + r.pastMs / 60000;
    if (!r.offered) { o.notOffered = (o.notOffered || 0) + 1; o.notOfferedMinutes = (o.notOfferedMinutes || 0) + s.min; }
    s.replayMin = r.ms / 60000;
  }
  for (const o of Object.values(out.spells)) for (const k of ['minutes', 'quietMinutes', 'replayMinutes', 'hurt', 'pastReasons', 'notOfferedMinutes']) if (o[k] != null) o[k] = round(o[k]);
  if (has('--json')) { console.log(JSON.stringify(out, null, 1)); return; }
  console.log(`Fresh trials since ${out.since}: ${trials.length}; Overworld bot-time by place and hour (Jev-down frames left out).`);
  for (const [k, row] of Object.entries(out.places)) {
    const tot = Object.values(row).reduce((n, r) => n + r.minutes, 0);
    if (!tot) continue;
    console.log(`\n${k}: ${round(tot)} min`);
    for (const [d, r] of Object.entries(row)) console.log(`  ${d.padEnd(11)} ${String(r.minutes).padStart(7)} min  damage ${String(r.damage).padStart(6)} (${r.damagePerHour}/h)  deaths ${r.deaths} (${r.deathsPerHour}/h)`);
  }
  console.log('\nSealed spells (a seal to its end), by place and hour:');
  for (const [k, o] of Object.entries(out.spells)) console.log(`  ${k}: ${o.spells} spells, ${o.minutes} min; threatened while sealed (a hostile within 16 or in sight, or hurt) ${o.threatened}, quiet ${o.quiet} (${o.quietMinutes} min); hurt ${o.hurt}, deaths ${o.deaths}; reason at the seal ${Object.entries(o.byReason).map(([r, n]) => `${r} ${n}`).join(', ')}; night questions while sealed ${o.asks} (pocket_next ${o.pocketAsks})`);
  console.log('\nReplayed under the hold (note 789): pocket_next asked, sealed minutes (a way out taken at the question at the hold\'s end), minutes sealed past the seal\'s reasons, and seals with no reason under the rock (not offered since note 773):');
  for (const [k, o] of Object.entries(out.spells)) console.log(`  ${k}: pocket_next ${o.pocketAsks} -> ${o.replayAsks}; sealed ${o.minutes} -> ${o.replayMinutes} min; past the reasons ${o.pastReasons || 0} min; no reason under the rock ${o.notOffered || 0} (${o.notOfferedMinutes || 0} min)`);
  for (const [k, o] of Object.entries(out.spells)) console.log(`    ${k} by the question before: ${Object.entries(o.by).sort((a, b) => b[1].min - a[1].min).slice(0, 8).map(([q, b]) => `${q} ${b.n} (${b.min} min, quiet ${b.quiet})`).join('; ')}`);
  console.log(`\nSleeps reported: ${sleeps.length}, by what was reported (${Object.entries(sleeps.reduce((o, x) => (o[x.a] = (o[x.a] || 0) + 1, o), {})).map(([k, n]) => `${k} ${n}`).join(', ')}); with a monster within 8 then ${sleeps.filter(x => x.within8).length}, within 16 ${sleeps.filter(x => x.within16).length}; hurt in the minute after ${sleeps.filter(x => x.hurt > 0).length} (${round(sleeps.reduce((n, x) => n + x.hurt, 0))} health), died ${sleeps.filter(x => x.died).length}.`);
  for (const x of sleeps.filter(x => x.hurt > 0 || x.within16)) console.log(`  ${new Date(x.t).toISOString()} ${x.port} ${x.a}: nearest ${x.nearest ?? '?'} (${x.list.map(m => `${m.name} ${Math.round(m.distance)}${m.visible ? '' : '?'}`).join(', ')}); hurt ${round(x.hurt)}${x.died ? ', died' : ''}`);

  console.log('\nBy source world, Overworld minutes: all, then at night by what the bot did:');
  for (const [w, o] of Object.entries(worlds).sort()) console.log(`  ${w}: ${round(o.all)} min; night ${round(['working', 'sealed', 'night_mine', 'holding', 'slept'].reduce((n, k) => n + (o[k] || 0), 0))} (${['working', 'sealed', 'night_mine', 'holding', 'slept'].map(k => `${k} ${round(o[k] || 0)}`).join(', ')})`);
  console.log('\nQuestions asked, by place and hour (per bot-hour of that place and hour):');
  for (const [k, a] of Object.entries(asks)) {
    const [band, hour] = k.split('|');
    const ms = DOING.reduce((n, d) => n + (cells[`${band}|${hour}|${d}`]?.ms || 0), 0);
    if (ms < 60000) continue;
    console.log(`  ${k}: ${Object.entries(a).sort((x, y) => y[1] - x[1]).map(([id, n]) => `${id} ${n} (${round(n / (ms / 3600000))}/h)`).join(', ')}`);
  }
  if (maxExamples) {
    console.log('\nExamples (sealed a minute or more):');
    for (const s of examples) console.log(`  ${new Date(s.start).toISOString()} ${s.band} ${s.hour} tod ${s.tod} hp ${s.hp0} food ${s.food0} via ${s.sa} after ${s.by}: ${round(s.min)} min, ${s.how}; near16 ${s.near16} seen ${s.seen} hurt ${round(s.hurt)}; ${s.why.none ? 'no reason' : s.why.kinds.join('+')}; replay ${round(s.replayMin ?? s.min)} min`);
  }
}

module.exports = { measure, slimFrame, bandOf, replayEnd, replaySpell };
if (require.main === module) main();
