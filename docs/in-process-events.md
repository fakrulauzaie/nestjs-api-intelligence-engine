# In-Process Event Analysis

In-process event analysis supports the `in_process_event` interaction kind for checker-proven
`@nestjs/event-emitter` declarations. The analyzer inventories Nest application
roots, `EventEmitterModule.forRoot()` registrations, injected `EventEmitter2`
producers, and `@OnEvent()` handlers without importing or bootstrapping the target.

A supported exact or configured-wildcard match is a repository-local delivery
candidate. It does not prove that Nest
instantiated the provider, that an event was delivered, that a handler completed, or
that a database operation succeeded.

## Supported identities

Producer and handler identities can be:

- string or no-substitution template literals;
- bounded immutable `const` references;
- string enum members resolved by the TypeScript checker;
- module-level `unique symbol` declarations, represented by a normalized
  repository-relative declaration key; or
- direct or one-constant-hop arrays accepted by `@OnEvent()`.

Payload classes and payload values are never event identities. Template expressions,
mutable values, arbitrary calls, and missing arguments become `dynamic` and emit
`INTERACTION_TARGET_DYNAMIC`. Producer identities containing `*` or `**` are also
dynamic: the analyzer never treats an emitted wildcard-shaped string as pattern
dispatch.

## Configured wildcard handlers

`@OnEvent()` string patterns are supported only when the applicable
`EventEmitterModule.forRoot()` configuration is statically resolved with
`wildcard: true`. Omitted `delimiter` means `.`, while a non-empty static string
selects a custom delimiter. Direct object literals and one immutable `const` object
hop are supported. Spread/computed options, dynamic booleans/delimiters, or conflicting
roots produce `EVENT_EMITTER_CONFIGURATION_UNKNOWN`; the handler remains dynamic and
is never guessed.

Matching follows EventEmitter2 segment semantics for the configured delimiter:

- `*` consumes exactly one segment;
- `**` consumes zero or more segments; and
- all exact and wildcard matches are retained—exact listeners do not outrank wildcard
  listeners.

With `wildcard: false`, `order.*` is a literal handler identity. Pattern targets carry
configuration evidence and use `event.in-process.wildcard-match.v1`. The executable
matrix covers exact-plus-wildcard fan-out, `*`, `**`, custom delimiters, disabled and
dynamic configuration, and multiple roots.

## Receiver and declaration proof

`emit()` and `emitAsync()` are accepted only through a constructor member whose type
resolves to the package `EventEmitter2` declaration. Parameter properties and one
unique direct constructor assignment are supported. Union types, overridden `@Inject`
tokens, and reassigned receivers emit `INTERACTION_RECEIVER_AMBIGUOUS` and publish no
guessed producer. Same-named local emitters and decorators are ignored.

The producer rules are:

- `event.in-process.event-emitter2.emit.exact.v1`;
- `event.in-process.event-emitter2.emit-async.exact.v1`.

Handlers use the synchronous, asynchronous, or timing-unknown
`event.in-process.on-event.*.exact.v1` rule. A static `{ async: true }` listener is
asynchronous; absent or false `async` is synchronous. Unsupported options remain
unknown and diagnosed.

## Roots, modules, and registration honesty

Every checker-proven `NestFactory.create(RootModule)` becomes an `ApplicationRecord`
and a resolved `APPLICATION_USES_ROOT_MODULE` assertion when the root is a unique
repository `@Module`. Module-import reachability and provider/controller declarations
then classify handlers independently from producers:

| State                  | Meaning                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `proven_registered`    | A root reaches the declaring provider and a supported `EventEmitterModule.forRoot()` registration. |
| `declared_candidate`   | The handler is declared, but no supported root/provider path proves registration.                  |
| `registration_unknown` | No application root exists or relevant root/module/emitter configuration is unsupported.           |

Multiple resolved application roots are retained. An application ID is attached only
when one context is statically unique. A matching handler with a null application
context remains a candidate, but endpoint traces promote database effects only from
`proven_registered` handlers.

Dynamic/spread EventEmitter configuration emits
`EVENT_EMITTER_CONFIGURATION_UNKNOWN`. Unknown handler reachability emits
`EVENT_HANDLER_REGISTRATION_UNKNOWN`. A producer with no local handler is a normal
`none_proven` report state, not an assumed remote consumer or an error.

## Fan-out and causal traversal

`INTERACTION_MATCHES_LOCAL_HANDLER` connects every retained exact or wildcard candidate; multiple
matches are deterministic fan-out, not ambiguity. `HANDLER_IMPLEMENTED_BY` connects
each handler declaration to its method. Neither predicate claims runtime delivery.

Endpoint traces traverse proven local handlers with state
`(method, interaction hop, synchronous depth, causal class)`. Crossing an event edge
increments `maxInteractionHops` and resets ordinary call depth. Fan-out and global
state counts use `maxFanOutPerInteraction` and `maxInteractionTraceStates` from
configuration. Path-aware cycles stop with `INTERACTION_CYCLE_TRUNCATED`; exhausted
bounds emit `INTERACTION_TRACE_LIMIT_REACHED`.

Database terminals remain separate:

- `synchronous` for the endpoint's ordinary call path;
- `local_interaction_synchronous` for a proven synchronous local listener path;
- `local_interaction_asynchronous` for `emitAsync()` or a static async listener.

Handler-rooted traces are also available through `buildInteractionHandlerTrace()` for
consumer-only repositories; no synthetic HTTP endpoint is created. Endpoint trace
`causalSummary` partitions synchronous, local, and distributed-conditional effects,
lists outbound/local interaction IDs, and carries explicit completeness diagnostics.

Existing mutation policy and `dbReads`/`dbWrites` meanings remain synchronous-only.
Control-evidence schema `2.0.0` and OpenAPI `x-api-intel` schema `2.0.0` add separate
`outboundInteractions`, `localInteractions`, and `localCausalEffects`; local handler
writes therefore remain visible without silently changing security/write conclusions.

## Evidence and retained data

Call evidence contains only the emitter callee. Target resolution evidence is
coordinate-only, so payload objects and values are not retained. Canonical output may
contain the normalized event identity, source/handler method IDs, application context,
registration/dispatch state, rule IDs, and repository-relative evidence coordinates.
It never retains event payloads or executes configuration code.

The executable contracts are `test/unit/extractors/nest-event-emitter.test.ts` and
`test/unit/extractors/nest-event-wildcards.test.ts`; source fixtures and semantic
manifests are under `test/fixtures/interactions/`.

## Deliberate boundaries

Dynamic `.on()`/`.once()` listener data flow, payload lineage, class-constructor event
identity, custom emitter wrappers,
Nest microservice transports, raw broker SDKs, retry/delivery semantics, or
cross-repository discovery remain unsupported. BullMQ queues use a separate
open-world contract documented in [BullMQ Queue Interactions](bullmq-interactions.md);
they are never treated as in-process event delivery.
