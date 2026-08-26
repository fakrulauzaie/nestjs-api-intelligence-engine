# Backend API Intelligence - Personal Project Plan
## NestJS Endpoint Trace Explorer

**Status:** Solo MVP plan 1.0  
**Recommended effort:** 6-8 weeks part time, approximately 60-80 focused hours  
**Primary target:** One local TypeScript NestJS application using TypeORM  
**Delivery form:** Local command-line tool producing JSON and Markdown  
**Core principle retained:** Deterministic extraction first; every important result must point to source evidence.

---

# 1. Project Definition

## 1.1 One-sentence goal

Build a local CLI that scans one NestJS/TypeORM repository without running it, lists its REST endpoints, and traces a selected endpoint from route handler through directly resolved service calls to the database table it reads or writes, with file-and-line evidence for every step.

## 1.2 Target user

The initial user is the developer building the tool. The practical use case is understanding an unfamiliar NestJS backend quickly enough to answer:

1. What REST endpoints exist?
2. Which method implements a selected endpoint?
3. Which directly injected providers does that method call?
4. Which TypeORM entity and table does the path access?
5. Where in the source is each conclusion supported?

## 1.3 Core user story

> Given a local NestJS repository, I can run one command, choose an endpoint, and receive a short evidence-backed trace from HTTP route to database table without starting the application.

## 1.4 Definition of success

The project is successful when it can analyze one intentionally selected reference repository and:

- Produce an accurate catalogue of its supported literal NestJS routes.
- Trace at least one read endpoint and one write endpoint through a controller and one or more directly resolved providers.
- Connect a TypeORM repository operation to an entity and table.
- Identify directly declared controller or method guards without claiming to know unsupported global behavior.
- Attach a source file and line range to every route, call, guard, entity, and table assertion.
- Mark unresolved or unsupported behavior explicitly instead of guessing.
- Produce the same normalized JSON on repeated runs against the same source revision.

This is a learning and portfolio-quality static-analysis tool, not a production service or a complete program-analysis platform.

## 1.5 Final demo

The final demonstration should use one endpoint such as:

```text
PUT /customers/:id
```

The CLI should return a trace similar to:

```text
PUT /customers/:id
  -> CustomerController.updateCustomer()
  -> CustomerService.updateCustomer()
  -> Repository<Customer>.save()
  -> WRITE table: customer

Guards:
  -> JwtAuthGuard declared on CustomerController

Evidence:
  -> src/customers/customer.controller.ts:42-51
  -> src/customers/customer.service.ts:68-82
  -> src/customers/customer.entity.ts:6-28

Limitations:
  -> Exact columns written are unknown because save() receives a complete entity.
```

---

# 2. Scope Boundary

## 2.1 Core scope

| Area | Included in the personal MVP |
|---|---|
| Repository | One local repository directory at a time |
| Application shape | One NestJS application with one primary `tsconfig.json` |
| Language | TypeScript only |
| Framework | NestJS REST controllers using standard decorators |
| Routes | Literal paths, empty paths, and simple `const` string references |
| Dependency injection | Constructor injection using class types and `@InjectRepository(Entity)` |
| Calls | Direct calls such as `this.customerService.update()` with a maximum trace depth of 3 |
| Persistence | TypeORM entities and common repository methods |
| Database result | Table-level reads and writes; explicit column mappings may be listed but column impact is not calculated |
| Authentication | Direct `@UseGuards` metadata on controller or method |
| Evidence | Repository-relative file path, line/column range, bounded snippet, and content hash |
| Output | Canonical JSON plus a readable Markdown report |
| Interface | Local CLI only |
| Execution model | Static analysis only; repository code is never imported or executed |

## 2.2 Supported TypeORM operations

The first version only needs to recognize the following common operations:

| Operation family | Methods | Result |
|---|---|---|
| Read | `find`, `findOne`, `findOneBy`, `findBy`, `count`, `exists` | `READS_TABLE` |
| Write | `save`, `insert`, `update`, `delete`, `remove` | `WRITES_TABLE` |
| Mapping | `@Entity`, `@Column`, `@PrimaryColumn`, `@PrimaryGeneratedColumn` | Entity-to-table and field-to-column metadata |

