# Backend API Intelligence Verified Critical-Section Wrapper Implementation Plan

Status: active internal implementation plan  
Primary validation target: `ticket-service-example`  
Prerequisite baseline: completed Phase 47 and package-proven Redlock critical sections

This plan closes the higher-order callback blind spot around repository-visible lock
wrappers without treating configuration or naming conventions as proof. The target
shape is the `RedisLockService.executeWithNttLock()` chain used by
`NttService.resolveTicket()`, but every published fact must follow from a bounded,
checker-resolved source path to a package-proven `redlock.using()` callback.

## Semantic contract

- A verified wrapper path proves only a supported static path from an inline callback
  argument into a package-proven critical-section callback. It does not prove runtime
  invocation, lock acquisition, exclusivity, delivery, timing, release, or success.
- Configuration may narrow eligible declarations or analysis bounds. It may never
  assert that a wrapper invokes its callback or that a technology is present.
- Receiver, method, parameter, and forwarding identities come from exact TypeScript
  symbols and repository-contained declarations rather than class-name text.
- Initial support is intentionally narrow: inline arrow/function arguments, direct
  callback invocation, and unchanged positional parameter forwarding.
- Unsupported transformations, delayed execution, ambiguous symbols, cycles, and
  exhausted bounds fail closed and never authorize nested-function traversal.
- Authorizing one inline callback does not authorize functions nested inside it.
- Existing extractors remain authoritative for calls, persistence, SQL, resources,
  and interactions after a callback has been independently authorized.
- Canonical ordering, IDs, evidence containment, redaction, and old-schema readers
  remain deterministic.

## Milestone W1: Freeze and prove the wrapper-flow contract

### Phase W0 — Frozen wrapper-flow gate

Status: complete

Goal: define the supported source language and its close negative counterparts before
writing callback-flow extraction code.

Deliverables:

1. Freeze non-executable `.ts.txt` fixtures for a direct wrapper and the real two-level
   `executeWithNttLock` forwarding shape.
2. Freeze negatives for callbacks that are ignored, invoked outside the critical
   section, stored for later, nested in an unproven scheduler, transformed through a
   new closure, spread through an argument tuple, trapped in a forwarding cycle, or
   passed as a method reference.
3. Record expected eligible paths, effects, evidence roles, bounds, diagnostics, and
   must-not-infer rules in a strict canonical manifest.
4. Type-check every fixture using declaration stubs without importing or executing
   target code.
5. Record the supplied real-service declaration paths and exact wrapper chain as the
   validation basis without making the external repository part of the test runtime.

Gate CSW0:

- Every positive has a close unsupported counterpart.
- Every wrapper step has a unique source marker and an explicit callback parameter.
- Only the underlying `Redlock.using` declaration supplies technology identity.
- The manifest targets analysis v8 while keeping analysis v7 frozen.
- No extractor behavior is changed in this phase.

Completion record:

- Added a strict, canonical CSW0 manifest with two eligible paths and eight close
  unsupported counterparts.
- Froze the direct wrapper and real two-level
  `executeWithNttLock → executeWithLock → Redlock.using` source shapes as
  non-executable `.ts.txt` fixtures.
- Froze negative contracts for ignored, outside-section, stored, scheduled,
  transformed, spread, cyclic, and method-reference callbacks.
- Recorded the six required evidence roles, three-hop bound, analysis-v8 schema
  decision, v7 freeze, derived-technology rule, and real ticket-service basis.
- Added a Gate CSW0 audit that canonicalizes the manifest, enforces positive/negative
  pairing, accounts for every marker and fixture, type-checks the corpus against
  declaration stubs, and prohibits executable fixture imports.
- Focused verification passed (1 file, 3 tests). Typecheck, lint, and formatting
  passed. The full parallel suite passed 356 of 358 tests; two unchanged integration
  tests exceeded existing wall-clock limits under contention and both passed in a
  one-worker retry (2 files, 5 tests).

### Phase W1 — Internal callback-flow summaries

Status: complete

Goal: create an internal, non-published representation of callback parameters that
reach a direct Redlock critical section.

Deliverables:

1. Index checker-resolved method declarations and stable parameter positions.
2. Summarize direct identifier invocation inside an already proven
   `redlock.using()` callback.
3. Preserve the terminal call, critical callback, parameter declaration, and
   invocation nodes as ordered evidence candidates.
4. Reject property storage, return-for-later, `.call()`/`.apply()`, rest parameters,
   destructuring, and nested unapproved function boundaries.
