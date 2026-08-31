# Supported Static-Analysis Patterns

This table is the P0 extraction boundary. A fact is emitted only when the TypeScript
checker proves the package symbol, the in-repository declaration, and the relationship
described below. Similar names alone are never enough.

| Area                              | Canonical rule                                                                                                                                                                                  | Supported source pattern                                                                                                                                                                                                    | Deliberate boundary                                                                                                                                                                          | Executable proof                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NestJS routes                     | `nest.route.standard.v1`                                                                                                                                                                        | `@nestjs/common` `Controller` plus `Get`, `Post`, `Put`, `Patch`, `Delete`, `Options`, `Head`, or `All`; omitted paths and strings accepted by the shared bounded constant resolver                                         | Dynamic expressions are diagnosed, custom wrappers are diagnosed, and same-named local decorators are ignored                                                                                | `test/unit/extractors/nest-routes.test.ts`, `test/unit/ts-index/constants.test.ts`, and `test/integration/route-catalogue.test.ts`                        |
| Class constructor injection       | `nest.di.class-constructor.v1`                                                                                                                                                                  | A constructor parameter whose checker-resolved type has one or more in-repository class declarations and which becomes a parameter property or one unique direct `this.member = parameter` assignment                       | String/symbol tokens, interface-only types, ambiguous constructors, and unbound parameters do not create guessed class edges                                                                 | `test/unit/extractors/class-relationships.test.ts` and `test/integration/class-relationships.test.ts`                                                     |
| Direct injected-member calls      | `nest.call.injected-member.v1`                                                                                                                                                                  | A direct `this.injectedMember.method()` call whose member and target method resolve through the constructor binding                                                                                                         | Name-only matches, unrelated receivers, nested function bodies, missing methods, and overloaded/multiple declarations are unresolved or ambiguous rather than guessed                        | `test/unit/extractors/class-relationships.test.ts` and `test/integration/class-relationships.test.ts`                                                     |
| Direct guards                     | `nest.guard.controller.v1`, `nest.guard.method.v1`                                                                                                                                              | Controller- or method-scoped `@nestjs/common` `UseGuards` arguments that resolve directly to in-repository class declarations                                                                                               | Local lookalikes and factory/expression arguments create no guard fact; absence means only `none_declared`, never `public`                                                                   | `test/unit/extractors/nest-guards.test.ts` and `test/integration/route-catalogue.test.ts`                                                                 |
| NestJS module metadata            | `nest.module.import.v1`, `nest.module.provider.v1`, `nest.module.export-class.v1`, `nest.module.export-module.v1`, `nest.module.controller.v1`                                                  | Package-proven `Module` object literals with direct/one-hop unmodified arrays, bounded spreads, repository classes, and direct `forwardRef` callbacks                                                                       | Dynamic modules, computed/indirect metadata, mutated arrays, factories, and unresolved classes mark completeness incomplete without guessed edges                                            | `test/unit/extractors/nest-modules.test.ts` and `test/unit/modules/visibility.test.ts`                                                                    |
| Application-global guards         | `nest.global-guard.app-guard-use-class.v1`, `nest.global-guard.app-guard-use-existing.v1`, `nest.global-guard.bootstrap.v1`                                                                     | Package-proven `APP_GUARD` with bounded `useClass`/same-module `useExisting`, plus direct `NestFactory.create` application bindings and `useGlobalGuards(new GuardClass())`                                                 | Factory/value providers, aliases/escapes, conditional bootstrap calls, and dynamic provider objects remain explicit unknowns; a guard is not an authentication claim                         | `test/unit/extractors/nest-modules.test.ts` and `test/unit/guards/effective.test.ts`                                                                      |
| Nest HTTP application roots       | `nest.application.http-root.v1`                                                                                                                                                                 | Package-proven direct `NestFactory.create(RootModule)` calls identify an HTTP application root for bounded registration analysis                                                                                            | Dynamic/factory module arguments remain unresolved; finding a root does not prove every runtime application or deployment unit                                                               | `test/unit/extractors/nest-event-emitter.test.ts`                                                                                                         |
| TypeORM entity/table mapping      | `typeorm.entity-table.v1`                                                                                                                                                                       | `typeorm` `Entity` with an explicit simple string name, or no name using the frozen lowercase-class-name fallback                                                                                                           | Project naming strategies and dynamic entity names are not inferred                                                                                                                          | `test/unit/extractors/typeorm-persistence.test.ts` and `test/integration/typeorm-persistence.test.ts`                                                     |
| TypeORM repository injection      | `typeorm.repository-injection.v1`, `typeorm.repository-entity.v1`                                                                                                                               | A constructor-bound member decorated with `@nestjs/typeorm` `InjectRepository`, whose argument resolves to an in-repository `typeorm` `Entity` class                                                                        | Non-entity, unresolved, or multiple plausible entity targets remain explicit gaps or ambiguity                                                                                               | `test/unit/extractors/typeorm-persistence.test.ts`                                                                                                        |
| TypeORM reads                     | `typeorm.repository.find.v1`, `typeorm.repository.findOne.v1`, `typeorm.repository.findOneBy.v1`, `typeorm.repository.findBy.v1`, `typeorm.repository.count.v1`, `typeorm.repository.exists.v1` | Calls to the listed method on a proven injected repository member                                                                                                                                                           | Same-named calls on arbitrary objects create no table facts                                                                                                                                  | `test/unit/extractors/typeorm-persistence.test.ts` and `test/integration/typeorm-persistence.test.ts`                                                     |
| TypeORM writes                    | `typeorm.repository.save.v1`, `typeorm.repository.insert.v1`, `typeorm.repository.update.v1`, `typeorm.repository.delete.v1`, `typeorm.repository.remove.v1`                                    | Calls to the listed method on a proven injected repository member                                                                                                                                                           | `save` and `remove` prove table direction but deliberately do not claim exact written columns                                                                                                | `test/unit/extractors/typeorm-persistence.test.ts` and `test/integration/typeorm-persistence.test.ts`                                                     |
| QueryBuilder reads                | `typeorm.query-builder.select.v1`, `typeorm.query-builder.join.v1`                                                                                                                              | Direct fluent or one safe method-local builder flow from checker-proven TypeORM roots; read terminals and explicit entity-class joins                                                                                       | Relation-string joins, callbacks, CTEs, dynamic targets, escaped/reassigned builders, and lookalikes create no guessed table edge                                                            | `test/unit/extractors/typeorm-query-builder.test.ts` and `test/integration/phase17-query-builder-consumers.test.ts`                                       |
| QueryBuilder writes               | `typeorm.query-builder.insert.v1`, `typeorm.query-builder.update.v1`, `typeorm.query-builder.delete.v1`                                                                                         | Proven insert/into, update, or delete/from state followed by `execute`; repository roots or explicit entity/static-literal targets supply the table                                                                         | `getSql`/`getQuery` are not terminals; execute without a proven builder kind/target and unsupported flow create no write fact                                                                | `test/unit/extractors/typeorm-query-builder.test.ts` and `test/integration/phase17-query-builder-consumers.test.ts`                                       |
| PostgreSQL raw-SQL reads          | `typeorm.raw-sql.select.read.v1`, `typeorm.raw-sql.update.read.v1`, `typeorm.raw-sql.delete.read.v1`                                                                                            | Explicit `postgresql-18`; proven TypeORM `.query()`/`.sql` receiver; static source; bounded visitor over SELECT/join/subquery/CTE and DML source relations                                                                  | Disabled dialect, mixed receivers, dynamic identifiers, parser/limit failures, and unsupported statements create no table edge                                                               | `test/unit/sql/postgresql-table-access.test.ts`, `test/unit/extractors/typeorm-raw-sql.test.ts`, and `test/integration/phase18-raw-sql-consumers.test.ts` |
| PostgreSQL raw-SQL writes         | `typeorm.raw-sql.insert.write.v1`, `typeorm.raw-sql.update.write.v1`, `typeorm.raw-sql.delete.write.v1`                                                                                         | Physical INSERT/UPDATE/DELETE targets from a completely supported PostgreSQL 18 parse                                                                                                                                       | DDL, CALL, SELECT INTO, temporary-table lifecycle, cross-database names, and mixed supported/unsupported multi-statements publish no facts                                                   | `test/unit/sql/postgresql-table-access.test.ts`, `test/unit/extractors/typeorm-raw-sql.test.ts`, and `test/integration/phase18-raw-sql-consumers.test.ts` |
| Nest request declarations         | `nest.request-parameter.v1`                                                                                                                                                                     | Checker-proven `@nestjs/common` `Body`, `Param`, and `Query` on supported route handlers, with whole/literal-selector state and declared/checker type shape                                                                 | Local lookalikes are ignored; dynamic selectors remain unknown; pipes and effective runtime validation/transformation are not inferred                                                       | `test/unit/extractors/nest-contracts.test.ts`                                                                                                             |
| Declared response contracts       | `nest.response-contract.v1`                                                                                                                                                                     | Explicit or checker-derived handler returns, one bounded `Promise<T>` unwrap, simple arrays/unions, and checker-proven manual `Res` handling                                                                                | `any`, unknown, anonymous, and complex shapes remain explicit; interceptors and serialized HTTP output are not inferred                                                                      | `test/unit/extractors/nest-contracts.test.ts`                                                                                                             |
| DTO/interface fields              | `typescript.contract-field.v1`                                                                                                                                                                  | Referenced in-repository class/interface properties with checker-proven inheritance, optional/readonly state, and package-proven class-validator decorators as declared constraints                                         | Mapped types remain checker-derived; validators are not executed and do not prove an active validation pipe                                                                                  | `test/unit/extractors/nest-contracts.test.ts`                                                                                                             |
| TypeORM entity columns            | `typeorm.entity-column.v1`                                                                                                                                                                      | Checker-proven `Column`, `PrimaryColumn`, and `PrimaryGeneratedColumn`, bounded literal options, transformer presence, and in-repository base declarations                                                                  | Dynamic/spread options are unknown; naming strategies, embeds, relations, virtual columns, `EntitySchema`, and transformer execution are not inferred                                        | `test/unit/extractors/nest-contracts.test.ts` and `test/unit/extractors/typeorm-persistence.test.ts`                                                      |
| Local request-to-column influence | `request.provenance.field-origin.v1`, `request.provenance.explicit-object-write.v1`                                                                                                             | Same-method decorated request fields through direct values, one non-mutated alias/destructuring, or bounded derived expressions into proven repository insert/update and executed QueryBuilder values/set object properties | “May influence,” never exact stored value; mapper/mutation/control-flow uncertainty remains `unknown`; spreads/computed keys have no guessed edge; no save/remove/raw-SQL propagation        | `test/unit/extractors/request-provenance.test.ts`                                                                                                         |
| Inter-method request influence    | `request.provenance.inter-method-object-write.v1`                                                                                                                                               | Argument-position mapping through one checker-resolved direct injected-member call at each hop; immutable frames carry whole-object/selected origins and preserve direct/derived/unknown state within configured call depth | Overload/target ambiguity, spread/rest, callbacks, interface dispatch, missing bodies, cycles, depth and resource limits stop propagation; reachability alone creates no value-flow edge     | `test/unit/extractors/inter-method-provenance.test.ts` and `test/integration/phase21-inter-method-provenance.test.ts`                                     |
| Eager Axios HTTP                  | `http.outbound.axios.eager.v1`                                                                                                                                                                  | Checker/package-proven default or named Axios; supported direct/callable methods; immutable `axios.create()` variables or readonly properties; literal/template/dynamic targets and bounded literal `baseURL` joins         | Same-named clients, arbitrary `AxiosInstance` parameters, computed members, unsupported config flow, custom adapters/transports, and Nest `HttpService` create no guessed resolved target    | `test/unit/extractors/outbound-http.test.ts`                                                                                                              |
| Eager fetch HTTP                  | `http.outbound.fetch.eager.v1`, `http.outbound.undici-fetch.eager.v1`                                                                                                                           | Unshadowed standard global `fetch` or checker/package-proven Undici `fetch`; literal/default method and literal/template/dynamic targets                                                                                    | Shadowed/local fetch functions and other packages are ignored; request bodies, headers, query values, credentials, fragments, response behavior, and network execution are never modeled     | `test/unit/extractors/outbound-http.test.ts` and `test/integration/no-execution.test.ts`                                                                  |
| Nest HttpService HTTP             | `http.outbound.nest-http-service.cold.v1`                                                                                                                                                       | Checker/package-proven constructor member; supported methods; package-proven `firstValueFrom`, `lastValueFrom`, `subscribe`, transparent `pipe`, or direct route return; cold/unknown states remain explicit                | Local/ambiguous/reassigned receivers and arbitrary wrappers create no guessed request activation; callback and stored-Observable data flow is not followed                                   | `test/unit/extractors/nest-http-service.test.ts`                                                                                                          |
| Nest axiosRef HTTP                | `http.outbound.nest-axios-ref.eager.v1`                                                                                                                                                         | Callable or supported Axios methods through a proven `HttpService.axiosRef`; Phase 31 method/config/target rules apply and activation is eager                                                                              | Unproven `HttpService` bindings and computed/unsupported Axios forms create no resolved interaction                                                                                          | `test/unit/extractors/nest-http-service.test.ts`                                                                                                          |
| Symbolic HTTP targets             | Phase 32 bounded symbolic evaluator                                                                                                                                                             | Static `ConfigService.get()` token or unshadowed `process.env.KEY`, composed through templates/concatenation, immutable constants, readonly initializers, or one unique constructor assignment                              | Values are never read; dynamic keys, mutable/reassigned properties, arbitrary calls, cycles, and limit breaches become dynamic/diagnosed                                                     | `test/unit/extractors/nest-http-service.test.ts`                                                                                                          |
| Exact EventEmitter producers      | `event.in-process.event-emitter2.emit.exact.v1`, `event.in-process.event-emitter2.emit-async.exact.v1`                                                                                          | Checker/package-proven injected `EventEmitter2`; exact literal, bounded const, string enum, or unique-symbol declaration identity; eager `emit`/`emitAsync` timing retained                                                 | Local/lookalike, union/overridden/reassigned receivers publish no guessed producer; payloads are not retained; dynamic and wildcard-shaped producer identities are diagnosed                 | `test/unit/extractors/nest-event-emitter.test.ts`                                                                                                         |
| Exact/wildcard OnEvent handlers   | `event.in-process.on-event.sync.exact.v1`, `event.in-process.on-event.async.exact.v1`, `event.in-process.on-event.timing-unknown.exact.v1`, `event.in-process.wildcard-match.v1`                | Package-proven `@OnEvent()` scalar/array identities; configured `*` one-segment and `**` zero-or-more matching with static default/custom delimiter; every exact/wildcard match retained                                    | Wildcards require statically proven `forRoot({ wildcard: true })`; dynamic/spread/conflicting configuration and manual listener registration create no guessed pattern match                 | `test/unit/extractors/nest-event-emitter.test.ts` and `test/unit/extractors/nest-event-wildcards.test.ts`                                                 |
| Local event causal traversal      | `event.in-process.exact-match.v1`, `event.in-process.wildcard-match.v1`                                                                                                                         | Proven handlers traversed with separate interaction-hop, ordinary-call-depth, fan-out, and state limits; handler-rooted entry points; sync/async local terminal classes; path-aware cycle termination                       | Candidate/unknown registration is not promoted to effects; limit/cycle diagnostics preserve partial relationships; distributed effects are not inferred                                      | `test/unit/extractors/nest-event-emitter.test.ts` and `test/unit/extractors/nest-event-wildcards.test.ts`                                                 |
| BullMQ queue producers            | `queue.bullmq.queue-add.v1`                                                                                                                                                                     | Package-proven `@nestjs/bullmq` `@InjectQueue()` member typed as `bullmq` `Queue`; direct `add()` with literal, bounded immutable-chain, string-enum/const-enum, or `as const` queue/job strings                            | Ambiguous/reassigned/lookalike receivers produce no guessed interaction; payload/options are not retained; no enqueue or delivery success claim                                              | `test/unit/extractors/nest-bullmq.test.ts` and `test/unit/ts-index/constants.test.ts`                                                                     |
| BullMQ WorkerHost candidates      | `queue.bullmq.worker-host.process.queue-wide.v1`, `queue.bullmq.queue-wide-candidate.v1`                                                                                                        | Package-proven `@Processor(queue)` class extending package `WorkerHost`; one `process()` method; same exact queue links to every bounded candidate; module provider metadata proves registration                            | Registration-unknown candidates do not contribute endpoint effects; duplicate workers are all retained; legacy Bull is unsupported                                                           | `test/unit/extractors/nest-bullmq.test.ts`                                                                                                                |
| BullMQ conditional traversal      | Phase 35 distributed interaction traversal                                                                                                                                                      | Endpoint and handler-rooted paths cross matched, proven-registered local worker candidates and classify downstream table terminals as `distributed_conditional`                                                             | Broker/worker crossing never changes synchronous DB facts or proves delivery, completion, retry behavior, remote ownership, or an exact job-specific effect                                  | `test/unit/extractors/nest-bullmq.test.ts`                                                                                                                |
| BullMQ exact branch extraction    | `queue.bullmq.worker-host.dispatch.v1`, bounded switch/if/common/unmatched/unsupported branch rules                                                                                             | Direct `job.name` switch or terminating strict-equality chains on the exact process parameter; static literal/enum/`as const` labels; grouped empty labels; common prelude/finally; exact/default effects                   | Aliases, mutation, compound predicates, dynamic labels, and non-empty fallthrough retain effects under an explicit unknown residual branch; no exact over-attribution                        | `test/unit/extractors/bullmq-branches.test.ts` and `test/unit/fixtures/phase39-bullmq-branch-gate.test.ts`                                                |
| Nest microservice applications    | `nest.application.microservice-root.v1`, `nest.application.hybrid-microservice-root.v1`                                                                                                         | Direct `createMicroservice()` roots and bounded `create()` + `connectMicroservice()` hybrids; static TCP/Redis/RMQ/Kafka transport inventory                                                                                | Dynamic bootstrap/factory/configuration and broker topology are not evaluated; transport inventory never proves routing or delivery                                                          | `test/unit/extractors/nest-microservices.test.ts`                                                                                                         |
| ClientProxy producers             | `microservice.client-proxy.send.v1`, `microservice.client-proxy.emit.v1`                                                                                                                        | Package-proven injected `ClientProxy`, static `ClientsModule.register()` token/transport, bounded scalar/plain-JSON patterns; eager `emit` and cold `send` activation states                                                | Lookalikes, ambiguous receivers/tokens, dynamic patterns, arbitrary wrappers, and unsupported transports remain absent or explicitly uncertain; payloads are not retained                    | `test/unit/extractors/nest-microservices.test.ts`                                                                                                         |
| Nest message/event handlers       | `microservice.message-pattern.v1`, `microservice.event-pattern.v1`                                                                                                                              | Package-proven controller handler inventory, including consumer-only roots and registration state                                                                                                                           | Provider decorators remain registration-unknown; local lookalikes are rejected; no handler declaration proves deployment or execution                                                        | `test/unit/extractors/nest-microservices.test.ts`                                                                                                         |
| Microservice candidate matching   | `microservice.request-response-candidate.v1`, `microservice.request-response-ambiguous-candidate.v1`, `microservice.event-candidate.v1`                                                         | Same resolved application, mode, canonical pattern, and proven compatible transport; events retain all candidates; duplicate request handlers remain ambiguous and non-traversable                                          | No delivery/acknowledgement claim, no request fan-out, no cross-application or transport-equivalence inference, and no transport-specific routing simulation                                 | `test/unit/extractors/nest-microservices.test.ts`                                                                                                         |
| Cache-manager resource access     | `resource.cache-manager.direct.v1`                                                                                                                                                              | Package-proven `cache-manager` `get`, `set`, `del`, and `wrap` calls inside supported Nest controller/provider methods; bounded exact/template/symbolic/dynamic target structure                                            | Payloads, callback results, runtime configuration values, arbitrary wrappers, hit/miss, execution, and command success are never retained or inferred                                        | `test/unit/extractors/resource-access.test.ts`                                                                                                            |
| Direct ioredis resource access    | `resource.ioredis.direct.v1`                                                                                                                                                                    | Package-proven direct `ioredis` string, hash, delete, expiry, and bounded `scan`/`hscan` calls; variadic deletes expand up to 16 structural targets                                                                         | Pipelines, transactions, scripts, pub/sub, `keys`, streams, arbitrary wrappers, runtime values, atomicity, and network success are unsupported                                               | `test/unit/extractors/resource-access.test.ts`                                                                                                            |
| Redlock critical sections         | `resource.redlock.using.v1`                                                                                                                                                                     | Package-proven `redlock` `using()` calls with bounded direct/immutable-const resource arrays and an inline arrow or function callback                                                                                       | Dynamic or oversized targets are diagnosed; callback references, lookalikes, custom wrappers, acquisition, exclusivity, timing, contention, execution, renewal, and release are not inferred | `test/unit/extractors/redlock-critical-sections.test.ts`                                                                                                  |

