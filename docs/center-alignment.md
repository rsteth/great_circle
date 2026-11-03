# Center drag alignment

This local fix follows the Size-chevron overlay revision and is not published.

## Reproduction before the fix

The desktop browser regression deliberately failed before production code changed. It grabbed the handle 15px right and 10px down from its center, then dragged 70px right and 40px down. Actual DOM/SVG measurements in `review/center-alignment-before-desktop.json` show:

- Circle-to-actual-button gap: 0.0043px.
- Circle-to-visible-preview gap while held: 18.0236px.
- Apparent jump from the visible preview to the released button: 18.0278px.
- Actual circle movement on release: 0px.

The circle and actual handle were already together. The duplicate, more prominent preview was positioned at the raw pointer, while the circle respected the initial grab offset. Removing the preview at release therefore appeared to snap the handle back. The synthetic before/after captures show the difference.

## Change

Handle grabs retain the initial offset in screen pixels. One proposed geographic point drives the circle preview, the visible preview projection and release commit. Projection uses the same fractional `map.project(...).subtract(getPixelOrigin())` coordinates as the circle, including map-pane translation, and projects the clamped geographic point rather than independently positioning a ghost at the pointer. The locked countdown stays at the locked center. A valid drop commits the proposed point directly without first restoring the old circle.

The 600ms once-only unlock, pointer capture, cancellation, settings guards, route preservation and camera handling remain intact. Keyboard movement remains an explicit Enter/Escape transaction; touch long-press on empty map remains a target preview until release. Those deliberately different interactions retain their existing behavior.

## Verification

- Strict TypeScript/production build passes; circle and selection unit tests: 11 passed. Canonical app/center/radius/Size-overlay browser regressions: 35 passed, five expected desktop touch-only skips.

- The original failing desktop reproduction now passes on desktop and mobile, with measured circle/button/preview gaps and release movement of 0px in the representative captures.
- New alignment suite: seven passed, one expected desktop touch-only skip. Its 16 positive/negative edge-grab cases (eight per profile) measured maximum circle/button gap, circle/preview gap and release movement of 0px. Coverage measures positive/negative edge grabs, small/large movement, immediate drop after unlock, repeated drags, settled pan/zoom, pending-state alignment, Escape restoration, native touch and latitude clamping. It checks camera, radius and bearing preservation plus the outward Size overlay during center preview.
- Existing ORS center-lock suite: 20 passed, two expected desktop touch-only skips. Its API key is unset and all `/api/loop` responses are mocked. It covers continuous single unlock, route preservation, outside release, capture/cancellation, keyboard transactions, countdown/reduced motion and native phone long-press.
- Pan fixtures wait for Leaflet's asynchronous inertia to finish before recording a stationary-camera baseline. Intermediate fixture failures while camera inertia was still moving were not treated as alignment regressions. The pan/zoom grab matrix also asserts that the pointer actually hits Center; at a more cramped zoom, existing Start-handle overlap can intercept an edge grab, so those tests use an unobstructed zoom rather than changing handle priority.

All screenshots use synthetic offline tiles. No live routing/provider calls, publication, pushes or screenshot transfers were used. Physical-device and assistive-technology checks remain manual. Existing geographic limits and tiny-circle visibility rules are unchanged.