For `save()` and `remove()`, the tool must not claim exact written columns unless the source makes them explicit. The MVP only needs trustworthy table-level behavior.

## 2.3 Explicitly out of scope

The following items are postponed rather than partially implemented:

- Monorepos, multiple deployables, Nx project graphs, and workspace-wide analysis.
- JavaScript source, other backend frameworks, Prisma, Sequelize, and Mongoose.
- Dynamic modules, runtime-generated routes, custom route decorator factories, and reflection-heavy behavior.
- String/symbol DI tokens, `useFactory`, `useExisting`, `ModuleRef`, and complete Nest module-scope resolution.
- Interface dispatch, polymorphic call graphs, callbacks, higher-order functions, and reflection-based calls.
- Raw SQL parsing, QueryBuilder analysis, stored procedures, and live database inspection.
- Column-level change impact, DTO-to-column data flow, reverse dependency analysis, and strict/conservative impact modes.
- Axios, `fetch`, Kafka, queues, events, and other external integrations.
- Effective authentication across global guards, Passport strategies, roles, scopes, or custom guard semantics.
- AI-generated explanations in the core milestone.
- PostgreSQL graph storage, graph databases, web UI, job queues, multi-user access, RBAC, audit, retention, SLOs, and production deployment.
- Enterprise evaluation programs, multiple pilot repositories, formal calibration, and numerical confidence scores.

## 2.4 Scope-change rule

A new feature enters the core plan only when it is necessary to complete the final demo and replaces an existing feature of similar effort. Otherwise it goes into the stretch backlog.

---

# 3. How the Original Plan Is Reduced

| Original plan area | Personal-project decision | Reason |
|---|---|---|
| Full backend intelligence engine | Build an endpoint trace explorer | Creates one coherent and demoable outcome |
| Multiple modules and deployables | Support one application | Avoids ownership and workspace-resolution complexity |
| Large canonical knowledge graph | Use a small assertion model in JSON | Keeps evidence and relationships without database work |
| PostgreSQL `GraphStore` | In-memory adjacency plus `analysis.json` | No infrastructure is needed for bounded traces |
| Broad call graph | Resolve direct calls through class-based constructor injection only | Keeps symbol work understandable and testable |
| Full authentication policy | Report directly declared guards and an explicit unknown state | Avoids misleading global-policy claims |
| TypeORM, SQL, QueryBuilder, and column lineage | TypeORM entities plus common repository methods at table level | Preserves useful database insight with much less analysis work |
| HTTP and messaging dependencies | Defer | Not required for the core endpoint-to-table story |
| AI explanation system | Defer until deterministic results are stable | Prevents AI work from hiding extraction defects |
| Production security and operations | Apply only safe local file handling and no-execution rules | Appropriate to a local personal tool |
| Formal ground-truth program | Hand-label a small fixture and 3-5 real endpoints | Enough to detect regressions without a dedicated evaluation team |
| 18-20 week multi-person delivery | 60-80 hour solo build | Matches personal-project constraints |

---

# 4. Product Contract

## 4.1 Input

Required:

- Path to one local repository.
- Path to the primary `tsconfig.json`, or automatic use of `<repo>/tsconfig.json`.

Optional:

- Git revision obtained from the local repository when available.
- Controller or route filter.
- Maximum call depth, capped at 3 in the MVP.

## 4.2 Output files

Each analysis writes to a local output directory:

```text
.api-intel/
  run.json
  analysis.json
  endpoints.md
  traces/
    PUT__customers__id.md
```

`run.json` contains repository metadata, tool version, TypeScript version, configuration, start/end time, and diagnostics.

`analysis.json` is the canonical deterministic result. Markdown files are generated views and can always be recreated from it.

## 4.3 Result states

The CLI uses four simple result states:

- `completed`: all required core stages succeeded.
- `completed_with_gaps`: useful output exists, but at least one supported-looking construct was unresolved or unsupported.
- `failed`: parsing or integrity failed before trustworthy output could be produced.
- `canceled`: user interrupted the run.

An empty result must say whether no matching item was found or analysis could not complete.

