import { afterEach, expect, it, vi } from 'vitest';
import { SearchClient } from '../src/routing/searchClient';
import { CoverageGapError, initialCoverage } from '../src/routing/coverage';
import { exampleSettings } from '../src/selection';
import type { NetworkResult } from '../src/routing/overpass';
import type { WorkerRequest, WorkerResponse } from '../src/routing/types';
class WorkerMock {
  static instances: WorkerMock[] = [];
  onmessage?: (event: { data: WorkerResponse }) => void;
  onerror?: unknown;
  posted: WorkerRequest[] = [];
  terminated = false;
  constructor() { WorkerMock.instances.push(this); }
  postMessage(message: WorkerRequest) { this.posted.push(message); }
  terminate() { this.terminated = true; }
}
afterEach(() => { vi.unstubAllGlobals(); WorkerMock.instances = []; });
function setup() {
  vi.stubGlobal('Worker', WorkerMock); const settings = exampleSettings(), coverage = initialCoverage(settings);
  const network: NetworkResult = { data: { elements: [] }, datasetId: 'saved-fixture', coverage, sourceCoverage: coverage, cached: false, timing: { fetchMs: 0, parseMs: 0, bytes: 0, cacheHit: false, elements: 0, queryAreaM2: 0, queryVertices: 0 } };
  return { settings, network, client: new SearchClient() };
}
it('sends independent strategy/pinned Start and preserves them through coverage gap serialization', async () => {
  const { settings, network, client } = setup();
  const pending = client.search(network, settings, new AbortController().signal, () => {}, { strategy: 'joint', pinnedStartId: 42 });
  const worker = WorkerMock.instances[0], sent = worker.posted[0];
  expect(sent.options).toEqual({ strategy: 'joint', pinnedStartId: 42 });
  worker.onmessage!({ data: { id: sent.id, type: 'error', message: 'coverage boundary', gaps: [settings.start], startNodeId: 42 } });
  await expect(pending).rejects.toEqual(new CoverageGapError('coverage boundary', [settings.start], 42)); client.cancel();
});
it('cancel terminates joint work; late old-worker errors cannot overwrite a new request', async () => {
  const { settings, network, client } = setup(); const first = new AbortController();
  const pending = client.search(network, settings, first.signal, () => {}, { strategy: 'joint' });
  const rejected = expect(pending).rejects.toThrow(), old = WorkerMock.instances[0], message = old.posted[0]; first.abort(); await rejected; expect(old.terminated).toBe(true);
  const progress = vi.fn(), next = client.search(network, settings, new AbortController().signal, progress, { strategy: 'nearest' });
  old.onmessage!({ data: { id: message.id, type: 'error', message: 'late old failure' } }); expect(progress).not.toHaveBeenCalled();
  const current = WorkerMock.instances[1]; expect(current.posted[0].data).toBe(network.data);
  current.onmessage!({ data: { id: current.posted[0].id, type: 'error', message: 'current failure' } }); await expect(next).rejects.toThrow('current failure'); client.cancel();
});
