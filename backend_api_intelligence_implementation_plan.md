# Backend API Intelligence - Phased Implementation Plan

## Purpose and authority

This is the execution plan for implementing the project described in
`backend_api_intelligence_personal_project_plan.md`. The project plan remains the
authoritative product and scope contract. This document translates it into a
dependency-ordered sequence of small implementation phases.

This plan is intentionally written for the implementing agent. It should be used to:

- choose the next bounded unit of work;
- avoid implementing later features before their foundations exist;
- define the tests and artifacts required before a phase is complete;
- preserve the project's deterministic, evidence-first behavior;
- prevent P1 and P2 work from entering the MVP accidentally.

If this implementation plan conflicts with the project plan, follow the project plan
and update this document before continuing.

---

# 1. Execution Strategy

## 1.1 Implementation order

The implementation will proceed through these phases:

| Phase | Outcome | Estimated effort | Depends on |
|---|---|---:|---|
| 0 | Scope, fixture, and expected behavior are frozen | 5-7 hours | None |
| 1 | Repository scaffold and automated quality gates work | 4-6 hours | Phase 0 |
| 2 | Canonical model, schemas, IDs, evidence, and diagnostics exist | 6-8 hours | Phase 1 |
| 3 | Safe repository inventory and TypeScript semantic index work | 7-9 hours | Phase 2 |
| 4 | First vertical slice: route catalogue in canonical JSON and Markdown | 9-12 hours | Phase 3 |
| 5 | Class-based constructor injection and direct calls resolve | 9-12 hours | Phase 4 |
| 6 | TypeORM entities, repository bindings, and table operations resolve | 9-12 hours | Phase 5 |
| 7 | Endpoint trace traversal produces read and write traces | 5-7 hours | Phase 6 |
| 8 | Direct guards and uncertainty semantics are complete | 4-6 hours | Phase 7 |
| 9 | CLI workflow and reports are complete | 4-6 hours | Phase 8 |
| 10 | Determinism, safety, negative cases, and integrity are hardened | 5-7 hours | Phase 9 |
| 11 | Real-repository validation, documentation, and demo are complete | 5-7 hours | Phase 10 |

Expected total: approximately 72-99 focused hours. This is slightly more
conservative than the product-plan estimate because it makes infrastructure,
verification, and phase gates explicit. Scope should be reduced before quality gates
are weakened.

## 1.2 Why this order differs from the milestone summary

The project-plan milestones correctly describe product increments, but the following
cross-cutting concerns must be implemented earlier than their original milestone
placement suggests:

- Evidence locations are created by every extractor, so the evidence API belongs
  before route extraction rather than near the end.
- Stable IDs and deterministic ordering affect golden files, so they belong before
  the first canonical output.
- Diagnostics and resolution states affect extractor return types, so their contracts
  must exist before unresolved cases appear.
- Runtime schemas must validate the first generated `analysis.json`, not be retrofitted
  after all extractors are complete.
- Trace traversal is easiest to implement only after call and persistence assertions
  share one validated graph representation.

## 1.3 Phase completion rule

A phase is complete only when all of the following are true:

1. Its implementation checklist is complete.
2. Its focused tests pass.
3. All previously completed tests still pass.
4. Its exit artifact can be generated from a clean checkout.
5. Its exit demonstration has been run successfully.
6. New supported and unsupported behavior is documented where relevant.
7. No unresolved design decision is hidden in a placeholder or guessed fact.

Do not begin substantial work from the next phase while the current phase's exit gate
is failing. Small forward-compatible interfaces are allowed; speculative
implementations are not.

## 1.4 Working rules

- Keep each work unit small enough for one focused session, preferably 60-120 minutes.
- Add or update a test in the same work unit as each analysis rule.
- Prefer one rule with explicit limitations over several partially correct rules.
- Analyze source only through filesystem reads and the TypeScript Compiler API.
- Never load the target through `require`, dynamic `import`, NestJS bootstrap, test
  commands, build commands, or application scripts.
- Treat `analysis.json` as the canonical deterministic artifact.
- Keep timestamps, elapsed time, and other volatile metadata in `run.json`.
- Keep extractors independent: each emits model records, assertions, evidence, and
  diagnostics; it must not format CLI output directly.
- Resolve symbols with the TypeChecker. Never create call or injection edges by
  matching names alone.
- Use repository-relative normalized paths with `/` separators in model output.
- Keep the maximum inter-method trace depth configurable but capped at 3 for the MVP.
- Record an explicit `ambiguous`, `unresolved`, or `unsupported` result instead of
  selecting a convenient target.
- Do not start P1 or P2 work until Phase 11 passes.

---

# 2. Planned Repository Shape

Create files only when their phase needs them. The target structure is:

```text
.
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts
  src/
    cli/
      index.ts
      commands/
        scan.ts
        endpoints.ts
        trace.ts
        report.ts
      errors.ts
      output.ts
    config/
      analysis-config.ts
    model/
      analysis.ts
      entities.ts
      assertions.ts
      evidence.ts
      diagnostics.ts
      schemas.ts
      ids.ts
      ordering.ts
    scanner/
      inventory.ts
      exclusions.ts
      git-metadata.ts
    ts-index/
      program.ts
      source-index.ts
      symbols.ts
      decorators.ts
      constants.ts
    evidence/
      locations.ts
      snippets.ts
      redact.ts
      validate.ts
    extractors/
      nest-routes.ts
      constructor-injection.ts
      method-calls.ts
      typeorm-entities.ts
      typeorm-repositories.ts
      nest-guards.ts
    resolve/
      direct-calls.ts
      repository-operations.ts
    trace/
      adjacency.ts
      endpoint-trace.ts
    diagnostics/
      catalogue.ts
    reporters/
      json.ts
      markdown.ts
      endpoint-catalogue.ts
      endpoint-trace.ts
  example-nestjs-app/
    src/
    tsconfig.json
    FIXTURE.md
    expected/
      endpoint-catalogue.json
      read-trace.json
      write-trace.json
      guarded-write-trace.json
      legacy-read-write-trace.json
      diagnostics.json
      negative-assertions.json
      analysis.json
  fixtures/
    ambiguous-calls/
    unsupported-patterns/
  test/
    unit/
    integration/
    golden/
    helpers/
  docs/
    supported-patterns.md
    architecture.md
  README.md
```

Names may change when implementation makes a clearer boundary apparent, but preserve
the responsibility split between scanning, semantic indexing, extraction, tracing,
evidence, diagnostics, and presentation.

---

# 3. Phase 0 - Freeze Scope and Ground Truth

## Goal

Turn the product plan into immutable examples before analyzer code exists. This avoids
changing expected behavior to match an implementation mistake.

