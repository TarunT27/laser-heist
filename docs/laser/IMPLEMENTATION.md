# Three-map implementation and local verification

Updated October 30, 2026. This is a local playable prototype, not a public deployment.

## Launch

From the project folder:

```sh
npm install
npm run check
PORT=3011 npm start
```

Open http://localhost:3011/laser/. `npm start` serves the production build; run `npm run build` after client edits. Use **Play solo** for a timed run with exactly one human and no bots, or **Explore without a deadline** to learn the route. Create a private room for one to four online humans; all connected players ready up before the host starts. Duplicate roles are supported. Other devices need a reachable host address; localhost only reaches the machine running the server. Public hosting needs a persistent Node process and WebSocket support.

WASD/arrows move relative to the camera; right-drag looks; C crouches; Shift sprints; E interacts; M opens the tactical map; P pings. Touch has movement, crouch, interaction and ping buttons plus scene dragging. The map supports click-to-walk and a next-job selector. Desktop Escape opens the pause menu; local solo pauses, multiplayer continues.

## Implemented routes

- **Museum:** delivery entrance, west security/case/signal jobs, east clamp-and-crawl conservation access, permanent interlock/return/north-door unlock, artifact theft, delivery lockdown, north loading-court escape. An optional miniature collection adds shared value.
- **Bank:** staff entry, independent security and records authorizations, pressure hold or clamp, interior vault release, full-size freight exit, van preparation, gold cart, two approach-side freight controls, braked parking and persistent crossed gates, van delivery. Optional extra gold increases value and slightly reduces cart speed. The personnel entrance cannot carry the cart; the full-size rear freight route is required.
- **Sky:** maintenance shutter, helipad relay and perimeter screens, cooling hold or clamp, internal isolation, core theft, direct bridge lockdown, exposed perimeter crossings between safe waiting areas, helicopter extraction. All surfaces share one elevation, with collision boundaries at the roof edges. Optional roof cache adds value.

Every role can perform all jobs. Hacker access and Infiltrator internal tasks are faster; Carrier transports faster; Lookout creates longer security windows. Equipment silhouettes and icons identify roles separately from player colors. The operative animations, skinned loot bag, helicopter and physical laser hardware are reused. New architecture is generated from the map definitions rather than loading obsolete fixed-layout worlds.

## Shared rules and recovery

`shared/heist-maps.ts` owns rooms, floors, gates, objectives, dependencies, hazards, cargo types and escape routes. `shared/heist.ts` owns progress, collisions, transport, security, clamps, deadlines and extraction. The network server runs these rules; renderer, tactical plan and navigation consume the same definitions.

A held switch works immediately. Six uninterrupted stationary seconds installs a player's one reusable clamp. Interrupted installation resets; an installed clamp survives alarms and owner disconnection. Paired completion releases it automatically. Completed jobs stay latched. Service interiors allow emergency return to a released switch. An occupied freight gate remains recoverable if its human holder leaves. Crossed freight gates latch open.

Carts only move under a connected controller holding interact, and brake when released. Portable loot stays with its carrier. Disconnects leave cargo at the last reachable position, release held inputs, preserve prerequisites and installed clamps, freeze the run for five seconds, and grant a bounded crew-size recovery allowance once. Extraction needs required cargo within two metres, every connected player within three metres, and an interaction hold. Bank extraction also requires both freight segments crossed. Timeout takes priority over extraction.

## Verification

`npm run check`: TypeScript, test suite and production build. The only build advisory is the existing large Three.js chunk.

- Movement-only route tests: all 12 map/solo-role combinations, all 30 map/two-role combinations (including duplicates), and three-/four-person crews on every map. Routes use movement and interaction inputs, not teleportation or objective mutation.
- Measured solo routes with known destinations: museum approximately 69–70 seconds, bank 120–129 seconds, sky 73–81 seconds. These are automation timings, not fresh-player usability measurements. Starting budgets remain intentionally generous (solo 8/10/12 minutes) for reading, exploration, setup and recovery. Escape allowances exceed the verified unsupported transport routes, with larger allowances for small crews.
- Recovery tests: cargo-controller disconnect and survivor retrieval/completion on all maps; interrupted clamp installation; one installed clamp per player; installed clamp survives its owner; immediate human hold with duplicate roles; closed-gate collision; latched return routes; crew/cargo extraction conditions; timeout priority; no repeated disconnect timer grants.
- `npx tsx tools/verify-heist-network.ts`: two separate real WebSocket clients complete every map as Hacker + Hacker. Inputs travel over sockets; authoritative ticks are accelerated for this test. Both clients receive identical completed-objective/cargo/win states. Recorded runs: 90.75 / 124.96 / 74.49 simulated seconds, no detections.
- Browser evidence and additional observations are in `output/playwright/`. Browser checks exercise the actual UI and rendered scene; automated route tests provide exhaustive role-combination coverage.

