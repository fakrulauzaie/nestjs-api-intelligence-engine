# Documentation Index

This index separates current product documentation from historical evidence. Unless a
document is explicitly marked historical, it describes the current `0.1.0` tool,
analysis schema `5.0.0`, and the capabilities listed in
[Supported Static-Analysis Patterns](supported-patterns.md).

## Source-of-truth hierarchy

When documentation and implementation disagree, use this order while correcting the
documentation:

1. runtime schemas, validators, CLI command definitions, and extractor rule constants
   under `src/`;
2. executable positive and negative contracts under `test/`;
3. living reference documents below;
4. detailed feature guides; and
5. historical ADRs, gates, validations, spikes, benchmarks, and examples.

`supported-patterns.md` is the coverage index, not a replacement for the detailed
semantic guides. Historical records never override current source or living
references.

## Living references

- [CLI and reporting workflow](cli-workflow.md) — commands, options, artifacts, and
  exit behavior.
- [Project configuration](project-configuration.md) — strict configuration versions,
  discovery, precedence, and report recipes.
- [Architecture](architecture.md) — current pipeline and trust boundaries.
- [Canonical model contract](model-contract.md) — analysis and derived-document
  versions and invariants.
- [Supported patterns](supported-patterns.md) — authoritative rule-to-test coverage
  map.
- [README](../README.md) — installation, quick start, capabilities, and limitations.

## Operational and reporting guides

- [Analysis comparison](comparison.md)
- [Potential change-impact analysis](impact-analysis.md)
- [Architecture policy engine](policy-engine.md)
- [Selected scan bundles](selected-scan-bundles.md)
- [Structured evidence exports](structured-evidence-exports.md)
- [Offline interactive graph](offline-graph-report.md)
- [Distributed policy and graph hardening](phase37-distributed-policy-report-hardening.md)

## Analysis feature guides

- [Nest modules and effective guards](nest-modules-and-global-guards.md)
- [Authorization metadata and composite decorators](authorization-metadata.md)
- [TypeORM QueryBuilder](typeorm-query-builder.md)
- [Static PostgreSQL raw SQL](postgresql-raw-sql.md)
- [Declared contracts and entity columns](declared-contracts-and-columns.md)
- [Intraprocedural request-to-column provenance](request-to-column-provenance.md)
- [Inter-method request-to-column provenance](inter-method-request-provenance.md)
- [Eager outbound HTTP](outbound-http.md)
- [Nest HttpService and symbolic targets](nest-http-service.md)
- [In-process events](in-process-events.md)
- [BullMQ queue interactions](bullmq-interactions.md)
- [Nest microservice interactions](nest-microservices.md)

## Historical and non-normative records

- [`adr/`](adr/) records accepted architecture decisions in their original context.
  A later decision may supersede an ADR explicitly; implementation chronology alone
  does not.
- [`benchmarks/`](benchmarks/) preserves measurements for the exact dated inputs and
  environments stated in each file. The numbers are not current performance promises.
- [`spikes/`](spikes/) preserves feasibility investigations and decisions made before
  production implementation.
- [Distributed Gate D0](distributed-gate-d0.md) is the frozen distributed-interaction
  corpus decision. Its BullMQ portion was consumed by Phase 35; its microservice
  portion was consumed by Phase 36.
- [Phase 11 real-repository validation](real-repository-validation.md) and the
  associated `official-nestjs-typeorm` outputs are historical evidence, not current
  report-format examples.

## Current examples

Current report-format examples are generated from the repository-local
`example-nestjs-app` fixture and stored in [`examples/current/`](examples/current/).
They are validated by documentation conformance tests against the current CLI and
schema. Historical official-sample evidence remains under
`examples/official-nestjs-typeorm/`.

## Maintenance contract

Documentation Gate D1 checks that:

- every CLI command synopsis matches its command definition;
- current schema versions and supported interaction kinds appear in living docs;
- local Markdown links resolve;
- current example artifacts remain readable and match generated reports; and
- historical records are not presented as current product behavior.

New interaction phases must not begin while this gate is failing.