## 4.4 Truth and uncertainty rules

- Facts are produced only by deterministic source analysis.
- Every relationship requires evidence.
- A unique result is `resolved`.
- Multiple plausible targets are `ambiguous`.
- A target that should exist but cannot be found is `unresolved`.
- A pattern outside the declared scope is `unsupported`.
- The tool never converts an unknown into an empty result or a guessed fact.

---

# 5. Minimal Knowledge Model

## 5.1 Entities

Only the following entities are required:

| Entity | Purpose |
|---|---|
| `AnalysisRun` | Records repository, revision, configuration, and tool version |
| `SourceFile` | Records normalized path and content hash |
| `Class` | Represents controllers, providers, and entities |
| `Method` | Represents route handlers and called methods |
| `Endpoint` | Represents HTTP method, normalized path, and handler |
| `Guard` | Represents a directly declared NestJS guard |
| `RepositoryBinding` | Connects an injected TypeORM repository to its entity |
| `Entity` | Represents a TypeORM entity class |
| `Table` | Represents the mapped database table |
| `Assertion` | Represents one typed relationship or property |
| `Evidence` | Points to the source supporting an assertion |
| `Diagnostic` | Describes an unresolved, ambiguous, or unsupported case |

Controller, service, provider, and entity are roles on classes rather than separate duplicate class types.

## 5.2 Required relationships

```text
ENDPOINT_IMPLEMENTED_BY   Endpoint -> Method
METHOD_CALLS_METHOD       Method -> Method
CLASS_INJECTS_CLASS       Class -> Class
CLASS_INJECTS_REPOSITORY  Class -> RepositoryBinding
REPOSITORY_FOR_ENTITY     RepositoryBinding -> Entity
ENTITY_MAPS_TO_TABLE      Entity -> Table
METHOD_READS_TABLE        Method -> Table
METHOD_WRITES_TABLE       Method -> Table
ENDPOINT_USES_GUARD       Endpoint -> Guard
```

A generic `DEPENDS_ON` relationship is not stored. The trace is assembled from the specific relationships above.

## 5.3 Minimal assertion shape

```ts
interface Assertion {
  id: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  status: 'resolved' | 'ambiguous' | 'unresolved' | 'unsupported';
  ruleId: string;
  evidenceIds: string[];
}
```

## 5.4 Minimal evidence shape

```ts
interface Evidence {
  id: string;
  fileId: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  role: 'declaration' | 'decorator' | 'call_site' | 'type_reference' | 'resolution_basis';
  snippet?: string;
  contentHash: string;
}
```

Stable IDs should be derived from normalized path, qualified symbol name, signature, and repository revision where available. Display names are not identities.

---

# 6. Technical Design

## 6.1 Processing pipeline

```text
Repository directory
  -> safe file inventory
  -> TypeScript Program and TypeChecker
  -> NestJS route extractor
  -> direct DI and method-call resolver
  -> TypeORM entity/repository extractor
  -> assertion and evidence validator
  -> in-memory trace builder
  -> analysis.json
  -> Markdown reports
```

## 6.2 Technical decisions

- Use the TypeScript Compiler API instead of regular expressions.
- Pin the analyzer's TypeScript version and record it in each run.
- Never `require`, `import`, compile, test, or start the analyzed repository.
- Ignore `node_modules`, `dist`, `build`, coverage output, binaries, and files above a configurable limit.
- Store the canonical result as JSON; do not add a database during the core build.
- Validate output with TypeScript types and a small runtime schema library such as Zod.
- Build traces by traversing assertion arrays in memory with a maximum depth of 3.
- Keep extractors independent and deterministic.

## 6.3 Suggested repository structure

