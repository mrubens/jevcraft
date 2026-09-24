# Rule audit: where code chooses instead of Jev (2026-09-24)

The project shows that a decision model can play Minecraft. A judgment (a
choice between reasonable alternatives) belongs to Jev, as options with facts;
code keeps mechanics (how an action is carried out, air, pathing, event-loop
safety), feasibility (whether an option is possible now) and bookkeeping (the
stall detector's measurement, attempt counts). This audit lists the rules that
choose. Line numbers are as of commit 27ef475.

## Done in 27ef475

- The play decisions have no confidence gate: `survival_priority`,
  `ranged_response`, `encounter_stance` and `dragon_fight` act on Jev's pick at
  any confidence. Their hand-written fallbacks answer only when Jev cannot be
  reached.
- `encounter_stance` is asked by default (`JEV_ENCOUNTERS=0` turns it off).
  An unsure pick is no longer handed to the rules for fifteen seconds; a stance
  that cannot be carried out is struck off for twenty seconds and Jev chooses
  again from what is left. The charge at ground shooters is one of its options
  (`charge_shooter`), and pillar, seal and bunker are offered at arm's length
  with what building costs there in the description.

## Done since

- d48caef: the creeper dance and building beside a mob or a creeper are
  stance options with their costs said, not rules run first or options
  hidden; health no longer hides a stance; a chosen fight holds its ground
  when the charge cannot be run. A stall, and a run of five failures
  (`persist`), is answered by Jev: another way, the rung for later, or a
  detour, with the strikes and the failure as facts; the three-failure
  move-on rule is gone. An ore the bot is short of is put to Jev at once
  with the shortage said, not taken by rule.
- 6662106: the night. The walk home is an option from dusk (not a fixed
  hour), staying up is always offered with the kit, the bed and the nights
  awake said, and a shelter beside a bed is offered with the bed's
  advantage said. Probed: unarmoured with no bed Jev shelters (1.0); with
  the bed forty-five blocks off it walks home (0.62 at dusk, 0.71 at night).
- 1b3fa96: `keep_working`, leaving mobs be for fifteen seconds, is a stance;
  the stance question is told what mobs hit for and how fast a sword kills.
  Probed: a zombie at twelve is fought (0.82), a creeper at five is danced
  (0.92), a skeleton at ten is charged (0.89). Three zombies at six against
  an unarmoured bot at eight health is also fought (0.88): Jev's call,
  watched in the trials.
- 22e026f: twenty working minutes on a rung ask Jev again with the minutes
  said, instead of setting the rung aside.
- 0855ad6: `upkeep` (a spare pickaxe, wood, blocks, or carry on).
- e2f0ba8: `gather_more` (the rest of a trunk, vein or stone face).
- f18082d: `home_site` (up to four sites with distance, levelling, water).
- 68d8b99: `evening_chore` (which chore before bedtime, or wait).
- 821eea2: `pocket_next` (stay, leave, the bed, the watcher, the mine).
- 503f7ca: the stance question gets this bot's fight cost (each mob's hit
  after its armour, swings to kill, health to kill them all), checked
  against the arena. Probed: three zombies against an unarmoured bot at
  eight health went from fight (0.88) to pillar (0.68).
- 3622502: `shelter_method` (saved shelter, room at a site, pocket here,
  shaft, mine), held for the night.
- 70e8da0: the food search always offered; an animal near a hostile is
  offered with the distance said.

The gates that remain are all on player-facing questions (intake, commands,
builds, memory, dream): below the bar the bot asks the player, which is Jev's
uncertainty put to a person, not a rule choosing.

## Still choosing, most-fired first

### Encounters (many times a minute in a fight)
| Where | Rule | Proposal |
|---|---|---|
| survival.js:410, 642 | `ranged_response` asks the same thing as the stance | Merge into `encounter_stance` |
| survival.js:747-838 | `escape()`'s cornered order: run, fight, bunker, seal, charge, wall off, hold | `wall_off` and `hold` stance options; the order becomes the outage fallback |
| survival.js:701 | A persistent follower means a 20-40 block run, not a hop | `retreat_near` / `retreat_far` with a `persistentFollower` fact |
| survival.js:1667 | Attacked beside a half-built pocket: finish it | A `seal_prepared_shelter` stance option |
| mob-hunt.js:104, mob-policy.js:70 | Health, food and full-kit floors decide whether a hunt is asked at all | Facts on `hunt_target`, plus `recover_first` |
| mob-hunt.js:34, 410 | A spider hunt for string first gets iron sword, armour and shield | `hunt_with_carried` vs `gear_up_first` |
| tunneling.js:62 | Dig through and fight one or two mobs in the tunnel | A stance option or a `tunnel_blocked` decision |

### Night and shelter (every tick of every night)
| Where | Rule | Proposal |
|---|---|---|
| survival.js:46, 57, 1422, 1465 | Night-mine ores, depth, and when a pickaxe is replaced | New `night_mine_target`, with uses left as a fact |

### Work (every mining step, every stall)
| Where | Rule | Proposal |
|---|---|---|
| stillness.js:244 | A stalled survival action is refused for ten minutes | Keep it offered with the stall as a fact |
| work.js:874 | Three missed candidates, then explore | Back to `resource_source` with the misses as facts |
| work.js:1204-1283 | What to do while cooking (ore list, stone, logs) | New `while_cooking` decision reusing the detour options |
| work.js:245-271, 2876 | Expedition readiness and Nether food gates | New `expedition_readiness` decision |
| work.js:2776 | Detour ores: a fixed list, only the first found offered | One option per ore found, with need as a fact |
| game-progress.js:142, 166, 207, 282 | Tool wear counts as missing; village bed before sheep; the bow only at night; the pearl-source order | Facts and options on `win_strategy` |

### Home, food and inventory
| Where | Rule | Proposal |
|---|---|---|
| home-base.js:337-423 | Home stages in a fixed order after the bed | New `home_step` decision |
| home-base.js:381, 680 | Wool means killing the nearest sheep | Options: kill, craft shears, village bed |
| inventory-tidy.js:10-129 | What is thrown out when pockets are full | New `inventory_drop` decision |
| home-stash.js:49-225 | What the chest and pockets keep | Deposit bundles as options |
| vitals.js:206-214 | When to eat, and not with a mob within 5 | Low value; an `eat` stance option when hurt with food carried |
| corpse-run.js:18-78 | Which items are worth a trip, and when it is safe to go | New `corpse_run` decision |

## Kept as code

Air and drowning (vitals, surface.js), the swing at arm's length and the shield
against an arrow already in flight (faster than a question), off a ledge when a
mob is close, lava-edge checks, pathing, the stall detector itself, set-aside
bookkeeping, layout and levelling, and wearing the best armour (dominant, not a
trade-off).

## Order of work

1. Encounters: the pre-emptions into `encounter_stance`, the hidden options
   offered, `ranged_response` merged.
2. `stall_answer`, replacing the stall ladder and `persist`.
3. Night: dusk times as facts, `go_home_to_bed`, `shelter_method`, `pocket_next`.
4. `opportunistic_ore` without the rule; gathering amounts; `upkeep`.
5. Home: `home_site`, `home_step`; then inventory, stash and corpse run.
