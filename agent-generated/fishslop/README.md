# Fishslop

A 3D aquarium game in the browser, inspired by Insaniquarium and the "Fishslop" test Theo Browne uses on coding models. You pilot a feeding submarine: drop pellets, grow guppies from fry to kings, scoop up the coins they drop, buy upgrades, and harpoon the monsters that show up on a timer. Buy all three egg pieces to win.

Built from scratch with Three.js and TypeScript. Every model is procedural and every sound is synthesized, so the only image files are the icons and the link preview.

Plays with keyboard and mouse or on a phone, in English or Spanish.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the game rules (node:test)
npm run build      # typecheck + production build into dist/
node e2e/smoke.mjs  # plays the built game in headless Chromium (needs a build)
node e2e/mobile.mjs # plays it again as a Spanish phone, in landscape and portrait (needs a build)
npm run bot         # a scripted player runs a whole game and reports the balance (needs a build)
npm run images      # re-renders the link preview and icons into public/ (needs a build)
```

## Controls

**Keyboard and mouse:** WASD swim, mouse look, Space/C up and down, Shift boost, click or F to drop food, right-click or R to fire the harpoon, 1–6 to buy, M to mute, Esc to pause.

**Touch:** the left thumb steers with a stick that appears where it lands (up drives, sideways turns, drag past the ring to boost). The right thumb drags to look. Buttons feed, fire (hold for repeat), rise, sink and pause; tap the shop to buy. The harpoon locks on from a wider angle than with a mouse, and Android phones buzz on buys, hits and losses.

The game picks touch controls when the device's main pointer is a finger (`(pointer: coarse)`), and switches whenever the player taps or clicks with the other kind. It works held either way: in portrait the view widens and the controls move above the shop. On a phone, Dive in also goes fullscreen where the browser allows it (Android; iPhone Safari doesn't). Added to the home screen, it opens from its own icon without the browser bars.

## Languages

English and Spanish. The game reads `navigator.languages` and uses the first one it speaks, so a browser set to `es-MX` or `es-ES` gets Spanish and anything else gets English. The button on the title screen switches and remembers the choice; `?lang=es` or `?lang=en` in the URL overrides both. Numbers follow the player's region (1,500 in Mexico, 1500 in Spain). Strings live in `src/i18n.ts`; elements in `index.html` name theirs with `data-i18n`.

## Link preview

`index.html` has Open Graph tags, so WhatsApp, Slack, Discord and X show `public/og.jpg` under a shared link. The image URL has to be absolute, so it names the GitHub Pages address. `npm run images` stages a moment in a real run (the sub harpooning a monster), adds the logo, and writes the image and the app icons. WhatsApp caches previews per link: add something like `?v=2` to see a new one.

## Layout

| File | What it does |
| --- | --- |
| `src/rules.ts` | Economy, growth, balance numbers. No rendering, so it's unit-tested. |
| `src/game.ts` | Game loop, states, monsters, shop, camera. |
| `src/entities.ts` | Fish AI, pellets, coins, harpoon bolts, the monster. |
| `src/tank.ts` | The aquarium: sand, caustics, rocks, coral, seaweed, bubbles. |
| `src/models.ts` | Procedural meshes. |
| `src/touch.ts` | On-screen stick, look drags and buttons for phones. |
| `src/i18n.ts` | English and Spanish strings, language detection. |
| `e2e/smoke.mjs` | Headless play-through used by CI. |
| `e2e/mobile.mjs` | Touch and Spanish play-through used by CI. |
| `e2e/bot.mjs` | Scripted player for balance testing. |
| `scripts/make-images.mjs` | Renders the link preview and icons. |

## CI and deploy

`.github/workflows/fishslop.yml` runs on every PR that touches `agent-generated/`:

1. **Typecheck, unit tests, build**
2. **Play-test in headless Chromium**: starts a run, swims, buys a fish, checks the pellet cap and that pellets expire, waits for a hungry fish to eat, keeps fish fed until the first monster arrives. Then a phone test plays as a Spanish-speaking touch device: checks the Spanish text, drives with the stick, looks with a second finger at the same time, feeds, holds the harpoon, buys, pauses, then turns the phone upright and plays again. Screenshots are attached to the run. Then the balance bot plays two full games: the `sensible` strategy must win within 15 minutes of game time, and `eggrush` must not.
3. **Deploy to GitHub Pages**: only on pushes to `master`.

CI runners have no GPU, so the browser renders in software at a few frames per second. The smoke test turns on `manualClock` and moves game time with `window.__fishslop.advance(seconds)` in fixed 60 Hz steps, which keeps it fast and deterministic.

## Balance bot

`npm run bot -- [strategy] [maxSeconds]` plays a full game in headless Chromium in about 25 seconds and prints a minute-by-minute log: money, fish, losses, monsters slain, upgrades and egg pieces, then when it won or lost. Strategies:

- `sensible` (default): grows the tank, buys the upgrades that pay off, fights every monster, then saves for eggs.
- `sensible-nofight`: the same, but never fires the harpoon.
- `eggrush`: keeps four fish and buys nothing but egg pieces.

It reads shop prices and hunger from `src/rules.ts`, so after a rebalance just rerun it. With the current numbers, `sensible` wins in about 10–11 minutes, `eggrush` stalls at one egg piece, and `sensible-nofight` eventually loses. A Claude subagent wrote the first version while play-testing the game.