```text
nestjs-endpoint-trace-explorer/
  src/
    cli/
      index.ts
      commands/
        scan.ts
        endpoints.ts
        trace.ts
    model/
      entities.ts
      assertions.ts
      schemas.ts
      ids.ts
    scanner/
      inventory.ts
      git-metadata.ts
    ts-index/
      program.ts
      symbols.ts
      constants.ts
    extractors/
      nest-routes.ts
      nest-guards.ts
      constructor-injection.ts
      method-calls.ts
      typeorm-entities.ts
      typeorm-repositories.ts
    resolve/
      direct-calls.ts
      repository-operations.ts
    trace/
      endpoint-trace.ts
    evidence/
      locations.ts
      snippets.ts
    reporters/
      json.ts
      markdown.ts
    diagnostics/
      codes.ts
  fixtures/
    basic-nest-app/
    ambiguous-calls/
    unsupported-patterns/
  test/
    golden/
  docs/
    supported-patterns.md
  README.md
```

## 6.4 Small diagnostic catalogue

| Code | Meaning |
|---|---|
| `TS_PARSE_ERROR` | A source file could not be parsed |
| `TS_IMPORT_UNRESOLVED` | A local import or symbol could not be resolved |
| `NEST_ROUTE_DYNAMIC` | Route path is computed beyond the supported constant rules |
| `NEST_CUSTOM_ROUTE_DECORATOR` | Route decorator is not a supported standard NestJS decorator |
| `DI_TOKEN_UNSUPPORTED` | Injection uses a string, symbol, factory, or other unsupported token form |
| `CALL_TARGET_UNRESOLVED` | Direct method target could not be resolved |
| `CALL_DEPTH_LIMIT` | Trace stopped at the configured maximum depth |
| `AUTH_GLOBAL_POLICY_UNKNOWN` | Global authentication behavior was not analyzed |
| `TYPEORM_ENTITY_UNRESOLVED` | Repository entity type could not be resolved |
| `TYPEORM_OPERATION_UNSUPPORTED` | Persistence call is outside the supported repository-method set |
| `TYPEORM_SAVE_COLUMNS_UNKNOWN` | Table write is known but exact columns are not |

---

# 7. CLI Experience

## 7.1 Commands

```bash
# Analyze a repository and write canonical output
api-intel scan ./reference-app

# Print detected endpoints
api-intel endpoints ./.api-intel/analysis.json

# Trace an endpoint
api-intel trace ./.api-intel/analysis.json \
  --method PUT \
  --path /customers/:id

# Regenerate Markdown from existing JSON
api-intel report ./.api-intel/analysis.json
```

## 7.2 Endpoint catalogue output

```text
METHOD  PATH                  HANDLER                               GUARDS          STATUS
GET     /customers/:id        CustomerController.findOne           JwtAuthGuard    resolved
PUT     /customers/:id        CustomerController.updateCustomer    JwtAuthGuard    resolved
POST    /health/check         HealthController.check                none_declared   resolved
```

`none_declared` means no supported controller or method guard was found. It does not mean the endpoint is definitely public.

## 7.3 Canonical endpoint-trace output

```json
{
  "endpoint": {
    "method": "PUT",
    "path": "/customers/:id",
    "handler": "CustomerController.updateCustomer"
  },
  "guards": [
    {
      "name": "JwtAuthGuard",
      "scope": "controller",
      "status": "resolved",
      "evidence": ["ev:controller-guard"]
    }
  ],
  "steps": [
    {
      "from": "CustomerController.updateCustomer",
      "relation": "METHOD_CALLS_METHOD",
      "to": "CustomerService.updateCustomer",
      "status": "resolved",
      "evidence": ["ev:service-call"]
    },
    {
      "from": "CustomerService.updateCustomer",
      "relation": "METHOD_WRITES_TABLE",
      "to": "customer",
      "status": "resolved",
      "evidence": ["ev:repository-save", "ev:entity-table"]
    }
  ],
  "diagnostics": [
    {
      "code": "TYPEORM_SAVE_COLUMNS_UNKNOWN",
      "message": "The table write is known, but exact written columns are not proven."
    }
  ]
}
```

---

# 8. Delivery Plan

## 8.1 Milestone summary

