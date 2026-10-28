import type { SolveTiming } from './types';
export type SearchStrategy = 'nearest' | 'joint' | 'hybrid';
export type CoverageStrategy = 'corridor' | 'hybrid-small';
export type SearchLimits = { expansions: number; timeMs: number };
export type SearchBudget = { remaining: number; deadline: number };
export const MAX_SEARCH_LIMITS: Readonly<SearchLimits> = { expansions: 1800000, timeMs: 14000 };
export const normalizeSearchLimits = (limits: Partial<SearchLimits> = {}): SearchLimits => ({
  expansions: Number.isFinite(limits.expansions) ? Math.max(0, Math.min(MAX_SEARCH_LIMITS.expansions, Math.floor(limits.expansions!))) : MAX_SEARCH_LIMITS.expansions,
  timeMs: Number.isFinite(limits.timeMs) ? Math.max(0, Math.min(MAX_SEARCH_LIMITS.timeMs, limits.timeMs!)) : MAX_SEARCH_LIMITS.timeMs,
});
export type SearchOptions = { strategy?: SearchStrategy; pinnedStartId?: number; limits?: SearchLimits };
export class NoLoopError extends Error {
  constructor(message: string, readonly startNodeId: number) { super(message); this.name = 'NoLoopError'; }
}
export class SearchFailure extends Error {
  constructor(message: string, readonly timing?: SolveTiming, readonly timedOut = false) { super(message); this.name = 'SearchFailure'; }
}
export const searchLimitMessage = 'Local search reached its shared work/time limit. Try a smaller circle or another Start. No extra road request was made for flexible search.';
export function comparisonOptions(query: string): { searchStrategy: SearchStrategy; coverageStrategy: CoverageStrategy } {
  const params = new URLSearchParams(query), search = params.get('routeSearch');
  return {
    searchStrategy: search === 'nearest' || search === 'joint' ? search : 'hybrid' as const,
    coverageStrategy: params.get('roadCoverage') === 'hybrid-small' ? 'hybrid-small' as const : 'corridor' as const,
  };
}
