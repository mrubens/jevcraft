# Stairs and slabs in custom builds

The building advisor can now include stair and slab regions in arbitrary designs.
The same deterministic executor handles them in Survival and Creative. Jev still
routes the player's request; block states, material counts, placement, and final
verification stay in code.

Each region has optional `properties`. Existing full-block schematics without
that field remain valid. New advisor responses use `null` for full blocks and air:

```json
{
  "from": [1, 1, 1],
  "to": [3, 1, 1],
  "block": "oak_stairs",
  "properties": { "facing": "south", "half": "bottom" }
}
```

Stairs require `facing` (`north`, `east`, `south`, or `west`) and `half` (`bottom`
or `top`). Facing points toward the high side of a bottom stair; north is negative
Z and east is positive X. Slabs use `facing: null` and `half: "bottom"` or `"top"`.
The executor translates slab half into Minecraft's `type` property. Each planned
cell consumes one item in Survival; there are no double-slab cells. Neighboring
stairs form corner shapes automatically. The schematic does not override those
derived shapes, request waterlogging, or supply arbitrary state IDs.

The foundation layer uses full blocks. [Wooden doors](doors.md) also have explicit
placement and verification; other oriented families remain outside the palette.
Entrance and interior diagnostics still use
an approximate cell walk graph; exact block-state verification does not prove
that every possible generated interior is navigable.

## Placement and resuming

- Work destinations include the required look direction and a visible click
  point on the correct half of a real collision face.
- Placement uses that same click point. It avoids clicks that would merge a
  neighboring slab into a double slab.
- Standing on a slab uses the actual collision height when evaluating reach.
- Building batches order supports before dependent trim, including beams above
  upside-down slabs. Execution prefers low layers but can build another reachable
  support in the batch when a lower piece cannot yet be attached.
- Survey translation, material batches, checkpoints, and final checks retain
  the intended states. A wrong-facing stair is unfinished even if its material
  matches. The bot may repair its own recorded misplacement; unowned changes at
  the site remain protected.

## Validation

`test/build-blocks.test.js`, `test/build-batch.test.js`, and the construction and
designer tests cover orientation, placement faces, half-slab footing, material
counts, capacity-limited support ordering, old schematic compatibility, and
protection of player edits.

The real-server fixture is:

```sh
MC_PORT=<isolated-port> node scripts/oriented-building-test.js
```

Run the generated artifact directory's `setup.json` commands in that isolated
server's console, then create its `ready` file. The script builds a gallery with
all eight stair orientation/half combinations, both slab halves, adjacent slabs,
a hanging slab that depends on a higher beam, and an ordinary staircase. It
stops after two stairs, reloads its checkpoint, finishes construction, and walks
up the staircase without jumping. A separate client verifies states and motion.
Supplies, terrain, and starting positions are granted: this is a controlled
mechanics test, not a natural Survival progression result. Ports 25565 and 25577
are explicitly rejected.

An interrupted fixture can be retried with `RESUME_BUILD_DIR=<artifact-directory>`.
For an arbitrary retained advisor design, set
`BUILD_SOURCE=test/fixtures/oak-stair-pavilion.json` and optionally
`BUILD_MODE=creative`. `TEST_REPAIR=1` pauses at `repairSetup`; apply the generated
`repair-setup.json` and create `repair-ready`. This deliberately records a wrong
fixture stair as bot-owned and verifies that resume corrects it.

On 2026-09-19, the live advisor returned the retained 135-block pavilion with 40
stairs and nine slabs using the new schema. Controlled Creative run
`oriented-building-mu8nuqdk` built it, resumed after cancellation, repaired the
deliberately reversed stair, and passed independent verification of all 49
oriented cells with health 20. The Survival gallery in
`oriented-building-mu8novpa` exposed the half-slab eye-height bug, then completed
from its saved checkpoint after the fix: 108 blocks, 15 oriented cells, and a
successful staircase walk without jumping. Artifacts are local and ignored by Git.

A fresh Survival run, `oriented-building-mu8nywan`, then passed the complete
108-block gallery from scratch, including cancellation/resume, the higher-beam
dependency, and the independently observed stair walk. The automated suite passed
400 tests on the supported bundled Node runtime.
