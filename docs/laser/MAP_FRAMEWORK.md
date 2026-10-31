# Laser Heist: three distinct heists for 1–4 players

Design proposal · October 29, 2026 · Gameplay described below is proposed, unless explicitly identified as existing.

## Direction

Keep the existing museum, bank, and sky-vault identities, but replace their shared puzzle and objective placement with three different spatial and mechanical experiences:

1. **Museum After Hours:** learn the building, split around a gallery, steal a fragile exhibit, escape through a changed route.
2. **The Gilded Exchange:** open two bank wings, break into a central vault, move a heavy loot cart through a freight route.
3. **The Sky Vault:** prepare an exposed route between rooftop structures, isolate a secure core, bring it across to a helicopter landing pad during lockdown.

The recurring fantasy is planning a job together, separating to make progress, regrouping for the theft, and getting everyone out. Each map has a different topology, signature obstacle, loot transport problem, and escape event. A darker material palette or extra laser alone does not make a new map.

## Cooperation without crew-size locks

**Require the work, not a particular class or number of bodies.** All characters can hack, crouch through service routes, operate machinery, carry loot, and start extraction. Their specialties improve speed, safety, information, or transport.

Separate three ideas:

- **Role:** a player's specialty and visible equipment.
- **Job:** a current responsibility such as opening a shutter or preparing extraction. Players can take any job.
- **Route:** how the crew chooses to solve a physical obstacle.

Four roles should create four useful contributions, but the game must never check for four specific role identities to unlock a door. Allow duplicate roles. A team can deliberately play without a Hacker and accept slower manual overrides.

### The common fallback: a physical switch clamp

Every operative carries one reusable clamp. Mark compatible sustained switches with a clamp icon. Holding a switch works immediately; installing a clamp takes an initial target of six uninterrupted seconds, after which it holds that switch until the paired objective completes. It then releases automatically and becomes available again. Installation progress survives neither walking away nor cancellation; installed equipment persists through ordinary detections.

Clamps work in multiplayer too. Teamwork saves setup time and lets players respond to security while their partner moves. There is no invisible rule that detects solo mode and deletes the puzzle.

Rules that prevent traps:

- No required sequence needs more than one unattended sustained switch. If two distant prerequisites are needed, each completion latches permanently.
- No clamp requires the same player to return through a closed door to retrieve it.
- Completing a service objective opens a normal return door. Loot never needs to fit through a crawlspace.
- Required gates remain open once their paired transport or override completes.
- All manual interactions work for every role. A specialty provides an advantage, never exclusive permission.
- No forced voice-chat puzzle. Signals, pending jobs, and security windows are visible through shared markers and pings.
- Clamp setup uses the existing interaction input; avoid adding a separate tool-selection screen.

### Crew-size experience

| Crew | How the same heist plays |
| --- | --- |
| 1 | Scout the route, latch prerequisites, clamp the one sustained switch, perform the interior task, move loot in safe stages, extract alone. No AI required. |
| 2 | One works security and route controls; one works access and transport. Swap responsibilities at safe rooms so one player is not permanently stationed at a terminal. |
| 3 | Split access, security, and transport/preparation. The third player can prepare the next segment while two solve the current obstacle. |
| 4 | Assign each specialty an active job. Run preparations in parallel, then move through the dangerous theft and escape segment together. |

The main objective and map stay the same for every crew size. Use a longer starting time for smaller crews to account for serial travel and setup. Set that allowance from measured clean route times; do not divide the four-player deadline by player count. Initial session targets: museum 6–8 minutes, bank 8–10, sky vault 8–12. These are prototype targets, not validated balance.

Offer optional side loot, security shutdowns, and escape preparations for spare capacity. These should be worthwhile, but never be the only reason a third or fourth player has something to do.

## The crew and existing assets

### What is actually available

