# Distributed Policy and Graph Hardening

Phase 37 completes the derived policy and graph surface for the four canonical
interaction kinds. It adds no source extractor and makes no broker, network, or
deployment claim.

## Adopted scope

- Graph schema `4.0.0` adds exactly one bounded, evidence-closed scene for every
  canonical in-process event, BullMQ, or Nest microservice handler.
- The offline report can switch between endpoint-producer and handler-rooted views.
  Selecting a handler node opens that handler; selecting a producer interaction from
  a handler view returns to a related endpoint when one is present.
- Handler views expose registration state, local versus broker/worker boundary,
  causal class, local producer candidate IDs, diagnostics, and downstream table
  terminals. Queue and microservice terminals remain `distributed_conditional`.
- Three opt-in policy rules evaluate existing canonical facts:
  `forbid-dynamic-interaction-target`,
  `require-proven-interaction-activation`, and
  `require-local-in-process-event-handler`.

Comparison, impact, endpoint traces, OpenAPI enrichment, and control evidence already
consumed the generic interaction substrate after Phases 35-36. Phase 37 re-audited
those consumers and did not duplicate or redesign them.

## Deliberately not adopted

Allowed-origin, queue/topic/module allowlists require typed rule parameters and stable
module ownership evidence that the current policy configuration does not provide.
Visible HTTP timeout enforcement is unsound until timeout evidence is canonicalized
across Axios instances, Nest `HttpModule`, request options, interceptors, and custom
clients. Namespace-selective event rules likewise require a documented matcher and
configuration migration. These ideas remain excluded instead of being approximated.

The local-event handler rule does not apply to queues or Nest microservices. Missing
local distributed consumers are normal open-world topology. Existing repository,
guard-on-write, and complete-write-trace policies retain their synchronous meanings.

## Trust and compatibility boundary

Graph v4 is a derived document over validated analysis v3. Historical graph v2/v3
documents remain readable, analysis schema stays `3.0.0`, and policy-results schema
stays `1.0.0`. All new policies are disabled unless named in configuration. A static
target or proven activation does not prove delivery, response, acknowledgement,
completion, retry behavior, or remote ownership.

The graph renderer remains self-contained and offline under the existing CSP. It
does not execute target code, import application modules, start NestJS, open broker or
database connections, or discover remote repositories.