## Decisions to record

- Package manager and supported Node.js version.
- Pinned TypeScript version used by the analyzer.
- CLI framework, if any, and runtime schema library. Default choices: a small CLI
  library and Zod; avoid a framework-heavy application container.
- Test runner. Default choice: Vitest.
- One reference NestJS/TypeORM repository or an intentionally small local fixture.
- Default table-name rule when `@Entity()` does not specify a name. The MVP should
  use one documented, deterministic rule and report the limitation rather than
  reproduce every TypeORM naming strategy.
- Maximum evidence snippet length and maximum analyzed source-file size.

## Fixture requirements

The integrated fixture must include:

- empty and non-empty controller prefixes;
- literal, empty, and simple `const` route paths;
- one dynamic route path that is unsupported;
- GET, POST, and PUT or DELETE examples;
- controller-to-service class injection;
- service-to-service class injection;
- `@InjectRepository(Entity)` injection;
- one repository read and at least two write variants, including `save()`;
- explicit and default `@Entity` table naming;
- controller-level and method-level `@UseGuards`;
- a similarly named uncalled method;
- a short call cycle, either in source or as a frozen assertion-graph case when a
  source-level Nest cycle would require out-of-scope `forwardRef` injection;
- a string or symbol injection token that is unsupported;
- an unsupported repository operation.

## Implementation checklist

- [x] Adopt and refine the provided `example-nestjs-app`; treat its installed packages
      and generated build output as excluded inputs rather than duplicating them.
- [x] Hand-write the exact endpoint catalogue expected from supported routes.
- [x] Hand-write one read trace and one write trace.
- [x] Mark evidence ranges in the expectations or a fixture annotation document.
- [x] Write expected diagnostics for every intentionally unsupported construct.
- [x] Add at least one negative assertion describing a relationship that must not
      appear.
- [x] Select 3-5 endpoints for final fixture evaluation.
- [x] Record every decision above in a short fixture README or decision section.

## Exit artifacts

```text
example-nestjs-app/expected/endpoint-catalogue.json
example-nestjs-app/expected/read-trace.json
example-nestjs-app/expected/write-trace.json
example-nestjs-app/expected/guarded-write-trace.json
example-nestjs-app/expected/legacy-read-write-trace.json
example-nestjs-app/expected/diagnostics.json
example-nestjs-app/expected/negative-assertions.json
example-nestjs-app/expected/analysis.json
example-nestjs-app/FIXTURE.md
```

## Exit gate

The expectations can be reviewed without reading analyzer code and unambiguously show:

- which facts should resolve;
- which cases should be ambiguous, unresolved, or unsupported;
- which source range supports each expected route and trace step;
- which tempting but false relationships must be absent.

## Do not implement yet

No extractor, generalized module resolver, QueryBuilder support, global guard analysis,
DTO flow, column lineage, UI, database, or AI output.

---

# 4. Phase 1 - Scaffold and Quality Gates

## Goal

Create a minimal TypeScript CLI project whose build, test, lint, and help commands are
reliable before analysis behavior is added.

## Implementation checklist

- [x] Initialize package metadata and pin runtime dependencies.
- [x] Pin the analyzer TypeScript version exactly.
- [x] Enable strict TypeScript settings.
- [x] Configure separate development/test and build TypeScript configurations if
      needed.
- [x] Configure the test runner with unit, integration, and golden test locations.
- [x] Add formatting and linting with the smallest practical configuration.
- [x] Implement the `api-intel` CLI entry point.
- [x] Add command shells for `scan`, `endpoints`, `trace`, and `report`.
- [x] Make unimplemented commands fail explicitly with a stable non-zero exit code.
- [x] Add a version constant and expose `--version` and `--help`.
- [x] Establish a temporary-output helper for tests; do not write generated artifacts
      into fixture source directories.
- [x] Add scripts for build, typecheck, test, and lint.

## Tests

- CLI help snapshot or focused assertions.
- Version command test.
- Unknown command and missing argument tests.
- Typecheck and empty test-suite smoke checks.

## Exit demonstration

```bash
api-intel --help
api-intel --version
```

## Exit gate

Build, typecheck, lint, and tests pass from a clean install. CLI failures are readable
and do not print stack traces unless a debug option is intentionally enabled.

## Completion record

Completed on 2026-08-16. A frozen pnpm install, formatting check, lint, strict
typecheck, 10 Vitest tests, production build, and compiled CLI help/version smoke tests
passed. Compiled usage failures return exit code 2; known unimplemented command shells
return exit code 3 without stack traces.

---

# 5. Phase 2 - Canonical Model and Cross-Cutting Contracts

## Goal

Freeze the internal/output contracts needed by every extractor before the first
feature is built.

## Design requirements

The model must represent at least:

- analysis run metadata;
- normalized source files;
- classes and their roles;
- methods;
- endpoints;
- guards;
- repository bindings;
- TypeORM entities and tables;
- assertions;
- evidence;
- diagnostics.

Assertions must support these predicates:

- `ENDPOINT_IMPLEMENTED_BY`
- `METHOD_CALLS_METHOD`
- `CLASS_INJECTS_CLASS`
- `CLASS_INJECTS_REPOSITORY`
- `REPOSITORY_FOR_ENTITY`
- `ENTITY_MAPS_TO_TABLE`
- `METHOD_READS_TABLE`
- `METHOD_WRITES_TABLE`
- `ENDPOINT_USES_GUARD`

## Implementation checklist

- [x] Define TypeScript types for all canonical entities.
- [x] Define the four assertion statuses: `resolved`, `ambiguous`, `unresolved`, and
      `unsupported`.
- [x] Define result states: `completed`, `completed_with_gaps`, `failed`, and
      `canceled`.
- [x] Define evidence roles and exact location semantics.
- [x] Define the initial diagnostic catalogue from the project plan.
- [x] Create runtime schemas for `analysis.json`, `run.json`, and trace views.
- [x] Implement normalized repository-relative paths.
- [x] Implement content hashing for source files.
- [x] Implement stable ID builders based on record kind plus normalized semantic
      identity. Keep volatile run data out of stable IDs.
- [x] Specify collision handling. A duplicate ID with unequal content must be an
      integrity failure, not last-write-wins behavior.
- [x] Implement canonical comparison and output ordering for every record array.
- [x] Implement a source-location helper that converts TypeScript node positions into
      one-based line/column ranges.
- [x] Implement bounded snippets and obvious-secret redaction.
- [x] Implement integrity validation:
  - all referenced IDs exist;
  - each resolved assertion has evidence;
  - evidence points to a known source file;
  - evidence hash matches the indexed file;
  - start positions do not follow end positions;
  - IDs are unique;
  - runtime schema validation succeeds.

