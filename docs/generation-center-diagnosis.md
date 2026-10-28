# Generation diagnosis and center handle (local)

This follow-up starts from published `1dfc2f06c8a580d7800a793030758da04288ebbf`. It remains local on `feat/center-handle-generation-diagnosis`; no push/deployment is authorized for this revision. The original Python sketch and main are unchanged.

## Fresh public-app observation

The previous saved-response checks did not prove fresh live routing. This investigation used isolated Playwright **Google Chrome for Testing**, not the user's foreground Chrome tab. Actual live requests used normal browser-controlled identity and the deployed `https://stethem.com/great_circle/` origin. Tiles were fixtures, geolocation was disabled, and all coordinates below are public examples.

A fresh 500 m circle at 49.289, −123.128, south Start, mixed surfaces, quiet roads and 30% variation succeeded through the actual UI:

- Initial and one consolidated expansion both returned HTTP 200, CORS `*`, complete JSON without a remark: 8,478 and 13,875 elements.
- Total generation took **63.228 seconds**, including service transfer, the normal cooldown/expansion and search. This is one live observation, not a general performance result.
- The app found and downloaded `great-circle-3.7km.gpx`: **3,729.644 m**, **18.718% distance error**, **0.396073 roundness**, **197 points**, closed start/finish. The downloaded GPX itself was checked offline against the fresh expanded response: every directed edge, supported turn including closure, full geometry, known coverage and acceptance thresholds passed.
- No provider rotation, special identity, automatic retry, paid service or security setting change occurred. This establishes a fresh success at one location, not that arbitrary circles work, that mobile Safari works, or that the user's failures are resolved.

A separate untouched-default check (center 49.299, −123.133; radius 1,591.549 m / nominal 10 km circumference / 20% variation) failed **before any HTTP response** with Chrome `net::ERR_NETWORK_CHANGED`. The app displayed a network failure, not a no-route result. After a full cooldown, one controlled manual retry returned HTTP 200 / CORS `*` / 11,581 complete elements. The first response took over 30 seconds, so the app attempted expansion immediately; the diagnostic's explicit one-real-request guard blocked that expansion locally. The resulting `ERR_FAILED` and generic network error belong to the harness boundary, **not a provider rejection or proof that the default full workflow fails**. No third public attempt was made.

Totals: four real POSTs attempted across the investigation (two successful small-case responses; one default attempt with no HTTP response; one successful default initial response). One additional expansion attempt was blocked before sending by the one-request harness. No maximum-radius or 10 km query was sent. Browser request failure does not establish whether the no-response attempt reached the server.

## What the default snapshot establishes

The actual initial default response is frozen under `tests/data/vancouver-default-corridor-2026-10-28.osm.json.gz` with timestamp, hash and ODbL attribution. Offline replay gives a start snap of 27.60 m, a directed returnable component of 1,408 nodes / 2,847 edges, and **zero component nodes in five of eight angular sectors** (east through west via north); the remaining three sectors have 215, 812 and 381 nodes. The solver correctly reports a missing-coverage connection, not a finished route. The initial corridor is a poor basis for a circular default example. Because no expanded default response was acquired, this does **not** prove no feasible wider loop exists, and downloaded coverage must not be treated as a complete disk.

The fresh small-case success and actual default network failure narrow the investigation: universal generation breakage was not reproduced. Connectivity changes, public service delays and unsuitable ring/network geometry are separate failure modes. The exact error and general selected area/radius from the user's device are still needed to identify their specific failures. No personal location is needed to continue from an error message. A reasonable next product decision is to replace the default/example with the freshly checked small circle; that default change is proposed, not silently included here.

## Local changes

- Remove the distant desktop Circle size heading/01 and obsolete `01 — 03` panel legend. Put compact **Circle size** directly above the numeric radius on desktop and phone.
- A 44 px **Move circle** handle shares the same map-coordinate overlay as the ring and existing controls. Dragging preserves radius and geographic Start bearing and uses the initial pointer grab offset. It does not pan, zoom or fit the map; Fit circle remains explicit. Keyboard arrows move by 12 screen pixels, Shift by 48, with supported latitude bounds and longitude wrapping.
- Pointer capture owns one pointer. Additional pointers cannot resize or take over. Escape, cancellation, capture loss and window blur restore the prior circle. Stale location requests cannot recenter after a manual gesture. Delayed post-drag map clicks are suppressed, fixing a discovered cancellation bug that otherwise relocated/refit the circle after mouse-up. Normal map gestures are restored after completion.
- Network errors now say: “Could not reach the public map service. Your connection may have changed, or the service may be unavailable. Check your connection, wait 30 seconds, then try again.” No-route suggestions refer to actual controls: smaller circle, center/Start, Route variation and surfaces. Existing statuses continue to distinguish download, no-loop, worker and deadline failures. No routing acceptance rule or provider/request limit changed.

## Checks and limits

64 deterministic tests and the typechecked production build passed. The full serial desktop/mobile suite passed 50 applicable cases (eight intentional skips); the final affected center/network suite also passed five cases (one skip) after adding window-blur coverage. Coverage includes independent center/radius/start movement, pointer offset, mouse/touch/multitouch, capture loss, Escape/blur rollback, keyboard movement, camera invariance, compact label placement, network failure → enforced cooldown → successful manual retry without reload, stale worker/cancel behavior, GPX, drawer, search and resize synchronization. Public services are mocked in automated regressions. No benchmarks were run.

Screenshots `/tmp/great-circle-center-{desktop,mobile}.png` show the local UI with labeled offline map tiles; `/tmp/gc-fresh-live-desktop.png` shows the published actual-data success with fixture tiles. They are local artifacts, not uploaded attachments. Circle dragging may intentionally put a handle beyond the viewport or behind map controls; explicit Fit circle restores the view rather than moving the camera during a drag. Actual iOS Safari and the user's exact failing settings remain unverified.
