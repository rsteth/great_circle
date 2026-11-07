# Anonymous routing guard (runtime rollout pending)

Status, November 7, 2026: the table, scoped runtime policy, four alarms and shared alert topic are created and verified. Control is seeded disabled at revision 0. The production alias remains version 2, without this guarded runtime. The shared SNS subscription is confirmed, and CloudWatch successfully published one setup test at 2026-11-07 03:37:44 UTC. Mailbox delivery has not been verified. Guarded code publication/enablement remains blocked pending the user’s HeiGIT sign-in and current provider-usage baseline; the latest check still showed the login page. Main remains at f84c7f8.

The ORS key remains server-only in the existing encrypted SSM parameter. It is neither rotated nor copied into configuration, responses, persisted rate-limit records or logs. Anonymous routing is retained. CORS is a browser policy, not authentication or an abuse budget.

## Limits and algorithm

The guarded Lambda implementation uses the fixed `great-circle-prod-routing-guard` DynamoDB table in `us-east-1`. A strongly consistent read plus conditional PutItem reserves each outbound ORS call globally, across cold starts and instances. Four CAS attempts maximum, AWS automatic retries disabled, 1.5-second per-operation timeout, and the existing 20-second aggregate request deadline bound work. Unknown write outcomes fail closed without retry/refund.

- Global: 36 reservations per sliding 80 seconds, 1,800 per conservative rolling day. Each reservation permits a local send only before its recorded timestamp plus 20 seconds. Retaining 60 seconds plus the 20-second send lease bounds local fetch starts conservatively to 36 per sliding 60 seconds, despite delayed CAS acknowledgments.
- Client: three generation starts per sliding 60 seconds, 60 per conservative rolling day.
- Client rolling days retain the current hourly bin plus 24 prior hourly bins. Global bins expire only at (bucketHour+25)*oneHour+20 seconds, preserving the send lease at the boundary. This retains 24–25 hours plus 20 seconds, with up to 26 bins during the first 20 seconds of an hour, rather than resetting at UTC midnight. ORS's provider day is a 24-hour period starting with its first request. The internal cap leaves headroom below the published 2,000/day and 40/minute quotas, provided this key is not used outside this guarded service.
- Reservations are charged even if a subsequent abort or network failure prevents sending. No refunds. Each loop still makes at most two ORS calls. Budget and protection failures stop retries; warm provider cooldown is checked before reserving.
- A read-only global availability/budget precheck occurs before creating/updating client records. The global CAS still occurs separately immediately before every actual provider send, including a second direction attempt.

Only Lambda's `requestContext.http.sourceIp` establishes the client. Forwarded headers, cookies and caller authorization are ignored. IPv4 is normalized; IPv4-mapped IPv6 shares the IPv4 bucket, and native IPv6 shares a /64 bucket. A scoped HMAC-SHA256 under the in-memory server key provides the stored client identifier. No raw IP, coordinates, request body or client identifier is logged. Key rotation changes client buckets but leaves the global budget intact. NAT/shared networks can share client limits; rotating networks can evade client limits, but not the global cap.

## Failure and emergency behavior

Missing/uninitialized control, malformed state, backwards clocks, throttling, exhausted contention retries, store failures and unknown client identity all deny outbound routing. Health, preflight and invalid input do not read the secret or guard. There is no permissive production fallback; tests inject explicit mock guards/stores. Local loopback development server remains separate and does not connect to DynamoDB.

Control is `pk=control`, with `revision` (number), `enabled` (boolean), and `state` (JSON string containing `lastAt`, `minute`, `hours`). It has **no TTL**. Client records use `pk=client:<scoped HMAC>`, revision and state, plus `expiresAt` at least 26 hours after last counted use. DynamoDB TTL expiry is cleanup, not the rate-limit decision. Counters are bounded to 36 global / 3 client short-window timestamps and 26 global / 25 client hourly bins.

Operators disable by atomically setting `enabled=false` and incrementing `revision`. Runtime reservations require the previously read revision **and enabled=true**; a stale writer cannot turn routing back on. Already acquired/in-flight work may finish. Preserve counters on disable/re-enable. Do not delete or reset control to restore service: doing so defeats the rolling budget. The approved staged rollout has seeded control disabled; enabling still requires a verified provider-usage baseline and draining old unguarded work. See the infrastructure proposal/runbook.

Warnings are structured objects `{event: 'routing_guard', reason, scope}`. Reasons are `near_budget` (at least 80% daily usage), `budget_block`, `guard_error`, `disabled`; scope is `global`, `client` or `store`. Each reason/scope logs at most once per minute per warm process. Logs contain no exception text, IP, identifier or key. Multiple processes may each log, so this is not a fleetwide log quota.

This is a conservative reservation/local-send control, not an exact guarantee of ORS arrival timing: network delay can shift arrivals after a local fetch starts. Explicit wall-clock checks enforce the send lease and aggregate invocation deadline even if abort timer callbacks are delayed. This reduces provider quota exposure, not Lambda/DynamoDB denial-of-wallet: rejected public traffic still incurs invocation/read costs. Per-client writes are avoided during known global exhaustion/disable, but the public endpoint remains reachable. Stronger perimeter filtering/authentication would be separate work. Guard infrastructure has now been applied separately; guarded runtime publication and enablement remain pending as stated above.

## Local verification

Mocked guard tests cover limits, minute/day boundaries, concurrent CAS, stale disable races, malformed/missing state, clock rollback, IPv6, abort after reservation, unknown source IP, global precheck, bounded logging and SDK command shapes. Lambda tests exercise secret isolation and deadlines; ORS tests verify pre-send gating, cooldown and no redirect/retry loophole. These tests do not prove AWS IAM deployment or live service behavior.