## Important model decisions

- `analysis.json` contains no timestamps or absolute workspace paths.
- `run.json` may contain timestamps, duration, repository input path, and environment
  metadata; normalized comparison excludes explicitly volatile values.
- Snippets are convenience data, never the identity or sole proof of evidence.
- Display names may change without changing semantic identity where the underlying
  qualified symbol has not changed.
- Assertions carry rule IDs so later output can explain which deterministic rule
  produced them.

## Tests

- ID stability across repeated construction.
- Distinct IDs for overloaded or same-named symbols in different files/classes.
- Windows input paths normalize to repository-relative `/` paths.
- Canonical ordering is independent of discovery order.
- Evidence location uses one-based line and column values.
- Snippet truncation and redaction.
- Runtime schema accepts a minimal valid analysis and rejects broken references.
- Resolved assertion without evidence fails validation.

## Exit artifact

A hand-constructed minimal `analysis.json` that passes runtime and integrity validation
and serializes identically when its input arrays are shuffled.

Exit artifact: `test/fixtures/minimal-analysis.json`.

## Exit gate

Later extractors can emit records exclusively through these contracts without adding
ad hoc output shapes.

## Completion record

Completed on 2026-08-16. Runtime schemas, semantic types, deterministic ID factories,
path/hash helpers, evidence creation/redaction, diagnostic factories, canonical
serialization, and cross-record integrity validation are implemented. The checked-in
minimal analysis passes schema and integrity validation and is byte-identical after
shuffled discovery order. All 55 tests and quality gates pass.

---

# 6. Phase 3 - Safe Inventory and TypeScript Semantic Index

## Goal

Load an in-scope repository into a TypeScript `Program` and expose reusable semantic
lookups without executing any target code.

## Implementation checklist

- [x] Validate and resolve the repository directory and primary `tsconfig.json`.
- [x] Reject missing, unreadable, or out-of-repository configuration paths with clear
      diagnostics.
- [x] Implement inventory exclusions for `.git`, `node_modules`, `dist`, `build`,
      coverage, analyzer output, binaries, symlinks that escape the repository, and
      oversized files.
- [x] Decide explicit symlink behavior and test it. The implementation skips all
      source symlinks and distinguishes targets inside and outside the repository.
- [x] Read source bytes once where practical and create `SourceFile` records with
      normalized paths and hashes.
- [x] Read the local Git revision when available without invoking target repository
      hooks or scripts; absence of Git metadata must not prevent analysis.
- [x] Parse the target `tsconfig.json` through the Compiler API.
- [x] Create a `Program` and `TypeChecker` without emitting output.
- [x] Surface TypeScript configuration, parse, and import diagnostics in the tool's
      diagnostic model.
- [x] Build a source index for classes, methods, constructors, parameters, imports,
      decorators, and qualified symbols.
- [x] Add helpers for decorator identity that use resolved imports/symbols rather than
      raw decorator text alone.
- [x] Add the deliberately narrow constant resolver needed for literal and simple
      `const` string paths.
- [x] Keep target-project compiler diagnostics distinct from analyzer integrity
      failures; useful partial analysis may still be possible for some diagnostics.

## Safety verification

- Add a fixture file with a top-level side effect that would create a sentinel file if
  executed.
- Run inventory and Program creation.
- Assert that the sentinel file was not created.
- Inspect package scripts only as text; never invoke them.

## Tests

- Default and explicit `tsconfig.json` selection.
- Exclusion behavior.
- File-size limit behavior.
- Path containment and symlink behavior.
- TypeScript parse diagnostic mapping.
- Index returns the expected fixture classes and methods.
- Decorator helper distinguishes supported imported decorators from same-named local
  functions.
- Constant resolver handles literal and simple `const` strings and declines computed
  values.

## Exit demonstration

Run an internal inspection command or test that deterministically lists fixture source
files, classes, methods, decorators, and evidence locations.

## Exit gate

The fixture is indexed through the TypeChecker, no repository code executes, and all
source paths/hashes are stable across two runs.

## Completion record

Completed on 2026-08-16. The analyzer now has a deterministic, size-bounded repository
inventory; explicit all-symlink skipping; optional local Git revision discovery; a
non-emitting inventory-backed TypeScript `Program` and `TypeChecker`; normalized
compiler diagnostics; and reusable indexes for imports, classes, constructors,
parameters, methods, decorators, and qualified symbols. Decorator identity requires a
resolved imported symbol, and string resolution is deliberately limited to literals
and one immutable `const` hop. The sample NestJS application is indexed with exact
evidence coordinates, excluded and out-of-repository source imports are blocked before
compiler reads, and a top-level side-effect sentinel remains absent. All 69 tests,
formatting, lint, strict typecheck, and production build gates pass.

---

# 7. Phase 4 - Route Catalogue Vertical Slice

## Goal

Deliver the first complete user-visible slice: `scan` detects supported NestJS routes,
writes validated canonical JSON, and `endpoints` renders the catalogue.

## Supported route rules

- Standard NestJS REST controllers and HTTP method decorators only.
- Empty path, string literal path, and simple `const` string reference.
- Controller and method paths are combined with one deterministic normalizer.
- Unsupported computed paths emit `NEST_ROUTE_DYNAMIC`.
- Unsupported custom decorator factories emit `NEST_CUSTOM_ROUTE_DECORATOR` when they
  look relevant; they never create a resolved endpoint.

## Implementation checklist

- [x] Detect classes decorated with the supported NestJS `@Controller` symbol.
- [x] Detect methods decorated with supported HTTP method symbols.
- [x] Extract controller and method path expressions through the narrow constant
      resolver.
- [x] Normalize slashes, empty segments, leading slash, and route parameters without
      changing parameter names.
- [x] Create class, method, endpoint, evidence, and
      `ENDPOINT_IMPLEMENTED_BY` records.
- [x] Attach decorator and declaration evidence as required.
- [x] Emit explicit diagnostics for dynamic or unsupported-looking routes.
- [x] Implement the scan pipeline sufficiently to write `run.json` and validated
      `analysis.json`.
- [x] Implement canonical JSON writing.
- [x] Implement the endpoint-catalogue view and Markdown output.
- [x] Implement `api-intel endpoints <analysis.json>` using only canonical JSON; it
      must not rescan source.
- [x] Decide duplicate normalized endpoint behavior. Preserve both declarations and
      mark selection as ambiguous; do not silently overwrite one.

## Tests

- Every route case listed in the project plan.
- Same-named local decorator is not treated as NestJS.
- Controller and method path normalization table tests.
- Dynamic path produces a diagnostic and no guessed endpoint.
- Duplicate method/path endpoint remains visible and ambiguous.
- Every resolved endpoint-to-handler assertion has valid evidence.
- Fixture endpoint catalogue exactly matches the frozen expectation.