| Milestone | Outcome | Estimated effort | Exit condition |
|---|---|---:|---|
| M0 - Freeze the target | One fixture and 3-5 manually labelled reference endpoints | 5-7 hours | Expected routes and two endpoint traces are written before implementation |
| M1 - Route catalogue | CLI lists supported NestJS routes with evidence | 12-15 hours | Fixture catalogue exactly matches expected output |
| M2 - Direct DI and call trace | Selected handler traces through class-based injected providers | 14-18 hours | One read and one write path resolve to the expected service methods |
| M3 - TypeORM table access | Repository operations connect to entities and tables | 12-15 hours | Trace identifies correct read/write table and reports unknown columns honestly |
| M4 - Guards, evidence, and diagnostics | Reports include direct guards, source locations, and gaps | 10-12 hours | Every published assertion has evidence; unsupported patterns have diagnostics |
| M5 - Productize the demo | Stable JSON, Markdown reports, tests, docs, and repeatability | 10-13 hours | Final demo and definition of done pass |

**Total:** approximately 63-80 focused hours.

## 8.2 M0 - Freeze the target

Tasks:

1. Choose or create a small reference NestJS/TypeORM application.
2. Keep it intentionally within the supported scope: one app, direct class injection, standard decorators, and common TypeORM repository calls.
3. Select 3-5 endpoints, including one read, one write, and one directly guarded endpoint.
4. Manually write expected endpoint catalogue rows.
5. Manually write the expected trace for one read and one write endpoint.
6. Add one negative example that must not become a relationship.
7. Record unsupported examples such as a dynamic route or string DI token.

Exit artifact:

```text
fixtures/basic-nest-app/expected-analysis.json
```

## 8.3 M1 - Route catalogue

Tasks:

1. Build the CLI and safe file inventory.
2. Create a TypeScript `Program` and `TypeChecker` from the repository's primary `tsconfig.json`.
3. Index source files, classes, methods, imports, and decorators.
4. Detect standard NestJS `@Controller` and HTTP method decorators.
5. Resolve literal and simple constant route paths.
6. Normalize controller and method paths.
7. Emit endpoint, handler, evidence, and diagnostic records.
8. Generate the first endpoint catalogue in JSON and Markdown.

Exit test:

- The fixture endpoint catalogue exactly matches the frozen expected catalogue.

## 8.4 M2 - Direct DI and call trace

Tasks:

1. Read constructor parameters for controller and provider classes.
2. Support class-based constructor injection only.
3. Map injected properties or parameters to class declarations.
4. Resolve direct calls in the form `this.<injectedMember>.<method>()`.
5. Follow direct calls up to depth 3.
6. Prevent cycles with a visited-method set.
7. Preserve ambiguous and unresolved results as diagnostics.
8. Build the first endpoint trace from endpoint to provider method.

Exit test:

- The chosen endpoint reaches the expected service method without any name-only guess.

## 8.5 M3 - TypeORM table access

Tasks:

1. Detect TypeORM `@Entity` classes.
2. Resolve explicit entity table names and a documented simple default-name rule.
3. Detect common column decorators for metadata only.
4. Detect `@InjectRepository(Entity)` constructor parameters.
5. Associate repository member calls with the injected entity.
6. Classify supported repository methods as read or write.
7. Attach table-access assertions to the calling method.
8. Propagate table terminals into the endpoint trace.

Exit test:

- One endpoint trace reaches the expected read table and one reaches the expected write table.

## 8.6 M4 - Guards, evidence, and diagnostics

Tasks:

1. Detect direct `@UseGuards` declarations on controllers and methods.
2. Combine controller and method guard metadata without inferring full effective authentication.
3. Add file, line, column, snippet, and content hash evidence.
4. Validate that every resolved assertion has evidence.
5. Add stable diagnostic codes and human-readable messages.
6. Add `completed_with_gaps` behavior.
7. Redact obvious secret-looking values from snippets.

Exit test:

- The report distinguishes `guarded`, `none_declared`, and `unknown_global` without labelling unsupported endpoints public.

## 8.7 M5 - Productize the demo

Tasks:

1. Stabilize deterministic IDs and output ordering.
2. Add golden tests for the complete fixture analysis.
3. Run the same analysis twice and compare normalized JSON.
4. Validate against one real repository that fits the scope.
5. Improve CLI errors and help text.
6. Write `supported-patterns.md` and a limitations section.
7. Add a concise architecture diagram and example outputs to the README.
8. Record a short demonstration or create a scripted demo command sequence.

