# Companion reliability checks

The roadmap remains open. These checks cover specific improvements, not every
terrain, recipe, or interruption the bot may encounter.

## Carrying batches for combined requests

Ordinary combined requests still gather shared materials before crafting. When
the whole request would overflow the working inventory, delivery targets split
into smaller lots. Each lot retains the original request totals, confirmed
deliveries, and kept-item reservations in the checkpoint. Requests to keep more
items than fit in inventory explain the space problem instead of gathering an
impossible load.

Controlled Survival run `bundle-capacity-mu8l0ca5` crafted and delivered 40 wooden
axes and two chests from granted logs. The first load contained 21 axes; the
receiver stored them in a chest, then the bot resumed its saved checkpoint and
delivered the remaining 19 axes and two chests. Independent receiver inventory
and chest checks verified the exact totals. Peak carried inventory was 25 slots.
Use `MC_PORT=<isolated-port> node scripts/bundle-capacity-test.js` with its printed
`setup.json` and `ready` file to reproduce it.

## Brief detours retain unfinished work

Replacing an unfinished task saves it inside the new task's atomic checkpoint.
After finishing a brief task such as coming to the player, `Jev resume` returns
to the previous unfinished request, including its blueprint, furnace state, and
confirmed deliveries. The latest eight unfinished tasks are retained, without
nested copies. Old work only resumes when requested; finishing a detour does not
automatically start it. The current unfinished task takes precedence on resume.

## Interrupted item handovers

Delivery saves both inventory and confirmed delivery counts before a throw.
On resume, extra carried items cannot excuse a lost, unconfirmed throw. Jev must
recover the missing inventory or have evidence that the recipient collected it
before continuing. This prevents sending duplicates when a reconnect happens
after a throw and the bot still carries spare copies.

`node --test test/delivery.test.js` covers spare stock, partial pickups, previous
completed handovers, exact stack splitting, and a recipient moving away.

## Saved furnace batches

A stopped batch retains its furnace position and output target. It collects
existing output, accounts for input already in the furnace, and obtains missing
fuel or input through a saved supply subtask. While a furnace is open, carried
counts come from that window. Fuel already burning is not treated as a missing
plank to replace from the next recipe's reserves.

`node --test test/smelting.test.js` checks cancellation/resume and fuel accounting.
For the real-server test, run
`MC_PORT=<isolated-port> node scripts/furnace-recovery-test.js`. Apply the printed
artifact directory's `setup.json` commands and create its `ready` file. When the
script prints `removeFuel`, apply `remove-fuel.json` and create `fuel-removed`.
This is a controlled fixture with granted inputs and an intentionally interrupted
furnace, never natural Survival acceptance.

Controlled run `furnace-recovery-mu8knagf` passed on Minecraft 26.1. After stopping
mid-batch and losing the furnace fuel, the bot crafted more fuel from one supplied
log and finished exactly four glass from the original four sand, retaining one
spare plank. Earlier failing fixtures exposed stale open-container counts and
are retained in `artifacts/`.

## Stop during request interpretation

All nested classifiers for a player request share its cancellation signal.
Chat/Observatory stop, death, and disconnect abort outstanding interpretation
calls and fence off old results, allowing a new request to proceed without waiting
for the old call's timeout/retries. `test/typesafe-provider.test.js` checks this
with a deliberately stalled transport and a subsequent fresh request.

## Reachable death drops

An unreachable nearby stack no longer causes Jev to abandon every drop. Recovery
checks up to eight visible matching stacks, with a three-second search budget,
and chooses a complete route that avoids water and observed threats. Searches
yield between pathfinder slices so an unfinished search is not mistaken for
proof that no route exists, and stop can interrupt the search. Retrieval keeps
digging, scaffolding, and towers disabled, then restores the previous movement
settings and interruption guard.

Items observed in inventory before navigation unwinds on stop are checkpointed
as recovered. A failed or interrupted trip never invents missing inventory.
The existing distance, health, hunger, five-attempt, and 30-second travel limits
remain in effect. This is bounded retrieval of observed drops, not a search
across unknown chunks or a promise to recover every death inventory.

`test/recovery.test.js` covers blocked/unsafe nearest stacks, incremental route
search, cancellation during search and after pickup, inventory evidence, and
restoration of movement settings. For the real-server fixture:

```sh
MC_PORT=<isolated-port> node scripts/recovery-routes-test.js
```

Apply `setup.json` in the isolated server console and create `ready`. When the
script requests the controlled kill, run that command there. After respawn,
apply `relocate.json` and create `relocated`. This traps one actual death-drop
stack in a bedrock enclosure while leaving another farther stack reachable.
Ports 25565 and 25577 are explicitly rejected. Supplies, terrain, the death,
and drop locations are controlled; this is not natural Survival acceptance.

On 2026-09-19, `recovery-routes-mu8podjh` passed: Jev bypassed the closer trapped
12-log stack, walked around its enclosure to recover all eight planks, and
finished the bounded attempt with health 20. An independent client observed the
pickup. The trapped logs remained intact, with no digging or block placement
and no additional deaths.

## Swimming through aquatic plants

Kelp, kelp stems, seagrass, and tall seagrass contain water even though they have
different block IDs. Navigation now recognizes that water for swimming costs,
surface entry, shore exits, and corner clearance. Surface exploration keeps the
swimmer's head in open air instead of treating a kelp column as dry space above
the lake bed. Death-drop retrieval still rejects water, including planted water.

The same water checks allow boats to use level source water containing plants,
while retaining clearance and current restrictions. Waterlogged solid blocks
and bubble columns are not accepted as ordinary open water. Kelp age metadata
is no longer mistaken for fluid level when checking whether Jev's head is
submerged. Routing, collision geometry, and fluid depth stay in code; the
existing Jev travel classifier still decides whether to use a boat.

`test/movement.test.js`, `test/surface.test.js`, `test/vitals.test.js`,
`test/boats.test.js`, and `test/recovery.test.js` cover these distinctions.
For isolated gameplay tests:

```sh
MC_PORT=<isolated-port> node scripts/planted-water-test.js
MC_PORT=<isolated-port> BOAT_PLANTS=1 node scripts/boat-test.js
```

Apply each artifact directory's `setup.json` in the isolated server console,
then create its `ready` file. Both scripts reject ports 25565 and 25577. The
swimming fixture crosses a shallow seagrass pool, a two-block-deep tall-seagrass
pool, and a three-block-deep kelp pool. The boat fixture adds kelp across its
existing lake, then crafts, launches, paddles, dismounts, retrieves the boat,
and climbs onto the far bank. Both use an independent observing client.

On 2026-09-19, `planted-water-mu8pz9bq` passed all three swimming crossings with
health and oxygen at 20, no digging, no deaths, and all 64 carried scaffolding
blocks unused. `boat-mu8pzqix` passed the planted-lake crossing with 99 independent
mounted observations, no server movement corrections, health 20, and the boat
recovered for reuse. Live Jev decisions selected a boat for the lake and honored
an explicit request to swim. These are controlled mechanics fixtures with
granted terrain and supplies, not natural Survival acceptance.