## Prototype limits

Geometry, consoles, van, screens and equipment are intentionally simple. The cart has authoritative kinematic handling and brakes; it does not have a dedicated pushing animation. Security uses timed sector windows with physical laser curtains/searchlight visualization rather than combat or NPC guards. Optional gold is an interaction and handling modifier, not a stack of independently simulated crates. No physical-phone, remote-internet latency, public hosting or fresh-player usability study has been completed. Reconnecting clients cannot rejoin an active room; surviving connected crew can finish it.

## Stealth overhaul and Blender environments (October 30, 2026)

**Security.** Each map has patrolling guards and sweeping cameras (`guards` / `cameras` in `shared/heist-maps.ts`). A guard sees in a cone (7.5 m standing, 4.2 m crouched) blocked by walls and closed doors; suspicion fills while you are visible, then they raise an alarm and chase. Getting caught throws you back to the entrance and drops the loot. Sprinting is loud and draws guards over; crouching is silent. F takes down an unaware guard from behind for 25 s. Security consoles black out cameras. The third alarm locks the building down (practice mode never fails). Chest-height laser sectors (`high`) can be crouched under.

**Cover.** `cover` entries are solid furniture. Below 1.5 m they hide a crouched player from guards; taller pieces (the bank van) block sight entirely.

**Movement.** Momentum (acceleration/braking), a stamina-limited sprint, pointer-lock mouse look with an over-the-shoulder camera, and walls that fade instead of pushing the camera in. Solo runs the shared rules at 60 Hz.

**Environments.** `tools/build_heist_hd.py` builds the three locations in Blender from the exact map data, with procedural marble, wood, brass, concrete and facade textures:

```sh
npx tsx tools/export-heist-maps.ts
~/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build_heist_hd.py -- --preview
```

Outputs `public/heist/hd-world-{0,1,2}.glb` (loaded by the renderer), editable `art/hd-world-*.blend`, and `art/hd-preview-*.png`. Re-run both commands after changing walls, gates, objectives or cover, and bump the `?v=` key in `client/heist/render.ts`. Without the GLBs the game falls back to the blockout geometry.

**UI.** The menu, HUD and debrief follow the "Laser Heist GUI Revamp" Claude Design canvas: night-ops palette, Chakra Petch / IBM Plex, alarm pips, stamina and noise meters, guard awareness tags, a detection vignette and graded results (S/A/B/C).

## Heist campaign, busted/bluff, difficulty (October 30, 2026)

**Campaign loop (solo).** Menu → planning board → setups → finale → getaway → payout. Data lives in `shared/heist-campaign.ts`: each heist has a scouting setup (optional: +1:00 and guard routes on the map) and two approaches, each needing its own setup (keycard, uniform, vault codes, bribe, jammers, passes). Setups run on the real maps with live guards (`startSetup` in `shared/heist.ts`); their rewards and the hired hacker become finale modifiers (`finaleMods` → `applyFinaleMods`). Crew cuts come out of the take; progress and account live in `localStorage` (`client/heist/campaign-save.ts`). Clearing a heist unlocks the next and resets its setups. Online rooms keep the lobby flow and play finales without modifiers.

**Getaway.** Van heists end in a night-city police chase. `client/heist/getaway-sim.ts` is pure and tested (arcade physics, grid-routing police that back out of corners and pull up to arrest, wanted stars = 1 + alarms, lose them by staying out of sight, bust when boxed in, wreck at 100% damage); `client/heist/getaway.ts` renders it. The driver you hire sets top speed and grip. A failed getaway can be retried without replaying the finale.

