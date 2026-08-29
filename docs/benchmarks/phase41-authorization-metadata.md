# Phase 41 Authorization Metadata Verification

Phase 41 publishes analysis v5 authorization facts while preserving the core security
boundary: metadata describes a requirement, not proof that a guard enforced it at
runtime.

## Verified semantic cases

| Case                                            | Published result                         |
| ----------------------------------------------- | ---------------------------------------- |
| Direct configured `SetMetadata()`               | Redacted metadata shape                  |
| Bounded repository metadata wrapper             | Exact repository-symbol fact             |
| Configured package decorator                    | Exact package-export fact                |
| `applyDecorators(SetMetadata(), UseGuards())`   | `proven_enforced` composite relationship |
| Exact configured metadata-to-guard mapping      | `configured_relationship`                |
| Metadata without a supported guard relationship | `enforcement_unknown` plus diagnostic    |
| Same-named local framework lookalike            | Ignored                                  |
| Separate Nest application roots                 | Global guard not attributed across roots |

Values are never serialized. Only scalar types, array counts/types, object keys, and
dynamic-shape flags are retained, with `redacted: true` on every value shape.

## Consumer migration outcome

- Analysis v5 separates metadata and enforcement records from ordinary guard facts.
- Diff v4, impact v2, OpenAPI/control exports v5, graph v6, endpoint catalogues, and
  Markdown traces expose the bounded facts.
- `require-proven-authorization-enforcement` passes only package-proven composite
  enforcement; configured and unresolved relationships remain `unknown`.
- `require-guard-on-write-endpoint` still consumes only guard assertions. Metadata
  alone cannot satisfy it.

## Verification commands and outcome

- Focused authorization Vitest: 1 file and 3 tests passed.
- Documentation Gate D1 Vitest: 4 files and 8 tests passed.
- Full one-worker Vitest: 122 files and 316 tests passed.
- TypeScript typecheck: passed.
- Build: passed.
- ESLint with zero warnings: passed.
- Prettier check: passed.

The one-worker full run is the reproducible corpus measurement used here; it avoids
unrelated resource contention between TypeScript program fixtures.
