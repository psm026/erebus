# EREBUS — JC's dream-space portfolio

Primordial darkness. Floating obsidian shards. A dark planet at the end. Scroll drives the camera.
Same architecture as the meadow reference site: **3 files, no framework, no build step.**

- `index.html` — content + structure. **Your portfolio copy lives here.**
- `styles.css` — all UI styling. Mood tokens at the top (`:root`).
- `script.js` — the Three.js world. Tuning knobs at the top (`CONFIG`).

Three.js loads from jsDelivr CDN via the import map in `index.html` — nothing to install.

---

## 1. Preview it locally

Browsers block ES modules on double-clicked files, so it needs a tiny local server.
Pick ONE:

**Option A — Terminal (built into macOS):**
```bash
cd "/Users/jc/Library/Mobile Documents/com~apple~CloudDocs/Claude Workspace/VIBE#1/Vibe#1/erebus"
python3 -m http.server 4173
```
Then open http://localhost:4173 in Chrome. `Ctrl+C` in Terminal stops it.

**Option B — VS Code, no terminal:** install the "Live Server" extension, right-click
`index.html` → "Open with Live Server".

---

## 2. Make it yours

- **Projects:** edit the five `<section class="panel project">` blocks in `index.html` —
  title, tags, description, link. Add/remove sections freely; the camera path,
  counter, and scroll length all adapt automatically.
- **Name/brand:** search `index.html` for "JC" (title, HUD, h1, meta tags).
- **Mood:** `styles.css` `:root` tokens (colors, fonts) + `script.js` `CONFIG`
  (drift speed, parallax, particle counts, accent colors).
- **Sector names:** the `SECTORS` array in `script.js` — rename the HUD labels.

## 3. Deploy (free)

**Fastest (no accounts linked, 2 min):** go to https://app.netlify.com/drop and drag
the `erebus` folder in. Live URL immediately.

**Proper (what the reference site does):**
1. Free account at https://github.com — create a repo, upload these files.
2. Free account at https://vercel.com — "Add New Project" → import the repo.
3. Done. Every future change pushed to GitHub auto-deploys.

## 4. What you do NOT need

- ❌ No game engine (Unity/Unreal) — the "CGI" is real-time GLSL shaders in the browser
- ❌ No Cinema4D/After Effects — animation is code (`script.js` frame loop)
- ❌ No paid hosting — this is a static site; Vercel/Netlify free tiers are plenty
- ⭕ Blender is optional, later, only if you want sculpted 3D models (loaded via GLTF)

## 5. Known v1 limits (the punch list)

- Placeholder copy everywhere — needs your real projects
- No bloom post-processing yet (rim glow is faked with fresnel shells — cheap + fast)
- No per-project imagery/textures yet
- Loader is choreography, not real asset progress (there are no heavy assets yet)
