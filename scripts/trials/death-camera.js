'use strict';
// A third-person camera for each death replay, written into the replay as
// ReplayMod's working timeline ("" in timelines.json): the time path runs
// from BEFORE seconds before the death to AFTER seconds past it, and the
// camera follows Jev from behind and above, placed from Jev's own positions
// in the flight record, a keyframe a second, looking at him. Open the replay
// in ReplayMod and the path is there; render it.
//   node scripts/trials/death-camera.js [BEFORE=30] [AFTER=3]
// Needs artifacts/deaths.json (death-index.js) and the flight records.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const BEFORE = Number(process.argv[2] || 30) * 1000, AFTER = Number(process.argv[3] || 3) * 1000;
const OUT = path.join(process.env.HOME, 'Library/Application Support/PrismLauncher/instances/Jev Replays/minecraft/replay_recordings');
const deaths = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts', 'deaths.json'), 'utf8'));
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');

function framesFor(port, from, to) {
  const id = `127_0_0_1-${port}-Jev-`;
  const out = [];
  for (const f of fs.readdirSync(FLIGHT).filter(f => f.startsWith(id))) {
    for (const line of fs.readFileSync(path.join(FLIGHT, f), 'utf8').split('\n')) {
      if (!line.includes('"position"')) continue;
      let r; try { r = JSON.parse(line); } catch (_) { continue; }
      const t = Date.parse(r.at), p = r.snapshot?.position;
      if (t >= from && t <= to && p) out.push({ t, p, yaw: r.snapshot.yaw });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// Minecraft: yaw 0 looks south (+z), 90 west (-x); pitch positive looks down.
const lookAt = (from, to) => {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  return [Math.atan2(-dx, dz) * 180 / Math.PI, -Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI, 0];
};

let written = 0;
for (const d of deaths) {
  const port = (d.server.match(/-(\d+)$/) || [, '25581'])[1];
  const died = new Date(d.local).getTime();
  let recStart = died - d.secondsIn * 1000;
  // The recording ends when Jev dies and leaves, and the log's time of
  // death is to the second: a path past the recording's end is a render
  // that waits for frames that never come. Stop short of its real length
  // (metaData.json's duration), and start no earlier than it does.
  const target0 = path.join(OUT, d.file);
  let duration = null;
  try { const meta = JSON.parse(execFileSync('unzip', ['-p', target0, 'metaData.json']).toString()); duration = meta.duration; if (meta.date) recStart = meta.date; } catch (_) {}
  const end = duration ? recStart + duration - 700 : died - 700;
  const to = Math.min(died + AFTER, end), from = Math.max(recStart, to - BEFORE - AFTER);
  const frames = framesFor(port, from, to);
  if (frames.length < 5) { console.log(`${d.file}: too few frames (${frames.length})`); continue; }
  // One keyframe a second, from the frame nearest each second; the camera
  // trails where Jev has been heading over the last three seconds, so it
  // swings smoothly rather than with every turn of the head.
  const cam = [], pos = [];
  let behind = { x: 0, z: -1 };
  for (let s = 0; s * 1000 <= to - from; s++) {
    const at = from + s * 1000;
    const near = frames.reduce((a, b) => Math.abs(b.t - at) < Math.abs(a.t - at) ? b : a);
    const past = frames.reduce((a, b) => Math.abs(b.t - (at - 3000)) < Math.abs(a.t - (at - 3000)) ? b : a);
    const mx = near.p.x - past.p.x, mz = near.p.z - past.p.z, m = Math.hypot(mx, mz);
    if (m > 0.8) behind = { x: -mx / m, z: -mz / m };
    const target = { x: near.p.x, y: near.p.y + 1.2, z: near.p.z };
    const eye = { x: near.p.x + behind.x * 4, y: near.p.y + 2.8, z: near.p.z + behind.z * 4 };
    cam.push({ time: s * 1000, properties: { 'camera:position': [eye.x, eye.y, eye.z], 'camera:rotation': lookAt(eye, target) } });
    pos.push(near);
  }
  const t0 = Math.max(0, from - recStart);
  const timeline = { '': [
    { keyframes: [{ time: 0, properties: { timestamp: Math.round(t0) } }, { time: to - from, properties: { timestamp: Math.round(t0 + to - from) } }], segments: [0], interpolators: [{ type: 'linear', properties: ['timestamp'] }] },
    { keyframes: cam, segments: cam.slice(1).map(() => 0), interpolators: [{ type: 'linear', properties: ['camera:position', 'camera:rotation'] }] },
  ] };
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tl-'));
  fs.writeFileSync(path.join(dir, 'timelines.json'), JSON.stringify(timeline));
  const target = path.join(OUT, d.file);
  if (!fs.existsSync(target)) { console.log(`${d.file}: not in replay_recordings`); continue; }
  execFileSync('zip', ['-q', '-j', target, path.join(dir, 'timelines.json')]);
  written++;
  console.log(`${d.file}: ${cam.length} camera keyframes, replay ${Math.round(t0 / 1000)}s to ${Math.round((t0 + to - from) / 1000)}s`);
}
console.log(`${written} replays given a death camera`);