## Shared bounded string resolution

Phase 38 expands the shared static-string helper used by routes, string DI tokens,
TypeORM static names/sources, BullMQ identities, and scalar Nest microservice pattern
components. It resolves literals, no-substitution templates, at most eight acyclic
immutable `const` hops, checker-resolved string and `const enum` members, and nested
property or string-element access on an `as const` object literal. Named import aliases
are resolved by the TypeScript checker.

`baseUrl` and `tsconfig.paths` are not interpreted by a second custom resolver: they
are already inputs to the selected TypeScript program. Only source admitted by the
repository inventory may become target source. Mutable bindings, unasserted objects,
spreads, computed keys, getters/methods, non-string members, ambiguous declarations,
cycles, and depth exhaustion publish no guessed string. Client-specific evaluators,
including outbound HTTP symbolic URL composition, retain their separately documented
boundaries.

## Explicit uncertainty behavior

Unsupported repository methods such as `preload` produce
`TYPEORM_OPERATION_UNSUPPORTED` and no read/write assertion. Dynamic route paths,
custom route decorators, unsupported DI tokens, unresolved calls, unresolved guards,
unresolved module/bootstrap metadata, and unresolved entity bindings likewise remain
diagnostics or non-resolved assertions. `AUTH_GLOBAL_POLICY_UNKNOWN` remains only when
the bounded global scan is incomplete and endpoints exist. A complete supported scan
with no registration produces `none_proven`, not a public/authentication claim.

