# Appearance and color presentation

The header has independent **Dark mode** and **Accessibility** buttons. On a fresh visit the theme follows the device, including device preference changes while the app is open. A manual toggle persists an explicit choice. **Use device theme** removes that override. Palette and theme are stored separately under `great-circle.appearance.v1.*`; denied storage leaves controls usable for the visit. An inline head bootstrap applies validated choices before the application paints.

The light interface uses warm ivory, charcoal, sage and restrained terracotta; all controls use semantic CSS tokens. Red–green friendly substitutes blue/orange accents, blue–yellow friendly uses magenta/teal, and high contrast strengthens boundaries. These are presentation options, not medical correction. OpenStreetMap tiles retain original colors. There is no tile or page color filter.

The Accessibility dialog uses native modal semantics, a named radio group, initial selected-option focus, bounded Tab/Shift+Tab cycling, Escape/Close dismissal and trigger focus return. New buttons have 44px targets. Reduced motion removes interface animation, and forced colors has explicit outlines.

Map Start remains labeled S/Start with a double circular border. Size remains labeled with arrows/Size and now has a rounded square boundary. Center keeps its padlock icon and all shipped unlock/drag/keyboard behavior. Route strokes have a continuous light casing, a darker solid route and a dashed ideal-circle guide; CSS classes update their palette without rebuilding routes or changing map camera/settings. The target ring also has a light casing. Palette/theme switches do not invalidate generated routes or GPX.

## Verification

- `npm run build` / `npm run typecheck`: pass.
- `npm test`: all 135 tests pass (22 files), including mocked backend requests. The localhost suite requires permission to listen outside the restricted sandbox.
- `tests/browser/appearance.spec.ts`: desktop and mobile tests cover all eight combinations, computed rendered foreground/background contrast (4.5:1 regular text, 3:1 qualifying large text), rendered control boundaries and route/casing contrast (3:1), independent persistence, live system fallback, explicit override/reset, denied storage, native dialog keyboard/focus behavior, 390px layout, 200% text enlargement, reduced motion and forced colors.
- Full offline Chromium browser suite: **88 passed, 8 expected project-specific skips**. The extra 200% text-enlargement overflow/screenshot checks also pass on both projects. Existing offline browser suite exercises circle/center/start/size interaction, map gestures, route generation, failures/cancellation and closed GPX export. No routing/provider calls are made by these tests; tiles and road data use fixtures.
- `review/contrast-*.json` records computed text/input/placeholder and essential boundary pairs in each combination: minimum text **5.8466:1**, minimum essential control boundary **3.1512:1**. `review/route-contrast-*.json` records minimum route/casing contrast **8.8827:1**.
- `review/` contains actual Chromium captures at desktop and emulated iPhone dimensions. Map content is a labeled offline fixture, not a live map screenshot. The light/dark Standard and high-contrast views, generated red–green route, and accessibility dialog are represented.

These checks do not replace physical-device or assistive-technology testing. Text zoom doubles computed text sizes in the browser. Browser page zoom and hardware/OS color rendering remain manual checks. No claim of complete WCAG conformance is made.