5. Unit-test package import aliases, lookalikes, unsupported parameter/call shapes,
   and repository containment. Call-site overload ambiguity begins in Phase W2, where
   call targets are first resolved.

Acceptance:

- `executeWithLock(lockKey, task)` records parameter 1 as reaching the direct
  critical section only when `task()` occurs lexically inside its proven callback.
- The ignored and outside-section W0 cases do not acquire summaries.

Completion record:

- Added an internal direct-parameter summary that retains the exact indexed method,
  parameter position and symbol, Redlock terminal call, critical callback, ordered
  direct invocations, and role-labelled proof nodes.
- Integrated summary collection only after the existing package-identity check has
  proven a real `redlock.using()` terminal; canonical analysis output and authorized
  nested callbacks remain unchanged.
- Restricted recognition to identifier parameters with no rest, destructuring, or
  default initializer and to direct non-optional identifier calls inside the proven
  callback's lexical body.
- Preserved nested function boundaries and rejected aliases, `.call()`/`.apply()`
  shapes, scheduled callbacks, outside-section invocation, stored callbacks, and
  package lookalikes.
- Added deterministic ordering across source, method, terminal, and parameter
  position.
- Focused verification passed (3 files, 6 tests). Typecheck, build, lint, and
  formatting passed. The full parallel suite passed 359 of 360 tests; one unchanged
  endpoint-trace case exceeded its existing wall-clock limit under contention and
  passed in a one-worker retry (1 file, 4 tests).

### Phase W2 — Bounded reverse wrapper propagation

Status: complete

Goal: prove multi-method wrapper chains by propagating terminal summaries backwards
through unchanged callback parameters.

Deliverables:

1. Resolve each wrapper call to one repository-contained method declaration.
2. Map arguments to parameters positionally without spreads, rest parameters, or
   ambiguous signatures.
3. Propagate only when the argument is the exact enclosing callback-parameter symbol.
4. Use a deterministic fixed point with cycle detection, a small hop limit, and hard
   state/candidate limits.
5. Retain the full terminal-to-entry evidence chain.
6. Keep transformed closures and cyclic sink-free chains unresolved.

Acceptance:

- `executeWithNttLock(..., task) → executeWithLock(..., task)` inherits the proven
  terminal for parameter 1.
- The W0 spread, transformed, and cyclic cases remain ineligible.

Completion record:

- Added exact checker-resolved forwarding edges between repository-contained method
  declarations and positional callback parameters.
- Restricted edges to directly referenced callable parameter symbols, one method
  implementation, property-access calls, and argument lists without spreads; nested
  functions, default/rest/destructured parameters, optional calls, aliases, and newly
  created callback closures remain boundaries.
- Added a deterministic fixed point that retains the shortest canonical proof for
  each method-parameter/Redlock-terminal pair and records the complete entry-to-sink
  flow plus proof nodes.
- Enforced a three-hop default, 1,024-state cap, 16-target-candidate cap, cycle
  detection, deterministic issue ordering, and validation of caller-supplied bounds.
- Added a no-Redlock fast path so repositories without a package-proven terminal do
  not pay for a repository-wide forwarding index.
- Verified the frozen two-level `executeWithNttLock → executeWithLock` chain while the
  transformed, spread, stored, scheduled, outside-section, method-reference, and
  sink-free cyclic counterparts remained ineligible.
- Focused verification passed (4 files, 8 tests). Typecheck, build, lint, and
  formatting passed. The final full parallel run passed 354 of 362 tests; eight
  existing wall-clock checks across seven CPU-heavy integration files timed out under
  contention, and all seven files passed serially (7 files, 10 tests). The isolated
  golden timing test completed well below its 40-second budget.

### Phase W3 — Call-site projection and nested traversal

Status: complete

Goal: project a verified wrapper summary onto an inline callback argument in the
calling method.

Deliverables:

1. Resolve the call-site receiver and method to the summarized declaration.
2. Accept only an inline arrow function or function expression at the proven argument
   position.
3. Add only that callback node to `allowedNestedFunctions` before downstream
   extractors run.
4. Emit a caller-owned Redlock critical-section resource and
   `CriticalSectionRecord` with the wrapper call, forwarding chain, terminal, and
   callback evidence.
5. Use a dynamic lock target unless bounded source value flow proves a stronger
   target; never copy the inner method's resource record across method ownership.
6. Project callback-contained canonical assertions through the existing
   `projectCriticalSectionEffects()` containment pass.

Acceptance:

- `resolveTicket()` exposes its inner method calls, TypeORM effects, resources, and
  interactions as `critical_section_conditional` effects.
