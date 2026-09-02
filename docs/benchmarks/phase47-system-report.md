# Phase 47 System Report Verification

Date: 2026-09-01  
Scope: conditional cross-service graph, proof-only system policies, and report hardening

The focused Phase 47 corpus proves one HTTP root through an explicitly declared RMQ
realm to one `@MessagePattern` candidate and a TypeORM table write. Its no-topology
counterpart retains target equality as non-traversable inventory and produces no
conditional path. Deterministic serialization, display omission accounting, strict
schema validation, offline CSP construction, accessible fallback content, and future
schema rejection are covered by automated tests.

The built CLI was also run through output paths containing spaces against freshly
scanned `ticket-service-example` and `ctt-queue-service-example` artifacts. The result
contains two services, twenty distributed endpoints, three declared-realm candidates,
seven target-only correlations, seven unmatched records, three conditional paths, and
one worker-side `WRITE table apim_log` effect. One path begins at
`POST /mobile/create`; two producer paths have no supported HTTP root. All paths remain
incomplete because source trace diagnostics/depth limits are retained. Nine
`require-declared-realm-candidate` policy failures describe other missing declared
candidates; they are not runtime delivery failures.

The CTT wrapper pattern is resolved through `nest.call.same-class-method.v1` and the
bounded `nest.call.bound-callback-forward.v1` rule. The latter requires a
TypeChecker-resolved bound injected-member method and direct invocation of the
corresponding same-class wrapper parameter. A negative fixture proves that merely
retaining the callback creates no forwarded edge.

Static artifact checks found no HTTP, HTTPS, or protocol-relative resources, no
closing-script sequence in embedded JSON, and a CSP with `connect-src 'none'` plus
hash-authorized scripts/styles. The report uses a relative-positioned Cytoscape
container and does not override wheel sensitivity. User verification confirmed that
the offline page loads and correlation navigation works, and identified excessive
zoom from applying force-directed repulsion to all disconnected compound children.
The corrected default view contains the seven edge-connected leaves plus their three
compound parents rather than all twenty-six inventory nodes. An executable headless
Cytoscape test proves disconnected inventory starts hidden, producer/broker/consumer
compounds are ordered left-to-right, and **All interactions** restores every node.
The in-app browser's URL security policy still rejects local `file://` navigation; no
alternative automation surface was used to bypass that policy.

The final single-worker repository suite passed 138 files and 355 tests in 239.80
seconds. Typecheck, production build, ESLint with zero warnings, and formatting checks
also passed.
