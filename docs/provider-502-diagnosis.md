# HTTP 502 investigation (local, 2026-10-28)

Baseline published revision: `b9182552237e36e2cb145027d5cbee57fcffa748`. The new error-handling patch is local on `fix/provider-502-diagnosis`; no publication is authorized for it yet.

## Observed live result and limits

**Robin's 502 was not reproduced. Its exact request, stage and upstream cause remain unverified.** One fresh run of the untouched published small default was made in isolated Google Chrome for Testing on this Mac, with normal browser-controlled User-Agent, Origin `https://stethem.com` and Referer `https://stethem.com/`. It did not operate Robin's foreground browser. Coordinates were the public default (49.289, −123.128), radius 500 m, south Start, mixed/quiet, tolerance 30%. Tiles were fixtures and device location was disabled.

Both requests were POSTs to **`https://overpass-api.de/api/interpreter`**, form-encoded `data=`. Query settings remained `[timeout:25][maxsize:33554432]`; client fetch timeout ≤45 seconds, total generation ≤90 seconds, aggregate two requests / 32 MiB decoded response bytes / 200,000 parsed elements. No endpoint rotation, retry, larger-area query, status-endpoint probe or provider request after this run was made.

| Stage | HTTP | Query / encoded POST bytes | Vertices | Headers / full body time | Elements / decoded body bytes |
|---|---:|---:|---:|---:|---:|
| Initial buffered ring | 200 | 2,464 / 2,995 | 97 | 38.387 / 38.978 s | 8,478 / 1,491,538 |
| Consolidated expansion | 200 | 2,887 / 3,544 | 99 | 34.477 / 35.102 s | 13,875 / 2,504,769 |

Both observed responses had `Server: nginx`, `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, complete data without a remark, and no Retry-After header captured. Response dates were 2026-10-28T13:14:18Z and 13:14:53Z. Query hashes and timings are retained in `provider-502-live-observation.json` for comparison without logging any actual user selection. No failed-status body/headers were observed in this run, so it cannot identify the gateway that returned Robin's 502 or establish a provider-wide outage, rate limit, malformed query or query-size cause.

The actual app reached **Loop found** and downloaded `great-circle-3.7km.gpx` in **74.381 seconds** wall time (74.257 s application generation timing). Aggregate data were 3,996,307 decoded bytes and 22,353 elements. Worker preparation/snap/search took 62.9 ms, including 27.2 ms search; main-thread transfer took 5.1 ms. The measured waits are dominated by fetching, but the captured timing does not separate server queue/evaluation from network/proxy/transfer time. This is one current success, not a reliability guarantee or proof Robin's case is resolved. It is separate from earlier saved-response deployment checks and earlier live successes.

The route-generation provider is Overpass. Place search independently uses Photon (`https://photon.komoot.io/api/`) and renders `Place search unavailable (502)` when that service fails. No place search was made here. A screenshot of the actual error/context and the general selected area/radius will distinguish those paths and the user's saved selection from the new default. Exact personal geolocation is unnecessary.

## Verified client issue and local correction

The published fetcher awaited cancellation of a non-OK response body **before** reading Retry-After and constructing the HTTP error. A failed body cancellation could replace the original 502/status with a generic network error and prevent honoring its longer Retry-After. This was reproduced deterministically with a standard ReadableStream cancellation rejection; it was **not observed in the successful live run and is not established as Robin's cause**.

The local patch:

- Records the HTTP status and accessible numeric/date Retry-After first, updates the existing backoff, and safely discards the error body. Synchronous throws or rejected cancellation cannot hide the original status. Invalid/nonfinite Retry-After values fall back to the existing 30-second minimum.
- Uses a typed service error and adds initial versus connection-download stage, HTTP status, wait, request duration, query size/vertices and area proxy to the local User Timing diagnostic. It logs no raw query, coordinates or credentials and sends no telemetry.
- Shows **Map service error / Road download failed**, separately from **No loop found**. HTTP 502 guidance says to keep the tab open, wait at least the indicated interval and explicitly select Generate loop again; it does not pretend that no route exists or promise that resizing fixes a gateway response. Explicit access refusals remain refusals, without automatic retry.
- Starts cancellation/timeout backoff when the abort occurs. An old aborted fetch that settles later cannot cache data, replace a newer backoff with stale response headers, or repeatedly reset the clock. Normal HTTP failures still preserve the longer server backoff using monotonic maximum updates. The abort listener is removed when the request completes.
- Applies request-sequence checking to UI error completion as well as success/progress, so stale errors cannot overwrite a newer generation.

No retry, provider fallback, query/route/GPX algorithm, coverage identity, response budget or deployment setting changed. Error bodies and partial data are never cached. Complete initial roads remain usable in the same tab, within the existing 15-minute / three-entry / 24 MiB cache, after a failed expansion. A manual retry can reuse that exact initial coverage and download only the missing expanded union after backoff; it never labels that initial ring as complete expanded/disk coverage. Cancellation while waiting issues no request.

## Backoff boundaries and safe next steps

The app honors Retry-After **when the browser exposes it through CORS**; a raw unexposed header cannot be read by ordinary browser JavaScript. The tested mocked responses explicitly expose it. This live run returned no such header, so it does not prove error-response exposure on the real provider. No proxy or forbidden-header workaround was added.

Backoff and road caches are still page/module-local. Keeping the tab open preserves both. Reloading loses road cache and the in-memory backoff; cross-tab coordination/persisting the service backoff could be a separately reviewed enhancement, not a fix for an unknown upstream gateway cause. No automatic retries or endpoint rotation should be added to mask this incident. The public backend is best-effort; changing data service or hosting requires an explicit decision and was not done.

Next evidence is Robin's failing selection/error screenshot, which the parent already requested. Do not repeatedly probe bigger circles or call the service to manufacture a failing trace. The local error-handling patch makes a future failure clearer and safer; it is **not a claimed fix for HTTP 502 availability**.

## Verification

Final checks: 74 deterministic tests across 13 files; typechecked production build; 15 affected desktop/mobile browser cases passed, one non-applicable desktop case skipped. New tests cover cancellation failures preserving status/backoff, HTTP-date/invalid Retry-After, retained initial cache after expansion failure, no automatic retries, aborted late 200/502 responses preserving newer cooldown/cache, and cancelled network responses unable to overwrite a newer successful UI. Browser recovery uses captured OSM responses and fake time, not additional provider requests. Existing error/cancel/default-export/drawer cases passed in the affected group. No benchmarks were run.

Screenshots: `/tmp/great-circle-502-{desktop,mobile}.png` are labeled offline service-failure tests; `/tmp/gc-502-live-desktop.png` is the actual successful published-app observation with fixture tiles. These are local files, not uploaded attachments. No push/publication occurred; main and original `main.py` are preserved.

Primary references: [HTTP 502 semantics, RFC 9110 §15.6.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.3); [Overpass public-instance resource/slot guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html). HTTP 502 identifies a gateway/upstream-response failure in HTTP semantics; it does not by itself reveal which deployment layer or underlying cause failed here.
