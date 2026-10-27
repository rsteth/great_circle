import { buildGraph } from './graph';
import { loopCore, solve, validateSettings } from './solve';
import type { Graph, OsmData, Settings, SolveTiming } from './types';
// One dataset per worker; two prepared preference/boundary graphs, capped by
// directed-edge count. A cancelled worker is discarded, including these caches.
export class RoutingEngine {
  private data?: OsmData;
  private graphs = new Map<string, { graph: Graph; edges: number }>();
  setData(data: OsmData) { if (this.data !== data) { this.data = data; this.graphs.clear(); } }
  solve(settings: Settings, progress: (message: string) => void = () => {}) {
    validateSettings(settings);
    if (!this.data) throw new Error('Map data is missing. Generate again.');
    const started = performance.now();
    const key = JSON.stringify([settings.center.lat, settings.center.lon, settings.radiusM, settings.surface, settings.style]);
    let entry = this.graphs.get(key);
    const cached = !!entry;
    if (entry) { this.graphs.delete(key); this.graphs.set(key, entry); }
    else {
      progress('Building a directed cycling network…');
      const graph = loopCore(buildGraph(this.data, settings));
      const edges = [...graph.edges.values()].reduce((sum, list) => sum + list.length, 0);
      entry = { graph, edges };
      if (edges <= 250000) {
        this.graphs.set(key, entry);
        while (this.graphs.size > 2 || [...this.graphs.values()].reduce((sum, item) => sum + item.edges, 0) > 250000) this.graphs.delete(this.graphs.keys().next().value!);
      }
    }
    const timing: SolveTiming = { graphMs: performance.now() - started, graphCached: cached, snapComponentMs: 0, searchMs: 0, totalMs: 0, anchorNodeProjections: 0, pathExpansions: 0 };
    const route = solve(this.data, settings, progress, { graph: entry.graph, timing });
    timing.totalMs = performance.now() - started;
    return { route, timing };
  }
}