**Busted and bluffing.** A guard whose suspicion circle fills stops you instead of chasing: press Space while the needle is in the green zone to talk your way out silently (no alarm). Each guard falls for it once; missing or freezing is busted (run over). A teammate can still take the guard down mid-confrontation. Online presses carry the confrontation time the client saw, so latency doesn't cost the bluff.

**Difficulty.** Relaxed / Standard / Professional (`DIFFICULTY` in `shared/heist.ts`) scale guard sight, suspicion, hearing, the bluff window, alarms allowed, stun time and the clock. `npx tsx tools/heist-difficulty.ts [--difficulty=…]` measures, for every spawn, job and chokepoint, how often a motionless player gets the time they need unseen; Standard runs Museum → Bank → Sky Vault at roughly 95 / 89 / 83% crouched.

**Getaway polish.** One simple goal: lose the cops (stay out of their sight until the meter fills), then drive to the getaway house at the north edge of the city and stop on the green ring. The HUD says which step you're on ("Break their line of sight" → "Stay hidden — Ns" → distance to the house), the minimap turns with the van and draws a GPS route home, and the house's garage rolls up on arrival. Engine, siren (louder as cruisers close in) and crash sounds; camera shake on impacts, brake lights, headlight beams, smoke when the van is badly damaged; GETAWAY / MADE IT / BUSTED / WRECKED banners; Esc pauses; touch phones get steering and gas/brake buttons.

**Getaway city (Blender).** `tools/build_getaway_city.py` builds the whole getaway city from the getaway's street grid, so every block matches the van's collision: downtown glass towers (curtain walls, lit podium shops, setbacks, aviation beacons), concrete offices, brick walk-ups with fire escapes and water tanks, shop streets with signs, awnings and billboards, three parks, crossings, curbs, streetlights, signals, street trees, boundary barriers, a distant skyline, and the getaway house (its `GarageDoor` node rolls up on arrival). Draco-compressed to ~1.8 MB; the decoder ships in `public/draco/`.

```sh
npx tsx tools/export-getaway-city.ts
~/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build_getaway_city.py -- --preview
```

Re-run both after changing `CITY`, `DROPOFF` or `HOUSE` in `client/heist/getaway-sim.ts`, and bump the `?v=` key in `client/heist/main.ts`. Without the GLB the drive falls back to the generated city.

## Finished game: how to play it and how it's verified (October 30, 2026)

**Play.** `npm install`, `npm run build`, then `PORT=3011 npm start` and open http://localhost:3011/ (`/laser/` also works; Orbit Knockout moved to `/orbit/`). For development, `npx vite --port 5179` and open http://localhost:5179/ (solo only; online rooms need `npm start`).

**The whole loop.** First launch opens the field guide. Menu → heist board (approach, setups, crew) → setup missions → finale → getaway (van heists) or helicopter (Sky Vault) → payout → next heist unlocks. Clearing the third heist for the first time shows the campaign ending (epilogue, totals, best share per heist, credits); every heist stays replayable. Failures never cost progress: a lost setup or finale offers a retry with setups kept, and a busted or wrecked getaway restarts the drive. Settings (top bar): sound, mouse sensitivity, and a two-click erase of all progress. Esc pauses everywhere, including mid-drive.

**Winnability is tested, not assumed.** Bots play with guards, cameras, lasers and police on, using only real inputs:

- `npx tsx tools/heist-playthrough.ts --difficulty=…` plays every finale with all four roles; `--setups` plays all nine setups. Current results: finales Relaxed 12/12, Standard 7–8/12, Professional 4/12; setups Relaxed 9/9, Standard 8/9 (every required setup).
- `npx tsx tools/getaway-playthrough.ts` drives every driver at 1–4 stars: lose the police, reach the getaway house.
- `server/tests/playthrough.test.ts` keeps the guarantees in `npm test`: every finale and setup on Relaxed, the museum and bank finales and every required setup on Standard, and the getaway at 1 and 3 stars.

The bots found and fixed several unfair spots: a records guard and a corridor guard that blocked the only routes, a helipad guard circling the extraction, a camera staring at a setup target, a getaway that started with a cruiser on your bumper, reinforcements spawning in plain sight, and crash damage that wrecked the van in three hits. Guards can now be bluffed twice each (the second window ~45% narrower) before a third sighting busts you.
