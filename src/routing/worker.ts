import { RoutingEngine } from './engine';
import type { WorkerRequest, WorkerResponse } from './types';
const engine = new RoutingEngine();
let datasetId: string | undefined;
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const send = (message: Omit<Extract<WorkerResponse, { type: 'progress' }>, 'id'> | Omit<Extract<WorkerResponse, { type: 'result' }>, 'id'> | Omit<Extract<WorkerResponse, { type: 'error' }>, 'id'>) => self.postMessage({ ...message, id: request.id });
  try {
    if (request.data) { engine.setData(request.data); datasetId = request.datasetId; }
    if (datasetId !== request.datasetId) throw new Error('Map data changed. Generate again.');
    const { route, timing } = engine.solve(request.settings, message => send({ type: 'progress', message }));
    send({ type: 'result', route, timing });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Route search failed. Try a smaller area.' });
  }
};
