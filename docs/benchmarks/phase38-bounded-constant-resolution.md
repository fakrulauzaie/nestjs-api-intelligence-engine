# Phase 38 Bounded Constant Resolution Verification

Phase 38 replaces the former narrow static-string helper with an eight-hop,
cycle-safe, checker-backed resolver. It never evaluates target code and does not
widen the repository containment boundary.

## Verified semantic cases

| Case                                                       | Result       |
| ---------------------------------------------------------- | ------------ |
| Literal and no-substitution template                       | Exact string |
| Immutable `const` chain within eight hops                  | Exact string |
| Imported regular string enum member                        | Exact string |
| Imported `const enum` string member                        | Exact string |
| Nested `as const` property/string-element path             | Exact string |
| Named import through repository-contained `tsconfig.paths` | Exact string |
| Mutable binding                                            | Unsupported  |
| Object without `as const`                                  | Unsupported  |
| Object spread or computed access key                       | Unsupported  |
| Getter, method, call, or computed value                    | Unsupported  |
| Cyclic reference                                           | Unsupported  |
| Resolution beyond eight hops                               | Unsupported  |

The executable resolver contract is in
`test/unit/ts-index/constants.test.ts`. BullMQ integration coverage is in
`test/unit/extractors/nest-bullmq.test.ts`.

## Real-service validation

The built CLI scanned `ticket-service-example` into an isolated workspace output.
The scan completed with trustworthy facts plus the service's existing static-analysis
gaps:

- 215 endpoints;
- 614 diagnostics;
- result state `completed_with_gaps`;
- five `verification-queue` producers with exact enum-derived job strings; and
- one queue-wide `VerificationProcessor.process` handler retained as dynamic,
  `proven_registered`, and distributed-conditional.

The exact producer jobs were:

- `ctt-ppoe-api-sync`;
- `ctt-verify-api-sync`;
- `ctt-verify-background`;
- `ntt-verify-background`; and
- `ntt-verify-api-sync`.

This is the intended Phase 38 boundary. Exact worker branch effects remain deferred
to Phases 39–40.

## Verification commands and outcome

- Focused Vitest: 2 files and 9 tests passed.
- Full parallel Vitest: 109 of 115 files passed; seven tests in six files exceeded
  existing wall-clock thresholds under concurrent load, with no semantic assertion
  or snapshot mismatch.
- One-worker retry of those files: 6 files and 9 tests passed.
- TypeScript typecheck: passed.
- Build: passed.
- ESLint with zero warnings: passed.
- Prettier check: passed.
