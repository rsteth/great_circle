export type ServiceReason = 'secret_unavailable' | 'ors_unavailable' | 'ors_timeout';
export type ServiceEvent = { event: 'routing_service'; reason: ServiceReason };
export type ServiceReporter = (reason: ServiceReason) => void;
// Only static allowlisted fields cross the log boundary. Sink failures are inert.
export function createServiceReporter(log: (event: ServiceEvent) => void = event => console.warn(event), now = Date.now): ServiceReporter {
 const last = new Map<ServiceReason, number>();
 return reason => {
  if (reason !== 'secret_unavailable' && reason !== 'ors_unavailable' && reason !== 'ors_timeout') return;
  try {
   const at = now();
   if (at - (last.get(reason) ?? -Infinity) < 60_000) return;
   last.set(reason, at);
   log({ event: 'routing_service', reason });
  } catch { /* Logging must never change routing or expose the sink exception. */ }
 };
}
