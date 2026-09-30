'use strict';
// The flight recorder, analysed for a window of time: shared by the day
// audit (scripts/audit-day.js) and the first-days trial verdict
// (scripts/first-days.js), so the report and the verdict count the same way.
const fs = require('fs');
const path = require('path');

function analyse({ identity, from, to, dir = path.join(__dirname, '..', '..', '.bot-state', 'flight') }) {

  // Every file that may hold frames in the window: named by its start time.
  const files = fs.readdirSync(dir).filter(f => f.startsWith(identity + '-') && f.endsWith('.jsonl'))
    .map(f => ({ f, start: Date.parse(f.slice(identity.length + 1, -6).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, 'T$1:$2:$3.$4Z')) }))
    .sort((a, b) => a.start - b.start);
  const frames = [];
  files.forEach(({ f, start }, i) => {
    const next = files[i + 1]?.start ?? Infinity;
    if (next < from || start > to) return;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch (_) { continue; }
      const at = Date.parse(r.at);
      if (at >= from && at <= to) frames.push({ ...r, t: at, file: f });
    }
  });
  frames.sort((a, b) => a.t - b.t);
  if (!frames.length) return null;

  const clock = t => new Date(t).toISOString().slice(11, 19);
  const secs = ms => Math.round(ms / 1000);
  const pos = s => s?.position ? `(${Math.round(s.position.x)}, ${Math.round(s.position.y)}, ${Math.round(s.position.z)})` : '?';
  const stepOf = s => s?.step?.action || s?.goal?.step?.action || null;
  const survivalOf = s => s?.survivalAction?.action || s?.goal?.survivalAction?.action || null;
  // The survival action stays in the snapshot after it ends: only a recent one
  // is what the bot is doing (the first audit charged six minutes to "eat").
  const currentSurvival = (s, t) => { const a = s?.survivalAction || s?.goal?.survivalAction; return a && (!a.at || t - Date.parse(a.at) < 8000) ? a.action : null; };
  const dist = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0;
  const obs = frames.filter(f => f.kind === 'observation' && f.snapshot?.position);

  // Where the time went: each observation second charged to the survival
  // action if one is current and recent, otherwise to the work step.
  const time = {};
  for (let i = 0; i < obs.length - 1; i++) {
    const s = obs[i].snapshot, dt = Math.min(obs[i + 1].t - obs[i].t, 5000);
    const survival = currentSurvival(s, obs[i].t), step = stepOf(s);
    const key = survival ? `survival:${survival}` : `step:${step || 'none'}`;
    time[key] = (time[key] || 0) + dt;
  }

  // Stretches of standing still: under half a block from where the stretch
  // began, for twenty seconds or more. Waiting in a shelter or a bed at night
  // is labelled as such rather than hidden.
  const WAITS = new Set(['wait_in_shelter', 'sleep', 'sleep_in_bed', 'wait_for_bedtime', 'hold_defensive_position']);
  const still = [];
  for (let i = 0; i < obs.length;) {
    let j = i;
    while (j + 1 < obs.length && dist(obs[j + 1].snapshot.position, obs[i].snapshot.position) < 0.5) j++;
    const span = obs[j].t - obs[i].t;
    if (span >= 20000) {
      const s = obs[i].snapshot, survivals = new Set(obs.slice(i, j + 1).map(o => currentSurvival(o.snapshot, o.t)).filter(Boolean));
      still.push({ from: obs[i].t, to: obs[j].t, seconds: secs(span), at: pos(s), step: stepOf(s), survival: [...survivals].join('/'),
        waiting: [...survivals].some(a => WAITS.has(a)) });
    }
    i = j + 1;
  }

  // In water: air below full, or the shore and surfacing actions.
  const wet = [];
  for (let i = 0; i < obs.length;) {
    // The surfacing action by its exact name: "return_to_surface" and
    // "ascend_to_surface" are walks up out of a mine, not water.
    const inWater = o => (o.snapshot.oxygen ?? 20) < 20 || /^(reach_shore|surface|swim)$/.test(survivalOf(o.snapshot) || '') || /^(reach_shore|dig_to_shore)$/.test(stepOf(o.snapshot) || '');
    if (!inWater(obs[i])) { i++; continue; }
    let j = i;
    while (j + 1 < obs.length && (inWater(obs[j + 1]) || obs[j + 1].t - obs[j].t < 3000 && inWater(obs[Math.min(j + 2, obs.length - 1)]))) j++;
    const span = obs[j].t - obs[i].t;
    if (span >= 10000) wet.push({ from: obs[i].t, to: obs[j].t, seconds: secs(span), at: pos(obs[i].snapshot), minAir: Math.min(...obs.slice(i, j + 1).map(o => o.snapshot.oxygen ?? 20)),
      step: stepOf(obs[i].snapshot), survival: survivalOf(obs[i].snapshot) });
    i = j + 1;
  }

  // Pacing: a minute in which the bot walked more than thirty blocks and ended
  // within five of where it began, and got nothing for it. Walking about a
  // furnace mining the coal round it, an iron pickaxe and a shield made in
  // the minute, is work in a small place, not pacing (the first-days trial
  // 7 was failed for exactly that); the measure is the stall rule's, what
  // is worth keeping (src/stillness.js FILLER).
  const { FILLER } = require('../../src/stillness');
  const inventories = frames.filter(f => f.snapshot?.inventory && typeof f.snapshot.inventory === 'object');
  // What was carried just before the window against everything seen up to
  // just after it: inventories are recorded only with actions and decisions,
  // and a minute of mining often has none inside it (trial 13's iron, 24 raw
  // ore into the furnace at the end of a "pacing" minute).
  // By binary search: scanning every inventory for every candidate window
  // took the verdict five minutes once they were recorded every ten seconds.
  const firstAtOrAfter = t => { let lo = 0, hi = inventories.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (inventories[mid].t < t) lo = mid + 1; else hi = mid; } return lo; };
  const gained = (from, to) => {
    const i = firstAtOrAfter(from + 1) - 1;
    const before = (i >= 0 && inventories[i].t >= from - 60000 ? inventories[i] : null) || (inventories[i + 1]?.t <= to ? inventories[i + 1] : null);
    if (!before) return false;
    const seen = inventories.slice(firstAtOrAfter(before.t + 1), firstAtOrAfter(to + 30001));
    if (!seen.length) return false;
    const first = before.snapshot.inventory, best = {};
    for (const f of seen) for (const [k, n] of Object.entries(f.snapshot.inventory)) if (!FILLER.test(k)) best[k] = Math.max(best[k] || 0, +n || 0);
    return Object.entries(best).some(([k, n]) => n > (+first[k] || 0));
  };
  const pacing = [];
  for (let i = 0; i < obs.length; i++) {
    let j = i, walked = 0;
    while (j + 1 < obs.length && obs[j + 1].t - obs[i].t <= 60000) { walked += dist(obs[j].snapshot.position, obs[j + 1].snapshot.position); j++; }
    if (obs[j].t - obs[i].t >= 50000 && walked > 30 && dist(obs[i].snapshot.position, obs[j].snapshot.position) < 5 && !gained(obs[i].t, obs[j].t)) {
      pacing.push({ from: obs[i].t, to: obs[j].t, walked: Math.round(walked), net: Math.round(dist(obs[i].snapshot.position, obs[j].snapshot.position)), at: pos(obs[i].snapshot), step: stepOf(obs[i].snapshot) });
      i = j;
    }
  }

  // Steps flipping: the work step changing back and forth between the same
  // two actions six times or more within a minute.
  const flips = [];
  const changes = [];
  // A hold's own swing is not a second step: a bunker or a box held with a
  // blaze just past the sword steps out to strike it (blaze_sortie, set by
  // the sortie and reset by the hold's next look), so the step trades names
  // for the length of the hold. mid-242-bc-fortress-4 (25587, 2026-09-28)
  // was failed as "flipping hold_bunker <-> blaze_sortie" on one hold at
  // full health, no loop in it (note 623).
  const HOLDS_OWN = { blaze_sortie: /^hold_(bunker|box)$/ };
  // The ladder's label for the crossing (game-progress.js gameStep writes
  // {action: 'enter_nether', phase: 'reach_nether'} before every pass, note
  // 748) is not a step of its own: a loop of the cast or the lava fetch was
  // failed as "flipping enter_nether <-> fill_bucket" (note 763b), naming
  // the label as half of it. The step it dispatched to is judged alone.
  const label = s => { const st = s?.step || s?.goal?.step; return st?.action === 'enter_nether' && st.phase === 'reach_nether' && Object.keys(st).every(k => ['action', 'phase'].includes(k)); };
  for (const o of obs) {
    const a = stepOf(o.snapshot), held = changes.at(-1)?.a;
    if (a && HOLDS_OWN[a]?.test(held || '')) continue;
    if (label(o.snapshot)) continue;
    if (a && held !== a) changes.push({ a, t: o.t, s: o.snapshot });
  }
  for (let i = 0; i + 6 < changes.length; i++) {
    const win = changes.slice(i, i + 7);
    const names = new Set(win.map(c => c.a));
    // Not a loop when it got somewhere: a tunnel toward an ore and the dig
    // at its end trade names every few seconds while the shaft advances
    // (trial 7: sixteen blocks in the minute). Over five blocks covered, or
    // something worth keeping gained, is progress under two names.
    const covered = Math.max(...win.map(c => dist(c.s.position, win[0].s.position)));
    // Nor when it ends somewhere else: trial 84's tunnel toward iron traded
    // names with the pickup of each block's cobblestone every second or two
    // while it advanced a block each time, five blocks in sixteen seconds,
    // and was failed as a loop. A loop comes back to where it was.
    // A climb is somewhere else too: mid-244-ce built a tower one block at a
    // time toward the last slot of a nine-of-ten portal frame, its walks
    // ending short and the step trading names, and was failed as a flip in
    // the trial's last 47 seconds (note 651). Two blocks up is progress.
    const movedOn = dist(win[6].s.position, win[0].s.position) >= 3 || (win[6].s.position.y - win[0].s.position.y) >= 2;
    // Nor when the step's own count went down: mid-202-c mined cobblestone
    // for its Nether blocks, the mine and the pickup of each block trading
    // names while seventeen to go became twelve, and was failed as a loop;
    // cobblestone is filler to the worth measure (2026-09-26).
    const left = c => { const st = c.s?.step || c.s?.goal?.step; return Number.isFinite(st?.count) ? `${st.action}:${st.drops || st.item}:${st.count}` : null; };
    const counts = win.map(left).filter(Boolean).map(k => ({ key: k.slice(0, k.lastIndexOf(':')), n: Number(k.slice(k.lastIndexOf(':') + 1)) }));
    const countedDown = counts.some((c, j) => counts.slice(j + 1).some(d => d.key === c.key && d.n < c.n));
    if (names.size === 2 && win[6].t - win[0].t <= 60000 && covered < 5 && !movedOn && !countedDown && !gained(win[0].t, win[6].t)) { flips.push({ from: win[0].t, to: win[6].t, between: [...names].join(' <-> '), at: pos(win[0].s) }); i += 6; }
  }

  // Retry loops: "persist" steps and repeated problems, by problem text.
  const problems = {};
  for (const o of obs) {
    const st = o.snapshot.step;
    if (st?.action === 'persist' && st.problem) { const p = problems[st.problem] ||= { count: 0, first: o.t, last: o.t, attempts: new Set() }; p.last = o.t; p.attempts.add(st.attempt); }
  }
  for (const p of Object.values(problems)) p.count = p.attempts.size;

  // Errors, damage, deaths, and what was said.
  const errors = {};
  for (const f of frames.filter(f => f.kind === 'error')) { const k = String(f.label).slice(0, 110); (errors[k] ||= { count: 0, first: f.t, step: stepOf(f.snapshot) }).count++; }
  const damage = [];
  let lastHealth = null;
  for (const f of frames) {
    const h = f.snapshot?.health;
    if (typeof h !== 'number') continue;
    // A fall to nothing is a death however small the last step: mid-205-a
    // died from 0.47 health and, under half a point, it was not counted,
    // so the verdict said no deaths (2026-09-26).
    if (lastHealth !== null && (h < lastHealth - 0.5 || (h <= 0 && lastHealth > 0))) damage.push({ t: f.t, from: lastHealth, to: h, at: pos(f.snapshot), step: stepOf(f.snapshot), survival: survivalOf(f.snapshot) });
    lastHealth = h;
  }
  const deaths = damage.filter(d => d.to <= 0);
  const chat = frames.filter(f => f.kind === 'chat').map(f => ({ t: f.t, text: f.detail?.message || f.label, from: f.detail?.from }));
  // Made and thrown away: a "leaving N X here" said after X was crafted or
  // taken in the same stretch.
  const thrown = chat.filter(c => /leaving \d+ ([a-z _]+) here/i.test(c.text || ''));

  // Jev inference: every decision frame, deduplicated by the decision's own
  // time and id; the ones with usage were answered by the model.
  const seen = new Set(), inference = { calls: 0, input: 0, output: 0, latency: 0, rules: 0, byQuestion: {} };
  for (const f of frames.filter(f => f.kind === 'decision')) {
    const d = f.snapshot?.decision || {};
    const key = `${d.id}@${d.at || f.t}`;
    if (seen.has(key)) continue; seen.add(key);
    const q = inference.byQuestion[d.id || f.label] ||= { calls: 0, rules: 0, input: 0, output: 0 };
    if (d.usage) {
      inference.calls++; q.calls++;
      inference.input += d.usage.input_tokens || 0; inference.output += d.usage.output_tokens || 0; inference.latency += d.latencyMs || 0;
      q.input += d.usage.input_tokens || 0; q.output += d.usage.output_tokens || 0;
    } else { inference.rules++; q.rules++; }
  }

  // Distance and what changed in the pockets, from the first and last full
  // snapshots.
  let walked = 0;
  for (let i = 1; i < obs.length; i++) { const d = dist(obs[i - 1].snapshot.position, obs[i].snapshot.position); if (d < 20) walked += d; }
  const full = frames.filter(f => f.snapshot?.inventory);
  const inventoryDelta = {};
  if (full.length >= 2) {
    const a = full[0].snapshot.inventory, b = full.at(-1).snapshot.inventory;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = (b[k] || 0) - (a[k] || 0); if (d) inventoryDelta[k] = d; }
  }

  return { frames, obs, time, still, wet, pacing, flips, problems, errors, damage, deaths, chat, thrown, inference, walked, inventoryDelta, clock, secs, pos, stepOf, survivalOf };
}

module.exports = { analyse };
