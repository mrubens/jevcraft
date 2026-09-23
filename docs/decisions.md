# Every question Jev is asked

Generated from `src/decisions` by `node scripts/decisions-doc.js`. Do not edit by hand: change the definition and regenerate.

Each question is defined once, with its stakes (what a wrong answer costs), its bar (a confidence below it is not acted on as asked, and what happens instead), and, for the in-game trees, the code's own answer when Jev cannot be reached. Every tree decision is asked through one runner (`decide`), and every batched question through `ask`; nothing else in `src` calls the model.

57 questions.

## survival

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `survival_priority` | choice | high | survival | 0.2: a coin flip between the night, food and the request goes to the safety order, not to whichever side edged it | code default |

## combat

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `ranged_response` | choice | high | survival | 0.2: unsure, the health rule decides: shoot while healthy, otherwise retreat | code default |
| `hunt_target` | choice | high | combat | none: every target offered already passed canBegin and isolated; a close call between fighting and leaving it is a preference, and the outage default is the same nearest target | code default |

## resources

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `resource_source` | choice | medium | source | none | code default |
| `opportunistic_ore` | choice | low | mining | none | the caller's own handling |
| `opportunistic_animal` | choice | low | pickup | none | the caller's own handling |

## build

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `house_build_step` | choice | medium | build | none | code default |
| `build_mode` | choice | high | request | 0.65: an unsure edit is built fresh beside the structure instead, which destroys nothing | the caller's own handling |
| `build_target` | choice | high | request | 0.65: an edit of an unsure target is built fresh beside it instead | the caller's own handling |
| `build_placement` | choice | medium | request | none | the caller's own handling |
| `template_style` | choice | medium | design | none | the caller's own handling |
| `template_floors` | choice | low | design | none | the caller's own handling |
| `template_size` | choice | low | design | none | the caller's own handling |
| `template_shelf_part` | choice | medium | design | none | the caller's own handling |
| `template_material` | choice | low | design | none | the caller's own handling |
| `schematic_design` | choice | medium | design | none | the caller's own handling |
| `design_fits` | noul | high | design | 0.5: a design that does not answer the request is sent back to the designer with the reason, up to four times | the caller's own handling |

## idle

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `idle_work` | choice | medium | idle | none | code default |
| `stillness_detour` | choice | low | idle | none | code default |

## recovery

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `recovery_action` | choice | medium | recovery | 0.6: unsure, or none, the generative adviser is asked when configured; otherwise nothing is done from the advice | the caller's own handling |

## endgame

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `dragon_fight` | choice | high | end | 0.2: unsure, the fixed order decides: out of danger, crystals, head, arrow, position | code default |
| `stronghold_waypoint` | choice | medium | stronghold | none | code default |

## travel

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `boat_crossing` | choice | low | travel | none | the caller's own handling |
| `discovery_target` | choice | medium | discovery | none | the caller's own handling |

## intake

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `intake_objective` | choice | high | request | 0.65: unsure, the bot asks which of the two likeliest outcomes was meant; the bar is 0.65 for the costly kinds and 0.5 for the rest, and none for other, status, stop, resume and dream | the caller's own handling |
| `intake_interaction` | choice | high | request | 0.65: for a costly kind, unsure whether it was an instruction or talk, the bot asks "now, or were we just talking?" | the caller's own handling |
| `intake_addressed` | noul | medium | request | 0.5: a message not clearly for this bot is left to the players it was for | the caller's own handling |
| `intake_memory_statement` | noul | medium | request | 0.75: a discussion is saved as a memory only when Jev is sure it is a personal statement for Jev | the caller's own handling |
| `intake_urgency` | score | low | request | none | the caller's own handling |
| `intake_item` | choice | medium | request | 0.6: unsure of the pick among the word-overlap candidates, the full catalog walk decides instead | the caller's own handling |
| `intake_quantity` | choice | medium | request | none | the caller's own handling |
| `intake_outputs` | choice | medium | request | none | the caller's own handling |
| `intake_delivery` | choice | low | request | none | the caller's own handling |
| `intake_target` | choice | low | request | none | the caller's own handling |
| `intake_material` | choice | medium | request | none | the caller's own handling |
| `intake_wood_choice` | choice | low | request | 0.7: a wood species is learned as a preference only when the message clearly chose it | the caller's own handling |
| `noted_wood` | choice | low | preferences | 0.7: an old wood preference is replaced by a note only when the note clearly states one | the caller's own handling |
| `discovery_category` | choice | low | discovery | none | the caller's own handling |

## item

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `catalog_branch` | choice | medium | catalog | 0.5: unsure at a leaf, the bot asks "did you mean A or B?" when a runner-up holds 0.25, and always below 0.35 | the caller's own handling |
| `bundle_candidate` | noul | medium | bundle | 0.65: a catalog branch is followed only when Jev is sure it holds a requested output | the caller's own handling |
| `bundle_covered` | noul | medium | bundle | 0.65: unsure the list is whole, the bot asks the player to name the items rather than drop one | the caller's own handling |
| `bundle_quantity` | choice | medium | bundle | none | the caller's own handling |
| `bundle_recipient` | choice | low | bundle | none | the caller's own handling |

## memory

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `memory_operation` | choice | medium | memory | 0.75: forgetting cannot be undone: an unsure "forget" is a question back ("say exactly what") | the caller's own handling |
| `memory_entry` | choice | high | memory | 0.75: forget below 0.75 asks which memory; repeating a costly past request below 0.65 asks the player to ask directly | the caller's own handling |
| `memory_place_name` | choice | low | memory | none | the caller's own handling |
| `memory_place_location` | choice | medium | memory | none | the caller's own handling |
| `memory_place_dimension` | choice | low | memory | none | the caller's own handling |
| `memory_note_replaces` | choice | medium | memory | none | the caller's own handling |

## dream

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `dream_operation` | choice | high | dream | 0.75: clearing the dream below 0.75 and setting one below 0.65 are confirmed in words first; the rest are reversible | the caller's own handling |
| `village_progress` | score | low | dream | none | the caller's own handling |
| `village_part` | choice | medium | dream | none | the caller's own handling |

## command

| Question | Primitive | Stakes | Ledger kind | Bar | When unreachable |
| --- | --- | --- | --- | --- | --- |
| `command_node` | choice | high | command | 0.5: unsure of a step, the bot asks for the command again with more detail rather than guess | the caller's own handling |
| `command_argument` | choice | high | command | 0.5: unsure of a step, the bot asks for the command again with more detail rather than guess | the caller's own handling |
| `command_subject` | choice | high | command | 0.5: unsure of a step, the bot asks for the command again with more detail rather than guess | the caller's own handling |
| `command_destination` | choice | high | command | 0.5: unsure of a step, the bot asks for the command again with more detail rather than guess | the caller's own handling |
| `command_faithful` | noul | high | command | 0.75: a built command is run only when Jev is sure it is the one asked for | the caller's own handling |
