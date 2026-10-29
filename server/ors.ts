import type { PreparedProvider } from '../src/loop/types';
import { ProviderFailure } from '../src/loop/types';
export const ORS_ENDPOINT = 'https://api.heigit.org/openrouteservice/v2/directions/cycling-regular/geojson';
export function createOrsProvider(apiKey?: string, client: typeof fetch = fetch): PreparedProvider {
  let nextAt = 0, active = false, sent = 0;
  return { requestCount: () => sent, async route(coordinates, settings, signal) {
    signal.throwIfAborted();
    if (!apiKey?.trim()) throw new ProviderFailure('unavailable', 'Routing service is not configured. Add the ORS key to the local server secret source.');
    if (active || Date.now() < nextAt) throw new ProviderFailure('unavailable', 'Routing service is cooling down. Try later.', Math.max(2, Math.ceil((nextAt - Date.now()) / 1000)));
    active = true; nextAt = Date.now() + 1500; let httpError: ProviderFailure | undefined;
    try {
      sent++; const response = await client(ORS_ENDPOINT, { method: 'POST', headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/geo+json' }, body: JSON.stringify({ coordinates: coordinates.map(point => [point.lon, point.lat]), preference: settings.style === 'quiet' ? 'recommended' : 'shortest', instructions: false, geometry_simplify: false, extra_info: ['surface'], radiuses: coordinates.map(() => 300), options: { avoid_features: ['ferries', 'steps'] } }), signal });
      if (!response.ok) {
        const retry = response.headers.get('retry-after'), parsed = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? (Date.parse(retry) - Date.now()) / 1000 : 0;
        const seconds = Math.max(30, Number.isFinite(parsed) ? parsed : 0);
        httpError = new ProviderFailure('unavailable', response.status === 401 || response.status === 403 ? 'Routing credentials were rejected. Check the server configuration.' : `Routing service unavailable (HTTP ${response.status}). Try later.`, seconds);
      }
      const reader = response.body?.getReader(); if (!reader) throw new ProviderFailure('unavailable', 'Routing service returned an empty response.');
      const chunks: Uint8Array[] = []; let bytes = 0;
      while (true) { const part = await reader.read(); if (part.done) break; signal.throwIfAborted(); bytes += part.value.byteLength; if (bytes > 8 * 1024 * 1024) { void reader.cancel().catch(() => {}); throw new ProviderFailure('unavailable', 'Routing response exceeded its data budget.'); } chunks.push(part.value); }
      const body = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      let data; try { data = JSON.parse(new TextDecoder().decode(body)); } catch { if (response.ok) throw new ProviderFailure('unavailable', 'Routing service returned invalid data.'); }
      if (!response.ok) {
        if ([2009, 2010].includes(data?.error?.code)) throw new ProviderFailure('unroutable', 'No cycling route connects these circle waypoints. Move the circle or Start.');
        throw httpError;
      }
      signal.throwIfAborted(); const feature = data?.features?.[0], coords = feature?.geometry?.coordinates;
      if (feature?.geometry?.type !== 'LineString' || !Array.isArray(coords) || coords.length > 20000 || coords.some(point => !Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) throw new ProviderFailure('unavailable', 'Routing service returned invalid geometry.');
      return { points: coords.map(([lon, lat]: number[]) => ({ lat, lon })), distanceM: feature.properties?.summary?.distance, waypoints: feature.properties?.way_points, surface: feature.properties?.extras?.surface?.values };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      const failure = error instanceof ProviderFailure && error.kind === 'unroutable' ? error : httpError ?? error;
      if (!(failure instanceof ProviderFailure && failure.kind === 'unroutable')) nextAt = Math.max(nextAt, Date.now() + (failure instanceof ProviderFailure ? Math.max(30, failure.retryAfterSeconds ?? 30) : 30) * 1000);
      if (failure instanceof ProviderFailure) throw failure;
      throw new ProviderFailure('unavailable', 'Could not reach the routing service. Try later.');
    }
    finally { active = false; }
  } };
}