The runtime currently loads one shared operative, `public/heist/crew.glb`, and clones it for players. It has six clips: Idle, Walk, Run, Crouch, CrouchIdle, and Interact. The shared base supports per-player Accent and Skin materials. Four selectable roles already exist, but they do not have four separate character models or separate equipment abilities.

The operative has a mask, jacket, harness, backpack, gloves, cargo trousers, and shoes. Reuse that rig and animation set. Create role silhouettes by adding equipment to the common skeleton, rather than producing four unrelated bodies.

Other local model assets inspected: three current world GLBs, the helicopter, the older museum scene, and the older thief with Idle/Walk clips. The current renderer loads `world-0.glb`, `world-1.glb`, `world-2.glb`, `crew.glb`, and the helicopter. The older thief and museum are reference/reuse material, not additional active crew members. Local Quaternius base, rigged-base, and gait files support the operative production pipeline; they are not a ready-made cast of playable roles.

### Role proposal

| Role | Existing advantage | Proposed identity and useful actions | Equipment addition |
| --- | --- | --- | --- |
| Hacker | Entrance hack runs at twice the base rate | Access specialist; faster manual overrides, temporarily divert one security sector, open the next route while teammates transport loot | Forearm terminal and compact antenna |
| Infiltrator | Inner override runs at twice the base rate | Service-route specialist; reach internal controls quickly, create return shortcuts, lead the team through timed hazards | Slim tool belt and small headlamp |
| Carrier | Loot movement is 3.2 versus 2.6 units/second for other roles | Transport specialist; move loot efficiently, reposition freight equipment, deploy a portable cover panel at marked sockets | Larger pack, folded cover panel, reinforced harness |
| Lookout | Camera suppression lasts 25 seconds versus 15 | Security specialist; mark scan timing and safe lanes for everyone, maintain camera suppression, prepare extraction signals | Shoulder scanner and compact binocular unit |

New tools and active abilities in this table are proposals. Keep the first implementation bounded: preserve the existing bonuses, introduce map jobs and the universal clamp, then add specialist abilities only if playtests show a need.

Keep team identity separate from role identity: team color can remain freely assigned, while equipment shape and a small role icon communicate specialty. Do not tie a job to skin tone, gender, or player color. Add attachment points and equipment visibility before expanding the animation library. Cart pushing, physical bracing, or handoffs will need animation work; the existing Interact clip is sufficient only for a rough prototype.

Every role should have something useful before the vault opens, during the theft, and during escape. End-of-run feedback can show doors opened, safe windows created, routes prepared, and loot delivered without assigning competitive worth to one type of contribution.

## Map 1: Museum After Hours

**Identity:** quiet, readable stealth around a central sculpture hall. Ivory stone, warm lights, glass partitions, and distinctive exhibits create landmarks.

**Layout:** a ring around the central gallery, with a security wing on the west, a conservation/service wing on the east, a delivery entrance to the south, and a loading courtyard to the north. The wings reconnect through the gallery. Place doors and controls to make this loop real; avoid a single hallway with decorative side rooms.

**End-to-end route**

1. **Delivery entrance:** read a short visual briefing, open the staff door, and see the central exhibit through glass. The target and exit are understandable before entering the hazard area.
2. **Prepare two wings:** use the west security desk to learn the camera cycle. Operate an east service release so someone can crawl to the conservation control. The infiltrating player opens a full-size return door from inside.
3. **Open the exhibit:** the conservation control latches the case interlock off. A player at security can provide a clean crossing window; without suppression, the scan pattern remains physically avoidable. Cross two clearly telegraphed laser lanes to the display.
4. **Take the artifact:** any player secures the display in a protective case. The carrier bonus makes transport easier. Picking it up starts local lockdown and closes the original staff entrance.
5. **Escape through the loop:** the conservation override has already unlocked the north loading door. Return through a different side of the ring, cross the courtyard scan, gather at the loading zone, and extract.

