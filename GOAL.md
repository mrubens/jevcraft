# Survival companion goal

Build and locally test a Jev-powered Minecraft survival companion. Starting with an empty inventory in a fresh natural world on Normal difficulty, it should gather resources, obtain food and shelter, maintain usable tools, manage hunger and health, avoid dangerous falls and other hazards, respond to nearby threats, and make progress through the survival technology tree while carrying out player requests.

It should act autonomously to stay alive between requests, and interrupt ordinary work when immediate survival needs require attention.

Use Jev for ongoing nested decisions: choose the current priority, a subtask within that priority, and the next bounded action or recovery tactic from feasible observed options. Start with house building and survival interruptions. Preserve the player's goal across interruptions, record an inspectable decision trail, avoid repeatedly choosing failed routes, discard stale decisions, and measure actual model latency. Exact recipes, action availability, movement mechanics, immediate emergency responses, and completion verification remain in code.

Extend natural-language item requests across the actual registry using dynamic nested catalog classifiers, then expand actual recipe/tool/drop dependencies. Support come and continuous follow. Distinguish recognized items from implemented acquisition methods, and verify requested quantities and recipient pickup. The user has also proposed a general LLM for long-term plans and strategy recovery, while Jev makes immediate nested decisions; integrate that next planning layer after documenting the current failure modes and choosing its runtime configuration.

Retain the concrete acceptance requests: “build a house,” “get me 32 purple concrete,” and “find a way to the Nether.” Verify each outcome against the world, recipient inventory/pickup evidence, or actual dimension transition. Keep persistent goals, recipe dependencies, exploration, bounded execution, cancellation, restart/resume, and honest blocker reporting. Add recovery after death, including safe retrieval of dropped items where feasible and replanning from remaining resources when retrieval is unsafe or items are gone.

Accept natural-language commands in Minecraft chat addressed as “Jev …”, regardless of its login username, including immediate stop, status, and resume controls.

The initial survival controller uses Jev for runtime decisions; ordinary code owns Minecraft rules and actions. The user has now authorized an optional OpenRouter building-design tool using `anthropic/claude-fable-5.1`. It takes the requested structure and observed world state and returns a validated, persistent schematic for Jev to execute. Without that service, Jev selects and configures supported building templates. Jev decisions may connect through TypeSafe or OpenRouter. This design extension does not relax the original natural-survival acceptance criteria below.

Commit and push tested milestones regularly to the private repository, with accurate progress notes and remaining limitations.

## Acceptance

- Survive two consecutive full day/night cycles on Normal difficulty from an empty inventory while completing a useful player request, without deaths in that run.
- Demonstrate food acquisition/eating, safe nighttime behavior, and replacement of a worn-out tool through real gameplay.
- Complete the house, purple concrete delivery, and Nether requests from empty survival starts in natural worlds.
- Separately test cancellation, process restart, disconnect, death recovery, and exhausted-resource/unreachable-goal handling. Report failed trials as failures; do not erase or relabel them.
- Use no item grants, teleports, creative mode, time changes, or difficulty changes during acceptance runs. Controlled resource worlds are allowed for debugging and must be labeled separately.

House construction and two full day/night cycles have passed in an uninterrupted fresh natural Normal world, including hunting, cooking, and returning to shelter both nights. Natural eating and healing now have evidence from a resumed Normal concrete diagnostic. Natural tool replacement and the complete natural concrete/Nether outcomes remain unverified. Controlled tests establish eating, tool replacement and other individual mechanics; they do not replace these remaining acceptance requirements. Full game completion and defeating the Ender Dragon are outside this initial companion milestone.
