# Companion reliability checks

The roadmap remains open. These checks cover specific improvements, not every
terrain, recipe, or interruption the bot may encounter.

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
