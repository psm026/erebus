# EREBUS GROWTH PROTOCOL
*How the world grows itself. Followed by scheduled agent runs — no human prompt needed.*

## The loop (every run)

1. **Remember.** Read `WORLD-LOG.md` and `world.json` in this folder
   (`.../Vibe#1/erebus/`). The last log entry contains a **NEXT INTENTION** —
   that intention is this run's assignment. JC's ideas (if he left any in the
   log under "Feed") take priority over the intention.
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

## Hard rules (never break)

- **Data only.** Touch ONLY `world.json` and `WORLD-LOG.md`. Never edit
  `script.js`, `index.html`, or `styles.css` on an autonomous run.
- Valid JSON. Test mentally against the schema below; a trailing comma kills the world.
- The `approach` room (planet + contact) is always the final room.
- Max 1 new room per run. Max 2 stops per room. Keep structure counts modest
  (≤ 20 objects per room) — 60fps is sacred.
- Every 3rd room gets a hidden `egg` with a new numbered secret (EGG-002, EGG-003…).
- Palettes: always dark. Base near-black, one dominant accent family per room.
  No pure white, no pastels. This is EREBUS.
- Copy voice: short, moody, confident. No exclamation marks. No corporate speak.

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
