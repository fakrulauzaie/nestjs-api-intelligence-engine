# Redlock Critical Sections

Analysis v7 models a narrow, package-proven Redlock boundary. It recognizes direct
`using()` calls whose method declaration resolves to the `redlock` package, whose
resource list is a bounded array (or immutable const array), and whose final argument
is an inline arrow or function callback.

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
- inline arrow and function callbacks; and
- callback-contained direct service calls, TypeORM table access, raw SQL, cache, and
  Redis access through the existing extractors.

Explicit gaps:

- dynamic, spread, empty, or oversized resource lists;
- callback references and arbitrary wrapper methods;
- nested callbacks not themselves proven as the `using()` callback; and
- custom lock abstractions (Gate L0).

These facts report dependency and lexical scope only. They never claim lock
acquisition, exclusivity, contention, timing, callback execution, renewal, or release.
Graph v9 renders the dependency and scope as a dedicated critical-section node.
