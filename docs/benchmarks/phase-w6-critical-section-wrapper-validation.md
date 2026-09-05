# Phase W6 Critical-Section Wrapper Validation

Phase W6 validates analysis v8 against the supplied `ticket-service-example` without
importing or executing application code. The acceptance scan used the repository's
TypeScript project and automatic symbol/flow proof only; it passed `--no-config`, so
no configured class or method name could authorize wrapper traversal.

Verification completed on 2026-09-05 with this command shape:

```powershell
pnpm run cli -- scan "<ticket-service-example>" --no-config --tsconfig tsconfig.json `
  --output ".tmp\phase-w6\second" --max-call-depth 3 --controller NttController `
  --with-graph --max-nodes 500 --max-edges 1000
```

The scan produced analysis schema `8.0.0`, 215 endpoints, 15 critical sections, and a
`completed_with_gaps` result. Fourteen sections came from
`resource.redlock.verified-wrapper.v1`; one came from the direct
`resource.redlock.using.v1` rule. The wider repository retained 632 diagnostics, so
the result does not claim whole-repository completeness.

## Acceptance results

`PUT /resolve` no longer terminates at
`RedisLockService.executeWithNttLock`. Exact symbol and parameter proof follows this
chain:

```text
NttService.resolveTicket inline callback
  -> RedisLockService.executeWithNttLock task parameter
  -> RedisLockService.executeWithLock task parameter
  -> Redlock.using inline callback
  -> direct task() invocation
```

The resulting trace retains the wrapper call and exposes the callback's inner calls,
including `buildResolveNttAuditLog`, `getResolvableNttOrThrow`, validation helpers,
`saveNttResolveInfo`, `NttData.update`, resolution verification,
`finalizeResolveTicket`, and `getTicketStatus`. Its section owns 11 direct effect
assertions. At the configured call depth, the endpoint reports eight table terminals
as `critical_section_conditional`: reads of `ctt`, `ctt_activity`, `ntt`,
`ntt_network_element`, and `ntt_troubleshoot_info`, plus writes of `ntt`, `ntt_note`,
and `ntt_troubleshoot_info`.

The pre-existing `PUT /force-resolve` path remains expanded. Its ordinary work still
reports seven synchronous table effects, while the nested `forceResolveNtt` wrapper
section owns four direct assertions and contributes two
`critical_section_conditional` table effects. This confirms that wrapper projection
does not reclassify unrelated synchronous work.

## Diagnostic audit

The acceptance scan contains one wrapper-flow diagnostic:

- `CRITICAL_SECTION_CALLBACK_FLOW_UNPROVEN` on
  `NttVerificationService.executeNttVerificationMachine`, where a local
  `executeLogic` variable is passed to `executeWithNttLock`. Analysis v8 intentionally
  supports only an inline arrow or function expression at the caller boundary. It
  does not traverse this variable's function body or claim its execution under the
  lock.

The two exact internal calls that forward the wrapper's `task` parameter no longer
produce duplicate unproven-flow warnings. They are suppressed only because those
same call-expression nodes appear in successful `forwarded_unchanged` proof steps.
Ambiguous targets, transformed callbacks, stored or scheduled callbacks, method and
property references, spread forwarding, cycles, and bounded-out paths remain closed
and retain their documented diagnostics when terminal-connected.

## Determinism and honesty boundary

Two independent CLI scans produced byte-identical artifacts:

| Artifact               | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `analysis.json`        | `3E1DD78811932B080A146F44B81FB90A0529B8DA21AFBFEFCED6E70A6BF290CB` |
| `api-intel-graph.html` | `F3E63837C78834F5AA3537FE27F129C89769E5F7888FC9248221A25C0E4717D4` |

These facts prove a repository-visible dependency and lexical callback scope. They do
not prove that a lock is acquired, that mutual exclusion holds, that the callback
runs, or that any runtime database, queue, or HTTP effect occurs.

Focused W0-W6 wrapper, schema, and documentation verification passed. Typecheck,
production build, ESLint with zero warnings, and formatting checks passed. The full
parallel suite passed 365 of 369 tests; three integration assertions exceeded their
wall-clock budgets and one raw-SQL CLI assertion observed missing output while the
suite was saturated. All affected files then passed together in a one-worker retry
(3 files, 6 tests), including the semantic raw-SQL assertion.
