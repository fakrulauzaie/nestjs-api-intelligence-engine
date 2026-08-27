# Nest Microservice Interactions

Phase 36 implements a bounded, static view of Nest microservice producers and
controller handlers. It records in-repository delivery candidates and conditional
effects; it does not connect to a broker, simulate routing, or claim delivery.

## Supported producers

The extractor requires a checker-proven `@nestjs/microservices` `ClientProxy` bound
to a constructor member with `@Inject(token)`. A static
`ClientsModule.register([{ name, transport }])` entry in the declaring module binds
that token to one of these inventory-only transports:

- `Transport.TCP`;
- `Transport.REDIS`;
- `Transport.RMQ`; or
- `Transport.KAFKA`.

Direct `client.emit(pattern, payload)` is eager. Direct
`client.send(pattern, payload)` returns a cold Observable and is classified as:

- `proven_activated` when directly bridged by `firstValueFrom`/`lastValueFrom`,
  directly subscribed, or directly returned from a proven Nest route;
- `constructed_cold` when the call is constructed and discarded; or
- `unknown` after an unsupported wrapper, alias, assignment, await, or non-route
  return boundary.

Payloads are never retained. An eager or activated producer proves only initiation,
not broker acceptance, acknowledgement, delivery, handler execution, or completion.

## Patterns and handlers

Supported patterns are bounded JSON-safe values: scalar strings/numbers/booleans,
`null`, arrays, and plain object literals. Immutable one-hop constants are resolved.
Object keys are sorted into canonical JSON, so `{ scope: 'admin', cmd: 'get_user' }`
matches `{ cmd: 'get_user', scope: 'admin' }`. Spreads, calls, functions, computed
keys, cycles, and depth/size limit breaches remain dynamic.

Package-proven controller methods decorated with `@MessagePattern()` or
`@EventPattern()` become independent handler records. Consumer-only repositories
therefore retain useful handler inventory and handler-rooted conditional database
traces. A decorator on a provider is retained as `registration_unknown`; a same-
named local decorator is rejected.

## Application and matching boundary

Supported roots are direct `NestFactory.createMicroservice(root, options)` calls and
the bounded hybrid sequence `NestFactory.create(root)` followed by
`app.connectMicroservice(options)`. Root module and transport must be statically
resolved. Dynamic modules and factories are not executed.

A producer and handler form an in-repository candidate only when all of these are
proven:

1. the communication mode agrees (`emit` ↔ `@EventPattern`, `send` ↔
   `@MessagePattern`);
2. their canonical pattern is equal;
3. they belong to the same resolved application context; and
4. their supported transport is equal.

Event patterns may retain multiple resolved candidates. Multiple request-response
handlers are recorded as `ambiguous` candidates and are deliberately not traversed;
the analyzer does not select or fan out a request handler.

No local candidate is normal for producer-only repositories and produces an
`external_or_unobserved` boundary, not an error. A matching local candidate changes
the boundary to `broker_or_worker_boundary`. Handler table effects remain
`distributed_conditional` in endpoint traces, impact paths, structured exports, and
the graph.

## Diagnostics

- `INTERACTION_TARGET_DYNAMIC`: pattern or client identity is dynamic/unsupported.
- `INTERACTION_RECEIVER_AMBIGUOUS`: the receiver is not uniquely package-proven.
- `MICROSERVICE_TRANSPORT_UNKNOWN`: application/client/handler transport cannot be
  uniquely established.
- `MICROSERVICE_TRANSPORT_MISMATCH`: equal patterns occur under incompatible proven
  transports and are not linked.
- `MICROSERVICE_ACTIVATION_UNKNOWN`: cold `send()` activation crosses an unsupported
  flow boundary.
- `MICROSERVICE_HANDLER_REGISTRATION_UNKNOWN`: handler reachability is not proven.
- `MICROSERVICE_REQUEST_HANDLER_AMBIGUOUS`: more than one request handler candidate
  exists; none is traversed.

These diagnostics produce `completed_with_gaps` when trustworthy facts remain.

## Deliberate exclusions

- broker topology, delivery, acknowledgement, retry, ordering, partition, exchange,
  queue, and consumer-group simulation;
- cross-repository discovery or linking;
- dynamic `ClientsModule` factories, string-built transports, and runtime config;
- custom client wrappers or subclasses, raw broker SDKs, NATS, MQTT, and unsupported
  transports;
- gRPC/protobuf service and method interpretation;
- payload lineage across the broker boundary; and
- arbitrary Observable alias or operator data flow.

The executable contracts are the frozen fixtures under
`test/fixtures/distributed/nest-microservices/` and
`test/unit/extractors/nest-microservices.test.ts`.