Exit test:

- A new user can clone the project, run one documented command, list endpoints, trace a selected endpoint, inspect evidence, and understand the declared limitations.

---

# 9. Prioritized Backlog

## 9.1 P0 - Required for the final demo

- P0-01: CLI skeleton and configuration.
- P0-02: Repository file inventory and exclusions.
- P0-03: TypeScript Program/TypeChecker adapter.
- P0-04: Stable source, class, method, endpoint, and evidence IDs.
- P0-05: Standard NestJS controller and route extraction.
- P0-06: Route normalization.
- P0-07: Class-based constructor injection extraction.
- P0-08: Direct injected-member method-call resolution.
- P0-09: Depth-limited trace traversal and cycle protection.
- P0-10: TypeORM entity and table extraction.
- P0-11: `@InjectRepository` resolution.
- P0-12: Common repository read/write classification.
- P0-13: Direct `@UseGuards` extraction.
- P0-14: Assertion/evidence validation.
- P0-15: Canonical JSON writer.
- P0-16: Endpoint catalogue and trace Markdown reporters.
- P0-17: Diagnostics and partial-result behavior.
- P0-18: Fixture, golden tests, real-repository demo, and documentation.

## 9.2 P1 - Useful only after P0 is complete

- P1-01: Request DTO extraction from `@Body`, `@Param`, and `@Query` parameters.
- P1-02: Handler return-type extraction.
- P1-03: Simple `APP_GUARD` recognition.
- P1-04: Simple string and symbol DI-token support.
- P1-05: TypeORM QueryBuilder recognition for static table/entity usage.
- P1-06: Direct Axios or `HttpService` call extraction.
- P1-07: SQLite persistence for historical runs.
- P1-08: Basic run-to-run diff.

## 9.3 P2 - Separate future projects

- P2-01: Column-level lineage and change impact.
- P2-02: Full Nest module graph and dynamic-module handling.
- P2-03: Monorepo and multiple-deployable support.
- P2-04: Kafka and messaging analysis.
- P2-05: Web evidence viewer.
- P2-06: AI narrative generated only from deterministic `analysis.json`.
- P2-07: Graph database or PostgreSQL `GraphStore`.
- P2-08: Multi-user service, security controls, observability, and production operations.

---

# 10. Testing and Evaluation

## 10.1 Test layers

| Layer | Purpose |
|---|---|
| Unit fixtures | Prove individual route, DI, call, guard, and TypeORM rules |
| Negative fixtures | Prove similarly named or unsupported constructs do not create resolved facts |
| Ambiguous fixtures | Prove multiple targets remain ambiguous |
| Golden fixture | Compare the complete canonical JSON for the reference application |
| Real-repository check | Validate usefulness outside the synthetic fixture |
| Repeatability check | Compare two clean normalized outputs for the same revision |

## 10.2 Required fixture cases

Route cases:

- Empty controller and method path.
- Controller prefix plus method path.
- Literal path.
- Simple string constant path.
- Dynamic path that produces `NEST_ROUTE_DYNAMIC`.

DI and call cases:

- Controller injects a service class.
- Service injects another service class.
- Service injects `Repository<Entity>` using `@InjectRepository`.
- A similarly named but uncalled method is not linked.
- Unsupported string token produces a diagnostic.
- A small call cycle terminates safely.

TypeORM cases:

- Explicit `@Entity('customer')` table name.
- Default entity name rule.
- `findOne` read.
- `save` write with unknown columns.
- `update` write.
- Unsupported custom repository call.

Guard cases:

- Controller-level `@UseGuards`.
- Method-level `@UseGuards`.
- Both controller and method guards.
- No direct guard with `AUTH_GLOBAL_POLICY_UNKNOWN` noted in limitations.

## 10.3 Acceptance checks

The core project passes when all are true:

1. The frozen fixture catalogue contains no missing or extra supported endpoints.
2. The selected read and write traces match the manually written expected paths.
3. Every resolved relationship has one or more valid evidence locations.
4. No unsupported DI, route, call, or TypeORM construct is silently treated as resolved.
5. Table read/write direction is correct for every fixture operation.
6. `save()` never claims exact columns without proof.
7. The analyzer does not execute or import repository code.
8. Two runs produce identical normalized `analysis.json` content.
9. The real reference repository produces at least one useful complete trace.
10. README documentation accurately states supported and unsupported patterns.

