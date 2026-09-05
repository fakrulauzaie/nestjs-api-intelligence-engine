# Redlock Critical Sections

Analysis v8 preserves the narrow, package-proven Redlock boundary introduced in v7.
It recognizes direct `using()` calls whose method declaration resolves to the
`redlock` package, whose resource list is a bounded array (or immutable const array),
and whose final argument is an inline arrow or function callback. It also projects a
repository caller's inline callback through a bounded wrapper chain when exact
TypeScript symbols prove that the same callable parameter reaches that direct
terminal.

Each structural resource key becomes a `ResourceAccessRecord` with technology
`redlock`, kind `distributed_lock`, and operation `critical_section`. Exact, template,
symbolic, and explicit dynamic key structures use the same redacted target model as
cache and Redis access. The duration, retry settings, callback payloads, credentials,
and runtime values are not retained.

A separate `CriticalSectionRecord` owns the callback scope and lists the exact
canonical method-call, table-access, and resource-access
assertions whose call-site evidence is inside it. Endpoint and independent-handler
traces do not treat these assertions as ordinary synchronous work. They traverse them
as `critical_section_conditional`; a distributed queue or microservice boundary remains
`distributed_conditional`.

Supported:

- direct package-proven `Redlock.using(resources, duration, callback)`;
- the overload with bounded settings before the callback;
- direct and immutable const resource arrays, limited to 16 entries;
- inline arrow and function callbacks;
- callback-contained direct service calls, TypeORM table access, raw SQL, cache, and
  Redis access through the existing extractors;
- direct invocation of a callable wrapper parameter inside a proven `using()`
  callback;
- unchanged positional forwarding of that exact parameter through up to three exact
  repository methods; and
- exact wrapper call sites whose proven callback argument is an inline arrow or
  function expression.

Explicit gaps:

- dynamic, spread, empty, or oversized resource lists;
- callback references and wrapper flows that transform, store, return, schedule,
  spread, alias, or invoke a callback outside the proven scope;
- nested callbacks not themselves proven as the `using()` callback; and
- declaration-only/external wrappers whose implementation is unavailable.

The engine does not use class or method names to identify wrappers, and it exposes no
configuration that can declare one trusted. Automatic proof requires an
in-repository method implementation, exact receiver and parameter symbols, and an
unchanged path to the package terminal. A wrapper-derived scope uses
`resource.redlock.verified-wrapper.v1`, owns a caller-local dynamic lock resource, and
retains call-site, callback-argument, parameter-forwarding, callback-invocation, and
terminal evidence. Dynamic is deliberate: the engine does not copy the inner
method's resource expression into a different method owner.

Analysis is bounded to three forwarding hops, 1,024 flow states, and 16 method-target
candidates. Terminal-connected unsupported callback forms, ambiguous targets,
cycles, and exhausted limits produce respectively
`CRITICAL_SECTION_CALLBACK_FLOW_UNPROVEN`,
`CRITICAL_SECTION_WRAPPER_TARGET_AMBIGUOUS`,
`CRITICAL_SECTION_WRAPPER_CYCLE_TRUNCATED`, or
`CRITICAL_SECTION_WRAPPER_LIMIT_REACHED`. A callback helper with no connection to a
package-proven Redlock terminal produces none of these diagnostics.

An unchanged parameter-forwarding call that is already part of a successful wrapper
proof does not also emit `CRITICAL_SECTION_CALLBACK_FLOW_UNPROVEN`. The call-site
analyzer cannot open that parameter as an inline callback, but the bounded propagation
proof has independently established its exact role in the chain. This suppression is
limited to the same resolved call-expression node. A caller that passes a local
variable, bound method, property reference, or any other non-inline callback still
receives the diagnostic and its callback body remains closed.

These facts report dependency and lexical scope only. They never claim lock
acquisition, exclusivity, contention, timing, callback execution, renewal, or release.
Graph v9 renders the dependency and scope as a dedicated critical-section node.
Wrapper-derived nodes are labeled `verified wrapper critical section`, and the
caller-to-scope edge is labeled `static wrapper callback projection`. Selecting either
shows the bounded call-site, callable-parameter, forwarding, invocation, and package
terminal evidence that collectively supports the projection. The retained snippets
are deliberately limited to symbol-bearing callees and parameter names; argument
values and callback bodies remain omitted. These presentation edges are scope
projections, not invented runtime calls, and the inspector repeats that the path does
not prove acquisition or callback execution.

Endpoint Markdown reports wrapper-derived table effects in the existing
`critical_section_conditional` causal partition. Guard-on-write and write-trace policy
rules continue to evaluate the proven reachable write, including honest unknown or
failure outcomes when guard or trace evidence is incomplete. The independently frozen
control/OpenAPI v5 shape still exports synchronous `dbReads` and `dbWrites` only, so a
wrapper-contained write is not relabeled as synchronous or silently added to those
arrays. Comparison and impact consume the existing resource/terminal projections.
When a wrapper-contained effect is downstream of a BullMQ or Nest microservice
boundary, handler and system reports preserve the dominant
`distributed_conditional` classification.

The real-service acceptance record, including the supported two-hop wrapper and the
retained method-reference negative, is in
[Phase W6 Critical-Section Wrapper Validation](benchmarks/phase-w6-critical-section-wrapper-validation.md).
