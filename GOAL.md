# Survival companion goal

Build and locally test a Jev-powered Minecraft survival companion. Starting with an empty inventory in a fresh natural world on Normal difficulty, it should gather resources, obtain food and shelter, maintain usable tools, manage hunger and health, avoid dangerous falls and other hazards, respond to nearby threats, and make progress through the survival technology tree while carrying out player requests.

It should act autonomously to stay alive between requests, and interrupt ordinary work when immediate survival needs require attention.

Retain the concrete acceptance requests: “build a house,” “get me 32 purple concrete,” and “find a way to the Nether.” Verify each outcome against the world, recipient inventory/pickup evidence, or actual dimension transition. Keep persistent goals, recipe dependencies, exploration, bounded execution, cancellation, restart/resume, and honest blocker reporting. Add recovery after death, including safe retrieval of dropped items where feasible and replanning from remaining resources when retrieval is unsafe or items are gone.

Accept natural-language commands in Minecraft chat addressed as “Jev …”, regardless of its login username, including immediate stop, status, and resume controls.

Use Jev as the only runtime model initially. Ordinary code owns Minecraft rules and actions. Document demonstrated limitations before considering OpenRouter.

## Acceptance

- Survive two consecutive full day/night cycles on Normal difficulty from an empty inventory while completing a useful player request, without deaths in that run.
- Demonstrate food acquisition/eating, safe nighttime behavior, and replacement of a worn-out tool through real gameplay.
- Complete the house, purple concrete delivery, and Nether requests from empty survival starts in natural worlds.
- Separately test cancellation, process restart, disconnect, death recovery, and exhausted-resource/unreachable-goal handling. Report failed trials as failures; do not erase or relabel them.
- Use no item grants, teleports, creative mode, time changes, or difficulty changes during acceptance runs. Controlled resource worlds are allowed for debugging and must be labeled separately.

The current implementation has only been exercised on Peaceful difficulty. Controlled tests establish specific mechanics, not general survival competence. Full game completion and defeating the Ender Dragon are outside this initial companion milestone.