## Exit demonstration

```bash
api-intel scan ./fixtures/basic-nest-app
api-intel endpoints ./fixtures/basic-nest-app/.api-intel/analysis.json
```

The actual tests should use a temporary output directory even if the demonstration
uses the default `.api-intel` path.

## Exit gate

The catalogue contains no missing or extra supported endpoints, output validates at
runtime, unsupported routes are visible, and two scans produce identical normalized
`analysis.json`.

## Completion record

Completed on 2026-08-16. Standard `@nestjs/common` controller and HTTP-method
decorators are now resolved through both TypeChecker symbols and actual package
declaration origins. Empty, literal, and one-hop immutable `const` paths normalize
deterministically; computed paths and proven custom route wrappers emit explicit
diagnostics without guessed endpoints. Extraction creates validated class, method,
endpoint, assertion, and exact evidence records. The scan pipeline writes canonical
`analysis.json`, volatile `run.json`, and deterministic `endpoints.md`; the `endpoints`
command regenerates the same Markdown from canonical JSON after source deletion.
Duplicate HTTP method/path declarations remain separate and are marked ambiguous in
the catalogue, while repeated identical decorators on one handler are deduplicated.
Two independent scans match byte-for-byte, the sample application matches all seven
frozen endpoints with no extras, and all 78 tests plus formatting, lint, strict
typecheck, and production build gates pass.

---

# 8. Phase 5 - Constructor Injection and Direct Method Calls

## Goal

Resolve a route handler through directly injected class providers without name-only
guessing.

## Supported resolution rules

- Constructor injection with a class type.
- TypeScript parameter properties such as `private readonly service: CustomerService`.
- Explicit constructor parameters assigned directly to `this.<member>` only if the
  assignment is simple and unambiguous.
- Direct call form `this.<injectedMember>.<method>(...)`.
- Only checker-resolved target method declarations.
- Maximum traversal depth of 3 and cycle protection.

## Implementation checklist

- [x] Extract constructor parameters and parameter-property members.
- [x] Resolve class type references to declarations through the TypeChecker.
- [x] Create `CLASS_INJECTS_CLASS` assertions with type-reference evidence.
- [x] Recognize `@Inject(...)` unsupported token forms and emit
      `DI_TOKEN_UNSUPPORTED` rather than a class edge.
- [x] Map `this.<member>` expressions to the resolved injected member.
- [x] Resolve the called method symbol and exact declaration.
- [x] Create `METHOD_CALLS_METHOD` assertions with call-site and resolution-basis
      evidence.
- [x] Report zero targets as `CALL_TARGET_UNRESOLVED` and multiple plausible
      declarations as ambiguous.
- [x] Record calls independently of traversal depth; apply the depth cap when building
      a trace.
- [x] Add visited-method cycle protection to the preliminary call-trace view.
- [x] Ensure similarly named but uncalled methods never receive an edge.

## Tests

- Controller injects a service and calls one method.
- Service injects and calls another service.
- Parameter property and explicit assignment variants.
- Unsupported string/symbol token.
- Same method name on another provider creates no edge.
- Missing and ambiguous target behavior.
- Cycle terminates and retains the discovered valid edges.
- Depth 3 stops cleanly and produces `CALL_DEPTH_LIMIT` when more supported calls exist.

## Exit demonstration

Trace one fixture endpoint from its handler to the expected service method(s), ending
before persistence. Print or snapshot each call edge and its evidence.

## Exit gate

The selected fixture endpoints reach only the manually expected provider methods, and
no relationship was inferred from text or method name alone.

## Completion record

Completed on 2026-08-16. Constructor parameter properties and simple, unambiguous
constructor assignments now establish injected-member bindings only when the
TypeChecker resolves an in-repository class declaration. The analyzer emits canonical
`CLASS_INJECTS_CLASS` and `METHOD_CALLS_METHOD` assertions with type-reference,
binding-resolution, and call-site evidence; exact method symbols determine targets,
while unresolved and overloaded targets remain explicit. `@Inject(...)` tokens emit
`DI_TOKEN_UNSUPPORTED`, and `@InjectRepository(...)` remains intentionally deferred to
Phase 6. Preliminary call tracing is breadth-first, capped at depth three, cycle-safe,
and emits `CALL_DEPTH_LIMIT` only for undiscovered supported continuations. The frozen
sample resolves exactly four class injection edges and seven direct call edges, with no
edge to the similarly named backup method or legacy token sink. The selected POST
`/notes` endpoint traces through `NotesService.create` to
`NotesFormatterService.normalize` and stops before persistence. All 84 tests plus
formatting, lint, strict typecheck, and production build gates pass.

---

# 9. Phase 6 - TypeORM Entities and Table Access

## Goal

Resolve injected TypeORM repositories to entities and classify supported repository
operations as table reads or writes.

## Supported persistence rules

| Direction | Methods |
|---|---|
| Read | `find`, `findOne`, `findOneBy`, `findBy`, `count`, `exists` |
| Write | `save`, `insert`, `update`, `delete`, `remove` |

Column decorators are metadata only. The MVP must not infer column impact. `save()` and
`remove()` must produce `TYPEORM_SAVE_COLUMNS_UNKNOWN` or an equivalent honest
limitation when exact columns are not proven.

## Implementation checklist

- [x] Detect `@Entity` using resolved TypeORM decorator identity.
- [x] Extract explicit string table names.
- [x] Apply only the frozen simple default-name rule when the decorator has no name.
- [x] Extract `@Column`, `@PrimaryColumn`, and `@PrimaryGeneratedColumn` metadata
      without deriving data flow.
- [x] Create Entity and Table records plus `ENTITY_MAPS_TO_TABLE` assertions.
- [x] Detect constructor parameters decorated with `@InjectRepository(Entity)`.
- [x] Resolve the entity argument to one exact declaration.
- [x] Create RepositoryBinding records and `CLASS_INJECTS_REPOSITORY` plus
      `REPOSITORY_FOR_ENTITY` assertions.
- [x] Resolve repository member calls only when the receiver is a proven repository
      binding.
- [x] Classify the supported repository method set.
- [x] Create `METHOD_READS_TABLE` or `METHOD_WRITES_TABLE` assertions with both
      call-site and entity-table evidence.
- [x] Emit `TYPEORM_ENTITY_UNRESOLVED` for an unresolvable entity.
- [x] Emit `TYPEORM_OPERATION_UNSUPPORTED` for a repository receiver calling an
      unsupported method.
