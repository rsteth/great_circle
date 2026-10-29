import type { Point, Route, Settings } from '../routing/types';
export type LoopRequest = { requestId: string; settings: Settings };
export type ShapeScore = { distanceError: number; roundness: number; radialError: number; angularCoverage: number; winding: number; retraced: number; lengthM: number; snapM: number };
export type LoopResult = ({ providerRequests?: number } & ({ status: 'ok'; requestId: string; route: Route; score: ShapeScore; requests: number } | { status: 'unavailable' | 'unroutable' | 'shape-tolerance' | 'cancelled' | 'invalid-request'; requestId: string; message: string; requests: number; retryAfterSeconds?: number; score?: ShapeScore }));
export type ProviderGeometry = { points: Point[]; distanceM: number; waypoints: number[]; surface?: [number, number, number][] };
export type PreparedProvider = { requestCount?(): number; route(coordinates: Point[], settings: Settings, signal: AbortSignal): Promise<ProviderGeometry> };
export class ProviderFailure extends Error {
  constructor(readonly kind: 'unavailable' | 'unroutable', message: string, readonly retryAfterSeconds?: number) { super(message); }
}