No percentage-based precision target is necessary for the first personal release. Exact results on a small frozen corpus are more useful and honest.

---

# 11. Risks and Controls

| Risk | Likely symptom | Control |
|---|---|---|
| Scope growth | New frameworks, integrations, UI, or AI appear before the first trace works | Keep the final demo fixed and place all additions in P1/P2 |
| TypeScript API complexity | Time is lost on general symbol-resolution edge cases | Support one compiler version and one reference repository first |
| Dynamic NestJS behavior | Routes or providers cannot be resolved | Emit explicit diagnostics; do not add runtime execution |
| False call edges | A similarly named method is linked | Require checker-resolved symbols; never resolve by name alone |
| Misleading authentication result | No direct guard is mistaken for public access | Use `none_declared` or `unknown_global`, never `public` in the core MVP |
| Misleading database detail | `save()` is presented as a column-specific write | Keep table-level semantics and emit `TYPEORM_SAVE_COLUMNS_UNKNOWN` |
| Output redesign | Data structures change during every milestone | Freeze the minimal model after M0 and make only additive changes |
| Test repository is too complex | Core path depends on dynamic modules or custom wrappers | Select a deliberately compatible reference app and document selection criteria |
| Personal momentum drops | Weeks pass without a visible result | End every milestone with one runnable CLI improvement and a demo command |

---

# 12. Stretch Roadmap

Stretch work starts only after the complete P0 definition of done passes.

Recommended order:

1. Request and response model extraction.
2. Simple global guard recognition.
3. Static Axios/`HttpService` dependencies.
4. QueryBuilder table access.
5. SQLite storage and run comparison.
6. Column-level lineage for explicit `update` and `insert` object literals.
7. Evidence-grounded AI explanation generated from the canonical JSON.
8. Full module graph, monorepo support, and additional frameworks.

AI is intentionally late. Its first task should be to turn one already validated endpoint trace into readable prose while citing assertion and evidence IDs. It must not create new routes, calls, guards, tables, or dependencies.

---

# 13. Definition of Done

The personal project is done when:

- The core goal can be demonstrated on the fixture and one real in-scope repository.
- The tool lists endpoints and traces one read and one write endpoint to the correct table.
- Every important output includes source evidence.
- Unknown, ambiguous, and unsupported behavior is visible.
- Canonical JSON is deterministic and runtime validated.
- Golden, negative, ambiguous, and repeatability tests pass.
- The analyzer never executes repository code.
- The CLI has useful help and error messages.
- The README contains installation, usage, architecture, supported patterns, limitations, and example output.
- No P1 or P2 feature is required to make the demo work.

---

# 14. First Ten Work Sessions

Each session should be 60-120 minutes and end with a committed artifact.

1. Create the project repository, CLI command, test runner, and fixture app.
2. Hand-write the expected endpoint catalogue and two expected traces.
3. Build file inventory and load the fixture `tsconfig.json` into a TypeScript `Program`.
4. Print all classes, methods, decorators, and source locations from the fixture.
5. Extract `@Controller` plus HTTP decorators and produce the first route catalogue.
6. Add stable IDs, canonical JSON ordering, and the first golden test.
7. Resolve one controller constructor-injected service and one direct method call.
8. Detect one TypeORM entity and `@InjectRepository` binding.
9. Classify one repository read and one repository write and attach the table to the trace.
10. Generate a Markdown endpoint trace with evidence and diagnostics, then compare it with the frozen expected trace.

After Session 10, reassess estimates using actual progress. Do not broaden the feature list; adjust only schedule or implementation depth within the declared scope.

---

# 15. Immediate Next Action

Select the reference application and freeze two expected traces before writing extractor code:

- One simple read path: route -> controller -> service -> repository read -> table.
- One simple write path: route -> controller -> service -> repository write -> table.

That single decision will determine whether the personal project remains manageable.