`save` and `remove` additionally produce `TYPEORM_SAVE_COLUMNS_UNKNOWN`. This is an
honesty boundary: visible object mutations do not prove the exact SQL column set.

Bounded QueryBuilder gaps use `TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS`,
`TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED`,
`TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED`, and
`TYPEORM_QUERY_BUILDER_TERMINAL_MISSING`. Static literal targets have distinct
`query_builder_literal` provenance; no SQL, CTE, callback, or relation text is parsed.

Raw-SQL gaps use `TYPEORM_RAW_SQL_DIALECT_UNSELECTED`,
`TYPEORM_RAW_SQL_RECEIVER_AMBIGUOUS`, `TYPEORM_RAW_SQL_SOURCE_UNSUPPORTED`,
`TYPEORM_RAW_SQL_LIMIT_EXCEEDED`, `TYPEORM_RAW_SQL_PARSE_FAILED`, and
`TYPEORM_RAW_SQL_STATEMENT_UNSUPPORTED`. Physical names use v2-only
`raw_sql_literal` provenance. Parser failure has no regex fallback, and one unsupported
statement suppresses every candidate access from that static SQL source.

Contract and column uncertainty is carried in the records themselves. Dynamic request
selectors and entity options remain `unknown`; mapped DTO shapes remain
`checker_derived`; manual responses, `any`, and complex return shapes never become a
serialized response claim. Class-validator annotations are declarations only.

