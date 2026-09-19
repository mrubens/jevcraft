# Jev Observatory

A local browser harness for seeing Jev's world, actions and recorded decisions together. The renderer uses Three.js (MIT) and the bot's actual block names, so it does not require a texture pack or Prismarine Viewer's version-specific block models. All browser modules are served locally.

## Run independently

```sh
npm ci
npm run harness
# Read another checkout's existing logs, without changing them or connecting to Minecraft:
npm run harness -- --source /path/to/bot --port 3040
```

Open `http://127.0.0.1:3040`. The illustrated cherry-cabin session is explicitly synthetic. Select a run or checkpoint to inspect actual recorded data. A standalone viewer starts no Minecraft connection and cannot control the game.

Old logs contain no terrain; those sessions show a position trail where positions were recorded. Missing health, timestamps and model probabilities stay unknown. Goal metadata comes from the saved goal; current inventory is never retroactively filled into old events. Checkpoints and run logs never claim a verified live connection.

## Attach to the bot

```sh
JEV_DASHBOARD_PORT=3041 npm start
```

Use another port if the standalone viewer is still running. `index.js` creates one server across reconnects; `createSession` attaches the current bot and publishes step events. The optional adapter is in `src/harness/observer.js`. Without the environment variable, normal startup is unchanged and Three.js is not loaded.

Integration points are limited to `index.js`, `src/session.js`, package manifests, `.env.example` and documentation; the remaining files are additive. The viewer was developed on `codex/jev-visual-harness` in an isolated worktree and is now integrated in the primary checkout. The live adapter also records Fable recovery advice and execution outcomes, labeled separately from Jev classifier judgments.

The viewer listens only on loopback. Live stop uses the same cancellation path as chat; resume shares the existing saved-task logic. Recording controls are disabled. Requests must target the current connection epoch with fresh observations; stale/replaced connections are rejected. Stop can interrupt a queued resume. The API offers no arbitrary chat, operator command, teleport or movement endpoint.

## Explore

- Drag to orbit, scroll to zoom, right-drag to pan. `Jev's eyes` follows recorded position, yaw and pitch. `Top` gives an overhead view. `Recenter` returns to Jev.
- The orange line is the recorded planned route. The muted line is recent travel. Translucent blue blocks show the saved construction blueprint at its actual coordinates.
- Cutaway hides captured layers above the selected relative height. Hover a block for its name and world coordinates.
- Select an activity or scrub the timeline to inspect that frame. This pauses only the display. `Latest` follows new observations. `Replay` advances at one observation per second, not wall-clock timing.
- The inspector shows offered options and recorded probabilities along the chosen tree path. Single-option branches are labelled as such; unrecorded answers never acquire fabricated probabilities. Earlier decisions are labelled as context for subsequent executor events. Request/catalog judgments are separately expandable when available.
- `Export` saves the current bounded trace. `Open trace` reads it locally in the browser, with all controls disabled. Exported traces can include chat, player names, world coordinates and decision inputs; review them before sharing. Credential-named fields are redacted, which is not a guarantee against secrets embedded in free text.

## Scope and limits

This is a 3D diagnostic renderer, not a full Minecraft client: blocks use simplified cubes/colors, without textures, precise stair/fence geometry, lighting simulation or player skins. Water/glass are translucent. Entities have simple markers. The live view captures a 25 × 25 area with 18 vertical layers around Jev, only where chunks are loaded. It is a view of the bot's known nearby world, not line-of-sight segmentation.

Bot state is sampled every second; terrain every two seconds; the browser polls every two seconds. Live memory keeps at most 600 frames or about 12 MiB of serialized frame data, whichever comes first. Dense terrain may shorten history considerably. Captures are not automatically persisted across process exit; export before closing. Existing JSONL inputs are limited to their latest 8 MiB. The status indicator distinguishes bot disconnects, stale samples and unavailable viewer connections.

## Validation

`npm test` runs the existing bot suite plus harness tests for immutable state, unknown historical fields, truncated logs, credential-field redaction, current connection fencing, failure isolation, local HTTP controls, stop during resume, and classifier branch numbering. Browser checks cover real log loading, 3D rendering, orbit/first-person/top modes, timeline selection, playback and export/reopen. The integrated suite passes 183 tests. The adapter was also verified against the real interactive Jev on port 25570: the live HTTP trace and browser showed changing positions, loaded terrain (over 8,000 blocks per capture), current inventory, health/food, active surface-return steps and the saved request interpretation. The live page is on port 3041. Stop/resume fencing is covered by in-process tests; validation did not interrupt the player’s game through those controls.
