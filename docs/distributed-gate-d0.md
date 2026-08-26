# Distributed Gate D0

Distributed Gate D0 freezes the source corpus and semantic contracts required before
the `job_queue` and `microservice_message` extractors may be activated. It does not add
an extractor, change analysis schema `3.0.0`, or claim that broker delivery occurred.

## Status

Passed on 2026-08-26. The frozen corpus, semantic/value review, focused mechanical
audit, documentation checks, and complete project verification all pass. Phase 35 is
complete and consumes the frozen BullMQ contracts without weakening them. The Nest
microservice corpus remains frozen for Phase 36.

## Compatibility target

The declaration stubs are intentionally minimal and never load framework runtime code.
Their compatibility surfaces were reviewed against:

| Package                   | Pinned version | Retained declaration surface                                                  |
| ------------------------- | -------------: | ----------------------------------------------------------------------------- |
| `@nestjs/bullmq`          |         11.0.5 | `BullModule`, `InjectQueue`, `Processor`, `WorkerHost.process`                |
| `bullmq`                  |          6.2.1 | `Queue.add`, `Job.name`, `Job.data`                                           |
| `@nestjs/microservices`   |         11.2.1 | `ClientProxy`, `ClientsModule`, pattern decorators, four supported transports |
| `@nestjs/common` / `core` |         11.2.1 | module/controller/DI metadata and microservice application roots              |
| `rxjs`                    |          7.8.2 | `Observable.subscribe` and `firstValueFrom` activation sites                  |

The primary references are the
[Nest queue guide](https://docs.nestjs.com/techniques/queues),
[Nest microservice guide](https://docs.nestjs.com/microservices/basics),
[Nest Bull repository](https://github.com/nestjs/bull),
[Nest ClientProxy source](https://github.com/nestjs/nest/blob/master/packages/microservices/client/client-proxy.ts),
and [BullMQ repository](https://github.com/taskforcesh/bullmq).

## Frozen corpus

Each topology is a separate `.ts.txt` project. Separation is semantic: a producer-only
case cannot accidentally match a handler from a different fixture.

```text
test/fixtures/distributed/
├── bullmq/
│   ├── colocated.ts.txt
│   ├── producer-only.ts.txt
│   ├── consumer-only.ts.txt
│   ├── branch-filtering.ts.txt
│   ├── negatives.ts.txt
│   └── gate.expected.json
└── nest-microservices/
    ├── colocated.ts.txt
    ├── producer-only.ts.txt
    ├── consumer-only.ts.txt
    ├── activation.ts.txt
    ├── patterns.ts.txt
    ├── transports.ts.txt
    ├── negatives.ts.txt
    └── gate.expected.json
```

The strict manifest schema is version `1.0.0`. Every case records a stable source
marker, topology, classification, producer and handler expectations, match scope,
activation, boundary, causal class, semantic must-emit/must-not-emit categories,
must-not-infer rules, a close counterpart, and rationale. It deliberately does not
freeze future extractor record counts or diagnostic-code names.

## BullMQ decisions

| Source condition                        | Frozen meaning                                                              |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Producer and registered local processor | Queue-wide local candidate; `broker_or_worker_boundary`; conditional effect |
| Producer without local processor        | `external_or_unobserved`; never a missing-consumer failure                  |
| Processor without local producer        | Handler inventory plus handler-rooted conditional trace                     |
| `WorkerHost.process()` with `job.name`  | Queue-wide until a separately proven branch-slicing rule exists             |
| Dynamic queue or job identity           | Retain dynamic/unknown classification; never invent an exact identity       |
| Duplicate processors                    | Retain every candidate; never select a single consumer                      |
| Processor omitted from module providers | `registration_unknown`; never `proven_registered`                           |
| Local decorator/worker lookalike        | Reject as unsupported package identity                                      |

Legacy `@nestjs/bull` `@Process()` compatibility is not part of D0 or the BullMQ-first
Phase 35. BullMQ does not use named `@Process()` handlers; its worker is queue-wide.

## Nest microservice decisions

| Source condition                                   | Frozen meaning                                    |
| -------------------------------------------------- | ------------------------------------------------- |
| `ClientProxy.emit()`                               | `eager`, event mode                               |
| Discarded `ClientProxy.send()`                     | `constructed_cold`                                |
| `firstValueFrom`, direct `subscribe`, route return | `proven_activated`                                |
| Send through an opaque Observable wrapper          | `unknown` activation                              |
| `send()` and `@MessagePattern()`                   | Request-response candidate only                   |
| `emit()` and `@EventPattern()`                     | Event candidate only                              |
| Multiple matching event handlers                   | Retain every local candidate                      |
| Duplicate request-response handlers                | Ambiguous candidates; never event-style fan-out   |
| Canonical plain object pattern                     | Stable JSON key ordering                          |
| Spread/runtime/non-serializable pattern            | Dynamic/unknown; never an exact canonical pattern |
| Same pattern under incompatible transports         | No local delivery candidate                       |
| Handler decorator on an unsupported provider       | Inventory with registration uncertainty           |

TCP, Redis, RMQ, and Kafka are transport inventory only. D0 does not simulate queues,
topics, reply channels, acknowledgements, consumer groups, partitions, retries, or
delivery. NATS, gRPC, raw broker SDKs, and custom transporters remain outside the
initial distributed extractor scope.

## Mechanical audit

`test/unit/fixtures/distributed-gate-d0.test.ts` performs the gate audit:

1. strict runtime manifest validation and canonical byte checking;
2. all three topologies for both technologies;
3. a close negative or unsupported counterpart for every positive case;
4. required non-inference contracts for delivery, missing peers, branches, and
   transport equivalence;
5. compatibility versions matching the generated declaration package metadata;
6. isolated TypeScript compilation with zero diagnostics;
7. exact source-marker coverage and fixture inventory closure;
8. execution sentinels in every fixture; and
9. prohibition of executable `.ts.txt` imports from production or test TypeScript.

The fixtures are copied as text into temporary projects and passed only to the safe
inventory and TypeScript compiler host. They are never imported, evaluated, emitted,
bootstrapped, or connected to Redis or a message broker.

## Semantic and value review

The semantic review was performed before any distributed extractor existed. It accepts
local handlers only as in-repository delivery candidates and keeps all database effects
conditional across the broker or worker boundary.

The value review accepts the remaining implementation effort:

- Phase 35 BullMQ-first extraction: 56-96 focused hours;
- Phase 36 bounded Nest microservice extraction: 64-112 focused hours.

These phases provide useful endpoint-to-worker and inbound-handler inventory without
requiring runtime infrastructure. The work remains justified only while the extractor
preserves the frozen must-not-infer contracts and does not broaden into raw SDKs,
transport routing simulation, or cross-repository delivery claims.

## Phase eligibility

Milestone I1 and the complete D0 audit passed before Phase 35 began. Phase 35 now
implements the bounded BullMQ contract described here. D0 still does not authorize
legacy Bull, raw brokers, delivery claims, or an expansion of the v3 meanings. The
Phase 36 microservice portion must remain valid before that phase begins.
