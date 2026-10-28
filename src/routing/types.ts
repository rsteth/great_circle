import type { Coverage } from './coverage';
export type Point = { lat: number; lon: number };
export type Tags = Record<string, string>;
export type OsmNode = Point & { type: 'node'; id: number; tags?: Tags };
export type OsmWay = { type: 'way'; id: number; nodes: number[]; tags?: Tags };
export type OsmRelation = { type: 'relation'; id: number; tags?: Tags; members: { type: string; ref: number; role: string }[] };
export type OsmData = { elements: (OsmNode | OsmWay | OsmRelation)[]; osm3s?: { timestamp_osm_base?: string }; remark?: string };
export type Settings = {
  center: Point;
  start: Point;
  radiusM: number;
  circleRadiusM?: number; // Explicit target circle; radiusM remains the padded search boundary.
  targetKm: number;
  tolerance: number;
  surface: 'mixed' | 'paved';
  style: 'quiet' | 'balanced';
};
export type Edge = { from: number; to: number; way: number; length: number; factor: number; surfaceKnown: boolean };
export type Turn = { from: number; to: number; only: boolean; uturn: boolean };
export type Graph = {
  nodes: Map<number, OsmNode>;
  edges: Map<number, Edge[]>;
  turns: Map<number, Turn[]>;
  notes: string[];
  coverage?: Coverage;
  frontier?: Point[];
};
export type Route = {
  points: Point[];
  lengthM: number;
  error: number;
  roundness: number;
  repeated: number;
  unknownSurface: number;
  snapM: number;
  circleCenter: Point;
  circleRadiusM: number;
  candidates: number;
  notes: string[];
  dataTimestamp?: string;
};
export type NetworkTiming = { fetchMs: number; parseMs: number; bytes: number; cacheHit: boolean; elements: number; queryAreaM2: number; queryVertices: number };
export type SolveTiming = { graphMs: number; graphCached: boolean; snapComponentMs: number; searchMs: number; totalMs: number; anchorNodeProjections: number; pathExpansions: number };
export type WorkerRequest = { id: number; datasetId: string; data?: OsmData; sourceCoverage?: Coverage; coverage?: Coverage; settings: Settings };
export type WorkerResponse = { id: number } & ({ type: 'progress'; message: string } | { type: 'result'; route: Route; timing: SolveTiming } | { type: 'error'; message: string; gaps?: Point[] });