**Four-player jobs:** Hacker handles access and gallery security; Infiltrator opens conservation and the north return route; Carrier stages the protective case, transports the artifact, and opens cover at the courtyard; Lookout reads camera timing, marks crossings, and prepares the loading signal. Staging and cover are new map interactions, not present assets.

**Two-player solution:** one operates the release while the other opens conservation. The first moves to security while the second approaches the exhibit. Regroup for the theft and escape. Any pair of roles can do this.

**Solo solution:** open the staff door, clamp the east release, crawl to conservation, and complete the override. The return door and north exit remain unlocked, and the clamp releases. Use the security desk or watch the visible scan cycle, collect the case, and leave through the north route. No second person is needed at the exhibit.

**Signature moment:** see a teammate on the other side of the glass shut down the scan just before crossing with the artifact.

**Recovery:** detection costs time/take and wakes an additional clearly signaled scan cycle; it does not reset the conservation override or seal the player in the wing. Optional side exhibit loot encourages exploring the ring.

## Map 2: The Gilded Exchange

**Identity:** a bank heist built around physical transport. Brass counters and teller booths give way to a heavy central vault and an industrial freight corridor.

**Layout:** an interlocking pair of loops. The public banking hall connects to west security offices and east records/service rooms; both lead to the central vault antechamber. The vault's rear door opens into a separate freight corridor and loading garage. The cart route is wide, continuous, and has parking bays between gates.

**End-to-end route**

1. **Enter the banking hall:** override a staff access panel. From here, the crew can see the two authorization wings and the vault destination.
2. **Collect two authorizations:** security and records each have a local obstacle and a latching authorization. Finish either wing first, or split the crew. No simultaneous authorization holds are required.
3. **Open the vault:** both authorizations power the antechamber. Hold the pressure stabilizer while a teammate completes the internal vault release. A clamp provides the unattended alternative. Opening the vault also opens its full-size freight door and releases the clamp.
4. **Load the cart:** secure the required gold crate on a braked cart. It moves only while a player controls it; releasing the interaction stops it safely. Anyone can move it, with Carrier receiving a modest handling advantage. Optional extra crates increase the take and handling burden, never the minimum crew size.
5. **Move the score:** navigate two freight segments. Each gate has an accessible control on the approach side and a clamp socket if it requires a hold. Once the cart crosses, the gate latches open. Security can be suppressed from local panels or avoided by parking behind cover during scans.
6. **Garage extraction:** park the cart in the van zone, gather the crew, and confirm extraction. Cart delivery is the required cargo condition; no player has to carry every crate individually to trigger the win.

**Four-player jobs:** Hacker opens authorizations and diverts freight security; Infiltrator takes the records service loop and opens the rear route; Carrier handles the cart and loading decisions; Lookout operates the next gate, spots scans, and signals safe cart movement. After authorizations, the Hacker joins the moving convoy instead of remaining at the first terminal.

**Two-player solution:** split the authorization wings, regroup at the vault, then alternate cart driving and opening the next freight segment. Security panels are local so the second player can keep moving with the driver.

**Solo solution:** complete both authorization wings in sequence. Clamp the vault stabilizer, open the release, load one crate, then use the parking bays to stop the cart while operating each gate. Clamp one gate at a time when necessary. All controls needed to progress are reachable without passing the closed gate first.

**Signature moment:** the cart rounds a teller-hall corner as a teammate opens the freight shutter and another diverts the scanner.

**Recovery:** detection locks the next segment briefly with an obvious local reset; the cart stays braked in its current safe position. Installed clamps and completed authorizations survive. No pit, jump, narrow vent, or one-way drop can swallow the cart.

## Map 3: The Sky Vault

**Identity:** exposed movement, route preparation, and a dramatic return trip. Dark glass, cyan edge lights, open skyline, and moving searchlights distinguish it from the enclosed maps.

