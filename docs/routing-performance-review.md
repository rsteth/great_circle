# Routing requests and performance — source review, 27 October 2026

## Current request flow

Generate makes one manual POST to `https://overpass-api.de/api/interpreter`, asking for OSM highway ways, every geometry node and associated turn restrictions in the selected padded area. Overpass supplies raw map data, not directions. The browser parses it and sends the raw dataset to a new Web Worker. The worker builds a directed cycling graph, prunes physical dead ends, restricts anchors to the start's returnable component and compares six circle candidates (three radius fits, both directions). Each uses eight angular anchors joined by turn-aware Dijkstra: up to 48 shortest-path searches. A valid result preserves every traversed node for closed GPX export. The worker is terminated after success/error.

One exact query is cached in memory for 15 minutes. Changing start angle, tolerance or preferences within that exact downloaded area makes **zero further map-data requests**, but still clones the data, rebuilds the graph and solves again. Radius/center changes miss the cache, including shrinking inside previously downloaded coverage. A → B → A downloads A again. Map tiles are separate normal OSM requests. Generation is manual and single-flight; there are no retries, failovers or speculative downloads. New queries have a 30-second minimum interval, extended by HTTP Retry-After. The client bounds downloads at 32 MiB/45 seconds; the server query requests 25 seconds. Cancel aborts the fetch or terminates the worker immediately.

## Bottlenecks and suggested priorities

These are **source-derived**, not newly benchmarked. No performance benchmark ran during this UI work, so there is no measured speedup claim.

1. **Instrument the stages first:** distinguish queue/download, decode/JSON parse, transfer, graph construction and candidate search. Public Overpass latency varies independently of local search. Larger selected radii increase requested area quadratically.
2. **Reuse downloaded coverage:** keep a small bounded cache of areas and reuse a containing dataset when shrinking or moving inside it. Continue clipping graph nodes/edges to the requested area and preserving restriction data. This avoids unnecessary public-service calls; it must not omit crossing ways or restrictions when deciding coverage.
3. **Reuse prepared graph state in a persistent worker:** cache by dataset + access/preferences, instead of structured-cloning raw OSM and building the graph on every generate. Preserve instant cancellation using cooperatively chunked work/request IDs or a terminate-and-recreate fallback; do not trade responsiveness for caching.
4. **Reduce repeated search work:** preproject nodes, index anchor sectors and precompute radial costs per circle. Current anchor selection repeatedly scans nodes; Dijkstra repeats projection/distance work and allocates string state keys. Indexed IDs and reusable buffers are plausible improvements, guarded by directional/turn/closing-seam fixtures.

Historical evidence only: the earlier 1 km Vancouver check used 12,148 elements / 2,150,647 bytes and reported approximately 141 ms for solving plus edge validation, producing a 3.264 km, 199-point loop. That is one tiny fixture and says little about dense/large areas or live network latency. It was not repeated here; Ant World timing was not used to claim any result.

## Search choice, separate from routing

Overpass remains unchanged. New manual place search uses the public [Photon API](https://photon.komoot.io/) maintained by komoot. Its official page permits reasonable project usage, warns of throttling/bans for extensive usage and gives no availability guarantee. This app sends only submitted text and a five-result limit, no device coordinates or map-center bias. It never autocompletes on keystrokes, conservatively limits uncached requests to one per second, caches up to 20 queries for 15 minutes, respects Retry-After on 429/503, bounds time/response size and supports cancellation/stale-response suppression. Set `VITE_PLACE_SEARCH_URL` at build time to use a separately selected compatible Photon service. No account/key or paid service is introduced. Tests mock search. A subsequent single Paris query from the local production app returned HTTP 200, five features and CORS `*`; see [readiness evidence](search-readiness.md). Published-origin deployment is still pending and unverified.

Public Nominatim was deliberately not auto-integrated: its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) prohibits autocomplete and imposes additional requirements on generic LLM-created integrations and switching services. No endpoint swapping or access-denial evasion occurred.

Locate me invokes the browser location API only after an explicit click; cancellation ignores late callbacks. Permission denial is actionable. Coordinates remain local until normal map viewing / a manual route request; searching a place never sends device coordinates. Tests use invented/static coordinates, not the user's actual position.

Primary sources: [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL), [Overpass shared-instance guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html), [Photon official implementation/API](https://github.com/komoot/photon), [Photon public service](https://photon.komoot.io/).
