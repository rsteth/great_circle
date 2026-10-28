# Nearest-first hybrid search — local revision

Implemented from `c934d19a0ef1754a0b36cd77fde7780c335dc1be` on `feat/local-routing-strategy-comparison`. No push, deployment, main/main.py change, provider request, new dependency or backend. Search now defaults to **hybrid**; corridor retrieval remains the default. This is separate from the earlier optional `hybrid-small` disk-fetch experiment.

## Behavior

1. Prepare/reuse one preference- and coverage-validated directed graph and run the existing quick nearest-anchor search (including its bounded junction fallback).
2. Return immediately if that produces an acceptable loop. A better-scoring joint alternative is intentionally not sought after a valid quick result.
3. If the quick stage cannot produce an acceptable loop on that graph, try bounded joint-anchor search on **the same prepared graph and snapped Start**. It performs no network I/O. Invalid settings, unusable graphs without a returnable snapped Start, provider errors and unexpected errors do not trigger arbitrary retries.
4. Publish a worker result only after all existing legal-edge/turn/closing-seam, distance tolerance, roundness and repeated-length checks. Failure produces no route or GPX. GPX remains every traversed original track point.

If both local stages fail with a coverage gap, only the **original quick-search gap locations/eligibility** can drive the existing single bounded expansion. The joint stage cannot add downloads for its candidates, move expansion patches to a new unverified footprint, or relabel an annular cache as complete area coverage. Objective-only failure still does not automatically widen. Existing limits remain two aggregate requests, 32MiB decoded data, 200,000 elements, 90seconds including download/cooldown/search; all access/direction/restriction handling and cache checks remain.

## Shared search budgets and cancellation

One generation now shares **1,800,000 expansions and 14seconds of local elapsed search work** across quick/flexible stages and any second downloaded graph. These are not fresh allowances for each stage. Graph preparation counts; browser accounting also charges worker startup/transfer/reply time. Network waits are excluded from the local14seconds but included in the overall90seconds. Monotonic clocks are used for local deadlines. Values supplied by comparison/test callers can lower, never raise, the caps.

The worker receives the remaining allowance, both stages use the same mutable expansion counter/deadline, and failed searches serialize timing back so planning deducts work before considering an expansion. A main-thread timer can terminate an unresponsive worker even during startup/preparation. No expansion is downloaded after search-budget exhaustion. The UI reports a planning limit separately from a completed no-loop search.

Cancel still terminates the owned worker, clears the deadline timer and dataset-transfer state, and rejects the request. Sequence/worker guards ignore obsolete progress, errors and successes. A subsequent request starts cleanly with its own current settings/Start. If a hard client deadline terminates work before the worker reports statistics, `searchTimedOut` flags incomplete telemetry; recorded expansion counts are not a claim of zero CPU/work for that unfinished search.

Progress includes **“Finding a loop…”** and, only when needed, **“Trying a more flexible loop on the same roads…”**, with Quick/Flexible candidate progress. Accepted fallback routes include a concise explanation in Route details. Metrics distinguish `networkAttempts`/`requests`, local `searchAttempts`/stage outcomes, winning route strategy, work totals and remaining budget.

## Executed offline results

`./node_modules/.bin/tsx scripts/check-hybrid.mts` reproduces a single diagnostic using generated/saved fixtures. Fetch is disabled explicitly; **zero actual provider requests**. The counts below are mocked road-download calls, not real service traffic. CPU user/system measurements bracket direct Node engine graph+solve on the caller thread, excluding loader/JSON/browser startup. One cold diagnostic per fixture is not an isolated benchmark or phone performance measurement. Preflight background VM22.4% and WebKitGPU5.5% were recorded; no substantial paired benchmark or GraphHopper process overlapped.

| Case | Mock road downloads | Local stages | Result | Expansions | Node local CPU | Local graph/search elapsed |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| Ring | 1 | Quick success | Fast valid loop, no joint stage | 477 | ~4.0ms | ~3.8ms |
| Grid | 1 | Quick fails; joint succeeds | 6,500m,3.45% distance error,0 repetition | 29,581 | ~13.1ms | ~13.1ms |
| Directed restricted ring | 1 | Both fail | Honest no-loop, no export | 4,842 | ~2.2ms | ~2.2ms |
| Captured small Vancouver default | 2 | Quick fails; joint fails; explicit expansion; quick succeeds | Same3,729.644m/197point baseline GPX | 921,868 | ~257.0ms total | ~258.3ms total |

The grid uses snapped node317 for both stages and byte-identical GPX SHA `675c0459848133214cc7d429a29305940fab0c6f95b68919a9cdda68d4baa130`. The saved default keeps node5697946446 and original expansion patches at `(49.289824,-123.126263)` and `(49.288765,-123.117445)`; no unseen joint expansion is replayed. Its GPX remains SHA `c694ec13f8376818a767951b35abb426968c48ee66ad30f51290bf4c76444cae`. Full stage/status/data/CPU records: [hybrid-local-results.json](hybrid-local-results.json).

This demonstrates a genuine same-data fallback success without another download, while preserving fast successes and clean failures. It does not establish current public-provider availability, eliminate502/incomplete-data failures, guarantee a route in sparse/disconnected coverage, or prove phone CPU/battery cost. Joint search is heuristic and may stop at the shared budget. The previously tested legal/tolerance/repetition thresholds were not loosened.

## Validation and review

- **104 unit tests pass**; typecheck and production build pass.
- **28 desktop/mobile Chromium cases pass**: default hybrid fast/fallback/failure, real worker execution, one mocked request per scenario, GPX closure/point count, cancellation during each stage, supersession with a different Start, fresh/persisted selections, HTTP502/backoff/connection retry, stale downloads and independent comparison switches.
- Work-limit regressions cover exhaustion before fallback and **during** fallback (exactly3,000 combined expansions), upper-cap clamping, graph preparation deadline, remaining budget across expansion, and refusal to fetch after exhaustion. An unresponsive-worker test confirms main-thread deadline termination and timer cleanup. Old worker progress/success/error cannot settle a superseding request.
- Isolated Google Chrome for Testing was used; Robin's foreground Chrome was not touched. Mobile is Chromium phone-viewport/touch emulation; physical iOS Safari is unverified.
- Local screenshots inspected: `/tmp/great-circle-hybrid-{fast,fallback,failure}-{desktop,mobile}.png`. No UI layout redesign or asset upload.

Run locally with `npm run dev`; ordinary `/` uses hybrid. `?routeSearch=nearest` and `?routeSearch=joint` retain independent comparison arms. **Ordinary Generate can make existing public map requests; tests and the diagnostic are the no-network path.** No publication is authorized for this revision.
