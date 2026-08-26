# Post-MVP Frozen Source Corpus

This directory is the Phase 12 ground truth for Phases 13-21. It freezes source
patterns and expected classifications before the corresponding extractors, models,
or derived schemas exist.

## Format

- Source files use `.ts.txt`. They are TypeScript source text, but keeping them as
  text prevents future unsupported constructs from entering the current root
  TypeScript program. A later test harness may copy a fixture to a temporary `.ts`
  project and supply pinned package declarations.
- Every feature directory contains `expected.json` using the temporary
  `phase12-expectation-1` contract.
- `status: "pending"` is intentional. These files are not current analyzer output and
  must not be weakened to match an incomplete implementation.
- `classification` is one of `positive`, `negative`, `ambiguous`, or `unsupported`.
- `mustNotEmit` records tempting false relationships that future implementations must
  exclude.

The temporary expectation contract is validated by
`test/unit/documentation/post-mvp-phase12.test.ts`. Each implementation phase must
replace or supplement these manifests with runtime-schema-valid canonical/derived
goldens before it can complete.

## Corpus

| Directory        | Future phase | Purpose                                                                                  |
| ---------------- | -----------: | ---------------------------------------------------------------------------------------- |
| `comparison/`    |        13-14 | Endpoint add/remove/modify, duplicate route ambiguity, reachable and unreachable changes |
| `modules/`       |           15 | Static module metadata, `APP_GUARD`, `useClass`, `useExisting`, and dynamic boundaries   |
| `query-builder/` |           17 | Proven TypeORM builder roots, state transitions, terminals, and escapes                  |
| `raw-sql/`       |           18 | TypeORM `.query()`/tagged `.sql`, PostgreSQL table directions, and dynamic SQL gaps      |
| `contracts/`     |           19 | Nest request sources, DTO fields, declared returns, and TypeORM columns                  |
| `provenance/`    |        20-21 | Direct/derived local origins, false edges, and inter-method propagation boundaries       |

## Evidence markers

Source comments use `CASE:<case-id>`. Expected cases refer to those markers rather
than frozen line numbers during Phase 12. The implementing phase must convert markers
to exact evidence ranges and then freeze range-based goldens.

## Safety

These sources must never be imported or executed by the analyzer. They may contain
declarations or call sites that would require real framework packages at runtime.
Only source text and checker-supplied declarations are valid inputs.