- [x] Emit the exact-columns-unknown diagnostic where required.
- [x] Do not treat arbitrary objects with `find` or `save` methods as repositories.

## Tests

- Explicit table name.
- Default table-name rule.
- All supported read methods via table-driven tests.
- All supported write methods via table-driven tests.
- `save()` and `remove()` do not claim columns.
- Unsupported custom repository call.
- Same method name on a non-repository object creates no table assertion.
- Unresolved and ambiguous entity argument behavior.
- Every table assertion has repository call and entity mapping evidence.

## Exit demonstration

Show one service method with a resolved table read and one with a resolved table write,
including the operation call, entity mapping, table name, direction, and evidence.

## Exit gate

All fixture operations have the correct read/write direction, the negative repository
case remains absent, and unsupported or imprecise behavior is explicitly diagnosed.

## Completion record

Completed on 2026-08-16. TypeORM `@Entity` declarations are now proven through
TypeChecker-resolved package symbols and mapped to explicit literal/one-const-hop table
names or the frozen lowercase-class default. The extractor records entity and table
records, recognizes supported column decorator metadata without claiming column flow,
and resolves parameter-property or direct-assignment `@InjectRepository(...)` members
to exact entity declarations. Canonical `CLASS_INJECTS_REPOSITORY`,
`REPOSITORY_FOR_ENTITY`, `ENTITY_MAPS_TO_TABLE`, `METHOD_READS_TABLE`, and
`METHOD_WRITES_TABLE` assertions carry binding, call-site, declaration, and mapping
evidence. All six read and five write operations are classified only on proven
repository receivers; operation-specific rule IDs preserve the matched method.
Unresolved or ambiguous entity tokens remain explicit, unsupported operations emit
`TYPEORM_OPERATION_UNSUPPORTED`, and `save`/`remove` emit
`TYPEORM_SAVE_COLUMNS_UNKNOWN` without column claims. Nested arrow callbacks retain
lexical repository ownership, allowing the intentionally messy endpoint to resolve
honestly. The frozen sample matches exactly two entity/table mappings, two repository
bindings, eight supported operations, one unsupported `preload`, and two unknown-column
diagnostics. All 86 tests plus formatting, lint, strict typecheck, and production build
gates pass.

---

# 10. Phase 7 - Endpoint Trace Assembly

## Goal

Assemble the independently extracted assertions into the canonical endpoint-to-table
trace promised by the product.

## Trace behavior

```text
Endpoint
  -> handler method
  -> zero or more directly resolved provider methods
  -> table read/write terminal(s)
```

Trace traversal must be deterministic, cycle-safe, and bounded. It operates on the
canonical model, not directly on TypeScript AST nodes.

## Implementation checklist

- [x] Build typed adjacency indexes from assertion arrays.
- [x] Resolve an endpoint selector by HTTP method plus normalized path.
- [x] Return an explicit not-found result when no endpoint matches.
- [x] Return an ambiguous selection result when multiple endpoints match.
- [x] Traverse `ENDPOINT_IMPLEMENTED_BY`, `METHOD_CALLS_METHOD`, and table assertions.
- [x] Apply maximum call depth at traversal time.
- [x] Prevent cycles using path-aware or visited-node tracking without suppressing
      distinct valid terminal paths.
- [x] Preserve assertion status and evidence on every trace step.
- [x] Include all deterministically reachable table terminals rather than selecting a
      preferred one.
- [x] Sort branches and terminals canonically.
- [x] Attach trace-relevant diagnostics, including depth limits and unresolved calls.
- [x] Define a runtime-validated endpoint-trace view derived entirely from
      `analysis.json`.

## Tests

- Frozen read trace.
- Frozen write trace.
- Two service hops.
- Multiple table terminals have stable ordering.
- Call cycle terminates.
- Depth-limit diagnostic.
- No endpoint match versus analysis failure distinction.
- Duplicate endpoint selection remains ambiguous.
- Rebuilding a trace from serialized `analysis.json` matches the in-memory trace.

## Exit demonstration

```bash
api-intel trace ./.api-intel/analysis.json --method GET --path /customers/:id
api-intel trace ./.api-intel/analysis.json --method PUT --path /customers/:id
```

## Exit gate

The frozen read and write traces match exactly, reach the correct tables, preserve all
evidence, and terminate safely under cycles and depth limits.

## Completion record

Completed on 2026-08-16. Canonical assertions now feed typed endpoint-implementation,
method-call, and table-access adjacency indexes. Endpoint selection normalizes route
paths and returns distinct resolved, not-found, ambiguous, or failed-analysis results.
The trace assembler performs deterministic breadth-first traversal using the configured
maximum depth of three, records every in-scope branch and assertion status, terminates
cycles, retains table access at the depth boundary, and emits `CALL_DEPTH_LIMIT` only
when a supported continuation remains undiscovered. All reachable read/write terminals
are deduplicated by method, direction, and table, while trace-relevant analysis and
generated diagnostics are attached by stable ID. Every trace is canonically ordered and
runtime-validated, and reversing assertion discovery order produces byte-identical JSON.
The `trace` CLI now reads validated `analysis.json` without rescanning source, accepts a
method/path selector, prints canonical trace JSON, and uses distinct exit codes for a
selection miss, ambiguity, and failed analysis. The frozen read, two-service-hop write,
and mixed legacy read/write traces match their expected semantic paths and rebuild
identically after a serialize/reload round trip with all assertion evidence preserved.
All 92 tests plus formatting, lint, strict typecheck, and production build gates pass.

---

# 11. Phase 8 - Guards and Complete Uncertainty Semantics

## Goal

Add directly declared guard metadata and make partial-result behavior consistent across
the whole analysis.

## Implementation checklist

- [x] Detect direct TypeChecker-resolved NestJS `@UseGuards` on controllers.
- [x] Detect direct `@UseGuards` on methods.
- [x] Combine controller and method declarations in the endpoint view while preserving
      their scopes.
- [x] Create Guard records and `ENDPOINT_USES_GUARD` assertions.
- [x] Use `none_declared` only when no supported direct guard declaration is found.
- [x] Always make the limitation about unanalyzed global policy visible where it
      affects interpretation.
- [x] Never emit `public` as an inferred authentication result.
- [x] Map diagnostics to the overall result state consistently.
- [x] Produce `completed_with_gaps` when useful trusted output exists alongside at
      least one supported-looking unresolved or unsupported case.
- [x] Keep `failed` for conditions that prevent trustworthy canonical output or fail
      integrity validation.
- [x] Preserve the difference between empty, unresolved, unsupported, and failed.

## Tests

