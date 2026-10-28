import { expect, it, vi } from 'vitest';
import { compareEngine, engineRequest } from '../src/routing/engineComparison';
import type { EngineTransport } from '../src/routing/engineComparison';
import { buildGraph } from '../src/routing/graph';
import { toGpx } from '../src/routing/gpx';
import type { Edge } from '../src/routing/types';
import { circleFixture } from './fixtures';
function fixture() {
  const { data, settings } = circleFixture(); const graph = buildGraph(data, settings);
  const forward: Edge[] = []; for (let id = 1; id <= 64; id++) forward.push(graph.edges.get(id)!.find(edge => edge.to === id % 64 + 1)!);
  const reverse = [...forward].reverse().map(edge => graph.edges.get(edge.to)!.find(candidate => candidate.to === edge.from)!);
  return { data, settings, graph, forward, reverse };
}
it('ordered waypoint arm preserves guide center, order, pinned Start and actual full geometry', async () => {
  const { graph, settings, reverse } = fixture(); let requests = 0;
  const transport: EngineTransport = async request => { requests++; expect(request.kind).toBe('ordered-waypoints'); expect(request.waypoints).toHaveLength(9); expect(request.waypoints![0]).toEqual(request.waypoints!.at(-1)); expect(request.limits.requests).toBe(1); return { edges: reverse }; };
  const result = await compareEngine('ordered-waypoints', graph, settings, 1, transport, new AbortController().signal);
  expect(requests).toBe(1); expect(result.points).toHaveLength(65); expect(result.points[0]).toEqual(result.points.at(-1)); expect(result.repeated).toBe(0); expect(result.error).toBeLessThan(.01); expect(toGpx(result).match(/<trkpt /g)).toHaveLength(65);
});
it('round-trip arm states that center/shape are not promised; both retain exact Start and preferences', async () => {
  const { graph, settings, forward } = fixture(); const request = engineRequest('round-trip', graph, settings, 1);
  expect(request.waypoints).toBeUndefined(); expect(request.seed).toBe(0); expect(request.targetM).toBe(settings.targetKm * 1000); expect(request.preferences).toEqual({ surface: settings.surface, style: settings.style });
  const result = await compareEngine('round-trip', graph, settings, 1, async () => ({ edges: forward }), new AbortController().signal);
  expect(result.startNodeId).toBe(1); expect(result.notes.join(' ')).toContain('does not promise');
  await expect(compareEngine('ordered-waypoints', graph, settings, 1, async () => ({ edges: forward }), new AbortController().signal)).rejects.toThrow('ordered');
});
it('rejects an open path, unknown geometry, moved start, illegal incoming turn and illegal closing turn', async () => {
  const { graph, settings, forward } = fixture(); const signal = new AbortController().signal;
  await expect(compareEngine('round-trip', graph, settings, 1, async () => ({ edges: forward.slice(0, -1) }), signal)).rejects.toThrow('closed');
  await expect(compareEngine('round-trip', graph, settings, 1, async () => ({ edges: [{ ...forward[0], way: -999 }] }), signal)).rejects.toThrow('unknown');
  await expect(compareEngine('round-trip', graph, settings, 1, async () => ({ edges: [...forward.slice(1), forward[0]] }), signal)).rejects.toThrow('disconnected');
  graph.turns.set(2, [{ from: 1000, to: 1000, only: false, uturn: false }]);
  await expect(compareEngine('round-trip', graph, settings, 1, async () => ({ edges: forward }), signal)).rejects.toThrow('turn');
  graph.turns.clear(); graph.turns.set(1, [{ from: 1000, to: 1000, only: false, uturn: false }]);
  await expect(compareEngine('round-trip', graph, settings, 1, async () => ({ edges: forward }), signal)).rejects.toThrow('legally closed');
});
it('uses the same graph access/direction rules and rejects repeated loops and excess results', async () => {
  const { graph, settings, forward } = fixture(); const signal = new AbortController().signal;
  graph.edges.set(1, []);
  await expect(compareEngine('round-trip', graph, settings, 1, async () => ({ edges: forward }), signal)).rejects.toThrow('illegal');
  graph.edges.set(1, [forward[0]]);
  await expect(compareEngine('round-trip', graph, { ...settings, targetKm: settings.targetKm * 2 }, 1, async () => ({ edges: [...forward, ...forward] }), signal)).rejects.toThrow('repetition');
  await expect(compareEngine('round-trip', graph, settings, 1, async () => ({ edges: new Array(200001).fill(forward[0]) }), signal)).rejects.toThrow('budget');
});
it('does not invoke transport when already cancelled; late results cannot survive abort and no retry occurs', async () => {
  const { graph, settings, forward } = fixture(); const controller = new AbortController(); controller.abort(); const transport = vi.fn(async () => ({ edges: forward }));
  await expect(compareEngine('round-trip', graph, settings, 1, transport, controller.signal)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
  const active = new AbortController(); let release!: (value: { edges: Edge[] }) => void;
  const delayed: EngineTransport = vi.fn(() => new Promise<{ edges: Edge[] }>(done => { release = done; }));
  const result = compareEngine('round-trip', graph, settings, 1, delayed, active.signal); active.abort(); await expect(result).rejects.toThrow(); release({ edges: forward }); expect(delayed).toHaveBeenCalledTimes(1);
});
it('bounds a non-cooperative engine deadline without adding a second request', async () => {
  vi.useFakeTimers(); try {
    const { graph, settings } = fixture(); let signal: AbortSignal | undefined;
    const transport = vi.fn((_request, current: AbortSignal) => { signal = current; return new Promise<never>(() => {}); });
    const result = compareEngine('round-trip', graph, settings, 1, transport, new AbortController().signal);
    const assertion = expect(result).rejects.toThrow('time budget'); await vi.advanceTimersByTimeAsync(14001); await assertion;
    expect(signal!.aborted).toBe(true); expect(transport).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
