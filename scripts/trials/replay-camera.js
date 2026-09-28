'use strict';
// What death-camera.js and highlights.js share: a replay's own record of
// when it began and how long it runs, and the third-person camera path
// written into it as ReplayMod's working timeline ("" in timelines.json).
// The camera follows Jev from behind and above, placed from his own
// positions in the flight record, a keyframe a second, looking at him.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');

// The replay's metaData.json: date (ms, when it began) and duration (ms).
function replayMeta(file) {
  try { return JSON.parse(execFileSync('unzip', ['-p', file, 'metaData.json'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch (_) { return null; }
}

// Jev's positions from the flight records of a port, from..to (ms).
function framesFor(flightDir, port, from, to) {
  const id = `127_0_0_1-${port}-Jev-`;
  const out = [];
  for (const f of fs.readdirSync(flightDir).filter(f => f.startsWith(id))) {
    for (const line of fs.readFileSync(path.join(flightDir, f), 'utf8').split('\n')) {
      if (!line.includes('"position"')) continue;
      let r; try { r = JSON.parse(line); } catch (_) { continue; }
      const t = Date.parse(r.at), p = r.snapshot?.position;
      if (t >= from && t <= to && p) out.push({ t, p, yaw: r.snapshot.yaw, dim: r.snapshot.dimension });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// Minecraft: yaw 0 looks south (+z), 90 west (-x); pitch positive looks down.
const lookAt = (from, to) => {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  return [Math.atan2(-dx, dz) * 180 / Math.PI, -Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI, 0];
};

// The timeline for replay time from..to (epoch ms) of a replay begun at
// recStart: the time path, and one camera keyframe a second from the frame
// nearest each second; the camera trails where Jev has been heading over
// the last three seconds, so it swings smoothly rather than with every turn
// of the head. `back` and `up` set how far behind and above him it sits.
function cameraTimeline({ frames, from, to, recStart, back = 4, up = 2.8 }) {
  const cam = [];
  let behind = { x: 0, z: -1 };
  const nearest = at => frames.reduce((a, b) => Math.abs(b.t - at) < Math.abs(a.t - at) ? b : a);
  for (let s = 0; s * 1000 <= to - from; s++) {
    const at = from + s * 1000;
    const near = nearest(at), past = nearest(at - 3000);
    const mx = near.p.x - past.p.x, mz = near.p.z - past.p.z, m = Math.hypot(mx, mz);
    if (m > 0.8) behind = { x: -mx / m, z: -mz / m };
    const target = { x: near.p.x, y: near.p.y + 1.2, z: near.p.z };
    const eye = { x: near.p.x + behind.x * back, y: near.p.y + up, z: near.p.z + behind.z * back };
    cam.push({ time: s * 1000, properties: { 'camera:position': [eye.x, eye.y, eye.z], 'camera:rotation': lookAt(eye, target) } });
  }
  const t0 = Math.max(0, from - recStart);
  return { keyframes: cam.length, t0, t1: t0 + to - from, timeline: { '': [
    { keyframes: [{ time: 0, properties: { timestamp: Math.round(t0) } }, { time: to - from, properties: { timestamp: Math.round(t0 + to - from) } }], segments: [0], interpolators: [{ type: 'linear', properties: ['timestamp'] }] },
    { keyframes: cam, segments: cam.slice(1).map(() => 0), interpolators: [{ type: 'linear', properties: ['camera:position', 'camera:rotation'] }] },
  ] } };
}

// Put the timeline into the replay (timelines.json at the zip's root).
function writeTimeline(file, timeline) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
  fs.writeFileSync(path.join(dir, 'timelines.json'), JSON.stringify(timeline));
  execFileSync('zip', ['-q', '-j', file, path.join(dir, 'timelines.json')]);
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { replayMeta, framesFor, lookAt, cameraTimeline, writeTimeline };
