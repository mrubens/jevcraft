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

When all inventory slots are occupied, a partial-stack handover uses ordinary
single-item hand drops instead of requiring a temporary empty slot. It checks
the recipient and cancellation before each drop, confirms the inventory change,
and retains the rest of the stack and unrelated supplies. Full-stack handovers
and splitting when space exists keep their existing behavior. Recipient pickup
is still required before the delivery is counted as complete.

`MC_PORT=<isolated-port> node scripts/full-inventory-delivery-test.js` reproduces
this on a one-block-wide ledge. Apply the artifact directory's `setup.json` in
the isolated console and create `ready`. Ports 25565 and 25577 are rejected.
Controlled run `full-inventory-delivery-mu8q8133` passed on 2026-09-19: with all
36 slots occupied, Jev delivered one pumpkin and then five pumpkins, retaining
11 pumpkins and 35 axes. The receiving client's inventory confirmed exactly
six pumpkins. Neither player fell or lost health, and replaying the completed
checkpoints sent no additional drops. Automated tests also stop mid-handover
and move the recipient before the next drop. Supplies and terrain are granted
for this mechanics fixture; it is not natural Survival acceptance.

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

Fuel accounting also preserves the initial furnace properties sent while its
window opens. Mineflayer can subscribe too late to those packets; after a
reopen, missing `totalFuel` made a burning furnace report zero fuel and consume
an extra plank. The compatibility layer observes properties before opening,
then reconciles fuel and cooking progress after each update, regardless of
packet order. Readings belong to that window opening and are discarded on
close, open failure, or disconnect. Known remaining burn ticks are usable even
before the total-duration packet arrives. Stop is checked before refueling and
after waiting for initial fuel status.

`test/furnace-properties.test.js` exercises the installed Mineflayer furnace
plugin with initial packets arriving before its open promise resolves. It also
checks property order, other window IDs, reused IDs, failed opens, and disconnect
cleanup. `test/smelting.test.js` verifies remaining burn time and cancellation
before a fuel transfer.

A stricter fuel-budget check in `scripts/workstation-access-test.js` reproduced
the real-server failure in `workstation-access-mu8qyh4i`: two glass took three
planks across stop/resume. After the fix, `workstation-access-mu8r2rjk` passed on
2026-09-19 with exactly two planks loaded, two glass, two chests, and two spare
planks left from the original 20. The reopened furnace correctly reported 4.95
seconds of remaining burn. Both recordings are retained; these are controlled
mechanics fixtures, not fresh Survival acceptance runs.

The related missing-fuel fixture `furnace-recovery-mu8r5275` also passed: after
its fuel was removed externally, Jev made replacement fuel from the supplied
log, completed exactly four glass, and retained two planks with health 20.

Smelting plans now choose a burnable plank species from carried stock or the
observed recipe graph, instead of requiring oak. The matching vanilla server's
item tags supply the ten allowed plank types; crimson and warped wood are
excluded. Larger carried stacks take precedence over a stray oak plank. One
fuel species is retained across a shared recipe plan so compatible smelts still
merge. Its item name is saved with the furnace batch and used for refueling;
older checkpoints without that field retain their oak behavior. Fuel quantities
use the verified 300-tick plank burn and 200-tick normal smelt durations.

Automated coverage checks every allowed plank type, locally observed birch,
non-flammable wood, requested-plank reservations, shared iron-armor smelting,
and selected-fuel persistence across interruption. This policy currently uses
planks; coal and mixed-fuel optimization remain separate work.

On 2026-09-19, `station-replacement-mu8rwe06` passed with `STATION_WOOD=birch`
and `STATION_TEST_X=2200`: Jev made and placed replacement stations, resumed,
and delivered a chest plus four glass using three birch planks as fuel. The
receiver independently confirmed both items and both stations; two birch logs
and one plank remained, with health 20. The preceding parallel run completed
the request but failed its station-count assertion; the observer now counts
only its own fixture plot. Both recordings are retained.

`furnace-recovery-mu8rtr0x` also passed with `FURNACE_TEST_WOOD=birch` and
`FURNACE_TEST_X=2300`: after fuel removal, Jev made replacement birch fuel from
the supplied log and completed four glass, keeping two planks with health 20.
These remain controlled mechanics fixtures, not fresh Survival acceptance.

