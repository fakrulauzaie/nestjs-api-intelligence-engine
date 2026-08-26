# Distributed Gate D0 Fixtures

This directory is a frozen, non-executable contract corpus for future BullMQ and Nest
microservice extractors. Every `.ts.txt` file is copied into its own temporary project;
fixtures are never imported or evaluated.

The `bullmq` and `nest-microservices` manifests use strict schema version `1.0.0` from
`test/helpers/distributed-gate-manifest.ts`. They describe desired semantics rather
than extractor-specific record counts or diagnostic codes.

Corpus rules:

- Keep co-located, producer-only, and consumer-only deployment units isolated.
- Add a close negative or unsupported counterpart for every positive case.
- Give each case one or more unique `D0_CASE:<case-id>` source markers.
- Preserve the top-level execution sentinel in every fixture.
- Pin every declaration surface and source version in the relevant manifest.
- Never import, transpile for execution, bootstrap, or connect a fixture to runtime
  infrastructure.
- Keep legacy Bull, NATS, gRPC, raw broker SDKs, and routing simulation outside this
  gate unless the implementation plan is explicitly revised first.

The authoritative semantics and review decision are documented in
`docs/distributed-gate-d0.md`. The executable mechanical audit is
`test/unit/fixtures/distributed-gate-d0.test.ts`.