- Controller-level guard.
- Method-level guard.
- Both scopes with stable order.
- No direct guard produces `none_declared` plus global-policy limitation.
- Same-named local `UseGuards` is not treated as NestJS metadata.
- Unsupported guard expression does not become a guessed Guard record.
- Result-state matrix for clean, gapped, failed, and empty analyses.

## Exit gate

The output distinguishes directly guarded, none directly declared, and globally
unknown behavior without making a claim that an endpoint is public.

## Completion record

Completed on 2026-08-16. Direct `@nestjs/common` `UseGuards` decorators are now accepted
only when the TypeChecker resolves each argument to exactly one repository class.
Controller- and method-level declarations produce canonical Guard records and
`ENDPOINT_USES_GUARD` assertions whose rule IDs preserve scope; endpoint catalogue and
trace views combine both scopes in stable order and expose `declared` or
`none_declared` without inferring public access. Same-named local decorators and guard
factories remain absent from the graph, while unsupported direct expressions emit
`NEST_GUARD_UNRESOLVED` with source evidence. Every analyzed endpoint exposes the
subjectless `AUTH_GLOBAL_POLICY_UNKNOWN` limitation because global policies remain out
of scope. A centralized result-state policy now distinguishes clean empty output,
useful partial output, fatal output, and cancellation. The frozen fixture resolves
exactly two Guard records and three guard assertions, including the guarded DELETE
trace with its method scope. All 101 tests plus formatting, lint, strict typecheck,
production build, and an end-to-end frozen-sample scan pass.

---

# 12. Phase 9 - Complete CLI and Reporting Workflow

## Goal

Make all four documented commands coherent and ensure Markdown is a reproducible view
of canonical JSON.

## Implementation checklist

- [x] Complete `scan <repository>` with default and explicit tsconfig/output options.
- [x] Support the optional controller/route filter without changing the truth of
      extracted facts; define whether filtering limits extraction or only the emitted
      view and document the choice.
- [x] Complete `endpoints <analysis.json>`.
- [x] Complete `trace <analysis.json> --method ... --path ...`.
- [x] Complete `report <analysis.json>` without rescanning source.
- [x] Enforce maximum call depth configuration and MVP cap.
- [x] Populate `run.json` with repository metadata, local Git revision when available,
      tool and TypeScript versions, effective configuration, timing, result state, and
      diagnostics.
- [x] Implement output directory creation and safe overwrite behavior.
- [x] Use deterministic, filesystem-safe trace report filenames.
- [x] Render endpoint catalogue Markdown.
- [x] Render endpoint trace Markdown with guards, steps, table direction, evidence,
      diagnostics, and limitations.
- [x] Make source references repository-relative and readable.
- [x] Ensure Markdown rendering never changes canonical JSON.
- [x] Add concise errors and stable exit codes for invalid input, failed analysis,
      endpoint not found, ambiguity, and schema-invalid input files.
- [x] Handle user interruption as `canceled` when possible without leaving a corrupt
      canonical file.

## Tests

- CLI integration tests for all commands.
- `report` regenerates byte-identical Markdown from unchanged canonical JSON.
- Invalid/corrupt JSON fails clearly.
- Endpoint not found is not reported as analysis failure.
- Trace filenames are stable and safe for route parameters and separators.
- Paths with spaces work.
- Partial output is not mistaken for completed output.

## Exit artifact

```text
.api-intel/
  run.json
  analysis.json
  endpoints.md
  traces/
    <method-and-route>.md
```

## Exit gate

A user can scan the fixture, list endpoints, trace an endpoint, delete generated
Markdown, and regenerate the same Markdown from `analysis.json` alone.

## Completion record

Completed on 2026-08-17. All four commands now form one coherent canonical-JSON
workflow. `scan` supports default and explicit tsconfig/output locations, an enforced
call-depth range of one through three, and exact controller/normalized-route filters.
Filters affect only emitted views: the full extracted graph, evidence, and diagnostics
remain in `analysis.json`. `endpoints`, `trace`, and `report` validate existing analysis
without rescanning source; failed/canceled documents, corrupt JSON, schema or integrity
failures, misses, and ambiguous selectors use distinct exit behavior.

Scans and reports emit deterministic `endpoints.md` plus one readable trace Markdown
file per uniquely selectable endpoint. Trace reports contain direct guards, canonical
steps, read/write table terminals, repository-relative evidence, diagnostics, and the
global-policy limitation. Filesystem-safe names combine method, sanitized route, and a
stable endpoint-ID prefix. Atomic staging, a generated-report manifest, analysis-last
commit order, and SIGINT cancellation prevent partial canonical publication while
preserving unrelated files and removing only previously tracked stale traces.
`run.json` retains repository revision when available, absolute input path, timing,
tool/TypeScript versions, effective configuration, result state, and diagnostics.

The frozen fixture produces seven deterministic trace reports; read, write, guarded,
evidence, and limitation content all match its semantic expectations. Deleting and
regenerating Markdown from unchanged canonical JSON is byte-identical, including for
paths containing spaces. All 108 tests across 36 files plus formatting, lint, strict
typecheck, and production build gates pass.

---

# 13. Phase 10 - Hardening, Golden Tests, and Safety

## Goal

Prove the implementation is deterministic, honest about unsupported behavior, and safe
to run on an unfamiliar local repository.

## Implementation checklist

- [x] Finish unit fixtures for every supported extraction rule.
- [x] Finish negative fixtures for similarly named and unsupported constructs.
- [x] Finish ambiguous fixtures for duplicate or multiple plausible targets.
- [x] Create the complete golden `analysis.json` for the integrated fixture.
- [x] Compare normalized output from two independent clean runs.
- [x] Randomize or reverse relevant internal discovery order in a test and confirm
      canonical output is unchanged.
- [x] Validate every assertion and evidence reference before writing canonical output.
- [x] Confirm the target side-effect sentinel is never created.
- [x] Confirm excluded and oversized files are not read as source inputs.
- [x] Confirm snippets redact obvious secret-looking assignments and values.
- [x] Confirm diagnostics never include unintended full source contents or absolute
      paths.
- [x] Test malformed tsconfig, parse errors, missing files, unreadable output location,
      invalid canonical JSON, and interrupted writes.
- [x] Measure fixture runtime only to catch obvious regressions; do not introduce a
      production performance program.

## Required acceptance matrix

| Concern | Required proof |
|---|---|
| Catalogue accuracy | No missing or extra supported fixture endpoints |
| Trace accuracy | Frozen read and write paths match exactly |
| Evidence integrity | Every resolved assertion has valid hashed source evidence |
| Negative behavior | Unsupported and similarly named constructs create no false facts |
| Database direction | Every supported fixture operation is classified correctly |
| Honest precision | `save()` and `remove()` do not claim exact columns |
| No execution | Sentinel and process-level safety tests pass |
| Determinism | Two clean scans produce identical normalized canonical JSON |
| Partial results | Gaps are explicit and result state is correct |
| Documentation fidelity | Supported-pattern table matches implemented, tested rules |

