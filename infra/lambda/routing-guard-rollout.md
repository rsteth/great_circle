# Great Circle routing protection: deployed operations

**Verified deployment, November 7, 2026:** production serves guarded Lambda version 3 from source `e2e90c7cbe022e077c0ed44e8e5fe75862089e83`. [Workflow 42335394534](https://github.com/rsteth/great_circle/actions/runs/42335394534) passed backend verification, all frontend checks and Pages publication. The table, scoped runtime policy, four alarms and shared alert topic are active. Before enablement, a disabled route returned HTTP 503 with zero provider requests; old-version work was drained for over 30 seconds. HeiGIT showed 2,000/2,000 Directions requests remaining before enablement. One bounded public canary then returned HTTP 200/ok, a closed 432-point route and two provider requests in about 3.1 seconds, with the expected origin-restricted CORS. Afterward, control was enabled at revision 3 with exactly two global reservations, and HeiGIT showed 1,998/2,000 remaining. These are point-in-time observations, not ongoing usage guarantees.

The shared SNS subscription is confirmed; CloudWatch successfully published one setup test at 2026-11-07 03:37:44 UTC. Mailbox delivery has not been verified. Actual Lambda JSON warning shape was checked with the disabled-guard event. AWS log-filter tests matched near-budget warnings and handled ORS/secret errors, excluded the disabled event from errors, and published no synthetic log or additional alert.

The ORS secret and design-foundation worktree were not changed. The steps below remain the operational rollout and rollback reference.

## Intended behavior

Anonymous use stays available. A DynamoDB-backed guard admits work before any upstream ORS call. It fails closed if required state is missing, malformed, unavailable, throttled or too contended.

Defaults:
- Global: 36 ORS reservations in a conservative 80-second admission window. Each reservation must be used within 20 seconds and is checked immediately before starting fetch. This bounds local send bursts to 36 per 60 seconds; it does not control network delay or provider arrival timing.
- Global: 1,800 ORS reservations in a conservative rolling-day window.
- Per client: 3 generation starts in a sliding 60 seconds and 60 in a conservative rolling-day window.
- Global hourly buckets remain until 24 hours plus the 20-second send-lease allowance after their hour ends. The conservative window is 24–25 hours plus up to 20 seconds, never a UTC-midnight reset. At the first 20 seconds of an hour, up to 26 buckets may be retained. This preserves the daily local-send allowance despite admission-to-send delay.
- Reservations are not refunded. A failure after admission may consume budget without consuming ORS quota.
- A shared enabled flag is checked before upstream reservations. Disabling prevents further reservations, but already admitted or in-flight calls may finish.
- Browser cancellation still does not guarantee cancellation of buffered Lambda execution.

ORS currently documents 2,000 Directions calls per provider day and 40 per sliding 60 seconds. Its day resets 24 hours after its first request. The application deliberately leaves headroom, but cannot account for other software using the same ORS credential. Actual account-specific quota must be verified before rollout.

Client identity comes only from Lambda's trusted source-IP event field, never a client-supplied header. Only a scoped keyed digest is persisted, not raw IP addresses or coordinates. IPv6 addresses are grouped by network prefix. This is a fairness measure, not authentication: shared networks share an allowance; attackers with multiple IPs can bypass per-client limits, but not the atomic global budget. Client records expire after inactivity. DynamoDB TTL deletion is asynchronous, so physical deletion can occur days after their expiration timestamp.

## Proposed AWS resources and permissions

Target: existing Great Circle account ending 6476, us-east-1. The CloudFormation proposal requires explicit account confirmation and checks the region.

The proposal creates:
- One Standard on-demand DynamoDB table: great-circle-prod-routing-guard, partition key pk. TTL uses expiresAt for client records; the control item has no TTL. Encryption at rest and deletion protection enabled. Maximum on-demand throughput is 20 read and 20 write request units/second.
- One narrowly scoped inline policy on existing great-circle-prod-runtime, allowing only dynamodb:GetItem and dynamodb:PutItem on that exact table.
- Two log metric filters with fixed dimensions and four five-minute alarms: global budget warning, handled guard/SSM/ORS failures, Lambda errors, Lambda throttles.
- A reference to the verified shared SNS topic, created once by the separate shared-alert destination stack for Great Circle, Reads and Bandit. This app stack never owns the topic policy or email subscription. See ../alerts/shared-app-alerts-rollout.md.

It does not modify the ORS key, SSM permissions, Lambda Function URL, authentication type, CORS, runtime configuration, code, aliases, current deployment role or project defaults. The infrastructure proposal does not seed a control record or deploy the new Lambda code.

No browser client ID, IP address, coordinate, credential, request body, or AWS exception text is included in guard or service-failure events. Handled SSM/ORS failures use static allowlisted reason labels, and expected unroutable routes or gate denials do not create misleading ORS-failure events. The log filters assume the existing Lambda JSON logging format and structured console.warn object messages. Verify this against a non-secret test event before declaring notifications operational. Event emission is bounded per reason/scope per warm execution environment, so these metrics signal problems rather than count all affected requests.

## Cost estimate and limits

Published us-east-1 prices, before shared account free allowances:
- DynamoDB: $0.625 per million write units and $0.125 per million read units. At 500–900 generations/day, small counters should cost well below $1/month absent abusive traffic or heavy contention. Each conditional rewrite is charged according to item size; failed writes, reads and bounded retries also cost money.
- Two custom metrics plus four standard alarm metrics: approximately $1/month. Existing account free allowances may cover them.
- SNS email delivery is $2 per 100,000 deliveries, plus applicable publish/request charges; a handful of alerts is negligible.
- Existing 512 MiB ARM Lambda at 900 generations/day: roughly $3.61/month if every call takes 20 seconds, or $5.41 at 30 seconds, before free allowances. These are conservative examples, not a forecast of actual latency or a change in existing Lambda pricing.

The application budget limits ORS work. It does not cap the AWS bill. Rejected anonymous traffic can still incur Lambda, DynamoDB, network and log usage. Table maximum throughput helps bound table work but is not a dollar cap. Alerts are notifications, not a guarantee of immediate delivery or spending stops.

## Approval and rollout checklist

Do not run a deployment from these files without explicit approval covering:
1. The exact table and runtime IAM grant above.
2. The shared alert destination and the chosen email recipient, plus this app's exact monitoring package.
3. Proposed limits and the pseudonymous client counter retention.
4. Publication/integration of the reviewed backend source, tests and infrastructure documentation into the existing Great Circle repository/main workflow, with the current repository audience. No design-foundation changes are included.
5. The tested Lambda code/version and prod-alias switch, with anonymous access unchanged.
6. A small explicit allowance for deployment validation, including any real ORS request.

Before deployment:
- Verify the AWS account/principal, current function/alias/configuration/digest, existing runtime role policies, Function URL/CORS, SSM metadata only, current account concurrency, log format/retention, and provider account plan.
- Inspect a CloudFormation change set. Stop on any unexpected existing resource or IAM/network/secret change.
- Run all local unit/type/build checks. Test mock concurrent admissions, sliding boundaries, malformed state, DynamoDB failures, stale writes and disabled control.
- Keep the working design-system branch separate. Reconcile only backend import path moves when later integrating.

Proposed initial control record (disabled):
```json
{
  "pk": {"S": "control"},
  "revision": {"N": "0"},
  "enabled": {"BOOL": false},
  "state": {"S": "{\"lastAt\":0,\"minute\":[],\"hours\":[]}"}
}
```

Initialization must use attribute_not_exists(pk), never overwrite existing counters. Existing records must be inspected and migrated deliberately, not reset to recover from an error.

Safe rollout sequence:
1. Create/verify the approved shared SNS destination once; confirm its recipient and test non-sensitive alert delivery. Then create only this app's approved table, narrow role policy, filters and alarms using the verified shared TopicArn.
2. Seed disabled control once. Verify fail-closed behavior with a private/test invocation that cannot call ORS.
3. Publish/integrate the approved backend source so main remains the canonical guarded implementation, then use the existing backend-first workflow to deploy the reviewed version. A one-off Lambda upload while main still contains the unguarded implementation is unsafe: a later normal deployment could restore it. Confirm code/configuration match. Health alone cannot prove that the budget store is operational because health intentionally reads neither store nor secret.
4. Before enabling, drain the previous unguarded version for at least its full 30-second invocation timeout and establish a conservative quota baseline. Empty counters are safe only after a verified ORS quota reset/quiet period with no other use of this key. Otherwise seed historical usage conservatively from verified provider remaining/reset information or sufficiently complete invocation records, including canaries and telemetry delay. Do not assume that deploying a new version resets provider quota. If the baseline cannot be verified, keep control disabled and ask for the needed provider information or wait for an agreed quiet/reset window. Never overwrite existing guard counters.
5. Enable control with a conditional revision update, then run only the explicitly approved bounded route canary.
6. Confirm budget advancement, public UI behavior, no credential leakage, and actual alert extraction.

## Emergency stop and recovery

The normal stop is an operator DynamoDB UpdateItem on pk=control:
- SET enabled = false
- ADD revision by 1
- Require the item to exist.

Do not modify state or delete/reset counters. Incrementing revision makes in-flight compare-and-swap writes fail. Runtime has no DynamoDB UpdateItem permission; this operator action uses a separately approved identity. Malformed/missing state also fails closed, but is not the recommended stop procedure.

Re-enabling is a separate authorized action: inspect counters and the issue, then conditionally SET enabled = true and increment revision using the observed revision. Do not treat a normal throttling response as a reason to clear the budget.

If malicious request volume is causing AWS cost, this flag stops provider work but does not remove public Lambda invocation cost. Changing the URL to AWS_IAM or setting reserved concurrency to zero would affect public access and needs separate approval; neither is automatic here.

Do not roll back to an unguarded older Lambda while assuming the DynamoDB flag still protects it. During recovery, keep guarded code fail-closed or explicitly approve temporary public access shutdown before deploying an older implementation.

## Sources

- ORS quotas and window semantics: https://giscience.github.io/openrouteservice/frequently-asked-questions.html
- ORS current plans: https://account.heigit.org/info/plans
- DynamoDB pricing: https://aws.amazon.com/dynamodb/pricing/
- DynamoDB maximum throughput: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode-max-throughput.html
- CloudWatch pricing: https://aws.amazon.com/cloudwatch/pricing/
- SNS pricing context: https://aws.amazon.com/sns/faqs/
- Lambda pricing: https://aws.amazon.com/lambda/pricing/

## Historical pre-rollout AWS snapshot, November 7, 2026

Before this rollout, read-only checks recorded the following facts without reading the ORS secret value. This historical snapshot is superseded by the verified deployment status above:
- Before rollout, prod pointed to Lambda version 2, Node24/ARM64, 512 MiB, 30-second timeout; JSON logs at WARN/INFO.
- Function URL remains anonymous (AuthType NONE), buffered, with CORS restricted to https://stethem.com and no credentialed browser requests. Public invocation policy is limited to the prod alias and URL invocation.
- SSM parameter is Standard SecureString, version 1, encrypted with alias/aws/ssm.
- Runtime has one inline policy: GetParameter on that exact secret and writes to its own log group. No attached managed policies.
- Deployment role trusts only the repository main-branch GitHub OIDC subject; its inline policy has no SSM access or IAM mutation beyond passing the fixed runtime role. It can deploy/configure the named Lambda, so code-deployment authority remains part of the credential trust boundary.
- Log retention is seven days. There are no existing alarms with the Great Circle prefix and no proposed guard table.
- Regional concurrency is 10 with all 10 unreserved; no function reservation is set.
- CloudWatch reported 15 invocations in the sampled preceding seven days, zero reported function errors/throttles, maximum duration about 3.05 seconds. Health checks are included; these metrics are not an exact ORS-quota baseline.

The subsequent approved rollout completed table/policy/alarm creation, provider-baseline verification, runtime deployment and log-filter checks. Subscription confirmation and CloudWatch setup-test publication are verified; mailbox delivery remains unverified. No billing cap is provided.