Local provenance gaps use `REQUEST_PROVENANCE_UNSUPPORTED` and
`REQUEST_PROVENANCE_LIMIT_EXCEEDED`. Inter-method boundaries use
`REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED` and
`REQUEST_PROVENANCE_CALL_DEPTH_LIMIT`. Unknown mapper or mutation dependencies remain
visible as `unknown` influence when a static sink column is proven. Spread/computed
keys, whole-object sinks, raw-SQL parameters, and `save()`/`remove()` produce no
guessed column edge.

Outbound-HTTP gaps use `OUTBOUND_HTTP_TARGET_DYNAMIC`,
`OUTBOUND_HTTP_METHOD_DYNAMIC`, `OUTBOUND_HTTP_CONFIG_UNSUPPORTED`,
`OUTBOUND_HTTP_RECEIVER_UNSUPPORTED`, and
`OUTBOUND_HTTP_TARGET_LIMIT_EXCEEDED`. Phase 32 additionally uses
`OUTBOUND_HTTP_ACTIVATION_UNKNOWN` when a cold producer crosses stored, reassigned,
awaited, returned-non-route, or unsupported-wrapper flow. A proven client call remains
an interaction when bounded target/method/activation detail is unknown. Target
structures never retain query values, fragments, userinfo credentials, headers,
bodies, or runtime configuration/environment values.

