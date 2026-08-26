# ADR 0001: Version canonical and derived documents independently

- Status: Accepted
- Date: 2026-08-17
- Owners: Phase 13 owns comparison documents; the phase introducing each canonical
  record family owns its analysis-schema migration.

## Context

The v0.1 analyzer publishes a strict `AnalysisDocument` with schema version `1.0.0`.
Zod rejects unknown properties, and integrity validation checks record kinds,
references, evidence, and predicate endpoints. Post-MVP work needs modules, effective
global guards, entity columns, request/response contracts, and provenance. Adding
those arrays to a strict v1 document would be an incompatible change even if existing
fields retained their meaning.

Comparison, impact, policy, OpenAPI matching, matrix export, and graph presentation
are derived products with different lifecycles. Tying all of them to the analysis
schema would force unrelated consumers to migrate together.

## Decision

1. Keep the published v1 schema immutable.
2. The first canonical record-family expansion publishes analysis schema `2.0.0`.
3. Readers that need both generations decode a discriminated union of supported
   schema versions and migrate to a private normalized representation in memory.
4. Migration is pure, deterministic, non-mutating, and never invents facts absent
   from the source document. Missing v2 facts in a v1 input normalize to explicit
   unavailable/unknown state, not an empty proven set.
5. The analyzer publishes only one canonical schema version per run. It never writes
   extra fields under `1.0.0` and never silently rewrites a user-supplied v1 file.
6. Current snapshot-scoped canonical IDs remain unchanged. Cross-snapshot matching
   uses the separate semantic projection from ADR 0002.
7. Each derived document has its own strict schema/version and validates before it
   crosses a publication boundary.

## Document ownership

| Document or view                                  | Initial owner                      | Version policy                                                                                              |
| ------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `AnalysisDocument` v1                             | Completed MVP                      | Frozen; read-only compatibility                                                                             |
| `AnalysisDocument` v2                             | Phase 15 module/global-guard model | Major version for record/predicate contract breaks; additive compatible revisions only after consumer audit |
| Semantic projection                               | Phase 13                           | Internal typed contract; deterministic fixtures required                                                    |
| `DiffDocument`                                    | Phase 13                           | Independent strict schema                                                                                   |
| `ImpactDocument`                                  | Phase 14                           | Independent strict schema                                                                                   |
| `PolicyResultsDocument` and config schema         | Phase 16                           | Independent strict schemas; every rule carries a rule version                                               |
| QueryBuilder and raw-SQL facts                    | Phases 17-18                       | Canonical analysis rules; no parser AST in public output                                                    |
| Contract/column/provenance records                | Phases 19-21                       | Analysis v2 record families and predicates                                                                  |
| OpenAPI match sidecar and control-evidence matrix | Phase 22                           | Independent strict schemas                                                                                  |
| Offline graph view model                          | Phase 23                           | Derived report schema; cannot add facts                                                                     |
| VS Code index                                     | Phase 24 (closed, not implemented) | Would be an ephemeral projection over validated analysis/report documents if separately reconsidered        |

## Compatibility contract

| Reader                        | v1 input                                     | v2 input                                              |
| ----------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| Existing v0.1 CLI             | Supported                                    | Rejected with a clear unsupported-schema error        |
| New comparison reader         | Supported through normalization              | Supported through normalization                       |
| New v2 endpoint/report reader | Supported with unavailable new fact families | Supported                                             |
| Extractor publication         | Read-only compatibility output               | Publishes validated v2 after Phase 15 migration tests |

Derived documents store their input analysis schema versions and canonical analysis
IDs for audit, but their identities and ordering do not depend on timestamps or
absolute paths.

## Validation and migration requirements

- Preserve runtime schema validation before cross-record integrity validation.
- Keep v1 golden files byte-identical.
- Add v1-to-normalized, v2-to-normalized, v1/v2 comparison, and unsupported-version
  tests before accepting v2.
- Reject lossy downgrade from v2 to v1.
- Keep evidence IDs and canonical IDs from each input available to derived documents;
  never substitute semantic keys where a canonical reference is required.
- A migration failure is an input/schema error, not `completed_with_gaps` analysis.

## Consequences

This adds explicit reader/migration work, but it prevents strict-schema drift and lets
comparison, policy, and presentation evolve without destabilizing canonical facts.
It also keeps v1 reproducibility meaningful after v2 exists.

## Rejected alternatives

- Adding optional arrays to v1: rejected because the runtime schema is strict and
  absence would be semantically ambiguous.
- One global schema version for every artifact: rejected because derived consumers
  have independent contracts.
- Recomputing all canonical IDs without snapshot scope: rejected because comparison
  can use semantic keys without invalidating existing evidence and goldens.
