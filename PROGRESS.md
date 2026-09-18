# Goal progress — September 18, 2026

The goal remains active. Completion requires live, empty-inventory survival runs for a house, 32 purple concrete, and an actual Nether transition, plus cancellation, recovery, and persistent progress. No OpenRouter integration is needed or present.

Implemented:

- Jev request interpretation with closed outcomes, material and quantity selection, no-match handling, and response validation.
- Goal checkpoints keyed by server/player, fixed building blueprint, resume/stop/status and serialized replacement.
- Dependency executor for recipes, tool tiers, smelting, concrete hardening, and portal construction/entry.
- House completion checks for all 96 structural blocks, clear interior and doorway; inventory/dimension checks for other goals.
- Bounded navigation, recorded failed mining positions, deterministic exploration history, finite retry/search budgets, honest blockers.
- A survival acceptance runner recording initial inventory/game mode, real Jev interpretation, action observations, and independent completion checks. It has no grant/teleport/creative commands.

Evidence:

- `npm test`: 23 tests pass, including chat nickname parsing, simulated resource consumption, recipe comparisons with Minecraft 26.1 data, rejection of incomplete houses, checkpoint round-trip, invalid Jev labels, cancellation of a pending navigation, navigation stall/hard deadlines, foundation protection, furnace output accounting while the inventory window is open, and mining speed with correct harvest restrictions.
- `node scripts/eval-intents.js`: all 14 real Jev calls matched expected interpretation (including the `Jev` nickname, half a stack, unsupported glass castle, stop, status and resume). Full answers in `artifacts/intent-eval.json`.
- First survival trial `artifacts/mu76ypz4/`: FAILED honestly while navigating steep mountain/ocean terrain on seed 12345. No items acquired, no claimed success. Led to less brittle building-site checks and exploration targeting visible dry land.
- Second survival trial `artifacts/mu772kzs/`: PASSED house acceptance as Trialmu772kzs. Empty inventory at spawn, gathered 24 oak logs, crafted 96 planks, and verified all 96 structural blocks plus clear interior/doorway at (83, 136, -32). Recovered from navigation and placement errors. No grants or teleports. Session 12261 exited 0.
- Natural-world concrete trial `artifacts/mu77bn3e/`: currently stopped with a navigation blocker at about (122,120,32). Starts from empty inventory, retains crafting table and a few travel materials. It was resumed across multiple code fixes; latest session 73780 exited 1. No sand acquired yet. Natural terrain exploration remains a real unsolved issue.
- Controlled-world concrete trial `artifacts/mu77pnbc/`: PASSED, including actual pickup by Receivemu77pnbc. Started empty in survival; gathered wood, 16 sand, 16 gravel, flowers; crafted purple dye and powder; crafted a wooden pickaxe; hardened/mined 32 blocks; delivered all 32. Required resumptions while fixing table batch crafting and handover sync. Final session 16413 exited 0, receiver inventory exactly 32 purple_concrete. Previous sessions 74988 and 98081 failed honestly on delivery. Natural-world resource discovery is not proven by this fixture.
- Directed handover uses the vanilla Ctrl-Q DROP_ALL_ITEMS action (verified enum ordinal 3 in the local server JAR) after synchronizing the inventory/held slot, then observes recipient pickup events. A saved uncertain handover can recover nearby dropped concrete and retry; it cannot silently craft replacements.
- Controlled fixture server session 9530 (TTY with writable console), cwd `.test-fixture`, flat survival/peaceful on port 25567. Terrain/resources were prepared using `scripts/fixture-commands.js` BEFORE the trial. No commands are issued during acceptance. This proves mechanics, not unrestricted natural-world exploration.
- Fixed an upstream navigation pitfall: pathfinder's goto resolves on an empty path; the wrapper now verifies goal.isEnd against actual position and stops failed navigation. Added a regression test.
- Separate vanilla 26.1 test server running in tool session 5285, cwd `.test-server`, localhost:25566, seed 12345, survival/peaceful. Original server on 25565 was left alone.
- Actual chat control trial `artifacts/control-mu788ljj/`: PASSED stop, no subsequent movement/progress, resume of the same blueprint, and automatic resumption after restarting the bot process. No grants or teleports.
- Nickname chat trial `artifacts/control-mu78yl9c/`: PASSED the same real chat/start/stop/resume/restart checks using `Jev ...` while the bot logged in as `Ctrlmu78yl9c`.
- Controlled Nether trial `artifacts/mu781ks4/`: PASSED after resumptions to correct mining speed and a portal foundation bug. Started empty; crafted wooden, stone, iron and diamond pickaxes; mined/smelted iron; made flint and steel; mined obsidian; built and lit a portal at (29,64,-14); entered `the_nether`. Final session 59165 exited 0. No grants or teleports.
- Portal bug: support dirt was mined from the planned foundation, deepening the resource pit. Gathering now excludes construction foundations/approaches, dirt gathering prefers surface soil, scaffolding is obtained before site selection, and the entire portal footing is checked. Navigation also respects construction exclusions.
- Natural concrete regression `mu77bn3e`, session 23355: FAILED by falling from a high place. The revised search descended from the mountain but safe movement is still unreliable. Server log confirms death at 13:39:05 local. Requires fall prevention and recovery; this must not be counted as success.
- Checked installed Mineflayer 4.39.0 against its published npm tarball: identical, including inventory synchronization support. No dependency patches are required.
- Reproduced installation and all initial tests from a clean checkout with `npm ci`. Declared Node >=22 to match dependencies.
- Added an application-side workaround for the upstream `incorrect_for_wooden_tool` material bug: pickaxe blocks retain harvest requirements but use correct tool-speed multipliers. The original Nether trial mines each obsidian for 75 seconds; the corrected diamond-pickaxe calculation is 9.4 seconds. See https://github.com/PrismarineJS/mineflayer/issues/3921.

Still required:

1. Complete and independently verify natural-world concrete and Nether trials. House passed in a natural world; concrete and Nether passed in the controlled fixture.
2. Test placement, crafting, smelting, hardening and portal entry in-game; resolve failures found.
3. Add reliable underground progression/resource search, tool replacement, and recovery through hostile terrain where needed.
4. Re-run the updated concrete workflow uninterrupted, and test partial delivery/cancellation live. Full delivery is now proven in the controlled fixture.
5. Test cancellation, restart/resume, death/disconnect, and repeated-failure behavior through the actual chat entry point.
6. Reconcile experimental legacy command support and current limited routing, and document accurate tested scope.
7. Expanded survival scope requested: food/hunger, health/threats, night safety, tool replacement, and death recovery on Normal difficulty. Proposed acceptance criteria are in `GOAL.md`; these are not yet implemented or proven.

Do not mark the goal complete based on unit tests or the presence of implementation. Live acceptance and recovery evidence are still missing.