Exact local-event gaps use `INTERACTION_RECEIVER_AMBIGUOUS`,
`INTERACTION_TARGET_DYNAMIC`, `EVENT_EMITTER_CONFIGURATION_UNKNOWN`,
`EVENT_HANDLER_REGISTRATION_UNKNOWN`, `INTERACTION_TRACE_LIMIT_REACHED`, and
`INTERACTION_CYCLE_TRUNCATED`. Missing local handlers are `none_proven`, not an error
or a remote-consumer assumption. Payload values are never retained.

BullMQ gaps additionally use `JOB_QUEUE_HANDLER_REGISTRATION_UNKNOWN`,
`JOB_QUEUE_FILTER_PARTIAL`, and `JOB_QUEUE_FILTER_UNPROVEN`. Producer-only and consumer-only repositories are normal
open-world topologies. Dynamic queue/job identity uses
`INTERACTION_TARGET_DYNAMIC`; duplicate candidates are bounded fan-out rather than a
guessed single consumer. Analysis v4 publishes exact/common/unmatched/unknown branch
facts. Partial and unsupported control flow retains discovered effects in an unknown
residual region rather than dropping them or assigning them to every job.

Nest microservice gaps additionally use `MICROSERVICE_TRANSPORT_UNKNOWN`,
`MICROSERVICE_TRANSPORT_MISMATCH`, `MICROSERVICE_ACTIVATION_UNKNOWN`,
`MICROSERVICE_HANDLER_REGISTRATION_UNKNOWN`, and
`MICROSERVICE_REQUEST_HANDLER_AMBIGUOUS`. Duplicate request handlers are visible
ambiguity records but are not traversed as event-style fan-out.

