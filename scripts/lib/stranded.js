'use strict';
// A bot stranded: its body has not left one small place for half an hour and
// the question about how to get off it (unstuck_move, or any other) has been
// answered "none of these is good" ten times running in the last quarter
// hour. 25598 (mid-242-bb-nether-1-fortress-9) stood on the tip of its own
// span over the lava sea from 23:22Z on 2026-09-28 to past 01:00Z (138 blocks
// walked, net 2, unstuck_move none good 35 in a row) and no check said so:
// the verdict had no death and no loop, and the watcher waits for one of
// them, so the trial sat until its three hours ended (note 650). The
// midgame verdict (a `stranded:` reason, which watch.sh stops for) and the
// progress audit (a flag) read this.
//
// `positions`: [{ t, position, dimension }] in time order, `decs`: every
// decision once, [{ id, at, only, noneGood }] in time order. Pure: the
// caller reads the flight record.
const MINUTES = 30, EXTENT = 12, STREAK = 10, STREAK_MINUTES = 15, COVER = 0.8, SHARE = 0.4, SHARE_MIN = 40;

function noneGoodRun(decs) {
  const run = {};
  let best = null;
  for (const d of decs) {
    if (d.only) continue;
    if (!d.noneGood) { delete run[d.id]; continue; }
    const r = run[d.id] ||= { id: d.id, run: 0, from: d.at };
    r.run++; r.to = d.at;
    if (!best || r.run > best.run) best = { ...r };
  }
  return best;
}

function strandedOf({ positions, decs, now, minutes = MINUTES, extent = EXTENT, streak = STREAK, streakMinutes = STREAK_MINUTES } = {}) {
  if (!Number.isFinite(now) || !positions?.length) return null;
  const from = now - minutes * 60000;
  const span = positions.filter(p => p.t >= from && p.t <= now && p.position);
  if (!span.length) return null;
  // The record covers the half hour: a bot that has been up for ten minutes
  // is not one that has stood for thirty.
  if (span[0].t - from > (1 - COVER) * minutes * 60000 || now - span.at(-1).t > 3 * 60000) return null;
  const dim = span[0].dimension;
  if (span.some(p => p.dimension !== dim)) return null;
  const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const { position: p } of span) for (const k of ['x', 'y', 'z']) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const box = Math.max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z);
  if (box > extent) return null;
  const recent = (decs || []).filter(d => d.at >= now - streakMinutes * 60000 && d.at <= now);
  const run = noneGoodRun(recent);
  // Or, when the answers are broken up by other questions (25585: the run of
  // fifteen ended at 01:14, then rung_progress, fortress_leg and the stance
  // questions each answered none good between good answers): most of the half
  // hour's answers none good.
  const half = (decs || []).filter(d => !d.only && d.at >= from && d.at <= now), ng = half.filter(d => d.noneGood).length;
  const shared = half.length >= SHARE_MIN && ng >= SHARE * half.length;
  if ((!run || run.run < streak) && !shared) return null;
  const at = { x: Math.round((lo.x + hi.x) / 2), y: Math.round((lo.y + hi.y) / 2), z: Math.round((lo.z + hi.z) / 2) };
  const iso = t => new Date(t).toISOString().slice(11, 19);
  const because = run && run.run >= streak ? `${run.run} none_good answers in a row to ${run.id} (${iso(run.from)}Z to ${iso(run.to)}Z)` : `none good in ${ng} of ${half.length} answers in the half hour`;
  return {
    minutes, box: Math.round(box), at, ...(run ? { question: run.id, run: run.run, from: new Date(run.from).toISOString(), to: new Date(run.to).toISOString() } : {}), noneGood: ng, answers: half.length,
    says: `stranded: ${minutes} minutes within ${Math.round(box)} blocks of (${at.x}, ${at.y}, ${at.z}), ${because}; no death and no loop, and nothing else stops it`,
  };
}

// The same from a run's parsed frames (midgame verdict: {t, kind, snapshot}).
function strandedFromFrames(frames, { now = frames.at(-1)?.t, ...opts } = {}) {
  const positions = [], decs = [], seen = new Set();
  for (const f of frames) {
    if (f.kind === 'observation' && f.snapshot?.position) positions.push({ t: f.t, position: f.snapshot.position, dimension: f.snapshot.dimension });
    const d = f.kind === 'decision' && f.snapshot?.decision;
    if (!d?.id || d.stale) continue;
    const at = Date.parse(d.at) || f.t, key = `${d.id}@${at}`;
    if (seen.has(key)) continue; seen.add(key);
    decs.push({ id: d.id, at, only: !!d.only, noneGood: !!d.noneGood });
  }
  decs.sort((a, b) => a.at - b.at);
  return strandedOf({ positions, decs, now, ...opts });
}

module.exports = { strandedOf, strandedFromFrames, noneGoodRun, MINUTES, EXTENT, STREAK, STREAK_MINUTES };
