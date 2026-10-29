# Prepared-graph routing prototype (local only)

## Status and setup

This feature defaults to ORS, behind a local Node/TypeScript API. It is **not deployed**. The published `b706529` site still uses Overpass and the browser worker. No ORS account/key has been created, read or stored, and no real ORS request has been made. Mock contracts establish integration behavior, not Los Angeles coverage, provider speed or real road legality.

Use two terminals:

```sh
npm run dev:server  # 127.0.0.1:8787; returns an explicit unconfigured error without a key
npm run dev        # 127.0.0.1:5173; Vite proxies /api to the local server
```

An ORS account and Directions key are required for a live comparison. Supply `ORS_API_KEY` through an approved **server-only** secret source, never a `VITE_` variable or ordinary chat. `.env.example` contains names/placeholders only; the server does not automatically load a `.env` file. An optional macOS route reads a generic password only if the user explicitly supplies `ORS_KEYCHAIN_SERVICE` at launch. The user can create the item using Keychain Access's secure password dialog, with service `great-circle-ors`, then launch:

```sh
ORS_KEYCHAIN_SERVICE=great-circle-ors npm run dev:server
```

No key is printed or sent to the browser/health endpoint. This optional read has **not** been exercised with a real key. No general secure local-secret-entry panel is exposed by the connected tools; unrelated cloud-environment or Sites setup panels are not appropriate. User approval/setup is pending. Do not paste the key into chat, commands in this transcript, or source files.

`GET http://127.0.0.1:8787/api/health` reports only provider/configured state. The server binds loopback, permits local Origin/Host only, has one active plan and no request-body logging. It is a development adapter, **not** an internet-ready service: public deployment needs a separate hosting/secret decision, HTTPS/origin configuration, authentication or abuse protection, shared quota accounting and operational monitoring. GitHub Pages cannot execute this server.

For the unchanged historical pipeline, run `VITE_ROUTING_MODE=legacy npm run dev`. There is no automatic ORS → Overpass fallback, extra endpoint, or background geolocation. Selection persistence is unchanged; route geometry is not persisted by the app.

## Current request and validation contract

Browser → `POST /api/loop` → server → `POST https://api.heigit.org/openrouteservice/v2/directions/cycling-regular/geojson` → score → accepted native geometry → GPX.

- Eight ordered circle legs: Start, seven circumference waypoints, same Start. Coordinates are longitude/latitude. Clockwise first; at most one counterclockwise repair for known unroutable/shape failures. No provider-error retry. First valid snapped Start is pinned across repair; it cannot move to rescue the circle fit.
- Cycling profile, recommended/shortest preference explicitly labeled in UI; ferries and steps avoided. These preferences are not identical to the old local quiet-road weights. Provider access/direction/turn semantics are relied upon, not independently audited against an OSM graph. Waypoint-turn/closing-turn behavior still needs real-provider fixtures; geometric closure alone does not prove a legal turn or safe ride.
- One plan: 20 seconds aggregate including optional 1.55-second repair wait; client cap 25 seconds. At most two provider requests; 1.5-second minimum request spacing, one in flight. Each response ≤8 MiB decoded, hence ≤16 MiB aggregate; ≤20,000 geometry points each. Geometry scoring caps 30,000 chunks and two million overlap comparisons. Request body ≤16 KiB; slow incoming request cap 10 seconds. No unbounded search or fan-out.
- Provider HTTP/network/parse failures establish ≥30-second cooldown; numeric/date Retry-After can extend it. An error body failure cannot erase the original HTTP status or Retry-After. Quota/auth/server failures are `unavailable`, distinct from known unrouteable waypoints and `shape-tolerance` failures. Attempts and actual provider sends are separate counters.
- Require ordered waypoint indices, each snap ≤300 m, native closure within 0.1 m (no appended closing line), accepted Start preserved within 1 m, geometry/native distance agreement within max(10 m, 1%). Compare actual distance against selected variation, roundness ≥0.3, mean normalized radial error ≤0.2 + variation/2, angular coverage ≥28/32 sectors, winding magnitude 0.85–1.15, geometric retrace ≤20%.
- Retrace measures overlapping collinear geometry within 1 m, including reversed/differently segmented pieces. It is not a claim of exact road-edge identity. Bridges/crossings or generalization can affect that approximation.
- Paved-only requires full segment surface coverage with known paved codes; unknown/unpaved segments fail honestly. Mixed allows unknowns and reports the fraction.
- GPX uses the exact accepted point sequence, serialized to the app's existing seven-decimal coordinate precision, with HeiGIT/ORS/OSM attribution and CC BY-SA 4.0 metadata. No synthetic closure, elevation or turn instructions. Start snap distance and actual distance/radial deviation are shown.
- Cancellation aborts the HTTP/provider request; generation IDs reject stale browser results. Late/noncooperative provider completion is discarded after the plan deadline. Owned local test servers are closed after tests.

Official API references: [return formats](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/requests-and-return-types), [routing options](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options), [surface codes](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/extra-info/surface). Provider endpoint migration: [HeiGIT announcement](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912).