The saved regression `artifacts/fuel-rounding-regression-20260919.json` showed
provisional per-piece fuel rounding requesting an extra log even though the
carried 24 birch planks covered a merged armor smelt and eight requested planks.
After merging batches, the planner now works backward through the ordered
actions to remove surplus supplies and their gathering/crafting dependencies.
It retains whole recipe yields, tool requirements, requested-output reserves,
and separate fuel allowances for smelts that cannot be merged.

`test/batch-plan.test.js` checks the exact-stock regression, reduced log gathering,
29 partial-inventory quantities, distinct furnace inputs, and tool progression.
The isolated gameplay fixture is:

```sh
MC_PORT=<isolated-port> node scripts/fuel-batch-test.js
```

Apply its artifact directory's `setup.json` only in the isolated server console,
then create `ready`. It grants 24 raw iron and 24 birch planks beside a furnace
and crafting table, then requests full iron armor plus eight birch planks. It
interrupts and reloads the saved goal during the furnace batch. An independent
receiver verifies delivery; instrumentation checks one 24-item furnace load,
16 fuel planks, all ingots ready before the first armor craft, and no digging.
The script rejects ports 25565 and 25577. This is a controlled mechanics fixture,
not fresh Survival acceptance.

On 2026-09-19, `fuel-batch-mu8sat5x` passed: one 24-raw-iron furnace load used
exactly 16 birch planks across a saved stop/resume. All 24 ingots were present
before the first armor craft. The independent receiver obtained all four armor
pieces and eight birch planks. Jev did no digging, retained his pickaxe, and
finished with health 20 and no deaths. All 444 automated tests also passed.

A separate seeded mixed-request ledger probe initially verified 82 of 96 plans. The other
14 failed before this trimming stage with missing raw iron or cobblestone;
each failure was also reproduced against the preceding committed batch planner.
These failures were recorded with their exact requests and
inventories in `artifacts/batch-trimming-stress-20260919.json`. The first case is
also saved in `artifacts/batch-trimming-failure.json`.
Tracing that first case showed a net-zero recipe cycle: ten carried raw iron
were compressed into a block and unpacked again while planning fifteen raw iron.
The acquisition planner then treated the method as complete despite still having
only ten. `artifacts/batch-missing-input-analysis-20260919.json` records the stock
ledger and sequence. The acquisition-accounting fix below now verifies the net
result before accepting a method; batch trimming alone cannot correct it.

## Acquisition accounting

`src/knowledge.js` prevents ingredient acquisition from consuming its own pending
output. Existing resource blocks can still be unpacked, and existing tools can
still serve as reusable prerequisites. Each acquisition method must leave enough
actual stock for its target, and the ledger rejects negative quantities. Failed
methods roll back their stock, steps, and fuel choice before trying another source.

Furnace construction now precedes budgeting its smelting inputs. Those inputs are
reserved before fuel preparation, so the same cobblestone cannot build a furnace
and become stone, and the same logs cannot become both charcoal and plank fuel.
Mining and hunting recalculate their remaining target after preparing tools.

`test/acquisition-accounting.test.js` covers raw-iron and nugget conversion cycles,
valid unpacking, furnace construction, charcoal fuel, reusable tools, and a mixed
stone/armor/plank request. It also replays 96 seeded mixed requests through every
action's prerequisites, consumption, production, and requested final inventory.
All 96 pass, as do the exact 14 previously saved failures. All 466 automated tests
passed on 2026-09-19.

```sh
MC_PORT=<isolated-port> node scripts/acquisition-accounting-test.js
```

Apply its `setup.json` only in the isolated server console, then create `ready`.
The fixture supplies nine raw iron, eight cobblestone, 21 birch planks, a stone
pickaxe, a placed crafting table, and seven nearby iron ore blocks. Eight exposed
stone blocks stand on a solid bedrock test platform to isolate material accounting
from terrain excavation. It requests
eight stone, two iron chestplates, and four planks. It must mine the missing
materials, craft and place a furnace, survive a saved stop/resume, smelt both
batches, and deliver all outputs to an independent receiver. Instrumentation
checks exact material use and no deaths. It rejects ports 25565 and 25577. These
controlled supplies do not establish natural Survival acceptance.

The first run, `acquisition-accounting-mu8w1qb5`, was stopped after exposing an
additional access problem: with 15 of 16 raw iron gathered, ore just outside
arm's reach triggered underground expedition preparation and an unnecessary wood
search. Ore's catalog depth was being mistaken for the observed block's depth.
`reachableLocalMine` now surveys a bounded short route to dry mining positions
before requiring expedition supplies. The survey does not travel, dig, or place
blocks, rejects deep descents and diving routes, and restores movement settings
on cancellation. `test/mining-access.test.js` covers those boundaries.

