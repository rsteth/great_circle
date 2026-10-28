import type { CoverageStrategy, SearchStrategy } from './strategies';
import { CoverageGapError, expandCoverage, initialCoverage, type Coverage } from './coverage';
import { loadNetwork, MapServiceError, newFetchBudget, type FetchBudget } from './overpass';
import type { SearchClient } from './searchClient';
import type { NetworkTiming, Settings } from './types';
export class PlanningFailure extends Error {
  constructor(message: string, readonly phase: 'download' | 'search' | 'budget', readonly metrics: Record<string, unknown>) { super(message); this.name = 'PlanningFailure'; }
}
// One initial corridor plus at most one consolidated corridor+local-patches
// query. Re-querying the union avoids merging conflicting OSM snapshots.
export async function planRoute(settings: Settings, signal: AbortSignal, progress: (message: string) => void, search: SearchClient['search'], dependencies: { load?: typeof loadNetwork; budget?: FetchBudget; searchStrategy?: SearchStrategy; coverageStrategy?: CoverageStrategy } = {}) {
  const controller = new AbortController(), budget = dependencies.budget ?? newFetchBudget();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new Error('Route planning time budget reached. Try a smaller circle.')), Math.max(1, Math.floor(budget.deadline - performance.now())));
  const load = dependencies.load ?? loadNetwork, attempts: NetworkTiming[] = [];
  const started = performance.now(), initial = { requests: budget.remainingRequests, bytes: budget.remainingBytes, elements: budget.remainingElements };
  let phase: 'download' | 'search' = 'download';
  let requestStage: 'initial' | 'connection' = 'initial';
  const metrics = () => ({ network: attempts.at(-1), networkAttempts: [...attempts], requests: initial.requests - budget.remainingRequests, bytes: initial.bytes - budget.remainingBytes, elements: initial.elements - budget.remainingElements, elapsedMs: performance.now() - started });
  let coverage: Coverage;
  let pinnedStartId: number | undefined;
  try {
    coverage = initialCoverage(settings, dependencies.coverageStrategy);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (controller.signal.aborted) throw controller.signal.reason;
      phase = 'download'; requestStage = attempt ? 'connection' : 'initial';
      progress(attempt ? 'Checking a missing connection…' : coverage.kind === 'disk' ? 'Loading roads in the small circle area…' : 'Loading roads near the circle…');
      const network = await load(settings, controller.signal, undefined, { coverage, budget, waitForCooldown: attempt > 0, onWait: seconds => progress(seconds ? `Waiting ${seconds}s before one connection check…` : 'Loading the connection check…') });
      attempts.push(network.timing); coverage = network.coverage;
      phase = 'search';
      try {
        const result = await search(network, settings, controller.signal, progress, { strategy: dependencies.searchStrategy, pinnedStartId });
        return { ...result, metrics: { ...metrics(), transferMs: result.transferMs, worker: result.timing, coverage: coverage.kind, searchStrategy: dependencies.searchStrategy ?? 'nearest', coverageStrategy: dependencies.coverageStrategy ?? 'corridor' } };
      } catch (error) {
        if (!(error instanceof CoverageGapError) || coverage.kind !== 'corridor') throw error;
        pinnedStartId = error.startNodeId ?? pinnedStartId;
        const expanded = attempt === 0 ? expandCoverage(coverage, error.gaps) : undefined;
        if (!expanded) throw new Error('No loop found within downloaded coverage. The bounded connection check could not complete a route. Move the center, try a smaller circle or choose another Start. Wider detours have not been checked.');
        coverage = expanded;
      }
    }
    throw new Error('No loop found within the corridor budget.');
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
    if (controller.signal.aborted) throw new PlanningFailure('Route planning time budget reached. Try a smaller circle.', 'budget', metrics());
    const mapFailure = error instanceof MapServiceError ? { ...error.detail, stage: requestStage } : undefined;
    const message = error instanceof Error ? error.message : 'Route planning stopped.';
    throw new PlanningFailure(mapFailure ? `${requestStage === 'initial' ? 'Initial road download' : 'Connection-check download'} failed. ${message}` : message, phase, { ...metrics(), ...(mapFailure ? { mapFailure } : {}) });
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}
