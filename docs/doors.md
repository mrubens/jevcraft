# Wooden doors in builds and navigation

Custom schematics can include wooden doors from the current Minecraft registry.
Jev places a door by clicking its floor from the requested direction, verifies
both halves, and counts one inventory item for the pair. The advisor supplies
the lower cell only:

```json
{
  "from": [2, 1, 0],
  "to": [2, 1, 0],
  "block": "oak_door",
  "properties": { "facing": "south", "half": null }
}
```

The lower cell needs a full supporting block directly below and an empty cell
above, both inside the design bounds. Code reserves the upper cell automatically.
Minecraft chooses the hinge; the design cannot request hinges, powered states,
open states, or explicit upper halves. Iron and copper doors are excluded.

Batch accounting reserves one item per door. A missing or inconsistent half
leaves that door unfinished. Checkpoints retain both halves even if stop arrives
as the server acknowledges placement. Opening a completed door does not erase
Jev's ownership of it; changing its facing or replacing a half does. Repairs
check the whole footprint before removing a bot-owned piece, protecting player
changes in the upper cell as well as the lower cell.

## Walking through entrances

Ground navigation can open intact wooden doors and walk through them in either
direction along the doorway axis. It requires a level supported threshold and
headroom. Door interactions consume no scaffolding and do not dig the entrance.
Jev rechecks the door before interacting, so a player opening it during approach
does not cause Jev to close it again. Stop is checked before interaction and
while waiting for the server's acknowledgement.

The navigation adapter corrects two upstream pathfinder assumptions: a thin
door panel is not a walking floor, and opening a door is not a scaffold placement.
After an acknowledged opening it refreshes the same goal using the updated
world. These changes apply through the bot's navigation helpers. Creative flight
does not yet open closed doors; it continues to treat them as collision obstacles.

## Reproduction and evidence

`test/build-doors.test.js` covers footprint and inventory accounting, invalid
designs, resume verification, ownership, placement direction, supported routes,
player interactions, cancellation, and protection of unexpected upper blocks.
It also retains a real advisor response in `test/fixtures/oak-door-cottage.json`.

For controlled gameplay validation:

```sh
MC_PORT=<isolated-port> node scripts/door-building-test.js
```

Apply the artifact directory's `setup.json` commands in that isolated server's
console, then create its `ready` file. The script builds a four-door room,
interrupts immediately after the first door placement, reloads the saved goal,
finishes construction, and walks through all four closed doors with digging and
scaffolding disabled. A separate client verifies the building and movement.
`RESUME_DOOR_DIR=<artifact-directory>` resumes an interrupted fixture.
Ports 25565 and 25577 are explicitly rejected.

On 2026-09-19, `door-building-mu8opd7m` passed in isolated Survival: 82 physical
cells, exactly four door items consumed, both halves saved at interruption, all
four entrances traversed, health 20, and no deaths. Supplies and terrain were
granted by the fixture; this is a mechanics result, not natural Survival
progression. A separate live advisor request returned a valid 110-cell cottage
with one door and 20 stairs. That retained design passed validation; the gameplay
run used the four-door room. The existing 410 automated tests passed before
adding the retained advisor regression.
