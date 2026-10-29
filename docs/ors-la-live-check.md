# ORS public-intersection check, 2026-10-29

Local-only test of `b2e8492`; no production change. The user supplied Washington/La Cienega as the reproduction area and authorized Keychain use and ORS transmission. No credential or request-auth headers appear in these fixtures. The selected intersection is public map data; no user identity, device position or personal metadata is retained.

LA County's [official locator](https://geocode.gis.lacounty.gov/geocode/rest/services/CAMS_Locator/GeocodeServer) returned `StreetInt`, score95.77, `W Washington Blvd & S La Cienega Blvd, Culver City, 90232` at34.032482851313,-118.374328230684. Radius1.5km came from the user. **South Start180°, mixed surfaces and30% variation were diagnostic choices, not necessarily the user's exact settings.**

Two live generations used four ORS requests total on the new HeiGIT endpoint. Recommended preference took2.77s and rejected its last15.70km candidate; raw geometry for that arm was not captured. Shorter preference took2.90s, returning HTTP200 in both directions:13.48km/432points and13.94km/443points,12,242/12,629decoded response bytes, no Retry-After. Total generation times include the intentional1.55s inter-attempt wait and browser/proxy work; these are observations, not controlled provider benchmarks. Provider graph date/version was not retained.

Both saved Shorter routes have identical native start/finish, ordered waypoint indices,109m Start snap, one net winding and32/32angular bins. They pass current non-distance shape checks but exceed the9.42km circumference target by43.0%/47.9%. At capture time the app rejected them, displayed no route and offered no GPX. GPX fidelity was checked in memory against all actual returned points, never presented as an accepted download. Road/turn/access compliance relies on ORS's cycling profile, not an independent OSM-edge audit; geometric continuity does not prove on-the-ground legality or safety.

## Radial and angular evidence

The route-wide diagnostic samples native segments at≤5m midpoint intervals, weights distributions by segment length, and uses the existing≤25m radial-extrema helper with nearest-point projection. Metrics describe the returned polyline, not unmodeled road curves or physical GPS accuracy.

| Measure | First Shorter route | Second Shorter route |
|---|---:|---:|
| Mean absolute radial departure |163m|151m|
| 95th percentile absolute departure |435m|426m|
| Radius range |1,085–2,085m|1,085–2,085m|
| Length within±150m (10%) |57.1%|63.7%|
| Length within±300m (20%) |83.3%|85.8%|
| Length within±450m (30%) |96.2%|96.4%|
| Worst departure |585m outward (39.0%)|585m outward (39.0%)|
| Absolute angular travel |1.066turns|1.062turns|
| Angular travel against net direction |0.033turn|0.031turn|
| Geometric retrace |6.2%|5.5%|
| Roundness |0.466|0.453|

“Mostly near the perimeter” is supported; “the whole route stays within30% of the circle” is false. Current radial acceptance bounds **mean** absolute error, at35% of radius for this slider setting, not every point. Angular coverage proves each coarse sector was visited; net winding can hide backtracking, so neither alone proves a smooth or near-circular loop. The diagnostic's low reverse angular travel supports these particular routes encircling once with modest angular backtracking. No scoring threshold is changed by this analysis.

Circumference error and radial proximity answer different questions. A street route can remain near the guide yet be much longer than2πr. The original distance rule rejected these otherwise qualifying shapes; radial checks did not reject them. Keep those measurements separate in UI language and show actual length plus conspicuous over-target status for any user-authorized larger-loop display. Never imply that over-target means within selected distance tolerance, nor silently drop closure/shape/surface/Start requirements.

## Reproduction and licensing

- `tests/data/ors-la-intersection-2026-10-29.json`: whitelisted numerical geometry, distance, waypoints and surface; two complete Shorter geometries, original rejection and non-secret timing/provenance. Recommended arm has summary only. No live replay is needed.
- `docs/ors-la-live-results.json`: reproducible detailed shape statistics.
- `npm test -- tests/ors-la-fixture.test.ts`: offline provider-contract, rejection, shape-extrema, GPX-point fidelity and cancellation regressions.
- `node --import tsx scripts/analyze-ors-fixture.ts`: regenerate offline diagnostics (no key, HTTP or provider access).

Routing © openrouteservice.org by HeiGIT; OpenStreetMap contributors. Saved results: [CC BY-SA4.0](https://creativecommons.org/licenses/by-sa/4.0/), consistent with the [current ORS result terms](https://account.heigit.org/info/tos). The sanitized response retains only selected feature fields, not a byte-identical raw HTTP response.

Chromium desktop/phone-width workflows were tested. Actual iOS Safari is unverified. Owned API/app processes were stopped and ports4180/8787 refused connections. No further provider calls are needed for the next local policy regression.

## Approved local larger-loop revision

After reviewing these captured results, the user approved showing a valid larger loop directly with an explanatory message beside the planning circle, without an extra acceptance gate. The local adapter still prefers an in-tolerance candidate, otherwise selects the closest complete larger candidate passing all existing non-distance checks. This fixture selects the first13.48km/432-point route, not the last13.94km result. UI says **Larger loop ·13.48km**, **4.05km (+43.0%) longer than the9.42km circle target**, and **Outside your selected distance variation**. The1.5km guide remains, GPX uses the exact displayed native sequence and carries the over-target warning/license. Invalid/open/unroutable/shape-failing/unknown-paved candidates do not qualify. Explicit cancellation discards an already found larger fallback. A later service failure can leave an earlier fully validated larger candidate usable, with the comparison failure/cooldown disclosed in route notes.

This behavior is verified with the saved real responses, not another live request; total live ORS calls remain four. Historical rejection and original source revision stay preserved in the fixture.

Final local validation:122unit/contract tests passed, typecheck/build passed,15prepared-graph desktop/phone Chromium cases passed with1desktop touch-only skip. The real LA fixture is rendered with the unchanged guide, explicit larger-loop warning and faithful432-point GPX including license/excess metadata. Earlier legacy browser regressions were80passed/8platform skips; no legacy search-policy change was made. Screenshots are local `/tmp/great-circle-ors-la-larger-{desktop,phone}.png`, visibly labeled offline basemaps with actual saved route geometry. Actual iOS and fresh live execution of the new acceptance policy remain unverified.
