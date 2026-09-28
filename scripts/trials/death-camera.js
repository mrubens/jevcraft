'use strict';
// A third-person camera for each death replay, written into the replay as
// ReplayMod's working timeline ("" in timelines.json): the time path runs
// from BEFORE seconds before the death to AFTER seconds past it, and the
// camera follows Jev from behind and above, placed from Jev's own positions
// in the flight record, a keyframe a second, looking at him. Open the replay
// in ReplayMod and the path is there; render it.
//   node scripts/trials/death-camera.js [BEFORE=30] [AFTER=3]
// Needs artifacts/deaths.json (death-index.js) and the flight records.
const fs = require('fs'), path = require('path');
const { replayMeta, framesFor, cameraTimeline, writeTimeline } = require('./replay-camera');
const ROOT = path.join(__dirname, '..', '..');
const BEFORE = Number(process.argv[2] || 30) * 1000, AFTER = Number(process.argv[3] || 3) * 1000;
const OUT = (process.env.REPLAY_RECORDINGS || path.join(process.env.HOME, 'Library/Application Support/PrismLauncher/instances/Jev Replays/minecraft/replay_recordings'));
const deaths = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts', 'deaths.json'), 'utf8'));
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');

let written = 0;
for (const d of deaths) {
  const port = (d.server.match(/-(\d+)$/) || [, '25581'])[1];
  const died = new Date(d.local).getTime();
  let recStart = died - d.secondsIn * 1000;
  // The recording ends when Jev dies and leaves, and the log's time of
  // death is to the second: a path past the recording's end is a render
  // that waits for frames that never come. Stop short of its real length
  // (metaData.json's duration), and start no earlier than it does.
  const target = path.join(OUT, d.file);
  let duration = null;
  const meta = replayMeta(target);
  if (meta) { duration = meta.duration; if (meta.date) recStart = meta.date; }
  const end = duration ? recStart + duration - 700 : died - 700;
  const to = Math.min(died + AFTER, end), from = Math.max(recStart, to - BEFORE - AFTER);
  const frames = framesFor(FLIGHT, port, from, to);
  if (frames.length < 5) { console.log(`${d.file}: too few frames (${frames.length})`); continue; }
  if (!fs.existsSync(target)) { console.log(`${d.file}: not in replay_recordings`); continue; }
  const cam = cameraTimeline({ frames, from, to, recStart });
  writeTimeline(target, cam.timeline);
  written++;
  console.log(`${d.file}: ${cam.keyframes} camera keyframes, replay ${Math.round(cam.t0 / 1000)}s to ${Math.round(cam.t1 / 1000)}s`);
}
console.log(`${written} replays given a death camera`);