## Exit gate

All project-plan acceptance checks that can be proven using fixtures pass. No known
false-positive relationship is accepted as a limitation; false positives are release
blockers for the affected rule.

## Completion record

Completed on 2026-08-17. The integrated fixture now has a complete 73,737-byte
canonical golden at `test/golden/example-nestjs-app/analysis.json`. Two independent
scan instances produce byte-identical analysis and normalized run metadata. Reversing
every canonical record collection plus nested role/evidence reference order leaves the
serialized document unchanged. The same test includes a deliberately generous
40-second regression ceiling without introducing a production benchmark subsystem.

The frozen negative contract is executed directly against semantic labels, including
dynamic routes, similar method names, unsupported DI, arbitrary same-named repository
methods, unsupported TypeORM operations, wrong table names, exact-column overclaims,
and public-authentication overclaims. Existing focused fixtures cover all eight route
decorators, every supported TypeORM read/write operation, both guard scopes, and
route/class/repository ambiguity. The supported-pattern table imports the actual rule
catalogues in its fidelity test, so an undocumented rule or operation breaks the gate.

Canonical publication validates schemas and cross-record integrity before creating an
output directory. Tests prove blocked output locations and pre-interrupted writes do
not replace existing user or canonical files or leave staging files. Inventory and
Program construction plus a complete scan leave a target side-effect sentinel absent;
an unfamiliar non-Nest repository containing local decorator and repository
lookalikes produces no false facts. Diagnostics and canonical JSON contain no checkout
path or unintended complete source text, and evidence snippets remain bounded and
redacted.

All 115 tests across 40 files pass, including malformed tsconfig, parse/import errors,
missing input, invalid canonical JSON, exclusions, oversized files, symlinks,
interruption, deterministic reports, and frozen read/write traces. Formatting, lint,
strict typecheck, and the production build also pass.

---

# 14. Phase 11 - Real Repository, Documentation, and Demo

## Goal

Validate usefulness outside the synthetic fixture and package the MVP as a reproducible
portfolio-quality demonstration.

## Real-repository selection criteria

Select one local repository that intentionally fits the MVP:

- one NestJS application and primary `tsconfig.json`;
- standard REST decorators;
- class-based constructor injection;
- TypeORM repositories through `@InjectRepository`;
- at least one supported read and write operation;
- at least one directly declared guard if possible;
- no requirement for dynamic modules, custom routing systems, or QueryBuilder to make
  the chosen demo path work.

## Implementation checklist

- [x] Run the analyzer on the real repository without executing it.
- [x] Manually inspect 3-5 endpoint catalogue entries.
- [x] Manually inspect at least one complete read trace and one complete write trace.
- [x] Compare every trace step and evidence location to source.
- [x] Fix in-scope analyzer defects and add regression fixtures before accepting the
      real-repository result.
- [x] Record unsupported real-world patterns as diagnostics and documentation; do not
      broaden scope automatically.
- [x] Complete `docs/supported-patterns.md` with a rule/test mapping.
- [x] Complete architecture documentation showing the extraction pipeline and the
      separation between canonical data and reports.
- [x] Complete README installation, usage, command examples, supported patterns,
      limitations, result-state meanings, and no-execution guarantee.
- [x] Add sanitized example JSON and Markdown output.
- [x] Write a short, repeatable demo script or command sequence.
- [x] Verify a fresh clone/install/build/scan flow.
- [x] Assign an MVP version only after every definition-of-done item passes.

## Final demo sequence

```bash
# Analyze without running the target application
api-intel scan ./reference-app

# Review the detected route catalogue
api-intel endpoints ./reference-app/.api-intel/analysis.json

# Trace a read endpoint
api-intel trace ./reference-app/.api-intel/analysis.json \
  --method GET \
  --path /customers/:id

# Trace a write endpoint
api-intel trace ./reference-app/.api-intel/analysis.json \
  --method PUT \
  --path /customers/:id

# Recreate reports without rescanning source
api-intel report ./reference-app/.api-intel/analysis.json
```

Adapt line continuation syntax in the README for the supported shell or show commands
on one line.

## Exit gate

Every definition-of-done item in the project plan passes on the fixture, and the real
repository produces at least one useful evidence-backed complete trace. A new user can
reproduce the demonstration from documentation alone.

## Completion record

Completed on 2026-08-17 and assigned MVP version `0.1.0`. The independent validation
target is the official NestJS `sample/05-sql-typeorm` application at pinned revision
`841df8792fbedd1fbba12c9fe999aee307a155c7`. A sparse checkout and dependency install
with lifecycle scripts disabled were used only to provide TypeScript declarations; the
target application, database, Docker setup, and package scripts were never run.

The analyzer found exactly four supported endpoints. All four catalogue entries were
compared with controller source. Every step and evidence coordinate in the complete
`GET /users/:id -> UsersController.findOne -> UsersService.findOne -> READ user` and
`POST /users -> UsersController.create -> UsersService.create -> WRITE user` traces
was checked manually. The delete trace was also checked through `Repository.delete`.
No false positive, missing supported fact, invalid evidence, or other in-scope defect
was found, so no extractor broadening or regression fixture was necessary.

The observed gaps are honest P0 boundaries: the application has no direct guard, so
the reports show `none_declared` plus `AUTH_GLOBAL_POLICY_UNKNOWN`, and `save()` emits
`TYPEORM_SAVE_COLUMNS_UNKNOWN` rather than claiming DTO assignments are exact SQL
columns. DTO/parameter/pipe lineage and Nest module configuration are recorded as
unmodeled future scope.

The portfolio package now includes a complete README, Mermaid architecture and trust
boundary, rule-to-test supported-pattern table, detailed real-repository audit, and
sanitized JSON/catalogue/read-trace/write-trace examples. `pnpm run demo` pins and
reproduces clone, safe dependency setup, analyzer build, scan, endpoint listing, read
and write traces, and report regeneration.

A dependency-free temporary engine copy completed frozen-lockfile installation,
production build, and the same official-sample scan. Its canonical analysis SHA-256
was `A3DB1223A91B4E2D002DD84DB04604D37603F645466B4A29E0732CFACD0194F2`, byte-identical
to the main demo output; the temporary directory was then removed. All 117 tests across
41 files plus formatting, lint, strict typecheck, and production build gates pass.

---

# 15. Cross-Phase Test Strategy

## 15.1 Test pyramid

- Pure unit tests for normalization, IDs, ordering, schema validation, and operation
  classification.
