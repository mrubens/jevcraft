'use strict';
// Jev down, read from the flight record (note 781): the spells in which no
// decision could be made, so the harness keeps them off the played clock,
// out of the loops and the stranded check, and in their own bucket in the
// audits. TypeSafe's credits ran out at 04:57:47Z on 2026-10-01 and every
// question came back 402: the verdict read each persist of it as a loop
// ("loop: 14× TypeSafe 402 ...") and the overnight loop restarted worlds on
// 25581, 25583 and 25584 every 80 seconds; progress-audit flagged the
// standing bots for stallShare and milestone; wasted-minutes filed the
// outage under "stuck/unstuck: persist".
//
// Evidence, per frame:
//   - the bot's own record (src/jev-down.js, src/recorder/observer.js): a
//     'jev_down' frame at a spell's start, 'jev_back' at its end, and
//     snapshot.jevDown on every frame between;
//   - before that record existed, the outage's own words: an error frame, a
//     goal's lastError or a persist step's problem naming TypeSafe 401, 402,
//     403, 408, 429 or 5xx, the breaker ("the decision service is not
//     answering"), billing, or no client.
// A spell runs from its first evidence to its last (or to its 'jev_back');
// evidence GAP_MS or less apart is one spell (the bot asks again every 15
// seconds at most; the mark lapses after a minute).

const INFRA = /TypeSafe (40[1-3]|408|429|5\d\d)\b|decision service is not answering|no available TypeSafe API credits|billing_error|no Jev client is configured/i;
const GAP_MS = 90000;

function kindOfText(text) {
  const t = String(text || '');
  const status = Number((t.match(/TypeSafe (\d{3})\b/) || [])[1]) || 0;
  if (status === 402 || /billing_error|no available TypeSafe API credits/i.test(t)) return 'billing';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 408) return 'timeout';
  if (status >= 500 || /not answering/i.test(t)) return 'server';
  if (/no Jev client/i.test(t)) return 'no_client';
  return 'other';
}

// One frame's evidence: { down: true, kind } | { back: true } | null. Works
// on a full frame (kind, label, snapshot.goal / snapshot.step) and on a slim
// one that kept `jd` (the kind, `jm` when the bot's own mark) or `jb`.
function evidenceOf(f) {
  if (!f) return null;
  if (f.jb) return { back: true };
  if (f.jd) return { down: true, kind: f.jd, marked: !!f.jm };
  if (f.kind === 'jev_back') return { back: true };
  if (f.kind === 'jev_down') return { down: true, kind: f.detail?.kind || 'other', marked: true };
  const s = f.snapshot || {};
  if (s.jevDown) return { down: true, kind: s.jevDown.kind || 'other', marked: true };
  const texts = [f.kind === 'error' ? f.label : null, s.goal?.lastError, (s.step || s.goal?.step)?.action === 'persist' ? (s.step || s.goal?.step).problem : null];
  for (const t of texts) if (t && INFRA.test(t)) return { down: true, kind: kindOfText(t) };
  return null;
}

// -> [{ from, to, ms, kind, open }] in time order; `open` when the record's
// last frame is in the spell (no answer since). `frames` in time order, each
// with `t`.
function spellsOf(frames, { gapMs = GAP_MS } = {}) {
  const out = [];
  let cur = null;
  for (const f of frames || []) {
    const e = evidenceOf(f);
    // The bot's own record marks every frame of a spell: one it does not
    // mark ends it (the gap rule is for the old record's scattered errors).
    if (!e) { if (cur?.marked && f.kind !== 'error') { cur.closed = true; out.push(cur); cur = null; } continue; }
    if (e.back) { if (cur) { cur.to = f.t; cur.closed = true; out.push(cur); cur = null; } continue; }
    const marked = !!e.marked;
    if (cur && !cur.marked && f.t - cur.to > gapMs) { out.push(cur); cur = null; }
    if (!cur) cur = { from: f.t, to: f.t, kinds: {}, marked };
    cur.to = f.t; cur.kinds[e.kind] = (cur.kinds[e.kind] || 0) + 1;
  }
  if (cur) out.push(cur);
  const lastT = frames?.length ? frames[frames.length - 1].t : null;
  return out.map(s => ({ from: s.from, to: s.to, ms: s.to - s.from, kind: Object.entries(s.kinds).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other',
    open: !s.closed && lastT !== null && lastT - s.to <= gapMs }));
}

// How much of [a, b] the spells cover, in ms.
function overlapMs(spells, a, b) {
  let ms = 0;
  for (const s of spells || []) ms += Math.max(0, Math.min(b, s.to) - Math.max(a, s.from));
  return ms;
}
// Spells joined where they overlap (a trial record's saved spells beside
// those read from a window's frames).
function merge(spells) {
  const out = [];
  for (const s of [...(spells || [])].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last && s.from <= last.to) { last.to = Math.max(last.to, s.to); last.ms = last.to - last.from; last.open = last.open || s.open; continue; }
    out.push({ ...s });
  }
  return out;
}
// A run clock's entries ([end, what, ms]) with the Jev-down time taken out:
// -> { entries, ms } (ms: the time taken out, Jev down's own bucket).
function offClock(entries, spells) {
  if (!spells?.length) return { entries, ms: 0 };
  let ms = 0;
  const out = [];
  for (const [t, what, dt] of entries) {
    const o = Math.min(dt, overlapMs(spells, t - dt, t));
    ms += o;
    if (dt - o > 0) out.push([t, what, dt - o]);
  }
  return { entries: out, ms };
}
const within = (spells, t, slackMs = 0) => (spells || []).some(s => t >= s.from - slackMs && t <= s.to + slackMs);
const minutes = ms => Math.round(ms / 6000) / 10;
// "Jev down 47.5 min (billing), open": for a verdict or an audit line.
function says(spells) {
  const ms = (spells || []).reduce((n, s) => n + s.ms, 0);
  if (!ms && !(spells || []).length) return null;
  const kinds = [...new Set(spells.map(s => s.kind))].join(', ');
  return `Jev down ${minutes(ms)} min (${kinds}${spells.length > 1 ? `, ${spells.length} spells` : ''})${spells.at(-1)?.open ? ', down now' : ''}`;
}

module.exports = { INFRA, GAP_MS, kindOfText, evidenceOf, spellsOf, overlapMs, merge, offClock, within, says, minutes };