- A method reference or unsupported flow remains a closed nested-function boundary.

Completion record:

- Added exact call-site projection from checker-resolved repository methods to inline
  callback arguments at the verified parameter position; optional calls, spreads,
  method references, ambiguous targets, and calls inside unrelated nested functions
  remain closed.
- Grouped all bounded terminal proofs for one call-site callback into one lexical
  projection, avoiding any claim about runtime lock count or acquisition behavior.
- Published caller-owned Redlock resource accesses and critical sections under the
  distinct `resource.redlock.verified-wrapper.v1` rule with dynamic targets and
  wrapper call, callback, forwarding, invocation, and package-terminal evidence.
- Authorized only the exact projected callback nodes for downstream class-call,
  repository, QueryBuilder, raw-SQL, resource, outbound HTTP, event-emitter, BullMQ,
  and Nest microservice extraction.
- Extended critical-section effect containment and integrity validation to include
  callback-contained `METHOD_INITIATES_INTERACTION` assertions.
- Added deterministic integration coverage proving a callback-contained method call,
  direct TypeORM write, QueryBuilder write, two HTTP interactions, local event,
  BullMQ job, and microservice message, while a method-reference caller remains
  unprojected.
- Focused verification passed (5 files, 7 tests). Typecheck, build, lint, and
  formatting passed. The full parallel suite passed 359 of 363 tests; four unchanged
  integration tests exceeded existing wall-clock limits under contention and all
  passed in a one-worker retry (3 files, 6 tests).

## Milestone W2: Publish and consume the new facts

### Phase W4 — Analysis v8, diagnostics, and compatibility

Status: complete

Goal: publish wrapper-flow outcomes without mutating the frozen v7 contract.

Deliverables:

1. Add analysis v8 diagnostic codes for ambiguous, unproven, and bounded-out wrapper
   flows only where a package-proven candidate justifies a diagnostic.
2. Reuse the existing critical-section/resource shapes where sufficient and add no
   public field that merely duplicates evidence.
3. Define a wrapper-derived rule ID distinct from direct `redlock.using` extraction.
4. Update stable-ID inputs, ordering, validation, run documents, comparison, impact,
   and v1-v7 compatibility tests.
5. If optional wrapper selectors are still justified, introduce project configuration
   v5 with exact `sourceFile`, exported/qualified class, method, and callback-parameter
   identity. Omit configured technology and preserve automatic proof as authoritative.
6. Regenerate checked-in JSON schemas and document migration.

Gate CSW1:

- Configuration cannot upgrade an unsupported flow to resolved.
- Every wrapper-derived section owns its resource access and effects through the same
  source method.
- Existing v7 documents validate and compare unchanged.

Completion record:

- Published analysis and run schema `8.0.0` while retaining independently strict
  v1-v7 validators; v7 rejects the four v8-only wrapper-flow diagnostics and remains
  comparison-compatible with an equivalent v8 projection.
- Added terminal-anchored diagnostics for unsupported inline projection, ambiguous
  verified targets, terminal-connected cycles, and hop/state/target-candidate limits.
  Sink-free cycles and arbitrary higher-order helpers remain silent because no
  package-proven candidate justifies a wrapper claim.
- Reused the v7 resource and critical-section shapes, kept caller ownership and
  deterministic evidence/ID inputs, and retained the distinct
  `resource.redlock.verified-wrapper.v1` rule.
- Updated normalization, canonical ordering, run validation, comparison v5, impact
  v2, system-input compatibility, trace schemas, current examples, and living
  documentation for analysis v8.
- Omitted wrapper selector configuration after implementation proved it unnecessary:
  exact repository symbols and package-terminal flow are authoritative, and
  configuration cannot upgrade an unsupported path.
- Regenerated and reformatted the checked-in project-configuration schema; it remains
  byte-identical and gains no wrapper selector or technology assertion.
- Focused wrapper/schema/compatibility and Documentation Gate D1 suites passed.
  Typecheck, build, lint, and formatting passed. The full parallel suite passed 361
  of 367 tests; six existing wall-clock checks exceeded their budgets under
  contention, and every affected file passed in a one-worker retry (6 files, 9
  tests), including the golden determinism budget.

### Phase W5 — Trace, graph, policy, and export hardening

Status: complete

Goal: make wrapper-derived paths useful everywhere direct critical sections are
already useful.

Deliverables:

1. Preserve `critical_section_conditional` classification in endpoint and interaction
   handler traces.
2. Show concise wrapper-chain evidence in the offline graph inspector without adding
   a speculative runtime edge.
