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

The gates that remain are all on player-facing questions (intake, commands,
builds, memory, dream): below the bar the bot asks the player, which is Jev's
uncertainty put to a person, not a rule choosing.

## Still choosing, most-fired first

### Encounters (many times a minute in a fight)
| Where | Rule | Proposal |
|---|---|---|
| danger.js:136 | Work stops for any hostile within 8 (shooters 16 or 32) before a stance is asked | Keep a floor (melee within 3, or hit); the band beyond it goes to `encounter_stance` with a `keep_working` option |
| survival.js:352, 494 | The creeper dance runs before the stance question | `creeper_dance` stance option |
| survival.js:322 | Hoglin near a drop: seal in, before the stance | A `knockbackDrop` fact on the stance; keep only feasibility |
| survival.js:558-586 | Stance options hidden by health (fight 8, bunker 10, charge 6, shoot 8) and a creeper within 7 | Offer them; health and the creeper go in the descriptions |
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
| day.js:11-14 | Work stops at 9500; the walk home at 10000 or 11000 | Ask from about 9000 with time, distance home and walk time as facts; a `go_home` option |
| survival.js:1730-1762 | Walking home for the bed runs before `survival_priority` | `go_home_to_bed` on `survival_priority` |
| survival.js:1825 | Staying up is offered only with bed, full kit and little sleep debt | Offer it; kit, bed and debt as facts |
| survival.js:877-955, shelter.js:68 | Which shelter: saved one, site, seal here, shaft pocket, night mine | New `shelter_method` decision |
| survival.js:1593-1663, 1149 | Inside a pocket: stay, leave, open on a watcher, night-mine | New `pocket_next` decision |
| survival.js:46, 57, 1422, 1465 | Night-mine ores, depth, and when a pickaxe is replaced | New `night_mine_target`, with uses left as a fact |

### Work (every mining step, every stall)
| Where | Rule | Proposal |
|---|---|---|
| work.js:152-202, 2505-2546, stillness.js:244 | The stall answer ladder: turn the search, move on, detour, set the rung aside after 3 strikes or 2 struggles; `persist` stands still up to 15 s | One `stall_answer` decision (try_differently, detour, set_aside_rung, keep_going, recovery); today's order becomes its fallback |
| work.js:3218 | Unsure recovery: move on from the resource by rule | An option of recovery, or `stall_answer` |
| opportunistic-mining.js:36 | Coal, iron, diamonds and lapis are taken without asking | Offer them on `opportunistic_ore` with counts carried and needed |
| work.js:715, 862 | How much to gather: logs 8, vein 32, rock 24 | A second level on `resource_source` |
| work.js:874 | Three missed candidates, then explore | Back to `resource_source` with the misses as facts |
| work.js:205-243 | A spare pickaxe under 24 uses; a wood and block reserve, every tick | New `upkeep` decision |
| work.js:1204-1283 | What to do while cooking (ore list, stone, logs) | New `while_cooking` decision reusing the detour options |
| work.js:245-271, 2876 | Expedition readiness and Nether food gates | New `expedition_readiness` decision |
| work.js:2776 | Detour ores: a fixed list, only the first found offered | One option per ore found, with need as a fact |
| game-progress.js:124, 103, 328 | The ladder offers rungs only in order; 20 minutes on a rung sets it aside | Keep dependencies only; the minutes become facts on `win_strategy` |
| game-progress.js:142, 166, 207, 282 | Tool wear counts as missing; village bed before sheep; the bow only at night; the pearl-source order | Facts and options on `win_strategy` |

### Home, food and inventory
| Where | Rule | Proposal |
|---|---|---|
| home-base.js:110-263, 793 | Where the base goes; the first flat shore wins | New `home_site` decision over the top few sites |
| home-base.js:337-423 | Home stages in a fixed order after the bed | New `home_step` decision |
| home-base.js:381, 680 | Wool means killing the nearest sheep | Options: kill, craft shears, village bed |
| foraging.js:204, 38 | `search_food` offered only when nothing else is; animals near hostiles dropped | Always offer; the hostile distance as a fact |
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
