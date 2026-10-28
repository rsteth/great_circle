# Local worker cost and real GraphHopper experiment

Follow-up to `4224a98988faba105156fae3bcf9f7638d290a03`, after explicit approval for bounded Java-only setup and measurements. Local-only: no application defaults changed, push or publication. Main remains `b918255`; error patch `1568c555` is preserved in this feature lineage.

## What the local search actually costs

**A brief CPU burst, not a continuous 18% versus 1% utilization.** On this Apple M5 Mac (10 logical CPUs, 32 GiB RAM, macOS26.6.2), the identical known expanded Vancouver graph produced:

| Mode | Nearest | Joint |
| --- | --- | --- |
| Node cold worker: graph+solve thread CPU, median | 67.1 ms | 306.4 ms |
| Node warm worker: graph+solve thread CPU, median | 25.1 ms | 270.0 ms |
| Chromium cold worker/graph: total walltime, median [range] | 67.4 [66.9–69.1] ms | 272.4 [272.0–277.3] ms |
| Chromium warm worker/cached graph: total walltime, median [range] | 23.3 [21.7–26.3] ms | 222.2 [217.6–223.6] ms |
| Chromium warm search portion only, median | 20.6 ms | 219.5 ms |
| Search expansions | 64,878 | 1,149,961 |

Both Node solver threads used close to one core while active; joint used about10.7x warm solver CPU time in this case, despite17.7x expansions. This does not measure whole-machine utilization, phone CPU or battery consumption. Node thread CPU and browser walltime are different measurements; do not divide one runtime's CPU values by another runtime's walltime. Node process-wide CPU, including compiler/other runtime threads and parent activity, is separately recorded in the JSON.

Protocol: **12 measured samples per runtime**, three per nearest/joint × cold/warm mode, with strategy order alternated by round. Two retained workers each had one excluded warmup. Cold means a new worker and graph; warm retains the same worker, dataset and prepared graph. No provider requests, downloads, Java imports or other project validation overlapped these samples. Preflight did observe an unrelated macOS Virtualization process at15.7% CPU; this is not an idle-OS laboratory benchmark. Use medians/ranges with n=3, not an asserted p95. Node25.9.0 uses `process.threadCpuUsage()` for graph+solve user/system CPU; Chromium147.0.7727.15 runs the actual app SearchClient/worker through a loopback Vite server. Source and dataset match the feature commit; graph coverage is the exact captured baseline expansion, not the joint-proposed new footprint.

Quality/GPX remained deterministic across samples: nearest3,729.644m/18.718% error/0.3961 roundness/0.977% repetition/197points; joint3,690.371m/17.468%/0.4061/0.522%/192points. Both preserve snapped node5697946446, valid closure, restrictions and exact per-strategy GPX hash.

Browser RAF continued during all samples: maximum observed inter-frame gap18.4ms, no observed main-thread long task >=50ms within a measured search window. Joint cancellation was requested after24.8ms; its promise rejected with AbortError3.8ms later, then a fresh nearest search succeeded in75.6ms. Promise rejection latency is not a precise measurement of when the underlying worker CPU stopped. These are isolated desktop Chromium observations, not physical iPhone/Safari or touch-latency measurements.

Memory: exact current-isolate heapUsed readings before/after solve are recorded, but they are **not peak or retained memory**; GC makes some deltas negative. Largest sampled post-solve heaps were40.5MiB nearest and45.3MiB joint. There is no reliable per-worker peak allocation/phone-memory measurement here.

Evidence: [local-worker-cost.json](local-worker-cost.json). Exact executed harnesses/logs remain in `/tmp/great-circle-worker-cost/{worker.ts,run.mjs,browser.mts,node-results.json,browser-results.json}`. They are local experimental harnesses, not an automated install or production benchmark command.

## Real Java-only engine setup

Verified GraphHopper11.1 from the project's [official installation route](https://github.com/graphhopper/graphhopper/tree/11.x#installation). Its exact JAR URL on Maven Central responded200 after the earlier directory-listing request had returned403. No alternate mirror, authentication workaround or Docker access was used.

- Download47,331,301bytes (45.1MiB); official SHA-256 metadata and downloaded artifact both `8462f758d9ea49edaded557cec5c687a0a24f004ec371cd4daaeb0534824ea33`.
- Three artifact HTTP requests: HEAD, SHA-256 metadata GET, JAR GET. No hosted routing, Overpass, real-map, geolocation or elevation requests.
- Existing Java25.0.2. `-Xms64m -Xmx512m -XX:ActiveProcessorCount=1`; one import/subnetwork worker. No CH/LM preparation, elevation or external data.
- App/admin bound only to127.0.0.1 ports8989/8990, checked free first. One owned JVM at a time; imports capped60seconds; server watchdog120seconds, staging/RSS monitored. JVM processor-count flag is not an OS affinity lock; JVM compiler/runtime threads can contribute process CPU beyond one thread's elapsed time.
- Bounded synthetic imports took0.55–0.68seconds each. Final server startups were under one second. Highest final-batch JVM maximum RSS166.1MiB; dedicated staging100,146,610bytes (~95.5MiB) after logs/caches/results, under1GiB. All owned JVMs and the benchmark Vite server stopped; ports8989/8990/4187 confirmed no listeners. Dedicated files retained, no user files removed.