## Independent repository confirmation

The rule table was also checked against the official NestJS `05-sql-typeorm` sample at
revision `841df8792fbedd1fbba12c9fe999aee307a155c7`:

| Rule area                 | Observed source                                                         | Verified result                                                    |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Routes                    | Four `users` handlers using `Post`, `Get`, and `Delete`                 | Four exact endpoint/handler facts                                  |
| Class injection and calls | `UsersController` constructor-injects and directly calls `UsersService` | Four exact class/call paths                                        |
| Entity and repository     | `User` plus `InjectRepository(User)`                                    | Default `user` table and one repository binding                    |
| Reads                     | `find` and `findOneBy`                                                  | Two complete `READ user` traces                                    |
| Writes                    | `save` and `delete`                                                     | Two complete `WRITE user` traces                                   |
| Guards                    | No direct `UseGuards` in the sample                                     | `none_declared` plus `AUTH_GLOBAL_POLICY_UNKNOWN`; no public claim |

Every generated evidence location for `GET /users/:id` and `POST /users` was compared
with source. The full audit is in
[Real Repository Validation](real-repository-validation.md).

## Deliberately unmodeled patterns

The current graph models bounded request-field influence on explicit insert/update
properties in one method and through proven direct injected-member calls. It does not
model polymorphic/interface dispatch, callback value flow, pipes, effective validation
or transformation, dynamic Nest module behavior, interceptors/serialization,
dynamic/non-PostgreSQL raw SQL, custom repositories, general RxJS alias/callback flow,
arbitrary HTTP clients, dynamic/manual EventEmitter listeners, legacy/custom queue
APIs, general BullMQ control-flow slicing, dynamic/custom Nest microservice clients or
broker topology, raw broker messaging, cache/Redis pipelines, transactions, scripts,
pub/sub, arbitrary wrappers, or lock semantics.
The supported eager, Nest `HttpService`, exact local-event, bounded BullMQ, and
bounded Nest microservice subsets
are documented separately. Unsupported QueryBuilder, raw-SQL,
and HTTP flow remains diagnosed rather than modeled. These are not silently converted
into nearby supported facts. Monorepo-wide application discovery, distributed
messaging, and broader runtime container behavior remain outside this phase.