The next run, `acquisition-accounting-mu8w7a2f`, completed the request and verified
all three deliveries, two input batches, and 17 fuel planks, but failed its exact
mining-count assertion. Ten stone blocks were broken to collect eight drops:
excavating the thin stone platform let drops fall into lower terrain. The final
fixture uses exposed stone on bedrock so that this material-accounting check
does not depend on recovering falling drops. That terrain/pickup behavior remains
separate reliability work; the earlier failed result is retained.

The final run, `acquisition-accounting-mu8wf9zp`, passed on 2026-09-19. The
independent observer counted exactly eight stone and seven iron ore blocks mined,
one furnace crafted and placed, and two chestplates crafted. One 16-raw-iron load
and one eight-cobblestone load used 17 birch planks. After the saved stop/resume,
the receiver obtained eight stone, two chestplates, and four planks. Jev retained
his pickaxe, finished with health 20, and had no deaths.

## Persistent companion memory

### Implicit wood preferences

Normal player requests can now teach a soft wood-species default. Candidate
species come from the active Minecraft catalog's plank types; one additional Jev
Choice judges the current request alongside routing. Only a confident explicit
choice for the speaker's own supplies/build is retained. Quotes, negations,
discovery-only requests, ambiguous species, and orders for another player or the
bot are excluded. The notebook retains the source request and task ID, scoped to
the player/world. Defaulted variants, repeats, resumes, and task-history eviction
cannot create additional evidence or overwrite a newer choice.

Current instructions outrank explicit notes, which outrank learned defaults.
Explicit wood notes are judged separately before catalog selection so a competing
inferred choice does not confuse the selector. The policy reaches single items,
bundles, simple houses, Jev templates, and the custom designer's memory prompt.
The custom designer treats inferred materials as preferences subject to local
feasibility. Task history is excluded from material-choice context, preventing a
forgotten preference from being re-inferred from an old request. Older notebooks
load without inventing preferences from past bot-selected defaults.

Validation on 2026-09-19:

- All 473 automated tests passed; the final memory persistence checks also
  passed after adding the history-eviction/resume guard.
- `implicit-memory-routing-mu8x6frq`: 14 real-Jev cases passed, including one
  cherry request followed by unspecified planks, stairs, a house and a bundle;
  current oak/birch choices; explicit-note priority; player isolation; negated and
  other-recipient requests; and normal defaults after forgetting.
- `implicit-memory-design-mu8x8acv`: three real-Jev template designs passed:
  inherited cherry, explicitly requested birch, and a birch note overriding the
  learned cherry choice. This checks design selection/validation, not placement.
- `implicit-memory-live-mu8wyr87` and `implicit-memory-live-mu8x3905`: real player
  chat in isolated Survival taught cherry from a single delivered log, survived
  reconnect, delivered cherry planks when unspecified, honored an explicit oak
  request, and forgot the choice across a second reconnect. An independent player
  received one cherry log, two cherry planks and two oak planks. No bot commands,
  deaths, or self-reinforcement occurred; final health was 20. The later guard is
  covered by automated persistence checks. These used controlled supplies, not
  fresh Survival acceptance.

The earlier failed classifier records are retained: bundle coverage initially
rejected a correct preferred variant (`mu8wvyp0`), forgotten preferences leaked
through task history (`mu8x00x3`), and competing explicit/inferred hints selected
the wrong species (`mu8x382o`). The fixes change the supplied evidence and typed
decision workflow rather than lowering acceptance thresholds.

```sh
node scripts/implicit-memory-routing-test.js
node scripts/implicit-memory-design-test.js
MC_PORT=<isolated-port> node scripts/implicit-memory-live-test.js
```

For the gameplay fixture, apply `setup.json` in the isolated server console, then
create its `ready` file. Ports 25565 and 25577 are rejected. `MEMORY_CASE` can select
one routing example after the shared learning setup for focused failure diagnosis.

### Places, notes, and task history

`src/memory.js` maintains an atomic, bounded local notebook per server/bot and
optional `MC_WORLD_ID` namespace. Notes, named places, and request summaries are
scoped to their speaker. Places include dimensions; automatic place records come
only from completed, verified discoveries or builds. Recent resource hints share
one ledger across requests and restarts and retain their observed-block checks,
30-minute expiry, and 512-block search bound. Named places and notes do not expire
on that timer. Chest inventories and full conversation transcripts are not stored.