- Focused source-string or tiny-project tests for individual Compiler API rules.
- Integrated fixture scans for component interaction.
- Golden tests only for stable canonical artifacts.
- CLI subprocess tests for argument handling, files, exit codes, and user-visible text.
- One manual real-repository verification at the end.

## 15.2 Golden-file discipline

- Do not update a golden file merely because a test fails.
- Inspect the semantic diff against frozen expectations first.
- Every intentional golden change must be explainable as a product-contract change,
  defect fix, or additive evidence/diagnostic improvement.
- Do not include timestamps, elapsed durations, absolute paths, random values, or
  machine-specific data in canonical golden files.
- Keep key focused expectations for read and write traces even after the full analysis
  golden exists; they make regressions easier to diagnose.

## 15.3 Rule-to-test discipline

Every supported rule should have:

1. one positive test;
2. one close negative test;
3. expected evidence;
4. expected resolution status;
5. a documented unsupported boundary.

---

# 16. Diagnostics and Failure Policy

Use the project-plan diagnostic codes as the initial closed catalogue:

| Code | Expected introduction phase |
|---|---:|
| `TS_PARSE_ERROR` | 3 |
| `TS_IMPORT_UNRESOLVED` | 3 |
| `NEST_ROUTE_DYNAMIC` | 4 |
| `NEST_CUSTOM_ROUTE_DECORATOR` | 4 |
| `NEST_GUARD_UNRESOLVED` | 8 |
| `DI_TOKEN_UNSUPPORTED` | 5 |
| `CALL_TARGET_UNRESOLVED` | 5 |
| `CALL_DEPTH_LIMIT` | 5/7 |
| `AUTH_GLOBAL_POLICY_UNKNOWN` | 8 |
| `TYPEORM_ENTITY_UNRESOLVED` | 6 |
| `TYPEORM_OPERATION_UNSUPPORTED` | 6 |
| `TYPEORM_SAVE_COLUMNS_UNKNOWN` | 6 |

Add a new diagnostic code only when the condition is distinct, actionable, and cannot
be represented accurately by an existing code. Tests must assert both code and the
model element or evidence to which it applies.

Failure policy:

- Integrity or runtime-schema failure: `failed`; do not publish canonical output as
  trustworthy.
- Unsupported or unresolved individual construct with useful facts remaining:
  `completed_with_gaps`.
- No supported matching endpoints after a successful scan: `completed` with an
  explicit empty reason.
- User interruption: `canceled`; do not leave a partially written `analysis.json`.

---

# 17. Scope Guardrails

The following are release blockers if accidentally relied upon by the MVP and must not
be implemented opportunistically:

- monorepo or multiple-deployable discovery;
- JavaScript or non-NestJS framework analysis;
- NestJS runtime bootstrap or target code execution;
- general module-scope DI resolution;
- string/symbol/factory DI resolution beyond emitting diagnostics;
- interface or polymorphic call-graph resolution;
- callbacks, higher-order functions, or reflection-based calls;
- raw SQL, QueryBuilder, custom repository semantics, or live database inspection;
- column-level lineage or DTO-to-column flow;
- global/effective authentication claims;
- outbound HTTP, queues, events, or messaging analysis;
- a graph database, server, web UI, multi-user system, or production deployment;
- AI-generated facts or explanations in the core MVP.

When a real repository exposes one of these patterns:

1. emit the closest accurate unsupported diagnostic;
2. preserve any independent resolved facts;
3. document the boundary;
4. add it to P1/P2 only if useful;
5. do not modify the active phase to absorb it.

---

# 18. Work Session Template

Use this template at the start and end of each implementation session.

```text
Phase:
Session outcome (one sentence):
In-scope files/rules:
Tests to add first:
Explicit non-goals:

Implementation result:
Commands run:
Tests passed:
Artifacts produced:
Diagnostics/limitations added:
Remaining phase checklist:
Next smallest session:
```

A session should normally produce one of:

- a frozen expectation;
- a model or safety primitive plus tests;
- one extractor rule with positive and negative tests;
- one integrated vertical slice;
- one hardening or documentation artifact.

Avoid sessions whose only result is a large untested framework or abstraction.

---

# 19. Phase Tracking Checklist

- [x] Phase 0 - Scope, fixture, and ground truth frozen
- [x] Phase 1 - Scaffold and quality gates complete
- [x] Phase 2 - Canonical model and cross-cutting contracts complete
- [x] Phase 3 - Safe inventory and TypeScript semantic index complete
- [x] Phase 4 - Route catalogue vertical slice complete
- [x] Phase 5 - Constructor injection and direct calls complete
- [x] Phase 6 - TypeORM entity and table access complete
- [x] Phase 7 - Endpoint trace assembly complete
- [x] Phase 8 - Guards and uncertainty semantics complete
- [x] Phase 9 - CLI and reporting workflow complete
- [x] Phase 10 - Hardening, golden tests, and safety complete
- [x] Phase 11 - Real repository, documentation, and demo complete

Current phase: **P0 MVP complete (`0.1.0`)**.

Immediate next action: hand off or tag the completed MVP. Start P1 only as a separately
chosen follow-up; no P1 or P2 capability is required by the finished P0 demonstration.

---

# 20. P0 Backlog Coverage Map

Use this table during phase review to ensure the phased sequence does not lose any
required item from the source project plan.

| Project-plan item | Primary implementation phase |
|---|---:|
| P0-01 CLI skeleton and configuration | 1 and 9 |
| P0-02 Repository file inventory and exclusions | 3 |
| P0-03 TypeScript Program/TypeChecker adapter | 3 |
| P0-04 Stable source, class, method, endpoint, and evidence IDs | 2 |
| P0-05 Standard NestJS controller and route extraction | 4 |
| P0-06 Route normalization | 4 |
| P0-07 Class-based constructor injection extraction | 5 |
| P0-08 Direct injected-member method-call resolution | 5 |
| P0-09 Depth-limited trace traversal and cycle protection | 5 and 7 |
| P0-10 TypeORM entity and table extraction | 6 |
| P0-11 `@InjectRepository` resolution | 6 |
| P0-12 Common repository read/write classification | 6 |
| P0-13 Direct `@UseGuards` extraction | 8 |
| P0-14 Assertion/evidence validation | 2, then enforced in every later phase |
| P0-15 Canonical JSON writer | 2 and 4 |
| P0-16 Endpoint catalogue and trace Markdown reporters | 4 and 9 |
| P0-17 Diagnostics and partial-result behavior | 2 and 8 |
| P0-18 Fixture, golden tests, real-repository demo, and documentation | 0, 10, and 11 |

All P0 items must be complete before any P1 or P2 item is scheduled.
