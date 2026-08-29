# Phase 39 BullMQ Branch Contract Verification

Phase 39 defines the Gate B0 semantic contract and frozen source corpus. It does not
extract or publish branch facts; the current scanner remains queue-wide until the
analysis v4 work in Phase 40.

## Frozen coverage

| Case                                                 | Expected contract result               |
| ---------------------------------------------------- | -------------------------------------- |
| Direct `switch (job.name)` literals and string enums | Exact job selectors                    |
| Consecutive empty case labels                        | One grouped exact selector             |
| `break`, `return`, and `throw`                       | Distinct bounded continuation behavior |
| Default and unmatched if-chain path                  | Exact exclusion selector               |
| Common prelude and `finally`                         | `all_jobs` selectors                   |
| Direct equality in either operand order              | Exact if-branch selectors              |
| Non-empty fallthrough or dynamic case label          | Supported facts plus unknown residual  |
| Aliased or mutated discriminant                      | Unsupported unknown dispatch           |
| Compound payload/job predicate                       | Unsupported unknown dispatch           |

Every partial or unsupported case retains its discovered calls in an unknown residual
branch. Gate B0 explicitly forbids inferring broker delivery, worker execution,
finally completion, or exact-job effects from unsupported flow.

## Contract outcome

- Added stable IDs and strict schemas for handler dispatches, branches, and
  branch-scoped projections of existing assertions.
- Kept analysis v3 frozen; ADR 0004 assigns publication to analysis v4.
- Type-checked all three `.ts.txt` fixtures against pinned NestJS 11.2.1,
  `@nestjs/bullmq` 11.0.5, and BullMQ 6.2.1 declaration stubs without importing or
  executing fixture code.
- Focused Gate B0 verification passed: 2 files and 9 tests.

## Verification commands and outcome

- Focused Gate B0 Vitest: 2 files and 9 tests passed.
- Full parallel Vitest: 307 of 308 tests passed; one existing endpoint-trace case
  exceeded its 20-second wall-clock limit under concurrent load, with no assertion or
  snapshot mismatch.
- One-worker retry of the complete timed-out file: 1 file and 4 tests passed.
- TypeScript typecheck: passed.
- Build: passed.
- ESLint with zero warnings: passed.
- Prettier check: passed.
