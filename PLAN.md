# EREBUS — Living World Plan

*A dev-grade interactive dark world that grows on its own. Portfolio first, organism second.*
*Updated 2026-07-12*

## The vision

One WebGL world (the current void scene) that expands over time: agents generate new
**rooms** — 3D spaces, hidden easter-egg chambers, and simple 2D pages (portfolio,
products, articles, collab pages) — committed to the site automatically. Visitors who
explore find things that weren't there last month.

## Architecture: rooms-as-data

The engine (script.js) stays hand-tuned. Everything that GROWS is data:

```
erebus/
  index.html          ← shell
  styles.css          ← UI skin
  script.js           ← engine (renders whatever the manifest says)
  world/
    manifest.json     ← list of all rooms + how they connect
    rooms/
      portfolio.json  ← the current 5-shard drift, as data
      room-002.json   ← palette, geometry recipe, shader params, content, links
      egg-001.json    ← hidden; unlock condition included
    pages/
      *.html          ← simple 2D pages (products, articles, collabs)
    WORLD-LOG.md      ← the world's memory: what exists, why, what to build next
```

Agents write **data files, not engine code** — so autonomous growth can never break
the site. A bad room is a bad JSON file, not a crash.

## The growth loop (the "living" part)

1. Scheduled agent run (weekly to start): reads WORLD-LOG.md + JC's prompt/ideas
2. Generates a new room JSON (+ page HTML if needed), appends reasoning to WORLD-LOG
3. Commits to GitHub
4. **IONOS Deploy Now** auto-publishes the commit to JC's existing IONOS hosting
5. World grew. Nobody touched anything.

## Pipeline (uses hosting JC already pays for)

GitHub repo → IONOS Deploy Now (free add-on: connects repo, auto-deploys every
commit, free SSL, staging branches). Docs: https://docs.ionos.space

## Division of labor

**JC (one-time, ~20 min):** create free GitHub account; log into IONOS and click
"connect" on Deploy Now (Claude drives the browser after login — Claude never
handles passwords); install Claude Code when ready for the heavy phase.
**Claude (everything else):** engine code, shaders, room generator, world-log,
scheduled growth runs, testing in Chrome, content drafting, deploy babysitting.

## Phases

1. **Ship v1** — portfolio drift live on IONOS (this week)
2. **Rooms refactor** — engine reads manifest; portfolio becomes room #1 (next)
3. **Growth agent** — scheduled run + WORLD-LOG + first auto-generated room
4. **$150k polish** — bloom post-processing, free-look camera, sound design,
   custom cursor, page transitions, per-room palettes (ongoing, compounding)

## Trusted resources (vetted)

- Course: Three.js Journey (Bruno Simon) — threejs-journey.com
- Official examples: threejs.org/examples
- Technique breakdowns: Codrops — tympanus.net/codrops
- Libraries when needed: pmndrs/postprocessing (bloom etc.), lenis (smooth scroll)
- YouTube: Yuri Artiukh (akella) shader streams, SimonDev, Wawa Sensei

## Hard rules

- No engine (Unity/Unreal) — real-time GLSL in the browser is the whole aesthetic
- Claude never logs in anywhere or touches credentials — JC authenticates, Claude drives after
- Agents write data, never engine code, on autonomous runs
