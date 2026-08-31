# BullMQ Queue Interactions

BullMQ analysis supports the `job_queue` interaction kind for a bounded, checker-proven
BullMQ surface. The analyzer inventories Nest BullMQ producers and local worker
candidates without importing the target, connecting to Redis, starting a worker, or
claiming that a queued job was delivered.

## Supported producer surface

A producer is retained only when all of the following are proven:

- a constructor member is decorated by the package `@nestjs/bullmq` `@InjectQueue()`;
- its declared type resolves to `bullmq` `Queue` rather than a same-named local type;
- the member binding is unique and is not reassigned; and
- the source method calls that member's `add(jobName, data)` method.

Queue and job identities support string literals, no-substitution templates, bounded
acyclic immutable `const` chains, checker-resolved string/`const enum` members, and
nested property or string-element access on `as const` objects. Named imports and
`tsconfig.paths` aliases work when TypeScript resolves their source inside the scanned
repository. The analyzer does not separately traverse aliases outside that boundary.

The payload and queue options are not retained. A dynamic queue or job remains a
`job_queue` record with an explicit dynamic target and
`INTERACTION_TARGET_DYNAMIC`; it is never matched to an exact local worker. Mutable
bindings, object spreads/computed keys, cycles, and exhausted resolution bounds remain
dynamic. A union or otherwise ambiguous receiver emits
`INTERACTION_RECEIVER_AMBIGUOUS` and produces no guessed interaction.

The producer rule is `queue.bullmq.queue-add.v1`. Producers are eager, asynchronous,
and outbound. An exact queue with no local worker has
`external_or_unobserved` boundary state. That is a normal open-world topology, not a
missing-consumer error.

## Supported worker surface

A local worker candidate requires both the package `@nestjs/bullmq`
`@Processor(queue)` decorator and an extension of the package `WorkerHost` class. A
class with one `process(job)` method creates one queue-wide handler record. Local
decorator or worker lookalikes are ignored.

The handler is `proven_registered` only when supported Nest module metadata proves
that its class is a provider. Otherwise it is retained as `registration_unknown` and
emits `JOB_QUEUE_HANDLER_REGISTRATION_UNKNOWN`. A consumer-only repository therefore
still exposes a handler-rooted trace without fabricating an HTTP endpoint or local
producer.

The queue-wide handler remains the deployment candidate identity. Analysis v4 also
publishes a separate dispatch/branch/effect projection for the supported bounded
`job.name` grammar; the handler itself is not duplicated per job.

The handler rule is `queue.bullmq.worker-host.process.queue-wide.v1`.

## Phase 40 branch publication boundary

Analysis v4 publishes the Gate B0 vocabulary for job-specific worker effects. It
distinguishes:

- `exact_jobs` branches selected by one or more proven job names;
- `all_jobs` work in a common prelude or `finally` region;
- `unmatched_jobs` work reached after excluding supported exact branches; and
- `unknown` residual work whose control flow cannot be safely sliced.

A dispatch is `complete`, `partial`, or `unsupported`. Partial and unsupported
dispatches must retain discovered effects in an unknown residual branch; the engine
must neither discard those effects nor copy them onto every exact job. Branch effects
are source-range projections of existing canonical method/table/interaction
assertions, not replacement facts.

The extractor supports direct `switch (job.name)` and terminating sequential strict
equality checks on the exact `process()` parameter symbol. Static literals, string
enums, `as const` members, grouped empty case labels, `break`, `return`, `throw`,
default/unmatched work, common prelude work, and top-level `try/finally` are bounded
supported shapes. Aliases, mutation, compound predicates, dynamic case labels, and
non-empty fallthrough emit `JOB_QUEUE_FILTER_PARTIAL` or
`JOB_QUEUE_FILTER_UNPROVEN` and retain their effects under `unknown`.

Exact producers select matching `exact_jobs`, `all_jobs`, and compatible
`unmatched_jobs` records. An `unknown` residual is kept visible for honesty but is not
copied onto an exact producer. See
[ADR 0004](adr/0004-bullmq-branch-analysis-v4.md) for the compatibility decision.