3. Audit Markdown, controls, OpenAPI enrichment, policy inputs, comparison, impact,
   and system reports.
4. Keep graph layout and labels readable for expanded legacy-service paths.
5. Add deterministic serialization and report-schema compatibility tests.

Implementation result:

- Endpoint and independent in-process-handler traces now have focused wrapper tests
  proving `critical_section_conditional`; distributed worker/system-report tests prove
  that an existing broker boundary continues to dominate as
  `distributed_conditional`.
- Graph v9 remains schema-compatible for analysis v7 and v8. Wrapper scope nodes and
  edges use concise, explicit static-projection labels, and the inspector presents
  symbol-only proof snippets plus the non-execution honesty boundary. No speculative
  wrapper-chain runtime node or edge was added.
- Markdown, policy inputs, comparison, and impact are exercised against a
  wrapper-derived write. The frozen control/OpenAPI v5 contract is explicitly tested:
  synchronous `dbWrites` remains empty rather than misclassifying a conditional write.
- Repeat scans produce byte-identical canonical graph reports, while graph validators
  accept both the frozen v7 and current v8 analysis families at graph schema v9.
- Focused wrapper, graph, v7/v8 compatibility, documentation, and system-report
  verification passed (12 files, 29 tests). Typecheck, build, lint, and formatting
  passed. The full parallel suite passed 364 of 368 tests; four existing integration
  checks exceeded their wall-clock budgets under contention, and all four passed in a
  one-worker retry (3 files, 6 tests).

### Phase W6 — Real-service validation and documentation

Status: complete

Goal: verify the feature against the supplied ticket service after synthetic contracts
pass.

Deliverables:

1. Build the CLI and scan `ticket-service-example` without executing application code.
2. Confirm `NttService.resolveTicket()` traverses through
   `RedisLockService.executeWithNttLock()` and exposes the expected inner calls and DB
   effects.
3. Confirm `forceResolveTicket()` and existing direct paths do not regress.
4. Review every remaining wrapper diagnostic and document supported/unsupported
   forms.
5. Run focused tests, the full suite, typecheck, build, lint, formatting, and a
   deterministic repeat scan.

Gate CSW2:

- The real `resolveTicket()` trace no longer terminates at the wrapper.
- No unsupported callback is traversed solely because of a configured or textual
  match.
- Documentation continues to state that the path is static and conditional, not proof
  of runtime lock behavior.

Completion record:

- Built the production CLI and scanned `ticket-service-example` with `--no-config`,
  so acceptance relied on exact repository symbols and package-terminal proof rather
  than configured wrapper names. No target application code was imported or run.
- `PUT /resolve` now retains `RedisLockService.executeWithNttLock` and traverses its
  inline callback into the expected validation, persistence, verification, and
  finalization calls. The section owns 11 direct assertions and the endpoint exposes
  eight table effects as `critical_section_conditional`.
- `PUT /force-resolve` retained seven synchronous table effects and its nested
  `forceResolveNtt` section contributes two conditional table effects, proving that
  existing direct and ordinary synchronous paths were not reclassified.
- Audited all real wrapper diagnostics. Exact internal parameter-forwarding calls no
  longer emit a contradictory unproven-flow warning after that same AST call is part
  of a successful bounded proof. The one remaining warning is the deliberately
  unsupported local `executeLogic` callback reference; its function body stays closed.
- The real scan found 215 endpoints, 14 verified wrapper sections, one direct Redlock
  section, and 632 total repository diagnostics with an honest
  `completed_with_gaps` status. Two scans produced byte-identical `analysis.json` and
  offline graph artifacts.
- Added the frozen acceptance record at
  `docs/benchmarks/phase-w6-critical-section-wrapper-validation.md` and linked it from
  the supported-pattern and Redlock guides. Focused tests cover both successful
  two-hop forwarding and the retained method-reference negative.
- Focused W0-W6 wrapper/schema/documentation tests, typecheck, production build,
  lint, and formatting passed. The full parallel suite passed 365 of 369 tests; the
  four contention-affected assertions all passed in a one-worker retry (3 files, 6
  tests), including the isolated raw-SQL semantic assertion.

## Deferred extensions

- Proving transformed callbacks such as `() => task()` across another wrapper layer.
- Resolving lock-key templates interprocedurally across arbitrary value transforms.
- External declaration-only wrappers whose implementation is unavailable.
- General-purpose higher-order function, scheduler, or promise callback analysis.
- Raw Redlock-compatible clients that cannot be tied to the installed package symbol.

These extensions require separate frozen contracts and must not be folded into the
initial implementation opportunistically.
