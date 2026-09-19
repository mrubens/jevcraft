# Survival companion and game completion goal

Build and locally test JevBot until it can autonomously beat Minecraft: start with an empty inventory in a fresh natural world on Normal difficulty, progress through the Overworld and Nether, obtain Eyes of Ender, locate a stronghold, enter the End, defeat the Ender Dragon, and return alive to the Overworld. This expanded objective was requested on 2026-09-19. The earlier companion requirements and their acceptance evidence remain part of the goal.

Build and locally test a Jev-powered Minecraft survival companion. Starting with an empty inventory in a fresh natural world on Normal difficulty, it should gather resources, obtain food and shelter, maintain usable tools, manage hunger and health, avoid dangerous falls and other hazards, respond to nearby threats, and make progress through the survival technology tree while carrying out player requests.

It should act autonomously to stay alive between requests, and interrupt ordinary work when immediate survival needs require attention.

Use Jev for ongoing nested decisions: choose the current priority, a subtask within that priority, and the next bounded action or recovery tactic from feasible observed options. Start with house building and survival interruptions. Preserve the player's goal across interruptions, record an inspectable decision trail, avoid repeatedly choosing failed routes, discard stale decisions, and measure actual model latency. Exact recipes, action availability, movement mechanics, immediate emergency responses, and completion verification remain in code.

Extend natural-language item requests across the actual registry using dynamic nested catalog classifiers, then expand actual recipe/tool/drop dependencies. Support come and continuous follow. Distinguish recognized items from implemented acquisition methods, and verify requested quantities and recipient pickup. Use the optional OpenRouter Fable LLM for bounded recovery advice after repeated failures, while Jev continues ordinary nested decisions. Provide observed terrain, inventory, recent failures and dynamically available actions; preserve the original request and verify every executed recovery step.

Retain the concrete acceptance requests: “build a house,” “get me 32 purple concrete,” and “find a way to the Nether.” Verify each outcome against the world, recipient inventory/pickup evidence, or actual dimension transition. Keep persistent goals, recipe dependencies, exploration, bounded execution, cancellation, restart/resume, and honest blocker reporting. Add recovery after death, including safe retrieval of dropped items where feasible and replanning from remaining resources when retrieval is unsafe or items are gone.

Accept natural-language commands in Minecraft chat addressed as “Jev …”, regardless of its login username, including immediate stop, status, and resume controls.

The initial survival controller uses Jev for runtime decisions; ordinary code owns Minecraft rules and actions. The user has now authorized an optional OpenRouter building-design tool using `anthropic/claude-fable-5.1`. It takes the requested structure and observed world state and returns a validated, persistent schematic for Jev to execute. Without that service, Jev selects and configures supported building templates. Jev decisions may connect through TypeSafe or OpenRouter. The same optional LLM may advise on stuck recovery, selecting only existing executable actions with persistent call/step limits and immediate cancellation. These extensions do not relax the original natural-survival acceptance criteria below.

Commit and push tested milestones regularly to the private repository, with accurate progress notes and remaining limitations.

## Acceptance

- Survive two consecutive full day/night cycles on Normal difficulty from an empty inventory while completing a useful player request, without deaths in that run.
- Demonstrate food acquisition/eating, safe nighttime behavior, and replacement of a worn-out tool through real gameplay.
- Complete the house, purple concrete delivery, and Nether requests from empty survival starts in natural worlds.
- Independently verify a complete autonomous run from a fresh empty Normal-survival start through dragon defeat and return alive to the Overworld. Evidence must establish the actual resource progression, End entry, dragon defeat, and return; recognizing the request or reaching an intermediate milestone is insufficient.
- Separately test cancellation, process restart, disconnect, death recovery, and exhausted-resource/unreachable-goal handling. Report failed trials as failures; do not erase or relabel them.
- Use no item grants, teleports, creative mode, time changes, difficulty changes, privileged world-discovery commands, or manual gameplay assistance during acceptance runs. Controlled resource worlds are allowed for debugging and must be labeled separately. Preserve failed runs and distinguish controlled and resumed trials.
- Keep the Observatory useful and protect the interactive player world from testing disruptions. Run heavy local test worlds sequentially, stop terminal trials' unused servers after saving, and record deliberate bot updates separately from unexpected disconnects.

House construction and two full day/night cycles passed in uninterrupted fresh natural Normal trial `mu7j1633`, including hunting, cooking and returning to shelter. Fresh uninterrupted Normal concrete trial `mu7uhz06` completed ingredient gathering, hardening and delivery, with exactly 32 blocks verified in an independent receiver inventory. Natural eating and iron-pickaxe replacement have retained event evidence, including fresh Nether trial `mu7sfld6`, which subsequently died in lava after collecting six obsidian. That failed run is preserved and does not satisfy Nether acceptance. Controlled hazard routing now crosses the copied ruined-portal terrain at full health without magma/lava contact; a fresh full Nether run is still required. Natural Normal chat stop/status/resume and process restart passed separately; controlled disconnect/death recovery also passed. Controlled mechanics tests do not replace the remaining full natural Nether or game-completion requirements.

## Progression toward winning

1. Finish reliable natural survival preparation and Nether access, with food, maintained equipment and recoverable travel routes.
2. Explore the Nether and obtain blaze resources, obtain ender pearls through supported survival mechanics, and craft Eyes of Ender. Exact recipes and pickup verification remain in code; Jev selects among feasible next actions.
3. Locate a stronghold from ordinary in-game observations, reach its portal room and activate the End portal. Do not use privileged locating commands or external seed knowledge to supply the answer.
4. Enter the End prepared, handle its hazards and crystals, defeat the dragon, and use the exit portal to return alive.
5. Verify the complete fresh-start progression independently, while retaining all earlier companion checks. Record missing actions and blockers honestly; partial progression does not finish this goal.