Jev classifies memory operations and selects names from verbatim message spans,
coordinates from parsed input or observed player positions, and references from
actual saved entries. Returning to a place uses ordinary navigation; recall never
starts travel. Remember/recall/forget does not cancel ongoing work. A fresh repeat
copies supported gameplay intent, never delivered counts, schematics, or operator
commands. Stop aborts the same request-bound classifier calls as other chat work.

The automated suite passed 455 tests, including persistence, separate owners and
worlds, corrections, forget across restart, history outcomes, clean repeated
requests, source invalidation, verified place creation, and dimension/cancellation
guards. The designer test also verifies that remembered preferences reach its
request context. Live classifier evaluation `memory-routing-mu8t5850` passed all
11 cases, including an implicit personal preference, a paraphrased return-home
request, recalling vs repeating, negation, preference-based catalog selection, and
a fresh explicit wood choice overriding memory. Existing companion routing also
passed all nine cases in `companion-routing-mu8t590y`.

The earlier memory classifier runs are retained. One exposed missing evidence in
the location selector; it now receives the actual observed positions. Another
showed personal preferences being discarded as ordinary discussion; a separate
Jev judgment now passes those statements to the memory classifier.

```sh
node scripts/memory-routing-test.js
MC_PORT=<isolated-port> node scripts/memory-live-test.js
```

For the gameplay fixture, apply the generated `setup.json` only in the isolated
server console, then create `ready`. The test rejects ports 25565 and 25577 and
uses the production session and real player chat. `memory-live-mu8t1osf` and the
final `memory-live-mu8vk4xr` passed on 2026-09-19: Jev saved the player's home
position, retained it and a wood preference through a reconnect, recalled home
without moving, walked back on request, and reported the completed task. A note
saved during follow left follow active; stop and forgetting home then worked.
The observing client independently saw arrival within three blocks. Both runs
finished at health 20, without deaths or bot-issued operator commands. Terrain
and initial positions were controlled; this is not fresh Survival acceptance.

## Stop during request interpretation

All nested classifiers for a player request share its cancellation signal.
Chat/Observatory stop, death, and disconnect abort outstanding interpretation
calls and fence off old results, allowing a new request to proceed without waiting
for the old call's timeout/retries. `test/typesafe-provider.test.js` checks this
with a deliberately stalled transport and a subsequent fresh request.

## Reachable crafting tables and furnaces

Being close to a workstation does not mean it can be opened. Jev now checks for
a reachable, visible block face and tries up to eight observed alternatives.
Searches finish their incremental pathfinding slices within a three-second
combined search budget. Travel has a separate 20-second overall limit, with
shorter limits per attempt. Digging, towers, and scaffolding are disabled for
this access check and restored afterward, including on stop. Geometry and
inventory accounting stay in code.

A carried table can be placed nearby when existing nearby tables cannot be
reached. Player workstations are preserved. A saved smelting batch remains tied
to its original furnace; a blocked furnace does not cause its ingredients to
be forgotten or the batch to move to another furnace. An unloaded saved
location is approached before declaring its furnace missing.

Recipe planning now uses the same access survey before counting a world station
as available. It does not walk, dig, place blocks, or spend materials during
that survey. If no observed station can be reached and none is carried, the
ordinary recipe graph includes making a replacement and its ingredients. This
applies to single requests, combined requests, house materials, and custom-build
batches. A request for a carried table or furnace still needs an inventory item;
an existing station cannot stand in for that output. Saved smelting batches
continue to require their original furnace rather than making a replacement.

`test/crafting.test.js`, `test/smelting.test.js`, and
`test/workstation-access.test.js` cover sealed nearest tables, alternative
selection, incremental searches, cancellation, changed blocks, movement
restoration, saved furnace identity, unloaded saved locations, replacement
recipes, and cancellation during planning.

For the isolated gameplay fixture, run
`MC_PORT=<isolated-port> node scripts/workstation-access-test.js`. Apply its
artifact directory's `setup.json` to the isolated console, then create
`setup-ready`. When requested, apply `portable.json` and create `portable-ready`.
Ports 25565 and 25577 are rejected. Terrain, supplied materials, and repositioning
are controlled; this is not natural Survival acceptance.

