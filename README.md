# Great Circle

A small browser app for finding near-circular cycling loops on real OpenStreetMap roads and paths, then taking the result with you as a GPX track. React, TypeScript, Vite, and Leaflet; inspired by the simple controls and dark zinc/blue styling of [Focus Speed Reader](https://github.com/rsteth/focus-speed-reader).

The original Python experiment remains intact in `main.py`. The TypeScript app does not execute it and needs no Python environment, API key, account, or backend.

## Run locally

Use Node 22.12+ (Node 24 LTS recommended) and npm. The initial implementation was checked with Node 25.9.0.

```sh
npm ci --ignore-scripts
npm run dev
```

Open the localhost URL Vite prints (normally `http://127.0.0.1:5173`). `--ignore-scripts` skips third-party lifecycle scripts; the published platform-specific esbuild package works without its postinstall script on this Mac.

1. Click **Area center** and pick a place on the map. Choose a 1–6 km search radius. Moving the area far away also moves the start into the new area.
2. Click **Start** to place a start pin on a road or permitted cycling path. Coordinate inputs provide an alternative to map clicks. No geolocation permission is requested.
3. Pick a 3–40 km target, distance tolerance, road preference, and surface mode.
4. Click **Find my circle**. Inspect the loop, distance error, repeated sections, and roundness. The yellow dashed ideal circle can be toggled.
5. **Export GPX** downloads a GPX 1.1 track. Import it into your cycling app or GPS device. It includes all mapped geometry nodes, but no elevation or turn-by-turn instructions. The selected start snaps at most 300 m to a usable graph node; getting to that snapped start is not part of the track.

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

The browser suite intercepts Overpass with a **synthetic ring fixture**, never a claimed live route. It checks phone/desktop layouts, worker routing, XML parsing and full GPX point count, cache reuse, stale-export invalidation, coordinate validation, HTTP errors, and cancellation. Normal visible map tiles may still load during browser tests. Screenshots are written to `/tmp/great-circle-{desktop,mobile}-fixture.png` and depict that synthetic fixture.

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

For a verified small-area example, set area center and start to **49.289, −123.128**, search radius **1 km**, target **3 km**, mixed surfaces, quieter roads, and ±20% tolerance. Results may vary with map updates. See [live-data diagnosis](docs/live-data-validation.md) for the exact observations.

## How routing works

- **Data:** One manual POST to `https://overpass-api.de/api/interpreter` requests highway ways, every geometry node, and associated turn-restriction relations. The query has a 25-second server timeout and 32 MiB memory limit. The client has a 45-second timeout, a streamed 32 MiB response cap, a 200,000-element cap, a 30-second new-area cooldown (at least 30 seconds after errors, extended by Retry-After), and a single-area 15-minute in-memory cache. Changing distance or preferences in the same area reuses the downloaded data. There is no automatic failover, retry, background fetching, or persistent location history.
- **Graph:** Adjacent OSM nodes become directed edges with geodesic lengths. Both endpoints must lie inside the selected area. It preserves one-way and reverse-one-way rules, bicycle-specific exceptions/directional access, and explicit opposite-cycleway tags. Motorways, trunks, steps, construction, and restricted access are excluded. Footways, pedestrian ways, and paths require explicit bicycle permission; this is deliberately conservative across jurisdictions. Barriers without known bicycle permission and conditional access are excluded. Known paved mode requires a recognized surface tag and excludes unknown surfaces.
- **Turns:** Via-node `no_*` and `only_*` restriction relations retain incoming-edge state across path segments and the closing turn. Bicycle exceptions are honored. Via-way, conditional, and unsupported restrictions cause their approach ways to be excluded instead of being silently ignored. Immediate U-turns are disallowed for circle search.
- **Search:** A Web Worker tries several geographic circle radii and centers, in both directions, including circles through the start. Physical dead ends are pruned before snapping, and anchors are limited to the start’s directed returnable component. Eight distinct anchors must fall into their own angular sectors; a local metric projection accounts for latitude. Turn-aware Dijkstra joins them with costs for road preference, radial deviation, and edge reuse. Every candidate returns to the identical snapped start node, with legal supported turns across the seam.
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

`npm run build` creates static output in `dist/`; `npm run preview` serves it locally. The Vite base is relative so assets and the worker can live under a subpath. No deployment workflow, analytics, credentials, or paid service was added.

## Primary references

- [Leaflet 1.9.4 API](https://leafletjs.com/reference.html)
- [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL) and [public-instance usage guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)
- [OSM bicycle access](https://wiki.openstreetmap.org/wiki/Key:bicycle), [one-way rules](https://wiki.openstreetmap.org/wiki/Key:oneway), and [turn restrictions](https://wiki.openstreetmap.org/wiki/Relation:restriction)
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) and [data attribution/license](https://www.openstreetmap.org/copyright)
