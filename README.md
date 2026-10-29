# Hero / Villain

Open-city superhero sandbox for Meta Quest 3, in the browser (WebXR + Three.js), with a PS1 look.
What you do with your powers decides whether the city treats you as a hero or a villain.

**Play:** open the GitHub Pages link in the Meta Quest Browser and press **Enter VR**. It also runs on desktop for testing.

## Quest controls

| Input | Action |
| --- | --- |
| Trigger | Fly where that hand points. Both hands = full speed. |
| Grip | Telekinesis: point at a car, crate or person, squeeze, swing, let go to throw. |
| Right stick ↑↓ | Push / pull what you're holding. ←→ snap turn. |
| Left stick | Walk. |
| A / X | Super jump. |
| B / Y | Dive. Hit the ground fast for a shockwave slam. |

The wrist screen on your left hand shows your reputation.

## Desktop controls

Mouse to look (click to capture), WASD walk/steer, Space fly where you look (Shift+Space double), right mouse grab, left mouse hurl, wheel push/pull, E jump, C dive.

## How it plays

- Stop muggings (knock out every thug in the group) to push toward **hero**. Civilians cheer when you land near them.
- Hurt civilians or cops to push toward **villain**. The sky turns to a burning dusk, rooftops catch fire, people run from you, and your gloves turn black and red.
- Gentle drops don't count. People you set down get back up and run.

## Run locally

Any static server works, for example `python3 -m http.server` in this folder, then open `http://localhost:8000`.
The Quest needs HTTPS for WebXR, so test VR on the Pages URL (or an HTTPS tunnel).

## Code map

- `src/art/`: the PS1 art kit (shader, procedural texture atlas, city generator, people, vehicles, gloves, FX). No image or model files.
- `src/game/main.js`: setup, reputation, game loop.
- `src/game/world.js` + `chunkWorker.js`: city streaming (built in a worker so flight doesn't stutter) and collision.
- `src/game/physics.js`: verlet physics. Cars and crates are 8-particle boxes, people are 13-particle ragdolls.
- `src/game/people.js`: pedestrians, muggings, cops. Rendered as one `InstancedMesh` per body part.
- `src/game/props.js`: parked and driving cars, buses, crates, dumpsters.
- `src/game/player.js`: flight, walking, jump, dive, slam.
- `src/game/powers.js`: telekinesis.
- `src/game/input.js`: one input shape for Quest controllers, desktop, and scripted tests.

## Tuning knobs

- Flight: `THRUST`, `MAX_SPEED`, `GRAVITY`, `SLAM_SPEED` in `player.js`.
- Telekinesis: `PICK_CONE`, `MAX_RANGE`, `HAND_GAIN` in `powers.js`; throw multiplier in `_release`.
- Glove and wrist screen placement: `gloves[...].rotation` in `main.js`, `wristMesh` in `hud.js`.
- Wobble is off (no vertex snap, no texture warp). To turn it back on, raise `snapMode` / `affine` in `PS1_VR` and `PS1_FLAT` in `src/art/ps1.js`. Render scale: `setFramebufferScaleFactor` in `main.js`.

Three.js r170 is vendored in `vendor/` (MIT licence).