Parent-thread official-source research verified free Standard at 2,000 Directions/day and 40/minute and result licensing as CC BY-SA 4.0: [plans](https://account.heigit.org/info/plans), [terms](https://account.heigit.org/info/tos). These are documented quotas/terms, not measured service availability. Attribution/share-alike obligations apply to reused exported results. Do not send user identity/client IP; a backend does not anonymize precise route coordinates. Current comparison uses a deliberately supplied public intersection, not device location.

## Why the old failures differ

`src/routing/overpass.ts` sends one bounded initial corridor query, optionally a second union/patch query after a safe connectivity failure, to the single public Overpass endpoint. Query timeout25 s; client45 s/request within total90 s; 32 MiB/200k-element aggregate budgets; polite cooldown/Retry-After. Ring snapshots are not complete disks. A prepared browser graph then applies coverage, access, surface, direction, barriers and supported turns, and nearest-first/joint fallback searches that same graph. No candidate multiplies remote requests.

1. Non-array/missing `elements` or nonempty Overpass `remark` means incomplete server data. It is rejected before cache/search even with HTTP200 and some roads. Runtime timeout/memory remarks are now identified. Invalid/truncated JSON and missing selected-way node geometry fail separately.
2. Client deadline means the map service took too long. HTTP502 may instead explicitly report workers busy/queue full; prior captured default evidence established that rejection, but does not establish every reported failure has the same cause.
3. Structurally complete raw data can still yield no usable network: selected whole-way geometry may cross the unqueried center hole or outer boundary and be excluded; cycling/access/surface/direction filters can remove more. The graph's fewer-than-three-used-nodes check then fails before search. This is not proof there are no roads in the region. The error now distinguishes no returned road ways from too little remaining usable geometry.
4. A narrow correctness gap was fixed: malformed coordinates/relation structures could previously be silently filtered into a tiny or empty graph. Structural validation now rejects those before cache/search. Valid empty data remains a distinct possible response, not automatically labeled corruption. Referenced relation ways outside the selection are not falsely treated as missing data.
5. Cached coverage proves the bounded query footprint was downloaded, not that OSM is globally complete or that a returnable cycling loop exists. Failed/incomplete responses never enter the reusable cache. No bounds or tolerance were loosened in this patch.

Previously measured 39 s +35 s sequential network stages dwarf local search (~0.25 s on this Mac). This motivates prepared graphs, but is not an ORS speed comparison. Removing corridor ingestion reduces topology-boundary failure modes; it cannot guarantee good circle-shaped routes where the road network does not permit them.

## Los Angeles reproduction and next experiment

Requested area: Washington Boulevard / South La Cienega Boulevard, radius about1.5 km. Photon returned unrelated street centroids/station rather than the intersection, so none were used as a supposedly verified pin. One small named-road intersection lookup used timeout10 s/maxsize1 MiB within an approximately1.8 km² bbox; the diagnostic client timed out at15 s with zero response bytes. No retry, full1.5 km corridor query, alternate endpoint or large query followed. Exact pin remains unresolved; provider-side outcome of that timed-out lookup is unknown. Existing saved Vancouver fixtures are not geographically comparable.

Once secure key setup and an accurate pin are approved/available, run **one** ordinary ORS plan for that public intersection, record attempt/send counts, elapsed time, status, actual geometry/shape/snap/surface metrics and faithful GPX, then compare to existing source-derived failure mechanisms. Do not claim mock performance as vendor performance. A bounded reverse direction is included in the plan budget, not an additional retry allowance. Actual iPhone Safari remains an independent test requirement.

## Recommendation

Try managed ORS first: small replaceable adapter, no per-circle raw OSM ingestion, explicit exported-result license, free quota suitable for a personal prototype. Current local contracts pass; coverage, routing semantics and circle quality await real results. Keep ordered circle waypoints rather than claiming native random round-trip generation obeys the drawn circle. If quality is insufficient, next evaluate a regional self-hosted GraphHopper graph from a versioned extract, accepting graph updates/storage/server operations. Local synthetic GraphHopper evidence does not prove Los Angeles coverage. Standard Mapbox Navigation results currently prohibit export/download/cache/store in its product terms, so it is not selected for this GPX app absent separate permission. No managed-provider account or hosting choice has been made on the user's behalf.

## UI and validation evidence

Generate/Settings precede variation/radius on mobile; desktop Generate also precedes the size fields. Radius uses `enterKeyHint=done` as an advisory hint plus visible accessible **Done**/**Cancel** controls, independent of native keyboard layout. Valid Enter/blur commits, Escape/Cancel restores committed value, and first ordinary outside tap only finishes editing. Intentional handle drag synchronously commits a valid draft or discards invalid/empty text before taking the gesture snapshot. Center drag preserves radius; size drag updates it. Resize/rotation retains committed selection. iOS software keyboard behavior has not been tested on hardware.

Tests intercept all external routing/map requests with explicit synthetic/saved fixtures; an additional browser check exercises the actual Vite → loopback API path with no key and confirms zero provider sends. Browser screenshots `/tmp/great-circle-ors-{desktop,phone}.png` and `/tmp/great-circle-radius-edit-phone.png` are local evidence, not uploaded attachments and not real routed geography.

Commands: `npm run typecheck`, `npm test`, `npm run build`, legacy `npm run test:browser`, and prepared-graph `npx playwright test --config playwright.ors.config.ts` (set the existing Chromium executable path if required). No large installs or performance benchmarks are involved.

Executed checks on this revision: typecheck and production build passed; 116 unit/contract tests passed; legacy Chromium 80 passed/8 platform-specific skips; prepared-graph Chromium 13 passed/1 touch-only desktop skip. Desktop and phone-width fixture screenshots were visually inspected. No actual iOS Safari or live ORS route was tested. Process inventory via `ps` was denied by the local sandbox (operation not permitted); it was not retried or bypassed. Playwright returned after its normal owned-server/browser teardown and unit HTTP servers close in `finally`; no persistent API server remains. Functional health checks after teardown returned ECONNREFUSED on owned ports4179,4180 and8787.