The frozen analysis-v1 output remains at
`test/golden/example-nestjs-app/analysis.json`; the current analysis-v2 output is at
`test/golden/example-nestjs-app/analysis-v2.json`. The integrated negative contract is
`example-nestjs-app/expected/negative-assertions.json`.

## Analysis v7 capability boundary

The current capability statement is: `outbound_http`, `in_process_event`,
`job_queue`, and `microservice_message` are supported and enabled. The
phase chronology below documents compatibility evolution and must not be read as the
current scanner state at each intermediate step.

Analysis schema `7.0.0` preserves the analysis-v6 `outbound_http`, `in_process_event`,
`job_queue`, and `microservice_message` records. Phase 30 implements no extractor for
those kinds and originally published empty `applications`, `interactions`, and
`interactionHandlers`, with `supportedKinds: []`, `enabledKinds: []`, and
`state: not_run`.

Phase 31 first activated `outbound_http` in `supportedKinds` and `enabledKinds`, plus a
`complete` or `incomplete` extractor state. At that milestone applications and
handlers remained empty and the other kinds were schema reservations.

Phase 32 extends `outbound_http` with Nest `HttpService`, `axiosRef`, cold activation
states, and symbolic target structure. Phase 33 activates `in_process_event`,
populates application roots and independent handlers, matches exact local candidates,
and carries proven causal paths through bounded traces, impact adjacency, Markdown,
and graph scenes. Phase 34 adds configured wildcard/delimiter matching and completes
explicit comparison, impact, policy-isolated trace fields, structured exports, and
graph v3 consumers.

Phase 40 adds branch-scoped BullMQ dispatch, selector, and effect records. Exact job
producers traverse matching, common, or supported unmatched worker regions; unsupported
residual regions remain explicit and are not treated as exact effects. Comparison v3,
impact v2, OpenAPI/control v4, and graph v5 preserve the distinction between branch
capability unavailable and a proven empty selection.

Phase 35 activates `job_queue` for the bounded BullMQ producer and queue-wide
`WorkerHost` surface. It publishes local delivery candidates and
`distributed_conditional` effects while preserving open-world producer-only and
consumer-only topologies.

Phase 36 activates `microservice_message` for the bounded Nest `ClientProxy`, static
registration/transport, canonical pattern, and controller-handler surface. Local
matches are delivery candidates only; downstream effects remain
`distributed_conditional`.

Current scans therefore advertise all four interaction kinds as supported and
enabled.

Analysis v5 additionally supports bounded authorization inventory:

- package-proven `SetMetadata`, `applyDecorators`, and `UseGuards` calls;
- repository wrapper functions/arrow functions whose body is a direct expression or
  one direct return;
- exactly one static metadata key per supported wrapper;
- static repository guard classes nested in a composite wrapper; and
- configured exact metadata keys, package exports, repository exports, and repository
  guard relationships.

Metadata values are reduced to redacted scalar/array/object shape. Dynamic value shape
and unknown enforcement remain explicit. Bare decorator names, arbitrary wrapper
control flow, runtime reflection, dynamic metadata keys, guard factories, inheritance,
and semantic claims about custom decorators are unsupported. A configured relationship
is not rewritten as proof, and a metadata decorator never becomes a guard fact by
itself.

Analysis v7 preserves package-proven non-relational resource inventory:

- `cache-manager` `get`, `set`, `del`, and `wrap`;
- selected direct `ioredis` string, hash, delete, expiry, and bounded scan commands;
- exact, template, symbolic, and explicit dynamic structural targets; and
- endpoint- and independent-handler-rooted causal projection.

The extractor retains no cache/Redis payload or runtime value. Unsupported operations
and dynamic/oversized targets remain diagnostics rather than nearby guessed facts. See
[Non-Relational Resource Access](non-relational-resource-access.md).