On 2026-09-19, `workstation-access-mu8qm35r` passed on Minecraft 26.1 Survival:
Jev bypassed a sealed table and furnace, crafted a chest at the alternative
table, and smelted two glass at the alternative furnace. Stopping after the
first glass and resuming opened the same furnace without loading input twice.
He then placed a carried table near the blocked one and crafted a second chest.
An independent client confirmed that placement and the intact enclosure and
original stations. There was no digging, no death or health loss, and all 64
carried cobblestone remained unused.

`MC_PORT=<isolated-port> node scripts/station-replacement-test.js` covers the
case with no usable stations and none carried. Apply its artifact directory's
`setup.json` in the isolated console, then create `ready`. Both player-server
ports are rejected. The supplied materials and sealed enclosure make this a
controlled Survival mechanics test, not fresh acceptance.

On 2026-09-19, `station-replacement-mu8rew5i` passed the combined request for a
chest and four glass. Jev turned four of six supplied logs into 16 planks,
crafted exactly one table and one furnace, placed them, and loaded all four
sand as one batch using three planks of fuel. The test stopped after crafting
the furnace and resumed from the saved checkpoint without duplicating either
station. The independent receiving client got exactly one chest and four glass,
observed both new stations, and verified that the sealed original stations and
their enclosure remained intact. Jev retained two logs and one plank, with
health 20, no deaths, and no digging.

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

## Falling mining drops

Mining and loose-resource pickup now share a bounded collector. It observes
supported pickup positions again as an item falls or moves, stops navigation
when inventory increases, and does not count an entity disappearing as receipt.
Pickup routes disable digging, scaffolding and towers, retain inherited movement
restrictions, and reject deep drops, hazardous floors and unknown terrain.
An unreachable stack has a 30-second cooldown at that observed position, so
ordinary acquisition can continue; moving the stack allows an earlier retry.
This does not promise retrieval from deep holes or unsafe water.

The original accounting fixture `acquisition-accounting-mu8w7a2f` exposed a
falling cobblestone at y57 and navigation toward an outdated item position,
with ten stone blocks broken for eight required drops. That run alone does not
prove whether every extra block was a replacement or navigation excavation.
`test/drop-collection.test.js` reproduces the old collection branch navigating
to an airborne cell with digging enabled, then covers moving/late drops,
inventory evidence, alternatives, cooldowns, unsafe routes, partial footing,
cancellation and movement restoration.

```sh
MC_PORT=<isolated-port> node scripts/drop-collection-test.js
```

Apply its artifact directory's `setup.json` in the isolated console, then create
`ready`. Ports 25565 and 25577 are rejected. The controlled ledge and staircase
fixture uses a second client to observe block changes and pickup packets.
On 2026-09-19, `drop-collection-mu8xrw7j` passed: the mined cobblestone fell from
y63.23 to y60, and a tossed raw iron fell from y65.32 to y60. Jev collected both
with no acquisition errors, exactly one stone broken, no placement, all eight
carried planks retained, health 20, no deaths, and no bot commands. All 482
automated tests passed. These are controlled mechanics checks, not fresh
Survival acceptance.

## Replacing tools during resource requests

The bounded replacement proof now runs for single-item, shared bundle and
construction acquisition when their dependencies require a pickaxe. Previously
it was reached only by an explicit pickaxe acquisition or surface escape. A
nearly broken tool could therefore send an ordinary stone request searching for
new wood despite having the last swing and ingredients for a replacement.

The recipe graph must prove that all replacement ingredients are carried or
that the only missing material is nearby stone within the worn tool's remaining
durability. A crafting table already verified as reachable may satisfy the
station requirement. No other planned inventory is treated as carried. One
mining or crafting dependency executes at a time, with digging and scaffolding
disabled for travel. The next step is recomputed from actual inventory, allowing
recovery to continue after the old tool breaks or the connection restarts.
Wet/unsafe targets, protected construction and minimum mining heights retain
their restrictions. Healthy tools do not trigger this fallback.

`test/tool-recovery.test.js` reproduces the missed ordinary-request recovery and
the missing continuation after tool breakage, alongside recipe funding, station
availability, inventory evidence and interruption checks. For the real fixture:

```sh
MC_PORT=<isolated-port> node scripts/tool-request-recovery-test.js
```

Apply `setup.json` in the isolated server console and create `ready`. Ports
25565 and 25577 are rejected. The fixture supplies a wooden pickaxe with one
use left, two cobblestone, two sticks, nearby stone and an existing world table.
It requests eight cobblestone and a furnace, disconnects after the old tool
breaks, reloads the saved request, and checks replacement and both deliveries
with an independent client. Supplies and terrain are controlled; this is not
fresh Survival acceptance.

