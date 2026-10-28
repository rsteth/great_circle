# Local routing strategy comparison

Local only, based on published `b918255` plus the unpublished HTTP-error patch `1568c555`. Neither main nor the remote is changed. No provider requests, accounts, credentials, installations or deployments were used in this comparison. The app still defaults to nearest-anchor search and corridor coverage.

## Run and select independently

`npm run dev` in this checkout, then use:

- `/`: nearest + corridor baseline.
- `/?routeSearch=joint`: joint anchor search + corridor.
- `/?roadCoverage=hybrid-small`: nearest + explicitly fetched small disk.
- `/?routeSearch=joint&roadCoverage=hybrid-small`: joint + small disk.

These are experimental URL switches, not saved user preferences. Normal Generate uses the existing public provider if it lacks cached data; **do not use Generate for a no-network comparison**. The tests and `./node_modules/.bin/tsx scripts/compare-strategies.mts` use saved/synthetic data only. The script writes `docs/local-strategy-comparison.json`.

## Implemented arms

Joint search considers up to four geographically diverse candidates per angular sector, including a junction candidate, with a four-state beam and up to two incoming headings per candidate. Every state retains its incoming edge, first edge, entire traversed path, selected anchors and repeated physical segments. Dijkstra enforces supported turns between legs and the closing seam. Node returnability alone is not treated as turn legality. Start is snapped once per search, then fixed for all candidates; when an initial search identifies that node before a coverage gap, the worker/plan preserve its ID across the bounded expansion. An unavailable pinned node fails explicitly rather than silently snapping elsewhere. If an incomplete initial graph has no returnable Start, snapping happens only after expansion. Existing 300 m snapping limit remains.

The target circle is unchanged. Routes still must close at snapped Start, meet the selected distance tolerance, roundness >=0.3 and repeated length <=20%. Both directions and the same three reference radii are tested. Beam pruning is heuristic: it can discard an eventual good route and is not a complete or optimal search. The existing **per-search** 1.8 million expansion / 14-second bounds remain; at most two searches fit inside the existing overall 90-second planning budget. SearchLimit can return only an already completed acceptable loop. Cancellation still terminates worker work.

`hybrid-small` requests one complete disk only for an explicit target circle radius <=1,000 m. It uses the existing padded search boundary (minimum 1,000 m, otherwise 1.35 x radius), with the existing 50 m query pad: at most a **1,400 m query radius (~6.16 km²)**. Over-padded injected settings fail. Above 1 km the strategy remains the current corridor; no automatic large-disk fallback. Disk failures do not expand. Existing 32 MiB / 200,000-element / 90-second aggregate limits, 25-second server timeout, cooldown, HTTP backoff, cache TTL/capacity, turn/access rules and request limit remain. A disk is fetched explicitly; an annular cached response cannot satisfy it. Complete selected-way geometry/restrictions and preference-specific graph clipping are retained.

Route details now say the circle is a guide and report actual length plus min/max distance from the requested center and average absolute departure from the requested radius. Radial diagnostics sample original segments at <=25 m and include their nearest projected point to the center; they are approximate diagnostics, not a new circle-size guarantee. GPX retains all traversed original points.

## Findings

All synthetic arms use identical underlying OSM-like snapshots and selection semantics. Query/JSON counts are offline mock data-volume measures, not public server cost or latency. One cold diagnostic per arm is recorded; local walltimes were not isolated from other work and cannot establish speedup. No paired performance slot was held.

| Same-fixture case | Nearest | Joint | Coverage effect |
| --- | --- | --- | --- |
| Dense 1 km grid | Closest closed candidate 27% off; fails 20% tolerance | 6,500 m, 3.45% error, roundness 0.706, zero repetition | Both find the same joint route; corridor 304 elements/26,090 normalized JSON bytes, disk 345/29,707; one mock request each |
| 1 km river/bridge detour | 6,813 m, 8.43% error, roundness 0.896, zero repetition | Identical geometry | Both fit the existing corridor; 118 elements/9,747 normalized bytes, one request. Joint adds work without quality gain |
| Peninsula tree | No loop | No loop | Corridor exhausts two bounded mock stages; disk rejects in one |
| Roads disconnected from selected Start | Honest failure | Honest failure | No straight-line fallback |
| One-way ring | Valid legally directed loop | Same loop | Supported restriction forbidding closing seam makes joint fail in a separate regression |

On the **identical known expanded Vancouver graph** (500 m target, south Start, 30% tolerance):

| Search | Actual distance | Distance error | Roundness | Repeated | Path expansions |
| --- | --- | --- | --- | --- | --- |
| Nearest/junction fallback | 3,729.644 m | 18.718% | 0.3961 | 0.977% | 64,878 |
| Joint | 3,690.371 m | 17.468% | 0.4061 | 0.522% | 1,149,961 |

Both preserve snapped node 5697946446, legal full closure and all track geometry. Actual radius varies roughly 135–615 m, average departure ~130 m: neither is especially close to the drawn 500 m circle. The joint quality improvement is modest and costs about **17.7x path expansions on this fixed graph**. This argues against calling joint search a performance improvement or blindly making it the default.

