import { CoverageGapError } from './coverage';
import type { NetworkResult } from './overpass';
import type { Route, Settings, SolveTiming, WorkerResponse } from './types';
export type SearchResult = { route: Route; timing: SolveTiming; transferMs: number };
export class SearchClient {
  private worker?: Worker;
  private dataset = '';
  private sequence = 0;
  private active?: { id: number; reject: (error: unknown) => void; signal: AbortSignal; abort: () => void };
  cancel() {
    const active = this.active; this.active = undefined;
    if (active) active.signal.removeEventListener('abort', active.abort);
    this.worker?.terminate(); this.worker = undefined; this.dataset = '';
    active?.reject(active.signal.reason ?? new DOMException('Cancelled', 'AbortError'));
  }
  search = (network: NetworkResult, settings: Settings, signal: AbortSignal, progress: (message: string) => void): Promise<SearchResult> => {
    if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    if (this.active) return Promise.reject(new Error('A route search is already running.'));
    const instance = this.worker ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = instance;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel();
      this.active = { id, reject, signal, abort }; signal.addEventListener('abort', abort, { once: true });
      const clear = () => { signal.removeEventListener('abort', abort); if (this.active?.id === id) this.active = undefined; };
      let transferMs = 0;
      instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (signal.aborted || this.active?.id !== id || message.id !== id) return;
        if (message.type === 'progress') { progress(message.message); return; }
        clear();
        if (message.type === 'result') resolve({ route: message.route, timing: message.timing, transferMs });
        else reject(message.gaps?.length ? new CoverageGapError(message.message, message.gaps) : new Error(message.message));
      };
      instance.onerror = event => {
        if (this.active?.id !== id) return;
        event.preventDefault(); clear(); instance.terminate(); this.worker = undefined; this.dataset = '';
        reject(new Error('Search stopped. Try a smaller area.'));
      };
      try {
        const started = performance.now();
        instance.postMessage({ id, datasetId: network.datasetId, data: this.dataset === network.datasetId ? undefined : network.data, sourceCoverage: network.sourceCoverage, coverage: network.coverage, settings });
        transferMs = performance.now() - started; this.dataset = network.datasetId;
      } catch (error) { clear(); instance.terminate(); this.worker = undefined; this.dataset = ''; reject(error); }
    });
  };
}
