# In a Sea of Stars

**Prototype 01 — Navigable Archive** for Tech B / Module 02.

A dreamlike interactive archive: sail a paper boat through a sea of 3D paper stars, each holding an archive image whose light comes from three machine readings. Retrieve a star to see it as a Polaroid and leave a note for other visitors.

*Not everything that matters has to shine.*

## Run in VS Code

1. Install Node.js (20.19+ or 22.12+ for this Vite version).
2. Open this folder in VS Code.
3. In the terminal run:
   ```bash
   npm install
   npm run dev
   ```
4. Open the localhost address shown by Vite (often http://localhost:5173/).

**Controls:** WASD or arrow keys = sail; click a nearby star or press E = retrieve; Esc = close. Click **+ Release a star** to upload a temporary image (max 12 MB).

## What currently works
- 800 archive images as 3D paper stars on a shader ocean, a folded paper boat, follow camera, crayon-style UI
- Real readings from three models (Teachable Machine, CLIP, MobileNet + star vocabulary), cached and stored in Supabase
- Light from the readings: brightness = Star-relatedness, slow colour drift = disagreement, pearl glow = not yet read
- Stars reveal their light as the boat comes close; the boat pushes stars aside and they drift back home
- Polaroid with the image, three pencil bars, a poetic line, credit, and shared visitor notes (Supabase)
- "+ Release a star": the image falls into the sea, is stored in Supabase, and is read by the local inference server when it runs
- About page (click the small line at the top)

## Not implemented yet
- Cinematic aerial camera for releasing a star (the falling animation stays as it is)
- Face detection for the portrait line ("We are all stars in someone's eyes.")
- Moderation of visitor notes / released stars — remove them by hand in the Supabase table editor
- On the published site, newly released stars stay unread unless `npm run inference` is running on this computer

## File guide
- `index.html` page markup, Polaroid, about page
- `src/main.js` Three.js world, boat, stars, light, collision, retrieval and upload
- `src/config.js` every tunable scene value (TUNE, 中文注释)
- `src/archive.js` archive data, poetic lines, credits · `src/layout.js` star positions
- `src/inference/` scoring rules shared by the browser and the Node scripts
- `src/persistence.js` Supabase notes, released stars and readings
- `scripts/` archive build, image fetching, inference, sync to Supabase
- `supabase/schema.sql` tables, security rules, rate limits

## Publishing (GitHub Pages)
1. Push this folder to a GitHub repository (branch `main`).
2. On GitHub: Settings → Pages → Source: **GitHub Actions**.
3. Every push to `main` builds the site with `.github/workflows/deploy.yml`; the address appears under Settings → Pages.

`.env.production` holds only the public Supabase URL and publishable key. The secret key lives in `.env`, which is never uploaded.

## Visual update v02
- Follow camera moved from (26, 25) to (18.5, 17.2) relative to the boat, with a 44° FOV.
- Boat scaled by 2.5×; interaction radius expanded to 5.5 world units.
- Polaroid now uses warm paper grain, watercolor washes, handwriting-style headings, and uneven pastel pencil bars.
- Model scores remain demo only; no ML or Google Sheets backend yet.

## Archive v03 — real archive data
- `npm run build:archive` picks 300 images (60 per human category, fixed seed) from `../STARS/data/pic` + `pic_manifest_255-700.csv`, compresses them to `Pic/star_###.webp` (≤640px, WebP q78; 75.9 MB → 10 MB) and writes `src/data/archive.json`. Originals are never modified. Change `PER_CATEGORY` / `SEED` in `scripts/build-archive.mjs` to resize the sea.
- Each star: persistent `id`, `image`, `title`, `humanCategories[]`, `originalFile`, `source` (Flickr page, license, creator), `analysisStatus`, `predictions { tm, clip, mn }`. Positions are scattered at runtime by `src/layout.js` (deterministic seed), so density is tuned without rebuilding.
- `predictions` are `null` until real inference runs. `null` = not yet read (dotted line on the Polaroid, soft neutral glow), never 0 / unrelated.
- The Polaroid shows the star ID, human category and a photo credit linking to the source.
- The sea is trimmed to 800 stars: `node scripts/trim-archive.mjs 800` keeps every Unrelated image and drops the most repetitive star-related ones (CLIP image similarity), listing them in `scripts/archive-removed.txt`, which `build:archive` skips. Remaining IDs never change, so numbers have gaps.

## Supabase backend
1. Supabase → SQL Editor → run `supabase/schema.sql` (tables `released_stars`, `responses`, `predictions`, bucket `released-stars`, RLS + rate limits).
2. Copy `.env.example` to `.env`, fill `VITE_SUPABASE_ANON_KEY` (publishable key), restart `npm run dev`.
3. Without these values everything falls back to local / session-only.
Moderation: Table Editor → set a row's `status` to `hidden`.
`apps-script/Code.gs` is an earlier Google Sheets alternative and is not used by the app.

## Tuning
- `src/config.js` — every scene value marked `TUNE` (中文注释): sea density, star colours / size / puffiness, glow brightness, boat, camera, ripples.
- `src/style.css` → `:root` — every UI font, font size and Polaroid colour.
- Performance: open `localhost:5173/?fps` for a frame-rate counter. If it stutters, lower `POST.maxPixelRatio` (1), `POST.msaa` (0), or turn off `POST.bloom` in `src/config.js`.

## Machine readings (Phase B)
Three models run **in Node, outside the browser**, so the sea never stutters:
Teachable Machine (`8-twB42kE`), CLIP (`Xenova/clip-vit-base-patch32`, q8) and MobileNet v2 + the Star vocabulary.
Scoring rules are shared in `src/inference/scoring.js` (ported from *Is It a Star?*): TM / CLIP Star score = 1 − P(Unrelated); MobileNet only counts labels found in the vocabulary — if none match, it stays **unnamed (null), never 0**.

- `npm run analyze` — reads every archive star once (~1 s each, WASM backend) → `src/data/predictions.json`. Re-runs skip cached stars; `-- --force` re-reads all (e.g. after editing `PROMPTS`).
- `npm run inference` — local server on `http://localhost:8787` for stars without a reading (visitor-released stars). The site calls it when the boat first approaches such a star; without it those stars simply stay unresolved.
- Add `SUPABASE_SERVICE_ROLE_KEY=<secret key>` to `.env` (no `VITE_` prefix) to also save readings to Supabase `predictions`.
- Note: Teachable Machine was trained on this archive, so its readings of archive images are inflated (it has seen them). The Polaroid says so on hover.

## Light (Phase C)
- All stars start with the same pearl glow; a star shows its own light the first time the boat comes near (`REVEAL` in config.js). Cached readings appear directly; only real inference shows a shimmer.
- Brightness = weighted combined score (`MODELS.weights`); higher scores lean moonlit gold. Low scores stay visible.
- Models disagree (spread ≥ `MODELS.disagreement`) → slow drift toward lavender / mist blue and irregular breathing.
- No usable reading → neutral pearl glow (unknown ≠ unrelated).
- Polaroid: real bars drawn one by one, hover for details, agreement note, poetic line chosen from the readings.
