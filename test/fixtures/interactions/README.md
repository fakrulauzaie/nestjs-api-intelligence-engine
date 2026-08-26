# Interaction fixture contracts

Fixtures in this directory are TypeScript text, copied into isolated temporary
projects, type-checked, and statically scanned. They are never imported or executed.

`outbound-http.ts.txt` covers the Phase 31 positive, uncertainty, close-negative,
redaction, reachability, and call-depth cases. `outbound-http.expected.json` is a
semantic expectation manifest rather than a frozen canonical-output golden: it fixes
per-method interaction counts, must-not-emit targets, and required diagnostics while
allowing evidence identifiers to remain content-derived.

`nest-http-service.ts.txt` and its manifest define the Phase 32 cold/proven/unknown/
eager activation matrix, symbolic ConfigService/environment identities, immutable and
mutable base flows, receiver negatives, redaction, endpoint reachability, graph
projection, and deterministic-output contract.

`nest-event-emitter.ts.txt` and its manifest freeze the Phase 33 exact-event contract:
multiple roots, static and unknown module configuration, exact string/enum/symbol/array
identity, synchronous/async producers and listeners, proven/candidate/unknown handler
registration, fan-out and traversal limits, cyclic cascades, consumer-only inventory,
payload redaction, same-named lookalikes, and ambiguous/reassigned receiver negatives.

`nest-event-emitter-wildcard.ts.txt` and its manifest define the Phase 34 configured
wildcard contract: exact-plus-pattern fan-out, `*`, zero-or-more `**`, default and
custom delimiters, disabled and dynamic configuration, multiple roots, causal writes,
comparison/impact propagation, synchronous policy isolation, structured exports, and
graph v3 presentation.