## Candidate matching and open-world meaning

`queue.bullmq.queue-wide-candidate.v1` matches an exact producer queue to every exact
local queue-wide handler for that queue, subject to the configured fan-out bound.
Each match is a resolved `INTERACTION_MATCHES_LOCAL_HANDLER` assertion, but it proves
only an in-repository delivery candidate.

| Topology                  | Published meaning                                                     |
| ------------------------- | --------------------------------------------------------------------- |
| Producer and local worker | `broker_or_worker_boundary` plus local candidate edges                |
| Producer only             | `external_or_unobserved`; no missing-consumer diagnostic              |
| Worker only               | Independent handler inventory and handler-rooted conditional trace    |
| Duplicate workers         | Every bounded candidate is retained; none is selected as the consumer |
| Dynamic queue             | Unknown target; no exact local match                                  |

The analyzer does not prove enqueue success, Redis availability, worker liveness,
delivery, ordering, retry behavior, acknowledgement, completion, or cross-repository
ownership.

## Conditional causal traversal

Endpoint traces cross a matched queue edge using the existing interaction-hop and
state limits. Database terminals downstream of a proven-registered worker use
`distributed_conditional`, even when producer and worker source are co-located. The
broker/worker boundary prevents these terminals from changing synchronous
`dbReads`/`dbWrites`, mutation policy, or authentication conclusions.

Handler-rooted traces use the same conditional class. Registration-unknown workers
remain visible as candidates but do not become endpoint effects. Cycle, fan-out, and
state exhaustion use the shared explicit interaction diagnostics.

Endpoint Markdown and catalogues include a BullMQ section. Graph scenes use distinct
interaction, `broker or worker boundary`, queue target, handler, and implementing
method nodes. Candidate edges are labeled `matches local handler`; the renderer never
uses `delivered`.

## Comparison, impact, and structured exports

Comparison schema `3.0.0` adds structural dispatch, branch, and branch-effect semantic
keys. Queue/job target changes remain deterministic interaction changes, while selector
or control-flow identity changes appear as branch add/remove changes. Potential-impact
schema `2.0.0` carries branch-aware reverse traversal so an exact branch effect is not
attached to an incompatible exact producer job.

OpenAPI enrichment and control evidence use schema `4.0.0` for frozen analysis v4 and
schema `5.0.0` for analysis v5, `6.0.0` for analysis v6, and `7.0.0` for current analysis v7. Resolved
endpoint facts include:

- `distributedInteractions`, including sanitized queue/job labels; and
- `distributedConditionalEffects`, including direction, table, causal class, and
  evidence IDs; and
- `jobQueueBranchIds`, listing the exact/common/unmatched branches selected for the
  endpoint trace.

The control CSV v4 adds `job_queue_branch_ids`. Graph schema v5 renders branch nodes
and branch-effect edges in handler scenes and lists selected branch IDs on endpoint
views. Historical analysis documents keep their prior derived schema behavior.

## Evidence and deliberate boundaries

Evidence retains only bounded call/declaration snippets and repository-relative
coordinates. Queue payloads, option objects, credentials, environment values, and
runtime broker state are not canonical facts.

The current scanner deliberately excludes legacy `@nestjs/bull`, named `@Process()`
handlers, general control-flow/data-flow slicing beyond the bounded grammar, custom queue wrappers, raw BullMQ
consumers, repeat and flow APIs, raw broker SDKs, and cross-repository discovery.
Nest microservices are a separate supported interaction kind rather than part of the
BullMQ surface. The executable queue-wide contracts are in
`test/unit/extractors/nest-bullmq.test.ts`; their frozen source corpus remains under
`test/fixtures/distributed/bullmq/`. The non-executable Gate B0 branch corpus is under
`test/fixtures/phase39/bullmq/`; executable Phase 40 propagation coverage is under
`test/fixtures/phase40/` and `test/unit/extractors/bullmq-branches.test.ts`.
