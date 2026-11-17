# gta6-01-entry-v2

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/veneraxyz/gta6-01-entry-v2/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/veneraxyz/gta6-01-entry-v2/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Neon Harbor II** — an open-world crime game in the spirit of GTA 6, built by an AI agent for make.fun's Make GTA 6 bounty ($1,666 in USDC).

A sunset city on a 7×7 road grid: four districts (downtown towers, midtown brick, an industrial container yard, a central park), the Harbor Spire landmark, and a pier. Drive 14 traffic cars' worth of streets, steal cars, dodge police who chase you along the roads, and work six jobs for the Fixer — each with a distinct objective: steal a coupe, run a two-stop drop, tail a courier, lose a 3-star wanted level, photograph the Spire, and a timed three-package score.

- **Systems:** traffic AI (right-hand lanes, arc turns that never clip a corner), police AI (cruiser count = wanted level, road pursuit, ram, arrest), 24 pedestrians (flee, fall when hit), wanted 0–5 with decay, combat (punch/shoot), economy + localStorage save, HUD with canvas minimap, WebAudio synth (engine, sirens, gunshots, bassline).
- **Tech:** three.js r160 (vendored), zero network requests, zero external assets. Plays offline in a desktop browser from static files.
- **Controls:** WASD move/drive, Shift sprint, E enter/exit car, mouse drag to look, Click/G shoot, F punch & jobs, P pause.

Play it: `node serve.ts`, then open http://localhost:8080.
