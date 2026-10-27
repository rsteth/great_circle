import type { Point } from './routing/types';
// Public Photon demo: reasonable use only, no availability guarantee. Manual
// submissions only. No map center or device position is sent with a query.
export const PLACE_ENDPOINT = import.meta.env.VITE_PLACE_SEARCH_URL || 'https://photon.komoot.io/api/';
export type Place = { point: Point; label: string };
const cache = new Map<string, { time: number; places: Place[] }>();
let nextRequest = 0;
export async function searchPlaces(query: string, signal: AbortSignal): Promise<Place[]> {
  const key = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  if (key.length < 2 || key.length > 200) throw new Error('Enter a place name (2–200 characters).');
  signal.throwIfAborted();
  const saved = cache.get(key);
  if (saved && Date.now() - saved.time < 900000) return saved.places;
  if (Date.now() < nextRequest) throw new Error('Wait a moment before searching again.');
  nextRequest = Date.now() + 1000;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Place search timed out. Try again.')), 10000);
  try {
    const url = new URL(PLACE_ENDPOINT); url.searchParams.set('q', query.trim()); url.searchParams.set('limit', '5');
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const retry = response.headers.get('Retry-After');
      if (response.status === 429 || response.status === 503) {
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
        nextRequest = Math.max(nextRequest, Date.now() + Math.max(30000, Number.isFinite(seconds) ? seconds : 0));
      }
      throw new Error(`Place search unavailable (${response.status}). Try later.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Place search returned an empty response.');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 1048576) { await reader.cancel(); throw new Error('Place search response was too large.'); }
      chunks.push(value);
    }
    controller.signal.throwIfAborted();
    const bytes = new Uint8Array(length); let offset = 0;
    chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.length; });
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(data.features)) throw new Error('Place search returned an invalid response.');
    const places: Place[] = [];
    for (const feature of data.features.slice(0, 10)) {
      const [lon, lat] = feature.geometry?.coordinates ?? [];
      if (feature.geometry?.type !== 'Point' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 75 || Math.abs(lon) > 180) continue;
      const p = feature.properties ?? {};
      const names = [p.name, p.city, p.state, p.country].filter((name): name is string => typeof name === 'string' && name.length > 0);
      const label = [...new Set(names)].join(', ');
      if (label) places.push({ point: { lat, lon }, label });
      if (places.length === 5) break;
    }
    cache.set(key, { time: Date.now(), places });
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
    return places;
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) throw new Error('Place search timed out. Try again.');
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
