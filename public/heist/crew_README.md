# Laser Heist operative

The current runtime model is a skinned humanoid based on Quaternius's CC0 Universal Base Characters. Locomotion and interaction clips are retargeted from the CC0 Universal Animation Library. Custom charcoal clothing, fitted mask, technical backpack, gloves, boots, pockets, harness and team accents were authored in Blender for Laser Heist.

## Rebuild

1. `python3 tools/prepare_crew_animation.py`
2. `blender -b --python tools/build_operative.py`
3. `npm run validate:assets`
4. `npm run build`

Editable source: `art/crew.blend`. Source downloads, original licenses and SHA-256 receipt: `art/vendor/quaternius/`. The earlier `build_crew_assets.py` generates the superseded prototype and is not part of this pipeline.

The footwear is a custom curved shoe mesh with a rounded toe, shaped instep, tapered heel, thin layered sole, crossed laces and an ankle collar. Upper vertices blend between foot and calf weights so the collar follows the leg during crouching. The old beveled-box boots are removed. Studio comparison images and the shoe close-up are in `docs/laser/qa/`.

## Runtime contract

- About 1.8 metres tall, metre units, soles near y=0, y up and +z forward.
- Shared humanoid skeleton with articulated hands and original skin weights.
- Six clips: Idle, Walk, Run, Crouch, CrouchIdle, Interact.
- In-place root; scene movement remains authoritative in the game simulation.
- `Skin` and `Accent` support per-player material colors.
- All models ship locally; no external runtime model fetch or asset service is required.
- Validation samples actual skinned vertices and limb rotations, checks finite attributes, motion range, named clips, and crouch height. Results are in `docs/laser/qa/character-validation.json`.

## Credit and license

[Quaternius Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) and [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html), CC0 1.0 Universal. Retained mirror source URLs and byte hashes are recorded in the receipt. No paid pack or restricted source version is included.
