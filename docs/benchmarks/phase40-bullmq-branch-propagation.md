# Phase 40 BullMQ Branch Propagation Verification

Phase 40 publishes the Gate B0 contract through analysis v4 and propagates exact,
common, unmatched, and residual-unknown worker branches through every supported
consumer. This is a static compatibility result, not evidence that a broker delivered
a job or that a worker executed.

## Verified semantic cases

| Case                                     | Published result                               |
| ---------------------------------------- | ---------------------------------------------- |
| Direct `switch (job.name)` exact labels  | Exact-job branches and scoped effects          |
| Consecutive empty case labels            | One grouped exact selector                     |
| Direct top-level strict-equality filters | Exact and unmatched selectors                  |
| Common prelude and `finally` calls       | `all_jobs` branches                            |
| Dynamic label or non-empty fallthrough   | Supported branches plus unknown residual       |
| Alias, mutation, or compound predicate   | Unsupported unknown residual                   |
| Exact producer job                       | Compatible exact/common/unmatched effects only |
| Unknown producer or residual selector    | Potential conditional effects retained         |

Branch effects reference existing canonical assertions; they do not create a second
call or persistence graph. Every path that crosses a queue boundary remains
`distributed_conditional`.

## Consumer migration outcome

- Analysis v4 distinguishes unavailable branch capability in v1-v3 from an available,
  possibly empty v4 branch family.
- Diff v3 compares dispatches, branches, and effects using structural semantic keys.
- Impact v2 carries selectors backward and excludes a producer only when every carried
  selector is proven incompatible.
- Structured exports v4 and endpoint Markdown publish selected
  `jobQueueBranchIds`.
- Graph v5 renders branch nodes and branch-effect edges without labeling candidate
  matching as delivery.

## Verification commands and outcome

- Focused BullMQ branch Vitest: 1 file and 2 tests passed.
- Phase 40 cross-consumer Vitest: 15 files and 63 tests passed.
- Full one-worker Vitest: 120 files and 312 tests passed.
- TypeScript typecheck: passed.
- Build: passed.
- ESLint with zero warnings: passed.
- Prettier check: passed.

The one-worker full run is the reproducible corpus measurement used here; it avoids
unrelated wall-clock threshold noise from running TypeScript program fixtures in
parallel on a shared machine.
