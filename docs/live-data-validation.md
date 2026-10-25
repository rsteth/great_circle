# Live-data diagnosis and bounded validation

## What caused the initial failure

The request used a POST to `https://overpass-api.de/api/interpreter`, with a `URLSearchParams({data: query})` body. Its content type was `application/x-www-form-urlencoded;charset=UTF-8`; `data=` contained the correctly URL-encoded Overpass QL query. This matches the [official HTTP/encoding documentation](https://dev.overpass-api.de/command_line.html).

A diagnostic captured the actual wire request headers. The CLI's implicit User-Agent was simply `node`, with no Referer. The response was HTTP 406, `Server: nginx`, `Content-Type: text/html`, and a 156-byte generic “406 Not Acceptable” page. There was no query parser explanation or OSM data. The diagnostic did not show an intermediary/proxy refusal marker. A malformed Overpass query would normally return 400 with a parser explanation; quota/capacity errors are documented as 429/504.

The [provider's administrator policy](https://community.openstreetmap.org/t/overpass-api-performance-issues/140598/74) explicitly requires a well-identified custom User-Agent for scripts and a normal HTTP referrer for browsers. It disallows stock User-Agents, identity faking, rotation, and distributing requests across servers. The [updated cooldown policy](https://community.openstreetmap.org/t/overpass-api-performance-issues/140598/157) warns against repeated errors and requires at least 30 seconds before another request.

The same 1 km-area query, endpoint, method, encoding, and other explicit headers returned **HTTP 200** after setting the truthful CLI identity:

```
GreatCircle/0.1 (+https://github.com/rsteth/great_circle; local personal route planner)
```

This isolates client identification as the observed recoverable defect, consistent with the provider's policy. No alternate endpoint, forged browser identity/referrer, proxy, credentials, or network/security setting change was used. Requests were serial, with more than 30 seconds between the denied and corrected requests. The server returned actual Overpass JSON, generator `Overpass API 0.7.62.11 87bfad18`.

The code now lets CLI callers identify the app explicitly. Browser requests retain their real browser-provided Referer and do not supply the CLI User-Agent. New-area requests have a 30-second minimum cooldown. HTTP failures reset that pause from the time of the response and honor longer Retry-After values. There are no automatic retries.

## Actual-data result

One corrected request downloaded **2,150,647 bytes** containing **12,148 actual OSM elements**: 9,117 nodes, 2,823 ways, and 208 turn relations. Data timestamp: **2026-10-25T01:44:06Z**.

Settings:

- Area center and requested start: latitude 49.289, longitude −123.128 (Vancouver West End).
- Search radius: 1,000 m, with a 50 m query margin; routing stays inside 1,000 m.
- Target: 3 km; tolerance ±20%; mixed surfaces; quieter roads.

The first local solve exposed anchor selection on dead-end/non-returnable branches. The follow-up source fix prunes physical dead ends and limits anchors to nodes reachable from, and able to return to, the snapped start. This preserves the actual road geometry and direction/turn rules.

Solving the saved response after that fix produced:

| Metric | Result |
| --- | --- |
| Track distance | 3.264457950 km |
| Distance error | +8.8153% |
| Roundness | 61.7373 / 100 |
| Repeated sections | 0% |
| Geometry points | 199 |
| Start snap | 17.603 m |
| Closed candidates compared | 28 |
| Local solve plus edge validation | approximately 141 ms |

Validation checked identical start/end coordinates, an actual directed graph edge for every consecutive point, supported turn legality including the closing turn, and all points inside the selected area. The GPX was generated from these actual points. Approach roads with unsupported or conditional restrictions were excluded, as reported in the result. No further data request was needed for the local diagnosis and solve.

Local diagnostic artifacts (outside Git):

- `/tmp/great-circle-overpass-diagnostic.json`: denied stock-UA request/response.
- `/tmp/great-circle-overpass-identified.json`: identified request/response.
- `/tmp/great-circle-tiny-live-osm.json`: actual OSM response.
- `/tmp/great-circle-tiny-live-route.json`: solved route.
- `/tmp/great-circle-tiny-live-summary.json`: edge/closure/boundary checks and metrics.
- `/tmp/great-circle-tiny-live.gpx`: actual GPX track.

## Final validation

After Ant released the validation window, all **19 deterministic routing/network tests**, all **six serial desktop/mobile browser checks**, TypeScript checking, and the production build passed. This includes dead-end pruning, returnable-component isolation, one-way/access/turn handling, geometry/GPX fidelity, impossible targets, truthful script identification, cache reuse, 406 cooldown, Retry-After, cancellation, and stale export invalidation.

One separately authorized browser request was then made through the actual production bundle served at `http://127.0.0.1:4181`. The browser supplied its normal User-Agent, Origin, and Referer; no identity override or header spoofing was used. Exactly one Overpass POST occurred, and the response was **HTTP 200** with **Access-Control-Allow-Origin: ***. The UI generated a **3.26 km**, **+8.8%** loop with **62/100 displayed roundness**, **0% repetition**, and **199 GPX points**. The downloaded GPX parsed without errors, had the GPX 1.1 namespace, and closed at the same coordinate. Desktop and 390 px phone screenshots were visually inspected, and the phone page had no horizontal overflow. Resizing reused the route without an additional map-data request.

Final browser artifacts (actual data, not fixtures):

- `/tmp/great-circle-browser-live-summary.json`: request headers, actual CORS response, UI metrics, GPX checks, and request count.
- `/tmp/great-circle-browser-live.gpx`: actual downloaded track.
- `/tmp/great-circle-browser-live-desktop.png`: production desktop screenshot.
- `/tmp/great-circle-browser-live-mobile.png`: production phone-width screenshot.

The temporary production preview and test servers were stopped after QA. No commands remain active. No endpoint failover, deployment, push, credentials, or security/network setting changes occurred.

This proves one small live case and the tested invariants, not universal route quality, legal access in every jurisdiction, or real-world safety. Missing map tags, current conditions, closures, elevation, and unsupported restrictions still limit the prototype. It remains a bounded heuristic rather than a complete navigation engine.
