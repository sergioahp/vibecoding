# Fishslop

A 3D aquarium game in the browser, inspired by Insaniquarium and the "Fishslop" test Theo Browne uses on coding models. You pilot a feeding submarine: drop pellets, grow guppies from fry to kings, scoop up the coins they drop, buy upgrades, and harpoon the monsters that show up on a timer. Buy all three egg pieces to win.

Built from scratch with Three.js and TypeScript. Every model is procedural and every sound is synthesized, so there are no asset files.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the game rules (node:test)
npm run build      # typecheck + production build into dist/
node e2e/smoke.mjs # plays the built game in headless Chromium (needs a build)
```

## Controls

WASD swim, mouse look, Space/C up and down, Shift boost, click or F to drop food, right-click or R to fire the harpoon, 1–6 to buy, M to mute, Esc to pause.

## Layout

| File | What it does |
| --- | --- |
| `src/rules.ts` | Economy, growth, balance numbers. No rendering, so it's unit-tested. |
| `src/game.ts` | Game loop, states, monsters, shop, camera. |
| `src/entities.ts` | Fish AI, pellets, coins, harpoon bolts, the monster. |
| `src/tank.ts` | The aquarium: sand, caustics, rocks, coral, seaweed, bubbles. |
| `src/models.ts` | Procedural meshes. |
| `e2e/smoke.mjs` | Headless play-through used by CI. |

## CI and deploy

`.github/workflows/fishslop.yml` runs on every PR that touches `agent-generated/`:

1. **Typecheck, unit tests, build**
2. **Play-test in headless Chromium**: starts a run, swims, buys a fish, checks the pellet cap and that pellets expire, waits for a hungry fish to eat, keeps fish fed until the first monster arrives. Screenshots are attached to the run.
3. **Deploy to GitHub Pages**: only on pushes to `master`.

CI runners have no GPU, so the browser renders in software at a few frames per second. The smoke test turns on `manualClock` and moves game time with `window.__fishslop.advance(seconds)` in fixed 60 Hz steps, which keeps it fast and deterministic.
