# Laser Heist — After Hours

A browser-native cooperative heist with third-person cameras, an authored human crew, and three contracts. Inspired by the selected ivory/glass/brass concept and the real 3D construction approach in TarunT27/roma-eternal-city.

## Contract loop

Choose a contract and crew role. Agree on integer percentage cuts adding to 100. Everyone readies up. Hack the foyer terminal, coordinate a held release switch and crouched service-vent route, override the vault, collect the diamond, and bring the entire crew to extraction. Detection costs 12 seconds and 5% of the current take, bounded at half the initial value. The server owns positions, interactions, hazards, readiness, and payouts.

Contracts: Museum After Hours; The Gilded Exchange; The Sky Vault. Different authored environments, partition layouts, laser counts/speeds, deadlines, and rewards. Next-contract progression preserves room campaign earnings.

Roles: Hacker opens the terminal faster; Infiltrator overrides faster; Carrier moves faster with loot; Lookout disables cameras longer. Every role can perform every interaction, so two-person crews remain viable.

## Asset pipeline

- `tools/prepare_crew_animation.py` + `tools/build_operative.py` -> `art/crew.blend` and `public/heist/crew.glb`: licensed Quaternius humanoid base and authored animation clips, adapted with custom heist clothing. Idle, Walk, Run, Crouch, CrouchIdle, Interact. See `public/heist/crew_README.md` for attribution and the reproducible pipeline.
- `tools/build_heist_worlds.py` -> three editable world `.blend` files and optimized material-batched runtime GLBs.
- Original local helicopter asset reused for extraction atmosphere.
- Original synthesized ambient audio and event cues in `client/heist/audio.ts`.

## Run

`npm install`, `npm run build`, then `PORT=3002 npm start`.

Open `/laser/` on the server address. Practice runs in the browser with an AI crew. Real private rooms require the included Node/WebSocket server; a static-only host supports practice but cannot host multiplayer rooms. LAN friends use the host computer's reachable LAN address, not localhost. Internet play requires deployment to a Node host with WebSocket support.

Controls: WASD or arrow keys move, right mouse drag look, C crouch, Shift sprint, hold E interact, M tactical map, scroll camera distance. The camera smoothly follows the character's heading. A held movement direction keeps a stable world course while the camera turns; releasing and pressing again uses the new view direction. Manual mouse/touch orbit takes priority briefly. Click the tactical map to walk a route; crouching and interaction remain player actions. Touch movement/action controls are available at narrow widths.

Earnings are fictional game currency. Room state is held in server memory and ends when the server restarts.
