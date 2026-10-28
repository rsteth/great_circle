import { compileCoverage, CoverageGapError, type Coverage } from './coverage';
import { distance } from './geo';
import type { Edge, Graph, OsmData, OsmNode, Settings, Tags } from './types';
const allowed = new Set(['yes', 'designated', 'official', 'permissive']);
const paved = new Set(['asphalt', 'paved', 'concrete', 'concrete:lanes', 'concrete:plates', 'paving_stones', 'sett', 'cobblestone', 'metal', 'wood']);
const roads = new Set(['cycleway', 'residential', 'living_street', 'unclassified', 'service', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'track', 'path', 'footway', 'pedestrian']);
export function bicycleAccess(tags: Tags, node = false): boolean {
  if (Object.keys(tags).some(k => /^(access|vehicle|bicycle|oneway).*:conditional$/.test(k))) return false;
  const access = tags.bicycle ?? tags.vehicle ?? tags.access;
  if (access !== undefined && !allowed.has(access)) return false;
  if (tags.highway === 'construction' || tags.construction || tags.proposed || tags.motorroad === 'yes' || tags.ford === 'yes' || tags.highway === 'ford') return false;
  if (node) {
    if (tags.barrier && !['bollard', 'entrance', 'cattle_grid'].includes(tags.barrier) && !allowed.has(tags.bicycle)) return false;
    return true;
  }
  if (!roads.has(tags.highway)) return false;
  if (['path', 'footway', 'pedestrian'].includes(tags.highway) && !allowed.has(tags.bicycle)) return false;
  return true;
}
export function directions(tags: Tags): [boolean, boolean] {
  let one = tags['oneway:bicycle'] ?? tags.oneway ?? (tags.junction === 'roundabout' ? 'yes' : 'no');
  if (tags['oneway:bicycle'] === undefined && Object.entries(tags).some(([key, value]) => /^cycleway(:left|:right)?$/.test(key) && value.startsWith('opposite'))) one = 'no';
  if (!['no', '0', 'false', 'yes', '1', 'true', '-1'].includes(one)) return [false, false];
  let forward = one !== '-1';
  let backward = !['yes', '1', 'true'].includes(one);
  for (const [key, direction] of [['bicycle:forward', 'forward'], ['bicycle:backward', 'backward']] as const) {
    if (tags[key] !== undefined && !allowed.has(tags[key])) {
      if (direction === 'forward') forward = false;
      else backward = false;
    }
  }
  return [forward, backward];
}
export function buildGraph(data: OsmData, settings: Settings, coverage?: Coverage): Graph {
  if (data.remark) throw new Error('OpenStreetMap returned incomplete data. Wait a little, then try a smaller area.');
  if (!Array.isArray(data.elements) || data.elements.length > 200000) throw new Error('This area is too dense. Reduce the search radius.');
  const graph: Graph = { nodes: new Map(), edges: new Map(), turns: new Map(), notes: [], coverage };
  const covered = coverage?.kind === 'corridor' ? compileCoverage(coverage) : undefined;
  const frontier = new Map<number, OsmNode>();
  const rawNodes = covered ? new Map(data.elements.filter((element): element is OsmNode => element.type === 'node').map(node => [node.id, node])) : new Map<number, OsmNode>();
  const blockedWays = new Set<number>();
  // A via-way or conditional restriction needs a richer state machine. Exclude its
  // approach ways rather than silently route through a potentially illegal turn.
  for (const element of data.elements) {
    if (element.type !== 'relation') continue;
    const tags = element.tags ?? {};
    if (tags.type !== 'restriction') continue;
    const explicit = tags['restriction:bicycle'];
    const bicycleConditional = tags['restriction:bicycle:conditional'];
    if (!explicit && !bicycleConditional && (tags.except ?? '').split(';').map(v => v.trim()).includes('bicycle')) continue;
    const rule = explicit ?? tags.restriction;
    if (!rule && !Object.keys(tags).some(k => k.startsWith('restriction') && k.endsWith(':conditional'))) continue;
    const from = element.members.filter(m => m.role === 'from' && m.type === 'way');
    const to = element.members.filter(m => m.role === 'to' && m.type === 'way');
    const via = element.members.filter(m => m.role === 'via');
    if (!rule || !/^(no_|only_)/.test(rule) || from.length !== 1 || to.length !== 1 || via.length !== 1 || via[0].type !== 'node' || Object.keys(tags).some(k => k.startsWith('restriction') && k.endsWith(':conditional'))) {
      from.forEach(m => blockedWays.add(m.ref));
      continue;
    }
    const rules = graph.turns.get(via[0].ref) ?? [];
    rules.push({ from: from[0].ref, to: to[0].ref, only: rule.startsWith('only_'), uturn: rule.endsWith('u_turn') });
    graph.turns.set(via[0].ref, rules);
  }
  if (blockedWays.size) graph.notes.push('Approach roads with unsupported or conditional turn restrictions were excluded.');
  for (const element of data.elements) {
    if (element.type === 'node' && Number.isFinite(element.lat) && Number.isFinite(element.lon) && bicycleAccess(element.tags ?? {}, true) && (coverage?.kind === 'corridor' ? covered!.contains(element) : distance(element, settings.center) <= settings.radiusM)) graph.nodes.set(element.id, element);
  }
  for (const way of data.elements) {
    if (way.type !== 'way' || !way.tags || blockedWays.has(way.id) || !bicycleAccess(way.tags)) continue;
    const tags = way.tags;
    const known = paved.has(tags.surface);
    if (settings.surface === 'paved' && !known) continue;
    const [forward, backward] = directions(tags);
    if (!forward && !backward) continue;
    const highway = tags.highway;
    const busy = ['primary', 'primary_link', 'secondary', 'secondary_link'].includes(highway);
    const factor = 1 + (busy ? (settings.style === 'quiet' ? 3 : 0.7) : ['tertiary', 'tertiary_link'].includes(highway) ? 0.35 : 0) + (!known ? 0.15 : 0) + (highway === 'service' ? 0.15 : 0);
    for (let i = 1; i < way.nodes.length; i++) {
      const a = graph.nodes.get(way.nodes[i - 1]);
      const b = graph.nodes.get(way.nodes[i]);
      if (!a || !b) {
        if (covered) {
          const missing = rawNodes.get(way.nodes[a ? i : i - 1]);
          const inside = a ?? b;
          if (inside && missing && bicycleAccess(missing.tags ?? {}, true) && !covered.contains(missing)) frontier.set(inside.id, inside);
        }
        continue;
      }
      if (a.id === b.id) continue;
      // Endpoint membership alone is insufficient for a non-convex corridor.
      // Keep original nodes only; never synthesize clipped GPX geometry.
      if (covered && !covered.segment(a, b)) { frontier.set(a.id, a); frontier.set(b.id, b); continue; }
      const length = distance(a, b);
      const add = (from: OsmNode, to: OsmNode) => {
        const edges = graph.edges.get(from.id) ?? [];
        edges.push({ from: from.id, to: to.id, way: way.id, length, factor, surfaceKnown: tags.surface !== undefined });
        graph.edges.set(from.id, edges);
      };
      if (forward) add(a, b);
      if (backward) add(b, a);
    }
  }
  const used = new Set<number>();
  for (const [id, edges] of graph.edges) { used.add(id); edges.forEach(e => used.add(e.to)); }
  for (const id of graph.nodes.keys()) if (!used.has(id)) graph.nodes.delete(id);
  graph.frontier = [...frontier.values()];
  if (graph.nodes.size < 3 && coverage?.kind === 'corridor' && graph.frontier.length) throw new CoverageGapError('No connected cycling network in downloaded coverage.', graph.frontier.slice(0, 2));
  if (graph.nodes.size < 3) throw new Error(coverage?.kind === 'corridor' ? 'No usable cycling network within downloaded coverage. Roads outside it are unknown. Try another area or start.' : 'No usable cycling network in this area with these preferences. Try mixed surfaces or a different area.');
  if (coverage?.kind === 'corridor') graph.notes.push('Route uses downloaded corridor coverage; detours outside it are unknown.');
  return graph;
}
export function turnAllowed(graph: Graph, previous: Edge | undefined, next: Edge): boolean {
  if (!previous) return true;
  if (previous.to !== next.from) return false;
  // Avoid immediate backtracking even where legal: it cannot improve a circle.
  if (previous.from === next.to) return false;
  for (const rule of graph.turns.get(next.from) ?? []) {
    if (rule.from !== previous.way) continue;
    const matches = rule.to === next.way && (!rule.uturn || previous.from === next.to);
    if (rule.only ? !matches : matches) return false;
  }
  return true;
}
