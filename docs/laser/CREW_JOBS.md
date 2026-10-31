# Crew jobs: one route anyone can finish, one job per role

October 31, 2026. Implemented; extends `MAP_FRAMEWORK.md`.

## The rule

- **Every map is finishable by one player of any role.** The required route (entry, prerequisites, the one clamped switch, the theft, extraction) never checks who you are. Specialties only make some of it faster. Solo, pair and 3–4 player routes are proven for every role combination in `server/tests/heist-navigation.test.ts`.
- **Every role has a job of its own on every map.** Each map has four optional crew jobs, one per role. Only that role can do it. Each gives the whole crew a perk that lasts the rest of the run. Solo you get your own; a full crew gets all four. No map needs any of them.

## The four jobs

The job and perk stay the same on every map, so players learn them once. Only the place changes, and the four places are spread out, so a full crew fans out at the start and regroups for the theft.

| Role | Job | Perk for the whole crew |
| --- | --- | --- |
| Hacker | Loop the camera feeds | Every camera stays dark for the rest of the run. |
| Infiltrator | Cut the laser relay / freight scanners / searchlight power | The map's worst hazards (gallery lasers, the cart's freight scans, the perimeter searchlights) shut down for good. |
| Carrier | Stage the escape gear | +30 s on the clock (including the escape clock), and anyone carrying the score moves at Carrier speed. On the bank, the extra crate stops slowing the cart. |
| Lookout | Tap the guard radio | Guards are 35% slower to notice anyone, bluff windows are 35% wider, and every patrol route shows on the map. |

| Map | Hacker | Infiltrator | Carrier | Lookout |
| --- | --- | --- | --- | --- |
| Museum | Deliveries, west | Conservation wing (behind the crawl) | Deliveries, east | Security wing |
| Bank | Banking hall, west | Records room | Van garage | Security offices |
| Sky vault | Arrival roof | Vault roof strip | Helipad | Maintenance bridge |

With all four jobs done, the scripted route test finishes the museum in 89 s instead of 107 s and the bank in 125 s instead of 129 s (`heist-crew-jobs.test.ts`).

## How players see it

- **Menu:** each role card shows its job on the selected contract.
- **Lobby:** a "Crew jobs on this map" list shows each job, what it does, and who covers it ("No Carrier" when nobody does).
- **HUD:** a "Crew jobs · optional" block lists the jobs your crew can do, yours first and marked YOUR JOB, ticked off with whoever did it.
- **World:** your own job's marker shows from across the map; a teammate's only up close. Jobs for roles not on the crew are hidden, and their console light stays grey.
- **Prompts:** standing at another role's job says whose it is. Information prompts such as "Needs: …" now show even without an E key.
- **Tactical map:** jobs are diamonds; cut sectors turn dark; a tapped radio draws patrol routes.
- **Debrief:** lists the crew jobs done and by whom.

## Code

- `shared/heist-maps.ts`: `job(...)` objectives (`kind: 'assist'`, `role`, `perk`, cut `sectors`).
- `shared/heist.ts`: `crewJobs`, `crewPerk`, `CREW_PERKS`, `ROLE_NAMES`, `state.credits`; role gating in `updateInteractions`; perks in `tuning`, `sectorTiming`, `movePlayer`, `updateCamera`.

## Bank vault door

The freight door is now a round vault door built in `tools/build_heist_hd.py` (`vault_door`). It has a stepped steel portal with a brass Deco surround, a polished front slab over two stepped plugs, 20+ locking bolts, a capstan wheel, two dials, a brass sunburst, strap hinges, and the bolt linkage, gear and time locks on the vault side. The door leaf is exported with its origin on the hinge and a `swing` glTF extra. The renderer swings it 180° into the freight corridor when the vault is released instead of hiding it. The rules match the art: two portal piers keep the walkable opening to the round portal's 3 m floor width, and the open door's resting place is solid (`Gate.swing`).

Rebuild: `npx tsx tools/export-heist-maps.ts`, then `~/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build_heist_hd.py`.

## Crew select (online room)

An online room opens on the "Your Crew" screen (`client/heist/crew-select.ts`, styles under "Crew select" in `client/heist/style.css`), a light layout taken from the Claude Design canvas "Laser Heist Crew Select". On it:

- **Left:** the four roles with portraits and who is on each. Click one to take that role; duplicates are allowed. Below that: Invite crew and the contract facts.
- **Centre:** the selected operative.
- **Right:**
  - the role's headline number, with stat bars built from `ROLE_BONUSES`/`HEIST_CONSTANTS`;
  - perk tiles with the crew job last;
  - the profit split (the host edits it in a dialog);
  - the Ready button, which stays in view and becomes START HEIST for the host once the whole crew is ready.
- **Host only:** picks the contract and difficulty in the header.
- **Phones:** the screen stacks into one scrolling column.

Portraits come from the game's operative model: `~/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build_crew_portraits.py` writes `public/heist/portraits/{hero,thumb}-<role>.webp`.