**Layout:** a triangle connecting an arrival roof, a secure vault roof, and a helipad. A direct maintenance bridge connects arrival to the vault. A longer perimeter catwalk links the vault to the helipad. A service return link joins the helipad to arrival. Prepare the perimeter route before taking the core; lockdown closes the direct bridge, but never the prepared escape catwalk.

For the first version, all playable surfaces remain on one elevation. Height comes from surrounding buildings and the skyline. Real climbing, elevators, jumping, falling physics, and multi-floor navigation are a separate expansion.

**End-to-end route**

1. **Arrive at the maintenance roof:** learn the searchlight rhythm, open the first bridge shutter, and see the helipad across the gap.
2. **Prepare the escape:** operate the helipad service relay and deploy the perimeter catwalk's protective screens. The relay latches. This step is mandatory before the core can be removed and may be completed in parallel with vault access.
3. **Isolate the core:** at the vault roof, hold a cooling bypass while a teammate uses the service path to reach the internal isolator. A clamp supports solo play. Completing isolation opens the return door and releases the clamp.
4. **Commit to the theft:** a clear prompt explains that removing the core closes the direct bridge and starts the escape clock. Any player can take the core. The prepared route is visibly lit before confirmation.
5. **Cross the perimeter catwalk:** move between sheltered alcoves while searchlights sweep the exposed spans. Teammates can operate local suppression panels to create longer windows. Without suppression, a safe crossing still exists for a solo player carrying the core at the slowest baseline transport speed.
6. **Helipad extraction:** the prearmed relay has already called the helicopter. Bring the core and every connected player into the pad, hold interact, and leave. Nobody must remain behind at a remote control.

**Four-player jobs:** Hacker handles shutters and local scanner diversions; Infiltrator reaches the internal isolator and opens return access; Carrier transports the core and positions cover at marked catwalk sockets; Lookout prepares the helipad relay and marks the next safe crossing. Every task ends with a route to the helipad.

**Two-player solution:** one prepares extraction while the other opens vault access. Regroup to isolate the core, then cross in short stages: one transports, one creates safe windows. Both reach the pad.

**Solo solution:** prepare the helipad and screens first, return over the service link, clamp cooling, complete isolation, collect the core, and move between alcoves when the visible searchlight has passed. Extraction is already armed. The escape deadline must include this unsupported crossing time plus a recovery margin.

**Signature moment:** the direct bridge shutters close behind the crew, the perimeter route lights up, and the helicopter approaches while everyone moves the core across the skyline.

**Recovery:** ordinary detection costs time/take and briefly intensifies scanning. It does not remove mandatory cover or destroy the only route. A collision railing prevents falling; danger comes from exposure and timing. Optional rooftop cache loot is a pre-theft detour, not a reason to abandon a teammate during the escape.

## Failure, extraction, and disconnects

- Explore without a countdown in a separate preview/practice option. In normal contracts, show the deadline from the start; the museum and sky thefts switch to a clearly announced escape phase.
- Alarm penalties remain recoverable. Timeout is the primary failure state for the first version; avoid adding combat or character death to this design pass.
- Finish persistent prerequisites once. Detection must not force a player to repeat long setup sequences.
- Keep the existing leave-together rule for connected crew members. A solo player counts as the entire crew.
- On disconnect, stop that player's input, drop carried loot at the nearest reachable safe position, and release player-held controls. Preserve installed clamps and completed objectives. Surviving players can install a clamp and continue. The server freezes interactions/deadlines for a short, bounded recovery interval, then recomputes the remaining route allowance once; no repeated timer grants for reconnect cycling.
- Assign idle jobs by progress, not by rigid class scripts. Practice bots, if enabled separately, must use the same controls, paths, and fallback equipment as humans. True solo remains distinct from AI-assisted practice.
- Payouts remain shared according to the agreed cuts. Do not reward only the person touching the loot.

## Implementation framework

