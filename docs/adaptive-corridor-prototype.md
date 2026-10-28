# Adaptive corridor prototype (local, 2026-10-28)

This revision is not published. It retains the earlier local efficiency and map-control work. The current editable and generatable circle radius is **0.5–10 km**, replacing the earlier 100 km planning-only limit. A 10 km radius implies a nominal 62.83 km route; it is not a 10 km diameter or route-length limit. No maximum-radius public query was made.

## Retrieval and known coverage

The existing Overpass endpoint receives a buffered **closed polyline**, not outer-minus-inner way subtraction. The ring uses 96 segments (97 coordinates including closure), rounded to six decimals. Query half-width is `ceil(max(350, 0.06 × radius + 150)) + 25` meters. The extra 25 m is excluded from usable routing coverage. Route variation remains the existing total-distance acceptance tolerance (10–30%), independently of corridor width.

The query selects permitted highway classes, every geometry node of selected ways, and associated turn-restriction relations. Full selected ways are retained in raw data, including crossings; the graph only admits adjacent original-node segments whose **entire geometry lies within known coverage**. No synthetic boundary connections or GPX points are created. Existing bicycle direction/access/barrier/surface/turn handling and candidate acceptance remain intact. Unsupported restrictions remain conservative. Geometry extending outside coverage is unknown, not proof that no road exists there. Date-line-crossing buffers and unsupported latitudes are rejected.

When search identifies clipped connections, one expansion may add up to two localized 1,025 m query disks (1,000 m usable). Their centers come from actual clipped-road frontiers, with spacing and distance bounds. The second request re-queries the complete ring-plus-patches union, replacing the first snapshot; it does not merge roads from inconsistent snapshots. Ordinary objective failures, empty data and provider errors do not trigger arbitrary widening. Sparse networks, bridges or detours outside these small patches may still fail even when a broader disk could find a loop. This is a bounded heuristic, not complete adaptive routing or global optimization.

Cache records carry explicit discriminated disk/corridor coverage and original timestamps. A corridor may satisfy the same ring with compatible width/known patches; it cannot satisfy an interior disk or shifted ring. A genuinely complete disk may cover a corridor. The solver independently verifies requested scope against source coverage. Raw-data cache remains three entries / 24 MiB / 15 minutes; prepared graphs remain bounded and keyed by settings plus coverage. Cancellation terminates active worker work; stale replies cannot restore an old route/export.

## Aggregate limits

- Two issued requests maximum per generation: initial plus at most one consolidated expansion. Cache hits consume no request, byte or element allowance.
- **90 seconds for the entire generation**, including cooldown waits, both downloads, parsing, worker preparation and searches. Deadline aborts the loader/worker. Synchronous main-thread parsing can delay timer delivery; this is not a hard real-time guarantee.
- 32 MiB aggregate decoded response-body bytes. Every streamed chunk counts, including duplicate content in the full second response and failed attempts. Crossing the limit cancels reading; one received chunk can cross the threshold. This is not a measurement or strict bound on compressed wire traffic or server work.
- 200,000 aggregate parsed elements, counting duplicates in both responses and elements in partial/remark responses. Malformed JSON cannot yield a parsed element count but its received bytes still count. Incomplete geometry and Overpass remarks are rejected before caching.
- 25-second Overpass timeout and 32 MiB server memory request; each client fetch is capped at 45 seconds or remaining aggregate time, whichever is less. Query text ≤16,000 characters, geometry vertices ≤128, at most two patches, conservative geometric cost proxy ≤110 km². The legacy disk path retains its 6 km padded search guard.
- New requests observe the existing 30-second cooldown. Every issued failure now starts a full cooldown after failure; a longer HTTP Retry-After is respected. The one explicit expansion may wait within the same 90-second budget. Provider failures stop without endpoint rotation or retry. Throttling is per page/module, not a cross-tab or IP-wide quota.

These local bounds do not prove cheap server evaluation. Buffered-polyline spatial selection, full crossing ways, relation lookup, density and concurrent public load can dominate cost. Smaller returned data does not establish faster network or server CPU. Public service guidance still applies; scaled use needs a deliberate provider/infrastructure decision.

