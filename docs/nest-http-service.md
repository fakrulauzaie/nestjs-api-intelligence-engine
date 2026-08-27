# Nest HttpService and Symbolic Targets

Nest `HttpService` analysis extends `outbound_http` to checker-proven
`@nestjs/axios` `HttpService` receivers. Unlike direct Axios and `fetch`, an
`HttpService` method creates a cold RxJS Observable; creating it does not by itself
initiate a network request. Canonical activation state preserves that distinction.

The analyzer remains static. It never subscribes, imports target modules, reads
configuration/environment values, starts NestJS, or sends a request.

## Receiver proof

A supported receiver is a constructor parameter whose declared type resolves to the
package `HttpService` class and which becomes either:

- a constructor parameter property, regardless of its local/member name; or
- one unique direct constructor assignment to a class member.

The owning class must be a checker-proven Nest controller or injectable provider.
Import aliases are supported. Union/ambiguous types, overridden `@Inject()` tokens,
and members reassigned after construction are diagnosed and do not produce a guessed
interaction. Same-named local services are ignored.

The supported cold methods are `get`, `post`, `put`, `patch`, `delete`, `head`,
`options`, and `request`. A proven `HttpService.axiosRef` callable or method uses the
Phase 31 Axios request rules and remains `eager`.

## Activation states

| Source shape                                                                                     | Canonical activation |
| ------------------------------------------------------------------------------------------------ | -------------------- |
| `firstValueFrom(http.get(...))` or `lastValueFrom(...)`                                          | `proven_activated`   |
| `http.get(...).subscribe()` including supported `.pipe()`                                        | `proven_activated`   |
| Direct Observable return from a proven Nest route handler                                        | `proven_activated`   |
| Standalone call or `.pipe()` with no supported activation                                        | `constructed_cold`   |
| Stored, reassigned, awaited, returned from a non-route, or passed through an unsupported wrapper | `unknown`            |
| `http.axiosRef.get(...)` or callable `axiosRef(...)`                                             | `eager`              |

Only package-proven RxJS `firstValueFrom`, `lastValueFrom`, `Observable.pipe`, and
`Observable.subscribe` participate. `.pipe()` retains the underlying producer but is
not itself activation. Nested callbacks are not executed or followed, and arbitrary
cross-variable subscription tracking is deliberately absent. Unknown activation emits
`OUTBOUND_HTTP_ACTIVATION_UNKNOWN`.

`proven_activated` means only that a supported subscription/bridge is statically
visible. It does not prove request completion, response consumption, status, or
success.

## Symbolic target construction

Phase 32 stores configuration identity, never configuration values:

- `configService.get('PAYMENT_URL')` becomes `{config:PAYMENT_URL}`;
- `process.env.AUTH_SERVICE_URL` becomes `{env:AUTH_SERVICE_URL}`;
- templates and `+` concatenations preserve those symbolic bases plus static paths
  and numbered runtime placeholders.

For example,
`` `${this.paymentBase}/charges/${id}?token=${token}` `` can become
`{config:PAYMENT_URL}/charges/{0}` with query key `token`. The query value is not
retained.

Symbolic bases may flow through immutable constants, readonly property initializers,
or one unique direct constructor assignment. Mutable/reassigned properties, dynamic
configuration keys, arbitrary calls, cycles, and unsupported object flow become a
dynamic target rather than a guessed service. The evaluator is bounded to eight
expression levels, 32 composed parts, 20 template substitutions, 2,048 target code
points, and 128 code points per accepted token identity.

Target gaps reuse `OUTBOUND_HTTP_TARGET_DYNAMIC`,
`OUTBOUND_HTTP_TARGET_LIMIT_EXCEEDED`, and
`OUTBOUND_HTTP_CONFIG_UNSUPPORTED`. Configuration tokens accept a conservative static
identifier/path alphabet; environment keys use conventional identifier syntax.

## Evidence and retained data

Each interaction has a resolved `METHOD_INITIATES_INTERACTION` assertion, a safe
callee-only call-site snippet, and coordinate-only target/activation evidence.
Canonical output may retain HTTP method, sanitized exact/template/symbolic target,
query-key names, activation, boundary, rule ID, and source coordinates.

It never retains URL userinfo, fragments, query values, headers, bodies, cookies,
response data, `.env` contents, `ConfigService` return values, or live
`process.env` values.

## Derived views and boundaries

Endpoint traces, catalogue Markdown, and graph scenes expose target resolution and
activation independently. Graph v3 separates activation/timing on the interaction
node from resolution on the external-target node. Semantic comparison keys use the
normalized target identity; diff schema `2.0.0` reports activation, boundary, timing,
and rule changes as explicit interaction modifications.

This phase does not implement general RxJS data flow, custom operators, stored
Observable alias tracking, custom HTTP wrappers, response lineage, SDK semantics,
EventEmitter, queues, or microservices. The executable contract is
`test/unit/extractors/nest-http-service.test.ts` and the non-executable fixture under
`test/fixtures/interactions/`.