Keep the existing TypeScript/Three.js client and authoritative server. The design does not require an engine migration.

### Shared contract definition

Replace the fixed terminal/switch/override/diamond sequence with a small objective graph per map. Define named rooms, connections, colliders, interactables, prerequisite IDs, persistent completions, paired hold/clamp relationships, hazard sectors, loot transport type, and extraction conditions. Represent escape route changes as explicit gate states; do not hide rules in the scenery.

The museum graph branches into security assistance and conservation access, then rejoins at the exhibit. Bank authorization branches are both required and latch independently before the vault. Sky escape preparation and core isolation are both required before the theft transition. The current four mission-stage labels can remain as presentation groups, but must not be the only representation of objective progress.

The server owns objective state, clamp installation, timers, security windows, loot, cart position/occupancy, and extraction. The renderer visualizes that state. Geometry, pathfinding, the tactical floor plan, prompts, and practice bots all consume the same map definition.

### HUD and controls

Keep move, crouch, sprint, interact, and tactical map as the baseline controls. Add a simple ping usable on desktop and touch. Show the current shared objective, who is handling the active jobs, a nearby interaction prompt, and a visible held/latched/clamped state. Let players claim or swap a job without changing their character role. Collapse secondary planning information during play.

Role messages should adapt to crew size and state: “Clamp the release, then use the service passage” is a complete solo instruction. “Ask your teammate” cannot be the only prompt. Mark the route that becomes the escape path before asking players to commit to the theft.

### Asset work

Reuse the operative, six clips, helicopter, material language, and useful architectural pieces. Rebuild each environment around its actual topology; existing world files are material and prop starting points. New shared assets: clamp with status light, readable gate controls, role attachments, cargo case, cart with brakes, gold crate, power core, protective screens, and extraction markers. The bank also needs a van/loading-zone asset. Add cart movement animation after the functional prototype establishes its handling.

### Build order

1. Prototype the shared objective graph and switch clamp in simple geometry. Enable one-player start, one-player extraction, and survivor continuation consistently across shared rules, server, lobby, prompts, and practice logic. Lowering the minimum-player constant alone is insufficient.
2. Build the complete museum route with existing assets and functional placeholder props. Verify it with one player of each role and two players of the same role before polishing.
3. Add the bank authorizations and cart. Validate parking, gate approaches, brakes, and each turn before adding optional loot.
4. Add the sky route preparation and theft-triggered gate transition. Verify the longest unsupported crossing with the slowest eligible carrier.
5. Add role equipment, stronger specialist abilities where needed, environmental detail, sound cues, and onboarding. Balance deadlines from observed runs.

### Acceptance checks

- Each map is completable by exactly one human with no AI, using each of the four roles.
- All ten unordered two-role combinations, including duplicates, have a legal end-to-end route. Verify mechanically through the shared simulation where possible, then playtest representative routes.
- Three- and four-player crews can distribute jobs meaningfully. During playtests, investigate periods over 15 seconds when a player has no understandable useful action; do not fix this by forcing arbitrary extra buttons.
- Every required held interaction has a documented clamp route or an accessible persistent alternative. Required unlatched simultaneous input count never exceeds two.
- No preparation, theft transition, detection, cargo placement, or disconnect can strand a surviving player behind a required gate.
- The cart, core, and case each have a reachable recovery position if their controller disconnects.
- Camera behavior, visual clearance, tactical navigation, desktop input, and touch controls support the actual new geometry.
- Two real network clients observe consistent gates, hazards, clamp states, transport, and extraction. Preview practice alone is not multiplayer validation.
- A fresh player can explain each map's signature obstacle and escape plan after one briefing.

## Recommended next step

Implement Museum After Hours as the first complete playable example of this framework. Its ring layout proves meaningful splitting, a visible solo fallback, a permanent return route, and a changed escape without first requiring cart physics or vertical movement. Use that evidence to refine the bank and sky maps before building their final environments.