## Offline comparison

Synthetic complete-way server fixtures compare selected elements, compact JSON bytes and admitted graph work. These are deterministic data/quality comparisons, **not measured Overpass CPU or network speedups**.

| Fixture / coverage | Elements | JSON bytes | Graph nodes / directed edges | Result |
|---|---:|---:|---:|---|
| Dense grid, disk | 1,241 | 107,603 | 365 / 1,376 | 14.500 km, 15.39% error, 0.616 roundness, 59 points |
| Dense grid, initial corridor | 624 | 53,681 | 140 / 432 | Identical accepted route/GPX; one request |
| Sparse tree, disk | 113 | 8,884 | 55 / 108 | No loop |
| Sparse tree, initial corridor | 34 | 2,656 | 14 / 24 | Coverage gap; bounded planner still finds no loop |
| Bridge detour, disk | 118 | 9,766 | 59 / 118 | 13.626 km, 8.43% error, 0.896 roundness, 60 points |
| Bridge detour, initial corridor | 117 | 9,672 | 57 / 112 | Missing connection |
| Bridge detour, expanded corridor | 118 | 9,766 | 59 / 118 | Exact disk-baseline route and GPX recovered |

Bridge expansion costs **two full responses totaling 19,438 JSON bytes**, almost twice the disk baseline. Dense-grid savings are promising but not universal. Crossing-way, interior-chord, restriction, sparse-network, boundary/cache-completeness, cancellation, worker-recovery, failure-cooldown, aggregate-budget and 10 km UI cases have deterministic coverage. Existing offline timing results in routing-efficiency-local.md predate this corridor revision and are not corridor benchmarks.

## Bounded actual Vancouver observation

Generic public coordinates 49.289, −123.128; radius 500 m, start south, ±30% variation. No device location was requested. Exactly **two real POSTs** were sent to the existing endpoint across two stages, with normal browser-controlled identity and localhost origin; fixture tiles avoided map-tile requests.

1. Initial corridor: HTTP 200, CORS `*`, 8,478 elements, no incomplete-data remark; query cost proxy 2,797,528 m² / 97 vertices. It exposed a real coverage gap. The one-request harness prevented the attempted expansion locally before sending it. This was a harness boundary, not provider refusal or an approval denial.
2. The authorized follow-up replayed that still-fresh initial snapshot (605 seconds old, under cache TTL), observed the normal cooldown, and sent one real consolidated expansion: HTTP 200, CORS `*`, 13,875 elements, no remark; proxy 9,398,800 m² / 99 vertices. No third request, fallback endpoint or maximum-area query was used.

**No acceptable live route or GPX resulted.** The closest closed candidate was 86% from target, outside the selected 30% tolerance, and was rejected. The solver is intentionally not relaxed to manufacture a successful live result. The second response replaced the first, preserving distinct snapshots. Both frozen responses are in tests/data with attribution and hashes. Offline replay counts 22,353 elements and 3,018,641 normalized compact JSON bytes including duplicates; these fixture bytes are not original wire-transfer measurements. Runtime streamed-byte limits were enforced; exact original transfer-byte totals were not persisted.

The live check exposed an incorrect status label that called solver rejection a download failure. It now reports **No loop found.** while retaining the actionable reason and withholding GPX. Deterministic desktop/mobile replay verifies the corrected final UI without more public requests. Download, search and aggregate-deadline failures now have distinct status handling.

## Verification and artifacts

Run `npm test`, `npm run build` (includes typecheck), and `npm run test:browser`. The serial browser suite uses synthetic or frozen public-data responses and labeled offline tiles; it does not contact routing/search/location services. The opt-in browser live script is bounded separately: by default one request, or one real expansion when explicitly given a fresh saved initial response. It exits unsuccessfully when no validated GPX is produced, even if HTTP succeeded.

The first prototype verification passed: 62 deterministic tests across 11 files, the typechecked production build, and 45 desktop/phone browser cases (seven non-applicable desktop copies intentionally skipped). All four final success/no-loop desktop/mobile screenshots were visually inspected. Browser checks completed in 44.4 seconds; no performance benchmark was run. Local screenshots: `/tmp/great-circle-corridor-{desktop,mobile}.png` show the synthetic bridge success; `/tmp/great-circle-corridor-actual-replay-{desktop,mobile}.png` now show the recovered actual-data offline replay after the follow-up below. No screenshots were uploaded and no push/deployment occurred.

