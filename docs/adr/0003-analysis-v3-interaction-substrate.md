# ADR 0003: Add an inert, capability-declared interaction substrate in analysis v3

- Status: Accepted
- Date: 2026-08-25
- Owner: Phase 30

## Context

Analysis v2 is strict and already owns modules, effective global guards, contracts,
columns, and request-to-column influence. Outbound HTTP and event-driven flows need
new canonical record families and predicates. Adding those fields to v2 would make a
strict v2 document change shape without changing its major version.

Later queue and microservice work may cross process, worker, deployment, and repository
boundaries. A repository-local match can prove a candidate declaration but cannot
prove broker delivery or remote execution. The schema must preserve that distinction
before an extractor exists, while avoiding a false claim that reserved kinds are
already supported.

## Decision

1. Freeze analysis v1 and v2. The scanner now publishes analysis schema `3.0.0`, and
   readers accept all three versions through a pure validated normalization boundary.
2. Analysis v3 retains every v2 family and adds `applications`, `interactions`,
   `interactionHandlers`, and `interactionAnalysis`.
3. Reserve four discriminants: `outbound_http`, `in_process_event`, `job_queue`, and
   `microservice_message`.
4. Reservation is representational only. `interactionAnalysis.schemaKinds` lists
   schema variants, while `supportedKinds` and `enabledKinds` separately describe
   executable analyzer capability for the current tool/run.
5. Phase 30 publishes empty interaction families, empty supported/enabled kinds, and
   `state: not_run`. It adds no HTTP, event, queue, or microservice extractor.
6. Use three canonical relationships:
   `METHOD_INITIATES_INTERACTION`, `INTERACTION_MATCHES_LOCAL_HANDLER`, and
   `HANDLER_IMPLEMENTED_BY`, plus `APPLICATION_USES_ROOT_MODULE` for a resolved root.
7. A local-handler match means static identity/scope compatibility. It never means
   runtime delivery. Fan-out will use multiple assertions rather than assertion
   ambiguity when every handler is a valid candidate.
8. Keep activation, boundary, dispatch timing, and handler registration as orthogonal
   states. Do not add `resolved_remote` to assertion status.
9. Add fact-affecting traversal limits to analysis v3 configuration. Project config
   version 3 can override those limits; v1/v2 project configs retain their meanings.
10. Comparison and impact keep their independently versioned configuration envelopes
    unchanged in Phase 30. They receive v3 analysis identity/version but do not claim
    interaction-aware changes or paths before an extractor phase owns those semantics.

## Canonical topology

```text
Application -> root module
Method -> initiates -> Interaction
Interaction -> matches local candidate -> InteractionHandler
InteractionHandler -> implemented by -> Method
```

Handlers are inventoried independently from producers so a future consumer-only
worker or microservice repository does not require a synthetic HTTP endpoint.

## Compatibility contract

| Reader/view                  | v1                | v2                | v3                        |
| ---------------------------- | ----------------- | ----------------- | ------------------------- |
| Canonical validator          | supported, frozen | supported, frozen | supported                 |
| V2 module/contract consumers | unavailable       | available         | available                 |
| Interaction consumers        | unavailable       | unavailable       | available, possibly empty |
| Current scanner publication  | no                | no                | yes                       |

Unavailable is not normalized to a proven empty fact family. V1/v2 canonical bytes
and IDs remain unchanged. Adding the v3 traversal envelope changes v3 analysis-run
identity deterministically.

## Consequences

- Generic interaction adjacency, semantic keys, integrity, and ordering can stabilize
  before extraction.
- Kind-specific target contracts are strict, so later work may require an additive
  compatible revision; the shared topology and existing field meanings must remain
  stable.
- Every downstream consumer must distinguish v1 from v2/v3 explicitly rather than
  treating "not v2" as v1.
- Queue and microservice enum values cannot be advertised as supported merely because
  their schema variants exist.

## Rejected alternatives

- Add optional arrays to v2: rejected because absence would be ambiguous and the
  strict published schema is frozen.
- Use one open string `kind`: rejected because unsupported values would evade runtime
  validation and exhaustive consumer review.
- Publish placeholder queue/message records: rejected because no extractor evidence
  exists.
- Treat missing local consumers as errors or assumed remote consumers: rejected
  because both claims exceed repository-local evidence.
- Extend diff/impact traversal in Phase 30: rejected as speculative without extracted
  interaction facts and causal fixtures.