Existing generated fixtures were converted to self-contained OSM XML, with full node/way/restriction references, then bounded to the same known road graph the app uses. Grid97nodes/172ways; ring64/64; bridge59/59; directed ring64/64; restriction adds one explicit bicycle turn relation; access adds a private chord to test native access handling. No new map download. Saved Vancouver files were deliberately **not** imported: some restriction relations reference absent boundary ways and require a separate audit before an equivalent engine comparison.

One strict bicycle profile enforces directional bike_access, blocks private/destination/no/dismount/use-sidepath cases, retains bicycle turn costs, disables walking against one-way roads, and uses existing path/work/time ceilings. All positive fixtures have paved cycleways; broad real-world style/surface/tag parity remains unverified. A targeted private chord was avoided and a bicycle-only forbidden turn rejected. Default GraphHopper bicycle behavior was not assumed identical to the app.

## Real engine results

Target approximately6.283km at1km radius. Final batch: **24 ordinary local route calls** (six fixtures × two arms × first/immediate-repeat), plus **three labeled diagnostics** (reverse waypoint order, private access, bicycle restriction). First-call is first per arm in a loaded server; round-trip follows ordered routing, so it is not a separately cold JVM. One seeded round-trip setting (seed0, four points), no seed sweep or success-driven retries. All responses/details retained.

| Fixture | Ordered clockwise circle waypoints | Seeded round trip |
| --- | --- | --- |
| Bounded grid | ~8.000km,27.32% error, includes turnaround; rejected by distance and immediate-backtracking policy | ~7.000km,11.41% error, roundness0.433, zero repetition; accepted |
| Ring | ~6.281km,0.04% error, zero repetition; accepted | Same circle, accepted |
| Bridge detour | ~6.813km,8.43% error, zero repetition; accepted | Same detour, accepted |
| Directed ring | ~43.965km, repeated laps; rejected | ~18.842km, about66.6% repeated length; rejected |
| Bicycle restriction | HTTP400 no connection | HTTP400 no connection; correct negative outcome |
| Private chord | Ring route, private chord avoided; accepted | Ring route, private chord avoided; accepted |

**Direction matters:** one separately recorded reverse-order waypoint diagnostic on the directed ring gives a valid6.281km loop. This was not silently substituted for the fixed clockwise arm or counted as a second independent fixture. Native turn-control routing also rejects traversal across the forbidden bicycle turn, while the unrestricted directed ring can traverse it. Private-access control returns the ~3.140km permitted half-ring, not the2km private chord.

Ordered first-call latency was51–60ms across final fixtures; immediate repeats5.0–7.1ms except the restricted negative case6.9ms. Seeded round-trip first calls4.3–5.9ms, repeats3.1–4.2ms. These are tiny pre-imported synthetic graphs, two calls per arm, not statistically powered performance results, not directly paired with the larger saved Vancouver graph, and **not end-to-end public data retrieval latency**. Setup/import/loading costs are separate in the JSON.

HTTP200 is not accepted as sufficient. The native harness checks every detailed segment against an allowed directed original OSM edge using native OSM way IDs and <=0.3m coordinate-rounding tolerance. It checks continuity, edge direction, supported turns, immediate-backtracking policy, closing seam, original pinned Start/end, waypoint order/snapping, distance consistency, selected distance tolerance, roundness, overlap-based repetition and radial deviation. Native virtual snap points and full returned geometry are retained; accepted GPX serializes that native geometry. A native turnaround can be legal under OSM yet rejected by the app's circular-loop policy; the grid rejection is not a blanket allegation of illegal provider routing.

Setup corrections are preserved, not hidden: the initial custom profile incorrectly blocked untagged roads (`BikeRoadAccess.MISSING`), then was corrected before comparison. Initial high-precision circle waypoints fell less than1mm outside the engine's seven-decimal synthetic bounds; the final harness rounds requests to seven decimal degrees (<=1cm normalization). The first batch and two setup probes remain alongside the final batch; no tolerance/access rule was loosened to claim success. Earlier26local requests plus2setup probes are not part of the final27-call comparison.

Evidence: [local-graphhopper-results.json](local-graphhopper-results.json). Raw configs, XML, import/server resource metrics, native request/response JSON, validation harness and accepted GPX remain in `/tmp/great-circle-gh11-local/`. No Docker socket retry, account, credential, paid service, production backend or deployment was introduced.

## Implications

Joint search adds a modest few hundred milliseconds on this desktop example, while the previously observed public map downloads took tens of seconds. It is reasonable to consider its quality gain against that small local cost, but phone/large-area behavior and its proposed new expansion remain unmeasured. Do not claim a general CPU percentage, battery impact or universal quality improvement.

A real pre-imported engine is promising for quick road routing and round trips. It still needs a strategy for waypoint direction/placement, strict output validation, data coverage and profile parity. The JVM running on this Mac cannot serve users of a static GitHub Pages app on their phones without a separate backend/hosting decision. This experiment did not authorize or implement that infrastructure, integrate GraphHopper into the app, switch defaults or publish the feature branch.