Primary references: [Overpass buffered around syntax](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL#Around_(around)); [public instance resource/cooldown guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html). Data © OpenStreetMap contributors, ODbL. Inspect current access and conditions before riding.

## Offline diagnosis and minimal anchor fallback

The 86%-off-target live observation above is preserved as the original result. No additional provider request was made for diagnosis or this fix. The same captured snapshots and an existing older disk fixture were replayed locally.

- Initial corridor: 2,110 admitted nodes / 4,065 directed edges; core 1,515 / 2,971; snapped returnable component 1,466 / 2,919. Start snaps 6.37 m to node 5697946446 (Stovold Lane). The original six fixed anchor candidates cannot complete all legs.
- Expanded corridor: 3,716 admitted nodes / 6,962 edges; core 2,917 / 5,552; returnable component 2,683 / 5,275. All six original candidates close, but their lengths are 6,453.520, 8,344.631, 5,857.951, 7,887.849, 6,067.305 and 7,079.407 m. The shortest is 86.46% above the 3,141.593 m target and has roundness only 0.187.
- Removing corridor clipping **for diagnosis only**, using the same captured expanded data within the existing padded disk, produces the same six lengths. This is not proof that this data completely covers a disk and is never used as such in production.
- The available 2026-10-25 disk snapshot has exactly the same selected center (49.289, −123.128), with the original 1 km disk / 50 m query guard, but a different acquisition date and footprint from the corridor. Under identical 500 m circle/start/preferences it produces the same six original candidate lengths and failure. This geographic comparison is not a simultaneous equivalent-query or server-performance comparison. No new disk was fetched.

**Cause narrowed and reproduced:** the solver chooses just one geographically nearest node for each angular sector, without testing alternative topology. Valid degree-two geometry points on Seawall and alley sections become compulsory visits, coupling incoming direction/turn state to long detours. Returnable-component membership alone does not make those anchors a good circular route. This behavior predates corridor retrieval. Changing coverage enforcement or relaxing access/tolerance is not necessary to fix this case.

**Minimal local correction:** after all six original explicit-circle candidates fail acceptance, try the same radii/directions/sectors using nodes with at least three distinct outgoing neighbors as alternative anchors. This adds at most six candidates, sharing the original 14-second / 1.8-million-state search budget and 90-second generation deadline. Successful original candidates retain their exact route/GPX and never enter the fallback. Legacy free-start search remains unchanged. A missing initial connection still permits the one existing bounded expansion, even when an alternative candidate closes but fails quality. No provider, coverage, access, turn, objective or acceptance threshold changes were made.

On the captured expanded snapshot the fallback produces **3,729.644 m**, **18.718% distance error**, **0.396073 roundness**, **0.977% repeated length**, **197 GPX points**, and **6.37 m snap**. The entire route, every directed edge, each supported turn including the closing seam, and exported point count are checked. Six segments totaling 146.635 m lie outside initial usable ring coverage; all lie inside the existing expanded union. Thus initial retrieval does remove useful connections, but expansion targets are sufficient in this case; the final failure was the restricted anchor choice, not overly strict final coverage. The saved query patch centers remain unchanged at (49.289824, −123.126263) and (49.288765, −123.117445).

The failed fixtures are unchanged. A regression explicitly reconstructs and retains the original 86.464% failure on both expanded and older disk data, alongside the corrected planner/GPX result. Final checks after the fix: **63 deterministic tests**, typechecked production build, **45 desktop/mobile browser cases passed**, seven intentional skips. Browser QA uses frozen responses and normal cancellation/cooldown logic; recovered-route screenshots were inspected. This is **offline recovery from actual saved data**, not a new live route/export validation. No public requests, benchmarks, uploads, pushes or deployments occurred in this follow-up. Junction alternatives remain a bounded heuristic and do not guarantee finding every plausible cycle.