**Saved adaptive replay limitation:** joint search requests a different second patch than the captured baseline download. The saved expanded response cannot be relabeled as complete coverage for that patch. The script stops that flow as **unmeasured** after the first snapshot and separately compares search on the identical known expanded graph. Source coverage checks and a regression enforce this distinction. No fresh request was made. The older 2026-10-25 disk at the same center produces the same baseline and joint routes under the same settings, but differs in date and footprint; it does not demonstrate a current one-request network speedup. The old larger default remains a bounded no-loop result on its two captured footprints; joint anchors cannot invent absent returnable roads.

The 25 m margin is unchanged. On the saved initial 500 m response, a diagnostic 10 m margin admits useful geometry excluded by 25 m, but this is not production-validated coverage. Tests retain whole-segment exclusion through the annular hole, boundary classification at 0°/±75° and 10 km circle radius, rounded query coordinates, and explicit rejection of non-25 m production margins. A complete small disk addresses the hole explicitly; globally lowering the margin is not recommended from this case.

## Ordered routing and dedicated round-trip arms

`src/routing/engineComparison.ts` adds **provider-neutral contracts, deterministic mock tests only**. There is no configured real provider and no network transport or user-facing engine selector. Ordered-waypoint requests preserve eight circle sectors in order plus identical pinned start/end; round-trip requests send pinned Start, target distance and fixed seed, without promising the drawn center. Both carry cycling preferences, one-call quota, deadline, byte and edge limits. Results must map every traversed edge back to the known fixture graph, preserving legal incoming turns and closing seam, pinned Start, distance tolerance, roundness, repetition and full GPX geometry. Unknown/unverifiable geometry is rejected. A future transport must enforce limits while streaming and translate full native geometry/edge identity; these contracts alone do not establish real-engine support or performance. Current ordered-waypoint verification uses nearby original track vertices (300 m bound), so a real transport needs detailed geometry rather than a simplified line. Hosted-engine profile semantics may differ; validate them against access/restriction fixtures before making claims.

Java 25.0.2 is available. No GraphHopper/Valhalla engine or OSM/PBF installation was found under Programs or on PATH. Docker CLI exists, but read-only image inventory failed with `permission denied` at `/Users/robinstethem/.docker/run/docker.sock`; its contents remain unverified. No socket permissions/security settings were changed and the command was not bypassed or retried. Existing authenticated GitHub repo context is not a routing-service API credential; no service account/key was created or inspected.

Official [GraphHopper 11.x setup](https://github.com/graphhopper/graphhopper/tree/11.x#installation) supports a standalone JVM server, and its [configuration](https://github.com/graphhopper/graphhopper/blob/11.x/config-example.yml) documents bicycle profiles, bicycle turn costs and visited-node limits. Its [round-trip source](https://github.com/graphhopper/graphhopper/blob/11.x/core/src/main/java/com/graphhopper/routing/RoundTripRouting.java) uses Start, target distance, seed, generated road snaps and bounded internal retries. This is approximate-distance generation, not a promise of the drawn center/shape. [ORS round-trip options](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options#options-round-trip) similarly describe preferred length, point count and seed. No hosted demo was used.

**Proposed next real-engine setup (pending approval, not installed):** pin released GraphHopper 11.1, verify artifact origin/hash, run only on localhost with Java already present, convert existing tiny saved/synthetic OSM data to XML (no new map download), configure one bicycle profile with explicit bicycle turn restrictions and no elevation/CH/LM preparation, preserve OSM-way identity/detailed geometry for validation. Proposed stop limits: <=200 MiB download, <=1 GiB staging/cache, 512 MiB JVM heap, one import worker, <=60 seconds import walltime, same 14-second/visited-node per-query limit and one request per arm. These are resource ceilings, not verified requirements; stop/report if exceeded. Installing this runtime/artifact and running its import needs the parent's resource decision first. Real engine quality/start-snapping/turn-state behavior remains **unmeasured**. The neutral mock tests do not substitute for it.

## Recommendation and validation

Keep defaults unchanged until reviewing these results. A small-disk-first policy is a credible next live experiment within the unchanged cost caps, but no current disk response or service-latency comparison was obtained. Joint selection is useful for some difficult networks but expensive; consider an explicit or failure-only fallback, with its budget/worker cancellation retained, rather than replacing every cheap successful nearest search. Test the real ordered and round-trip arms on a bounded local engine next; neither can yet be recommended on measured results. Do not publish this experimental revision without approval.

Executed: 94 unit tests pass, typecheck/build pass, 12 desktop/mobile Chromium browser cases pass using intercepted saved data. Browser checks cover independent URL switches, actual worker execution, one-request disk query, closed GPX, guide/deviation copy, mobile overflow, baseline fresh Generate, HTTP502/backoff, cancel/stale response, and existing independent handle gesture regression. Isolated Google Chrome for Testing was used; Robin's foreground Chrome was not touched. Actual iOS Safari and fresh provider success for these arms remain unverified. Screenshots: `/tmp/great-circle-comparison-{nearest,joint}-{desktop,mobile}.png` (local files only).
