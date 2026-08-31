# Phase 43 Resource-Access Verification

Phase 43 introduces analysis v6 resource facts without broadening interaction
semantics. The frozen fixture is source text only and is never imported or evaluated.

Verified contracts:

- package-proven `cache-manager` and direct `ioredis` calls only;
- exact, template, symbolic, and dynamic structural targets;
- value and callback-payload redaction from canonical output;
- bounded multi-key deletes and scan selectors;
- explicit unsupported-operation and dynamic-target diagnostics;
- endpoint and independent interaction-handler resource terminals;
- deterministic analysis v6 serialization and integrity validation;
- comparison v5 endpoint resource changes and impact reachability; and
- graph v8 endpoint, handler, and architecture resource nodes.

Pipelines, transactions, scripts, pub/sub, arbitrary wrappers, execution claims, and
lock semantics remain outside this phase.

Verification completed on 2026-08-30. The focused resource suite passed both the
direct/event corpus and branch-filtered BullMQ worker case. The complete single-worker
regression passed 127 files and 326 tests; typecheck, production build, lint with zero
warnings, and formatting checks passed. These are correctness gates, not performance
promises.
