# BullMQ Queue Interactions

Phase 35 activates the `job_queue` interaction kind for a bounded, checker-proven
BullMQ surface. The analyzer inventories Nest BullMQ producers and local worker
candidates without importing the target, connecting to Redis, starting a worker, or
claiming that a queued job was delivered.

## Supported producer surface

A producer is retained only when all of the following are proven:

- a constructor member is decorated by the package `@nestjs/bullmq` `@InjectQueue()`;
- its declared type resolves to `bullmq` `Queue` rather than a same-named local type;
- the member binding is unique and is not reassigned; and
- the source method calls that member's `add(jobName, data)` method.

Queue and job identities support string literals, no-substitution templates, and the
bounded immutable constant forms accepted by the shared string resolver. The payload
and queue options are not retained. A dynamic queue or job remains a `job_queue`
record with an explicit dynamic target and `INTERACTION_TARGET_DYNAMIC`; it is never
matched to an exact local worker. A union or otherwise ambiguous receiver emits
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

BullMQ `WorkerHost.process()` is queue-wide: its canonical job target is dynamic even
when source control flow inspects `job.name`. A detected `switch` or equality test on
`job.name` emits the informational `JOB_QUEUE_FILTER_UNPROVEN` diagnostic. Phase 35
does not slice control-flow branches, so no database effect is labeled as belonging
to one exact job name.

The handler rule is `queue.bullmq.worker-host.process.queue-wide.v1`.

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

Comparison schema `2.0.0` already treats interaction and handler identity generically,
so queue/job target changes appear as deterministic interaction add/remove changes;
boundary, timing, activation, registration, or rule changes remain modifications.
Potential-impact paths attach those changes only to endpoints that reach the changed
queue record.

OpenAPI enrichment and control evidence use schema `3.0.0` only when the analysis
contains a `job_queue` interaction or handler. Resolved endpoint facts then add:

- `distributedInteractions`, including sanitized queue/job labels; and
- `distributedConditionalEffects`, including direction, table, causal class, and
  evidence IDs.

The control CSV v3 adds `distributed_interactions` and
`distributed_conditional_effects`. Interaction-free and local-interaction-only
analyses keep their prior export schema versions and bytes.

## Evidence and deliberate boundaries

Evidence retains only bounded call/declaration snippets and repository-relative
coordinates. Queue payloads, option objects, credentials, environment values, and
runtime broker state are not canonical facts.

Phase 35 deliberately excludes legacy `@nestjs/bull`, named `@Process()` handlers,
exact `job.name` branch slicing, custom queue wrappers, raw BullMQ consumers, repeat
and flow APIs, Nest microservices, raw broker SDKs, and cross-repository discovery.
The executable contracts are in
`test/unit/extractors/nest-bullmq.test.ts`; their frozen source corpus remains under
`test/fixtures/distributed/bullmq/`.
