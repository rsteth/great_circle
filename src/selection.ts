import { changeCircle } from './circle';
import { validateSettings } from './routing/solve';
import type { Settings } from './routing/types';
// One last user selection on this device, never route data or a location history.
export const SELECTION_KEY = 'great-circle.selection.v1';
export function exampleSettings(): Settings {
  return changeCircle({ center: { lat: 49.289, lon: -123.128 }, start: { lat: 49.289, lon: -123.128 }, radiusM: 1000, targetKm: 3, tolerance: 0.3, surface: 'mixed', style: 'quiet' }, { radiusM: 500, bearing: 180 });
}
export function readSelection(storage?: Pick<Storage, 'getItem'>): Settings | undefined {
  try {
    const raw = (storage ?? window.localStorage).getItem(SELECTION_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || typeof saved.settings?.circleRadiusM !== 'number') return;
    validateSettings(saved.settings);
    return saved.settings as Settings;
  } catch { /* Disabled storage, unknown schema or invalid data: use the example. */ }
}
export function writeSelection(settings: Settings, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    validateSettings(settings);
    (storage ?? window.localStorage).setItem(SELECTION_KEY, JSON.stringify({ version: 1, settings }));
    return true;
  } catch { return false; } // Storage restrictions must not prevent planning.
}
