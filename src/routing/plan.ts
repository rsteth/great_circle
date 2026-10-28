import { CoverageGapError, expandCoverage, initialCoverage } from './coverage';
import { loadNetwork, newFetchBudget, type FetchBudget } from './overpass';
import type { SearchClient } from './searchClient';
import type { NetworkTiming, Settings } from './types';
export class PlanningFailure extends Error {
  constructor(message: string, readonly phase: 'download' | 'search' | 'budget', readonly metrics: Record<string, unknown>) { super(message); this.name = 'PlanningFailure'; }
}
// One initial corridor plus at most one consolidated corridor+local-patches
// query. Re-querying the union avoids merging conflicting OSM snapshots.
export async function planRoute(settings: Settings, signal: AbortSignal, progress: (message: string) => void, search: SearchClient['search'], dependencies: { load?: typeof loadNetwork; budget?: FetchBudget } = {}) {
  const controller = new AbortController(), budget = dependencies.budget ?? newFetchBudget();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new Error('Route planning time budget reached. Try a smaller circle.')), Math.max(1, Math.floor(budget.deadline - performance.now())));
  const load = dependencies.load ?? loadNetwork, attempts: NetworkTiming[] = [];
  const started = performance.now(), initial = { requests: budget.remainingRequests, bytes: budget.remainingBytes, elements: budget.remainingElements };
  let phase: 'download' | 'search' = 'download';
  const metrics = () => ({ network: attempts.at(-1), networkAttempts: [...attempts], requests: initial.requests - budget.remainingRequests, bytes: initial.bytes - budget.remainingBytes, elements: initial.elements - budget.remainingElements, elapsedMs: performance.now() - started });
  let coverage = initialCoverage(settings);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (controller.signal.aborted) throw controller.signal.reason;
      phase = 'download';
      progress(attempt ? 'Checking a missing connection…' : 'Loading roads near the circle…');
      const network = await load(settings, controller.signal, undefined, { coverage, budget, waitForCooldown: attempt > 0, onWait: seconds => progress(seconds ? `Waiting ${seconds}s before one connection check…` : 'Loading the connection check…') });
      attempts.push(network.timing); coverage = network.coverage;
      phase = 'search';
      try {
        const result = await search(network, settings, controller.signal, progress);
        return { ...result, metrics: { ...metrics(), transferMs: result.transferMs, worker: result.timing, coverage: coverage.kind } };
      } catch (error) {
        if (!(error instanceof CoverageGapError) || coverage.kind !== 'corridor') throw error;
        const expanded = attempt === 0 ? expandCoverage(coverage, error.gaps) : undefined;
        if (!expanded) throw new Error('No loop found within downloaded coverage. The bounded connection check could not complete a route; wider detours may be needed.');
        coverage = expanded;
      }
    }
    throw new Error('No loop found within the corridor budget.');
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
    if (controller.signal.aborted) throw new PlanningFailure('Route planning time budget reached. Try a smaller circle.', 'budget', metrics());
    throw new PlanningFailure(error instanceof Error ? error.message : 'Route planning stopped.', phase, metrics());
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}
