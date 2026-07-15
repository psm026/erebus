# EREBUS GROWTH PROTOCOL
*How the world grows itself. Followed by scheduled agent runs — no human prompt needed.*

## The loop (every run)

0. **Check the seeds first.** Look in `seeds/` (this folder). If JC dropped
   anything — images, notes, moodboards — those are this run's assignment and
   outrank everything below. Turn each seed (or named image+note pair) into a
   room: extract palette from images, mood from words. Move consumed seeds to
   `seeds/used/`. Images that should float in a room get optimized (webp,
   ≤1200px, ≤300KB) and uploaded to the repo root as `asset-<name>.webp`,
   referenced via `{ "kind": "image", "src": "./asset-<name>.webp" }`.
1. **Remember.** Read `WORLD-LOG.md` and `world.json` in this folder
   (`.../Vibe#1/erebus/`). If no seeds existed, the last log entry's
   **NEXT INTENTION** is this run's assignment. "Feed" lines in the log also
   outrank the intention.
2. **Design one new room** as a *consequence* of what was built last — the world
   grows like a story, not a playlist. Correlate: reuse one motif from the
   previous room (a color, a structure kind, a word) and mutate everything else.
3. **Write it** into `world.json` as a new room object, inserted BEFORE the
   "approach" room (the planet always stays last). 2 stops max per room.
4. **Log it.** Append an entry to `WORLD-LOG.md`: date, room id, what it is,
   why it followed from the last room, and a new **NEXT INTENTION** (one
   sentence seeding the next run — the world always knows its next dream).
5. **Publish.** Commit `world.json` + `WORLD-LOG.md` to github.com/psm026/erebus
   via the browser (GitHub upload page replaces files by name:
   https://github.com/psm026/erebus/upload/main — commit message
   `GROWTH: <room-id>`). Vercel auto-deploys. Verify https://erebus-emra1.vercel.app
   loads afterward. If the browser is unavailable, save the room to
   `pending-rooms/` in this folder and note it in the log — the next run (or JC's
   next chat session) publishes it.

## Sub-worlds & portals (v4 engine)

- A structure `{ "kind": "portal", "to": "<world-id>", "scale": [2.6, 2.6], "rim": "B", "intensity": 1.5 }`
  is a clickable burning ring that fades the visitor into `world-<world-id>.json`
  (same schema as world.json). The LAST room of every sub-world MUST contain a
  return portal: `{ "kind": "portal", "to": "main", ... }`.
- Sub-worlds are where deep ideas live: a room in the main world is a door;
  the world behind it can be 1-3 rooms. Prefer growing a sub-world behind an
  existing room over endlessly lengthening the main drift. Keep the main world
  ≤ 9 rooms; go deeper, not longer.
- Sub-world files are committed exactly like world.json (flat file in repo root).

## Hard rules (never break)

- **Data only.** Touch ONLY `world.json`, `world-*.json`, and `WORLD-LOG.md`.
  Never edit `script.js`, `index.html`, or `styles.css` on an autonomous run.
- The engine skips malformed rooms instead of crashing — but don't lean on it.
  Validate JSON before publishing (`python3 -c "import json; json.load(open('world.json'))"`).
- Valid JSON. Test mentally against the schema below; a trailing comma kills the world.
- The `approach` room (planet + contact) is always the final room.
- Max 1 new room per run. Max 2 stops per room. Keep structure counts modest
  (≤ 20 objects per room) — 60fps is sacred.
- Every 3rd room gets a hidden `egg` with a new numbered secret (EGG-002, EGG-003…).
- Palettes: always dark. Base near-black, one dominant accent family per room.
  No pure white, no pastels. This is EREBUS.
- Copy voice: short, moody, confident. No exclamation marks. No corporate speak.
- **JC's aesthetic law (never violate):** subtle over literal. Fewer, dimmer,
  slower elements — "moving but not." Things fade in and out of existence
  (the engine's presence system does this; don't fight it with max intensities).
  Intensities ≤1.5 for almost everything. Tapered/organic lines, never uniform
  wires. Any shape that doesn't earn its place gets cut. If it feels safe, go
  subtler. The identity is PSM — never use JC's real name anywhere on the site.

## Room schema (copy this shape)

```json
{
  "id": "kebab-id",
  "sector": "EREBUS // NAME",
  "accentA": "#hex", "accentB": "#hex",
  "fog": "#nearblack", "nebulaA": "#darkhex", "nebulaB": "#darkhex",
  "dust": "#hex",
  "stops": [
    { "variant": "room-title", "eyebrow": "Nth chamber", "title": "The Name", "body": "One or two lines." },
    { "num": "symbol-or-number", "title": "…", "tags": "…", "body": "…", "link": { "label": "…", "href": "#" } }
  ],
  "structures": [
    { "kind": "shard|monolith|ring|orb|swarm|image|egg", "count": n, "scale": [min, max],
      "rim": "A|B", "intensity": 0.4-2.0, "anchor": true, "opacity": 0.2,
      "src": "only for image kind", "secret": { "eyebrow": "EGG-00N // FOUND", "title": "…", "body": "…" } }
  ]
}
```

## Where JC feeds the world

JC drops ideas/images/thoughts in chat anytime — those become rooms immediately,
outside this schedule. He can also write a line under **Feed** in WORLD-LOG.md;
the next run consumes it. Images belong in the repo as flat files
(`asset-<name>.webp`) referenced by `image` structures via `./asset-<name>.webp`.