On 2026-09-19, `tool-request-recovery-mu8y8nez` passed: one final wooden-pickaxe
use completed the replacement ingredients, then Jev disconnected and resumed
from the saved combined request. He made exactly one stone pickaxe and one
furnace, mined exactly 17 stone blocks (including the replacement ingredient),
and delivered eight cobblestone plus the furnace. No wood was gathered, no
blocks were placed, the replacement pickaxe remained carried, and health stayed
20 with no deaths or bot commands. All 487 automated tests passed.

The earlier runs remain recorded: `mu8y4szg` stopped at a missing fixture goal
version; `mu8y6eck` completed the gameplay but failed the crafting-count check
because its observer hook was installed before compatibility initialization.
The final fixture sets the saved-goal version and installs its hook after spawn.

## Access through leaf cover

Natural companion run `mu8yf4yy` started empty in a fresh Normal world on
2026-09-19 and immediately blocked on a spruce canopy while trying to obtain
16 cobblestone. Surface travel forbade all digging, and acquisition discarded
logs without an already-clear mining stance. These are geometric access rules,
so the fix is in execution code rather than another model prompt.

Surface travel may now clear dry leaves while keeping terrain, trunks, buildings,
inherited no-dig rules, construction protection and existing drop limits intact.
Acquisition retains nearby covered resources, tries ordinary dry access first,
then surveys a leaf-only approach within 12 blocks. The surveyed path is limited
to 16 nodes and eight leaf breaks, with scaffolding, towers and parkour disabled.
After arrival, up to three observed leaf obstructions on the eye ray may be
cleared using the existing safe-break checks. A reachable dry leaf above a
resource on safe solid ground is also cleared so its drop has walkable headroom;
the collector itself still cannot excavate. Actual dry footing and line of
sight must still pass before mining the requested block. Waterlogged leaves
cannot be cleared by this fallback. All temporary movement rules restore on
success, failure and cancellation.

The regression tests reproduce the discarded covered resource and overhanging
leaf, and check protected/flooded cover, no-dig inheritance, bounded routes,
terrain preservation, cancelled work and movement restoration. All 493
automated tests passed. Real controlled fixtures use independent clients for
block changes and, for acquisition, pickup packets:

```sh
MC_PORT=<isolated-port> node scripts/canopy-travel-test.js
MC_PORT=<isolated-port> node scripts/foliage-mining-test.js
MC_PORT=<isolated-port> FOLIAGE_TEST_OVERHANG=1 node scripts/foliage-mining-test.js
```

Apply each artifact's `setup.json` in the isolated server console, then create
`ready`. Interactive ports 25565 and 25577 are rejected. The fixture terrain and
starting positions are supplied; the bots begin with empty Survival inventories.
`canopy-travel-mu8z8sx1` cleared two leaves and descended the supported crown
from y70 to ground at y64. `foliage-mining-mu8zc9u7` cleared the leaf overhang
blocking its eye ray and collected one cherry log. The final covered-resource
fixture `foliage-mining-mu8zh7ye` cleared six approach leaves and one leaf for
pickup headroom, mined one cherry log, and independently verified its pickup.
Health remained 20, with
no deaths or bot commands. These are controlled mechanics checks.

The original natural failure is preserved as `mu8yf4yy-before-canopy-recovery`.
The leaf-travel-only retry still failed. A subsequent retry occurred at night
and selected unreachable dirt for shelter; focused acquisition then exposed
the eye-ray obstruction. The final resumed natural run gathered two spruce logs
and crafted a table and four remaining planks, but still blocked while seeking
more wood lower in the tall canopy. The requested cobblestone delivery and
two-cycle Survival acceptance therefore remain unproven. No setup commands were
issued in that natural world, and resumed debugging is not fresh acceptance.

Earlier fixture failures are also retained: `foliage-mining-mu8z1x8u` had no
working console input and was aborted before setup; `canopy-travel-mu8z5dit`
completed the descent but counted natural grass decay under the fixture trunk
as bot excavation (the setup now starts that cell as dirt);
`foliage-mining-mu8zagsq` collected its log but incorrectly required an overhang
break on a route with an already-clear view. The separate overhang scenario
now supplies the obstructed stance explicitly.
`foliage-mining-mu8zc9u9` exposed a real pickup failure when the log fell beyond
pickup reach under its remaining leaf roof; the access step now opens that
headroom before mining instead of treating a broken log as collected inventory.