Analysis v7 additionally recognizes package-proven Redlock `using()` calls with up to
16 structurally bounded resource keys and inline arrow/function callbacks. It emits
`distributed_lock` resources plus explicit `CriticalSectionRecord` scopes. Assertions
inside those callbacks trace as `critical_section_conditional`; dynamic/spread lists,
callback references, lookalikes, and custom wrappers remain fail-closed gaps. See
[Redlock Critical Sections](redlock-critical-sections.md).

Schema representation must not be interpreted as static-analysis support. The
supported outbound subsets are defined in
[Eager Outbound HTTP Analysis](outbound-http.md) and
[Nest HttpService and Symbolic Targets](nest-http-service.md). Exact and configured
wildcard local events are defined in [In-Process Event Analysis](in-process-events.md).
The BullMQ subset is defined in [BullMQ Queue Interactions](bullmq-interactions.md),
and the Nest microservice subset in
[Nest Microservice Interactions](nest-microservices.md). Dynamic/manual EventEmitter
listeners, legacy Bull, raw/custom BullMQ APIs, dynamic/custom microservice clients,
raw broker SDKs, delivery, and remote consumers remain unmodeled. The
non-executable corpus in [Distributed Gate D0](distributed-gate-d0.md) is the frozen
BullMQ and Nest microservice contracts consumed by Phases 35 and 36; it is not
broader static-analysis support.

## Derived architecture policies

The eight built-in policy rules consume only supported canonical and semantic-diff
facts above. They do not broaden static-analysis support. Direct controller repository
access, guard declarations on synchronous write endpoints, write-trace completeness,
new diagnostics, bounded interaction targets, proven interaction activation, and
closed-world local-event handler presence are covered by
`test/unit/policy/evaluate.test.ts`; strict configuration,
canonical ordering, and integrity are covered by
`test/unit/policy/contracts.test.ts`. The result vocabulary and limitations are in
[Typed Architecture Policy Engine](policy-engine.md).

## Derived structured evidence exports

Phase 22 consumes only validated canonical facts. OpenAPI 3.0/3.1 JSON operations are
matched by exact normalized HTTP method and path, including documented Nest `:name`
to OpenAPI `{name}` conversion and an optional explicit path prefix. Duplicate,
ambiguous, unresolved, and unmatched cases remain visible; operation IDs, fuzzy
similarity, handler names, YAML, and Swagger/OpenAPI 2 are not matching inputs.

The control-evidence JSON/CSV matrix emits one row per canonical endpoint with guard
state, mutation classification, proven table access, bounded provenance, diagnostics,
policy outcomes, and evidence/source references. Unknown trace state remains unknown.
CSV uses RFC-style quoting and neutralizes cells beginning with `=`, `+`, `-`, or `@`.
These exports inventory evidence; they do not certify compliance or infer runtime
behavior. See [Structured Evidence Exports](structured-evidence-exports.md).

## Derived offline graph report

Graph schema v4 projects one bounded scene per canonical endpoint and one per canonical
interaction handler from the existing endpoint/handler traces, effective-guard, and
request-provenance views. Assertion
status remains resolved, ambiguous, unresolved, or unsupported; derived unknown states
remain named. Optional policy results must match the snapshot, and optional impact
results must contain it on an exact before/after side. Impact path assertion IDs—not
route similarity—control edge styling.

Scenes default to 120 nodes and 180 edges, retain the endpoint root, and report omitted
node/edge/evidence counts. The single HTML artifact embeds pinned Cytoscape.js and safe
JSON under hash-based CSP with network connections disabled. Source-derived UI text is
written with `textContent`, evidence locations are copyable text rather than links, and
the graph has a keyboard-accessible table equivalent. Hosted services, client-side
analysis, remote assets, whole-repository default rendering, and guessed edges are not
supported. See [Offline Interactive Graph Report](offline-graph-report.md).

Graph v7 introduced one bounded architecture overview for analysis v5. Graph v8
preserves it and adds resource-access nodes and reach metrics for analysis v6. Current
graph v9 adds explicit Redlock critical-section scope nodes for analysis v7.
Resolved `METHOD_CALLS_METHOD` edges provide direct fan-in/fan-out. Resolved-only
connectivity inside the existing bounded endpoint and handler traces provides separate
and combined root-reach counts for methods, tables, interactions, and resources. Every metric has
deterministic p50/p75/p90 heat thresholds and exact numeric output. Supported Nest
module declaration assertions cluster only uniquely owned classes/methods; multiple,
unknown, missing, and unavailable ownership remain distinct. Zero reach is
`not_reached_from_supported_roots`, not a dead-code or deletion claim. See
[Architecture Overview and Bounded Refactoring Metrics](architecture-overview.md).
