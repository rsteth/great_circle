import { solve } from './solve';
import type { WorkerRequest, WorkerResponse } from './types';
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const send = (message: WorkerResponse) => self.postMessage(message);
  try {
    send({ type: 'progress', message: 'Building a directed cycling network…' });
    const route = solve(event.data.data, event.data.settings, message => send({ type: 'progress', message }));
    send({ type: 'result', route });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Route search failed. Try a smaller area.' });
  }
};
