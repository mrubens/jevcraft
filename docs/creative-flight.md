# Creative flight

Jev automatically uses flight for travel, following players, and reaching building
faces when the server has put him in Creative mode and granted flight. Existing
requests such as `Jev come here`, `Jev follow me`, and custom builds use this
capability. It never changes the game mode on its own.

Routes check the whole player's body against loaded block collision shapes,
including ceilings and corners. Flights use ordinary client movement packets,
recheck obstacles during movement, and replan when a followed player moves.
Creative construction does not need access scaffolding. Say `Jev stop` to hover
in place. Switching back to Survival or losing flight permission restores normal
gravity and walking.

Search is bounded to observed terrain within 96 blocks of the current position.
It does not fly through unloaded terrain or walls. This is Creative flight;
Survival Elytra flight is not implemented.

## Validation

`node --test test/flight.test.js` checks obstacle clearance, moving targets,
construction reach, cancellation, changes to terrain, and permission revocation.

`MC_PORT=<isolated-port> node scripts/flight-test.js` starts two test clients and
prints an artifact directory. Apply that directory's `setup.json` commands to
the isolated server console, then create its `ready` file. The script refuses
the player-world ports 25565 and 25577. Setup grants Creative mode and operator
permission to the witness for controlled scene changes; the builder has no
operator permission.

Controlled run `flight-mu8kae4d` passed on Minecraft 26.1: the witness observed
wall traversal, following an airborne moving player, cancellation to a hover,
return to Survival walking, and a complete 600-block tower with zero scaffold
placements. The witness independently checked the final blocks and open spaces.
This is a Creative mechanics test, not fresh Survival acceptance.
