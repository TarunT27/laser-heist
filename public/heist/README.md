# Laser Heist runtime assets

Everything in this folder is loaded by the game. Coordinates are game space: `x` right, `y` up, `z` depth; floors sit at `y = 0`.

| File | What it is | Built by |
| --- | --- | --- |
| `crew.glb` | The skinned crew operative with Idle, Walk, Run, Crouch, CrouchIdle and Interact clips (see `crew_README.md`) | `tools/build_operative.py` |
| `hd-world-0.glb`, `hd-world-1.glb`, `hd-world-2.glb` | The museum, bank and Sky Vault, placed from the game's map data. `Wall_*` nodes fade when they hide the player; `Gate_<id>` nodes are door leaves | `tools/build_heist_hd.py` |
| `getaway-city.glb` | The getaway city and the getaway house (`GarageDoor` rolls up on arrival). Draco-compressed; the decoder is in `/draco/` | `tools/build_getaway_city.py` |
| `helicopter.glb` | The Sky Vault extraction helicopter | `tools/build_helicopter.py` |
| `portraits/` | Role portraits for the online crew-select screen | `tools/build_crew_portraits.py` |
| `favicon.svg`, `og.jpg` | Browser icon and link-preview image | — |

Editable `.blend` sources and preview renders live in `art/`. Retired models from earlier prototypes (the first museum, thief and fixed-layout worlds) were moved to `art/legacy/`; the game no longer loads them.

The crew is based on Quaternius's CC0 Universal Base Characters and Universal Animation Library; the license files sit beside this README. Everything else here was authored for this project.
