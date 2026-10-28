import { NoLoopError, normalizeSearchLimits, SearchFailure, searchLimitMessage, type SearchOptions, type SearchBudget } from './strategies';
import { coverageKey, covers, CoverageGapError, type Coverage } from './coverage';
import { buildGraph } from './graph';
import { loopCore, solve, validateSettings } from './solve';
import type { Graph, OsmData, Route, Settings, SolveTiming } from './types';
// One dataset per worker; two bounded prepared graphs. Hybrid stages share the
// same graph, pinned Start, deadline and expansion counter. No fetch occurs here.
export class RoutingEngine {
  private data?: OsmData;
  private sourceCoverage?: Coverage;
  private graphs = new Map<string, { graph: Graph; edges: number }>();
  setData(data: OsmData, sourceCoverage?: Coverage) { if (this.data !== data || coverageKey(this.sourceCoverage) !== coverageKey(sourceCoverage)) { this.data = data; this.sourceCoverage = sourceCoverage; this.graphs.clear(); } }
  solve(settings: Settings, progress: (message: string) => void = () => {}, coverage?: Coverage, options: SearchOptions = {}) {
    validateSettings(settings);
    if (!this.data) throw new Error('Map data is missing. Generate again.');
    if (coverage && (!this.sourceCoverage || !covers(this.sourceCoverage, coverage))) throw new Error('Dataset does not cover the requested corridor.');
    const started = performance.now(), limits = normalizeSearchLimits(options.limits);
    const budget: SearchBudget = { remaining: limits.expansions, deadline: performance.now() + limits.timeMs };
    const timing: SolveTiming = { graphMs: 0, graphCached: false, snapComponentMs: 0, searchMs: 0, totalMs: 0, anchorNodeProjections: 0, pathExpansions: 0, stages: [] };
    const exhausted = () => budget.remaining <= 0 || performance.now() >= budget.deadline;
    const finish = () => {
      timing.totalMs = performance.now() - started;
      timing.searchBudget = { expansionLimit: limits.expansions, timeLimitMs: limits.timeMs, remainingExpansions: budget.remaining, remainingTimeMs: Math.max(0, limits.timeMs - timing.totalMs) };
    };
    try {
      if (exhausted()) throw new Error(searchLimitMessage);
      const key = JSON.stringify([settings.center.lat, settings.center.lon, settings.radiusM, settings.surface, settings.style, coverageKey(coverage)]);
      let entry = this.graphs.get(key);
      timing.graphCached = !!entry;
      if (entry) { this.graphs.delete(key); this.graphs.set(key, entry); }
      else {
        progress('Building a directed cycling network…');
        const graph = loopCore(buildGraph(this.data, settings, coverage));
        const edges = [...graph.edges.values()].reduce((sum, list) => sum + list.length, 0);
        entry = { graph, edges };
        if (edges <= 250000) {
          this.graphs.set(key, entry);
          while (this.graphs.size > 2 || [...this.graphs.values()].reduce((sum, item) => sum + item.edges, 0) > 250000) this.graphs.delete(this.graphs.keys().next().value!);
        }
      }
      timing.graphMs = performance.now() - started;
      const run = (strategy: 'nearest' | 'joint', pinnedStartId = options.pinnedStartId): Route => {
        if (exhausted()) throw new Error(searchLimitMessage);
        progress(strategy === 'nearest' ? 'Finding a loop…' : 'Trying a more flexible loop on the same roads…');
        const stageStarted = performance.now(), before = budget.remaining;
        const stage: SolveTiming = { graphMs: 0, graphCached: true, snapComponentMs: 0, searchMs: 0, totalMs: 0, anchorNodeProjections: 0, pathExpansions: 0 };
        let status: 'success' | 'no-loop' | 'limit' | 'error' = 'error', startNodeId = pinnedStartId;
        try {
          const route = solve(this.data!, settings, message => progress(`${strategy === 'nearest' ? 'Quick' : 'Flexible'} search · ${message}`), { graph: entry!.graph, timing: stage, strategy, pinnedStartId, budget });
          startNodeId = route.startNodeId; status = 'success'; return route;
        } catch (error) {
          if (error instanceof NoLoopError || error instanceof CoverageGapError) { status = exhausted() ? 'limit' : 'no-loop'; startNodeId = error.startNodeId; }
          throw error;
        } finally {
          timing.snapComponentMs += stage.snapComponentMs;
          timing.searchMs += stage.searchMs;
          timing.anchorNodeProjections += stage.anchorNodeProjections;
          const used = before - budget.remaining; timing.pathExpansions += used;
          timing.stages!.push({ strategy, status, elapsedMs: performance.now() - stageStarted, pathExpansions: used, startNodeId });
        }
      };
      const strategy = options.strategy ?? 'hybrid';
      if (strategy !== 'hybrid') return { route: run(strategy), timing };
      try { return { route: run('nearest'), timing }; }
      catch (nearestError) {
        if (!(nearestError instanceof NoLoopError || nearestError instanceof CoverageGapError) || nearestError.startNodeId === undefined) throw nearestError;
        if (exhausted()) throw new Error(searchLimitMessage);
        try {
          const route = run('joint', options.pinnedStartId ?? nearestError.startNodeId);
          route.notes.push('Found with flexible search after the quick search found no acceptable loop on these roads.');
          return { route, timing };
        } catch (jointError) {
          if (exhausted()) throw new Error(searchLimitMessage);
          if (!(jointError instanceof NoLoopError || jointError instanceof CoverageGapError)) throw jointError;
          // Keep baseline fetch eligibility and gap locations. Flexible anchors
          // must not fan out into new downloads or relabel cached coverage.
          if (nearestError instanceof CoverageGapError) throw nearestError;
          if (jointError instanceof CoverageGapError) throw new NoLoopError('No acceptable loop found after quick and flexible search on the downloaded roads. Move the circle or Start, or choose a smaller circle. Wider detours remain unknown.', nearestError.startNodeId);
          throw jointError;
        }
      }
    } catch (error) {
      finish();
      if (error instanceof CoverageGapError) { error.timing = timing; throw error; }
      throw new SearchFailure(error instanceof Error ? error.message : 'Local route search failed.', timing);
    } finally { finish(); }
  }
}
