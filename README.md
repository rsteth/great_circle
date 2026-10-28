# Great Circle

**Live app: [stethem.com/great_circle](https://stethem.com/great_circle/)**

A small browser app for finding near-circular cycling loops on real OpenStreetMap roads and paths, then taking the result with you as a GPX track. React, TypeScript, Vite, and Leaflet; inspired by the simple controls and dark zinc/blue styling of [Focus Speed Reader](https://github.com/rsteth/focus-speed-reader).

The original Python experiment remains intact in `main.py`. The TypeScript app does not execute it and needs no Python environment, API key, account, or backend.

## Run locally

Use Node 22.12+ (Node 24 LTS recommended) and npm. The initial implementation was checked with Node 25.9.0.

```sh
npm ci --ignore-scripts
npm run dev
```

Open the localhost URL Vite prints (normally `http://127.0.0.1:5173`). `--ignore-scripts` skips third-party lifecycle scripts; the published platform-specific esbuild package works without its postinstall script on this Mac.

1. Drag the blue **Size** handle on the circle edge inward/outward to resize (0.5–100 km radius). Tap elsewhere on the edge to move that handle; a protected area around Start prevents accidental resizing. Only Size has a radial guide, with two arrowheads. Ring and handles share the same map-coordinate layer. Tap the readout to enter kilometers; Enter/valid blur commits and Escape cancels. Circumference supplies target distance. Resizing keeps the map camera fixed; Fit circle is explicit.
2. Drag the floating lime **S / Start** around the edge. This changes only bearing, never size. North is 0°, east 90°, south 180°, west 270°.
3. Submit **Search here** to find a place globally, click the map away from the edge to move center, or open **Coordinates**. **Locate me** requests location only when clicked. These actions preserve size and start angle. **Fit circle** brings controls back into view.
4. Focus a map handle and use arrows (Shift for larger steps), Page Up/Down, Home or End as a keyboard alternative. Start also has a numeric angle field and cardinal buttons. Escape, pointer cancellation, lost capture or blur restores pre-drag settings. Only the captured pointer can change its own handle; map pan/pinch resume afterward.
5. Adjust **Route variation** from tight to flexible (10–30% internally; no numeric labels on the slider), roads and surface, then **Generate loop**. Roads can produce a different shape/distance. Start still snaps at most 300 m to usable mapped roads; getting there is not included.
6. **Download GPX** retains full mapped geometry and identical start/finish, without elevation or turn-by-turn directions.

Changing any route setting clears the previous route and export. Cancellation aborts the download or terminates the search worker. Download/service errors and impossible targets are shown without substituting a straight-line route.

## Checks

All checks are explicit; installation does not run tests, contact Overpass, or start a server.

```sh
npm run typecheck
npm test
npm run build
```

Browser tests start their own localhost Vite server on port 4179 and run serially:

```sh
npx playwright install chromium  # one-time optional browser download
npm run test:browser
```

An existing compatible Chromium test binary can be supplied instead of installing another browser:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/absolute/path/to/Chromium' npm run test:browser
```

The browser suite intercepts Overpass with a **synthetic ring fixture** and map tiles with an explicitly labeled offline grid; it makes no external map requests and never claims a live route. It checks phone/desktop layouts, worker routing, XML parsing and full GPX point count, cache reuse, stale-export invalidation, coordinate validation, HTTP errors, and cancellation. Gesture coverage includes repeated drags, 359°/0° wraparound, independent resizing, pointer capture/cancel/Escape, touch scrolling prevention, keyboard/numeric fallback, center/size changes, regeneration and GPX. Screenshots are written to `/tmp/great-circle-hand-{desktop,mobile}.png` and depict that offline fixture.

The opt-in live check makes **one bounded request and no retries** for a 1 km Vancouver West End area with a 3 km target. The CLI sends a truthful Great Circle User-Agent as required by the provider. On success it saves actual OSM data and a GPX to `/tmp/great-circle-live-osm.json` and `/tmp/great-circle-live.gpx`, and reports route metrics:

```sh
npm run check:live
```

**Final validation:** typecheck, production build, all 19 deterministic routing/network tests, and all six desktop/mobile browser checks passed. Screenshots were visually inspected; browser checks confirmed no horizontal overflow and a valid closed GPX with all 65 fixture points. The first live request returned **HTTP 406**. Diagnosis found that the CLI used a generic `node` User-Agent, contrary to the provider’s client-identification policy. A subsequent authorized tiny-area diagnostic reproduced 406, then the identical query with the truthful Great Circle User-Agent returned **HTTP 200**. Actual-data validation produced a 3.264 km closed loop with 199 geometry points, 8.8% distance error, 61.7/100 roundness, and no repeated sections. Every directed segment, the closing turn, and the 1 km area boundary were checked. A subsequent single production-browser request from localhost also returned HTTP 200 with `Access-Control-Allow-Origin: *`, using normal browser-controlled User-Agent, Origin, and Referer. The actual built app generated the same 3.26 km / 199-point result, downloaded valid closed GPX, and passed desktop/phone visual inspection without horizontal overflow. This is one tiny live case, not a guarantee of global route quality or on-the-ground access; the deterministic browser suite above uses fixtures. No alternate endpoint, identity disguise, or automatic retry was used. The follow-up identification, cooldown, cancellation, dead-end, and returnability regressions all passed.

An optional production-browser live check runs against an already built local preview and makes exactly one actual Overpass request with normal browser identity. Run only when you intend to use the public service, at least 30 seconds after any previous request:

```sh
npm run preview -- --port 4181 --strictPort
# In a second terminal (with a Playwright Chromium installed or executable path set):
npm run check:browser:live
```

It writes actual-data desktop/mobile screenshots, a GPX, and request/CORS evidence to `/tmp/great-circle-browser-live-*`. Stop the preview with Ctrl-C afterward. No build, test, or install runs this check automatically.

The earlier verified 3.264 km example below predates the circle-hand controls and used a free start pin. It is historical evidence, not a claim that a new selected circumference/start will reproduce that route. The new controls are checked with deterministic offline geometry fixtures; actual roads and map updates can change which loops are possible. See [live-data diagnosis](docs/live-data-validation.md) for the exact observations.

## How routing works

- **Data:** One manual POST to `https://overpass-api.de/api/interpreter` requests highway ways, every geometry node, and associated turn-restriction relations. The query has a 25-second server timeout and 32 MiB memory limit. The client has a 45-second timeout, a streamed 32 MiB response cap, a 200,000-element cap, a 30-second new-area cooldown (at least 30 seconds after errors, extended by Retry-After), and a single-area 15-minute in-memory cache. Changing distance or preferences in the same area reuses the downloaded data. There is no automatic failover, retry, background fetching, or persistent location history.
- **Graph:** Adjacent OSM nodes become directed edges with geodesic lengths. Both endpoints must lie inside the selected area. It preserves one-way and reverse-one-way rules, bicycle-specific exceptions/directional access, and explicit opposite-cycleway tags. Motorways, trunks, steps, construction, and restricted access are excluded. Footways, pedestrian ways, and paths require explicit bicycle permission; this is deliberately conservative across jurisdictions. Barriers without known bicycle permission and conditional access are excluded. Paved-only mode requires a recognized surface tag and excludes unknown surfaces.
- **Turns:** Via-node `no_*` and `only_*` restriction relations retain incoming-edge state across path segments and the closing turn. Bicycle exceptions are honored. Via-way, conditional, and unsupported restrictions cause their approach ways to be excluded instead of being silently ignored. Immediate U-turns are disallowed for circle search.
- **Search:** A Web Worker tries several geographic circle radii and centers, in both directions, including circles through the start. The circle-hand UI passes an explicit circle radius and a geographic start on its circumference. For this mode the candidate center stays at the chosen map center, with nearby radius fits; legacy callers without an explicit radius retain the earlier center-search behavior. The search boundary is padded separately and never serves as the draggable target circle. Physical dead ends are pruned before snapping, and anchors are limited to the start’s directed returnable component. Eight distinct anchors must fall into their own angular sectors; a local metric projection accounts for latitude. Turn-aware Dijkstra joins them with costs for road preference, radial deviation, and edge reuse. Every candidate returns to the identical snapped start node, with legal supported turns across the seam.
- **Acceptance:** Full geometry determines actual distance. Candidates must meet the chosen ±10/20/30% tolerance, have roundness of at least 30/100, and repeat no more than 20% of their physical sections. Accepted candidates are ranked by distance error, roundness, and repetition. Roundness is `4π × absolute enclosed area / track length²`, not a safety or fitness score. Repetition counts subsequent traversal of the same physical node pair in either direction. Search is capped at about 14 seconds or 1.8 million state expansions; the best acceptable result is labeled if the cap is reached.
- **Export:** Every traversed OSM geometry node becomes a GPX track point in order, including an identical start and end. No geometric shortcuts, synthetic connecting lines, smoothing, or inferred elevations are inserted. OSM attribution is included in the GPX metadata.

## Boundaries and limitations

This is a usable interface and bounded routing prototype, not a globally optimal circle solver or a complete navigation engine. It can miss a feasible loop, especially in sparse, disconnected, coastal, or heavily restricted areas. It does not model every jurisdiction's implicit bicycle law, lane-level movements, traffic, hills, temporary closures, or every OSM tagging convention. Missing/incorrect map tags still matter. Unsupported restrictions are handled conservatively, sometimes losing valid routes. A nearest eligible loop-node snap can still choose an unhelpful small component; move the start if that happens. Roundness can be affected by crossing geometry and is only one heuristic.

Mixed surfaces includes unknown tags and unpaved roads; quiet mode penalizes busy roads but does not promise traffic-free routing. Always inspect the track and current conditions before riding.

The selected area is transmitted only when generating a route. OSM map tiles load as you pan/zoom. Requests use normal browser caching and visible attribution, with no tile prefetch or offline tile download. Public OSM/Overpass services are best-effort and suitable here for light personal experimentation, not a production routing service or SLA. An HTTP 406/429/504 or CORS failure may prevent downloading data; the app reports it rather than bypassing access controls. Scaling beyond personal use needs a separately chosen data/routing provider or infrastructure, which is outside this prototype.

## Source map

- `src/App.tsx`, `src/MapView.tsx`, `src/style.css`: controls, map, preview, metrics, and download.
- `src/routing/overpass.ts`: bounded fetching, throttling, and in-memory caching.
- `src/routing/graph.ts`: access/direction filtering, raw-node geometry, and turn rules.
- `src/routing/solve.ts`, `geo.ts`: sector anchors, turn-aware path search, candidate ranking, and metrics.
- `src/routing/worker.ts`: isolated search lifecycle; termination provides immediate cancellation.
- `src/routing/gpx.ts`: escaped, attributed GPX 1.1 track export.
- `tests/`: deterministic routing fixtures and responsive browser checks.
- `main.py`: unchanged historical Python sketch, with its original limitations.

`npm run build` creates static output in `dist/`; `npm run preview` serves it locally. The Vite base is relative so assets and the worker can live under a subpath. The pinned-action `.github/workflows/pages.yml` runs the deterministic checks and production build in GitHub Actions, then publishes `dist/` through GitHub Pages on pushes to `main`. The repository is public by explicit owner approval; the original Python sketch is preserved. No analytics, credentials, or paid service was added.

## Primary references

- [Leaflet 1.9.4 API](https://leafletjs.com/reference.html)
- [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL) and [public-instance usage guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)
- [OSM bicycle access](https://wiki.openstreetmap.org/wiki/Key:bicycle), [one-way rules](https://wiki.openstreetmap.org/wiki/Key:oneway), and [turn restrictions](https://wiki.openstreetmap.org/wiki/Relation:restriction)
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) and [data attribution/license](https://www.openstreetmap.org/copyright)

## Published smoke check

GitHub Pages serves the app at **https://stethem.com/great_circle/** through the existing account custom domain, with HTTPS enforced. The cloud test/build/deploy workflow passed. A single actual browser request from the deployed origin succeeded with normal browser-controlled identity and CORS; it produced the 3.26 km / +8.8% / 62-roundness / 0%-repeat / 199-point closed GPX example. Desktop and 390 px phone-width layouts were inspected without horizontal overflow. This is one bounded live case, not a guarantee of route quality or current real-world conditions.

## Circle-hand change validation

The circle-hand update preserves graph access/direction rules, path costs, snap distance, acceptance thresholds, and GPX export. The intentional new semantic constraint is that the selected ring has a fixed geographic center and linked radius/circumference, and its start is the chosen bearing on that ring. Public data queries still use the existing bounded, cached fetcher with a padded search boundary. No geolocation, provider, account, key, or privacy behavior changes were added.

Validation for the circle-hand revision: 25 deterministic routing/network/circle tests and the typechecked production build passed. Eleven desktop/phone browser cases passed; the desktop-only copy of the touch case is intentionally skipped, while real emulated touch passed on the phone project. Tests use local ring data and offline map tiles, including repeated drags, wraparound, resize, Escape/pointer cancellation/lost capture, numeric validation, center/size changes, regenerate and full GPX export. No performance benchmark or extra public map-data request was run.

## Mobile map layout

On phones the map fills the viewport width. Route variation, the radius readout and **Generate loop / Cancel** sit directly below the map, outside the tile/handle area, with resizing kept on the map. **Settings** opens the secondary controls (center coordinates, start angle and ride preferences) in a modal bottom drawer. Close, Done, Escape or the backdrop dismiss it. Focus stays in the drawer and returns to the opener; background scrolling is locked and restored. Hidden invalid fields are reopened and focused rather than silently blocking generation.

Loading stays next to the map; errors are brought into view. Successful results expose a single **Download GPX** action in the map control area. Portrait, narrow 320 px phones and touch landscape layouts reserve space for map attribution and keep circle/start/resize gestures separate from the control area. Desktop retains its sidebar. The routing/search/GPX modules are unchanged by this layout update.

Mobile-layout validation: all 25 correctness tests and TypeScript/production build passed. Fifteen desktop/phone browser cases passed, with five non-applicable desktop copies intentionally skipped. Coverage includes 320 px phones, portrait and touch landscape, native modal focus trap/return, Escape/backdrop/Done/close, scroll locking, rotation/desktop breakpoints, hidden-field validation, map-handle clearance, independent hand/size/touch gestures, loading/cancel/error/success, and GPX. Screenshots use labeled offline map tiles; no new routing-service request or benchmark was needed. Safe-area insets are reserved for header, controls, drawer and attribution.

## Perimeter/search revision (local)

The route fetcher, solver, access/direction/turn rules and GPX implementation are unchanged. New manual global search uses Photon (reasonable-use public demo, no availability guarantee), separately from Overpass. It sends only entered text, never the map center or device position. Queries are cached and rate-limited; stale/cancelled responses cannot recenter the map. Location is requested only by clicking Locate me; actual device location is never used by tests. See [routing request/performance review](docs/routing-performance-review.md) for source-derived bottlenecks, proposed optimizations and provider terms. No routing-performance optimization or speedup is claimed by this UI revision.

Set `VITE_PLACE_SEARCH_URL` to a compatible Photon endpoint at build time if a different service has been deliberately selected. Search is submit-only, bounded to 10 seconds / 1 MiB / five places. Mocked browser tests do not establish public availability; a subsequent [single actual Paris browser check](docs/search-readiness.md) returned HTTP 200 with CORS allowed from localhost. Publication remains pending.

Local validation for this revision: 29 deterministic routing/network/circle/geocoding tests passed; TypeScript and production build passed. The desktop/phone suite covers 24 applicable cases (six desktop copies of phone-only checks skipped). Final zoom safety checks also passed after correcting the test to wait between Leaflet animations. Coverage includes on-ring hit selection and Start exclusion, repeated rotation/wraparound, touch resizing, multitouch/cancel/capture loss, pan/pinch, extreme zoom/Fit, center/size regeneration, stale export, full closed GPX, hidden-field/drawer accessibility, mocked search races/errors/cache, and explicit mocked location denial/success. Screenshots: `/tmp/great-circle-perimeter-{desktop,mobile}.png`, `/tmp/great-circle-mobile-landscape.png`, `/tmp/great-circle-mobile-map-dock.png`. All map/search/location data in this revision's browser tests are fixtures; no actual personal location, new live map query, provider performance benchmark, push or deployment was used.

At very small on-screen circle sizes the Size handle is hidden to protect Start's hit target; use Fit circle to restore separated handles. This changes only the view, not the radius or route settings.

## Main branch publication

The verified UI lineage is integrated into `main` by fast-forward, preserving the original Python sketch and all TypeScript history. Pages now publishes pushes to `main`; optimization work starts on a separate local feature branch and needs a separate publication decision.

## Current local refinements

See [radius/map behavior and large-area boundary](docs/radius-map-refinement.md) and [local routing-efficiency work](docs/routing-efficiency-local.md). Circle planning/editing supports a 100 km **radius**; the shared public map downloader still supports circles up to 4.5 km radius and rejects larger downloads before fetching. Efficiency and this newest UI revision remain local pending a separate publication decision.

The measured offline comparison preserved exact baseline GPX on both fixtures. Saved Vancouver median solve time was 111.16 ms baseline, 60.29 ms cold and 47.24 ms warm (five interleaved samples; no network timing claim). See [protocol and full results](docs/routing-efficiency-local.md#paired-offline-comparison). `npm run benchmark:routes -- --baseline /absolute/path/to/frozen-cfb2be0-source` is explicitly opt-in and requires a coordinated timing window.
