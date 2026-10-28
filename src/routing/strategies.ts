// Explicit experimental switches; the published nearest/corridor defaults remain.
export type SearchStrategy = 'nearest' | 'joint';
export type CoverageStrategy = 'corridor' | 'hybrid-small';
export type SearchOptions = { strategy?: SearchStrategy; pinnedStartId?: number };
export function comparisonOptions(query: string) {
  const params = new URLSearchParams(query);
  return {
    searchStrategy: params.get('routeSearch') === 'joint' ? 'joint' as const : 'nearest' as const,
    coverageStrategy: params.get('roadCoverage') === 'hybrid-small' ? 'hybrid-small' as const : 'corridor' as const,
  };
}
