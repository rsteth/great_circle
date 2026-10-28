# Radius and synchronized-map revision (historical local checkpoint)

**Superseded radius/download limits:** the latest [adaptive corridor revision](adaptive-corridor-prototype.md) uses a 10 km maximum radius and bounded corridor retrieval. The 100 km planning-only limit and old large-circle rejection described below document the earlier checkpoint, not current behavior.

Circle planning radius is 0.5–100 km. The maximum is a **radius**, producing a nominal circumference of approximately 628.3 km. Tap/click the radius readout beside Route variation to enter kilometers. Enter or a valid blur commits; Escape cancels; empty, nonfinite and out-of-range values remain editable with a units/range error. Arrow/Home/End map-handle controls share the same constants.

Ring, center, radial guide and both handles now render in one Leaflet pane in unrounded layer coordinates. They inherit the same map-pan transform and update atomically. The geodesic ring includes the exact handle bearings. SVG stacking puts the handle faces above the ring. The borderless distance legend uses the same UI font/color/background family as map controls.

Size tracks the pointer's nearest safe perimeter bearing and radius. A 64 px nominal exclusion plus a geodesic/Mercator screen-distance check protects Start; small angular hysteresis prevents jitter at the handoff. Start bearing never changes during Size gestures. No spring/elastic animation was added; reduced-motion users get the same direct precision. Cancellation restores pre-gesture radius and Size bearing. A second pointer cannot take over the captured handle. Tiny projected circles preserve keyboard control while removing the competing pointer hit target around Start; edit the readout or use Fit circle for a larger view.

**Radius edits do not fit, zoom or pan the map**, during drag or completion, keyboard changes or numeric entry. Fit circle is explicit. Viewport resize invalidates Leaflet's size without changing zoom; the ring/handles retain a shared transform. Search/new center and route preview retain their deliberate camera behavior.

## Separate map-download boundary

The existing public Overpass downloader remains bounded to a 6 km padded search radius, 32 MiB, 200,000 elements and its existing time/cooldown limits. The previous maximum routable circle size of 4.5 km is preserved. Larger circles up to 100 km can be drawn/edited, but Generate returns a clear request-size limitation **before any fetch**, instead of silently downloading a continental road graph or mislabeling partial data as a large route. Supporting large routable loops needs a separate data/architecture decision. No huge live query or new provider was used.

Routing cost/acceptance/GPX semantics and the earlier local efficiency commit remain intact. Validation includes the 100 km radius/circumference boundary, rejected numeric values, safe Start crossing both directions, exact camera/tiles invariance, shared transform through pan/zoom/resize, mouse/touch/multitouch cancellation, existing routing/cache/GPX regressions and no oversized download. This revision is local and needs a new publication decision.

Final local checks: 42 deterministic tests, the typechecked production build and all 37 applicable desktop/phone browser cases passed; seven desktop copies of phone-only checks were intentionally skipped. The final suite includes persistent-worker/coverage-cache, stale-reply/crash recovery and byte-identical baseline GPX checks alongside the new UI. Screenshots `/tmp/great-circle-radius-{desktop,mobile}.png` were visually inspected after correcting SVG stacking; the ring now remains behind handle faces. Public routing/search/location remain mocked in browser QA. No oversized public request was made.
