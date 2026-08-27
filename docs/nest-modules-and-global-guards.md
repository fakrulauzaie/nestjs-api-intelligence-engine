# Nest Modules and Effective Guard State

The bounded static NestJS module graph and evidence-backed application-global guard
registrations were introduced in analysis schema `2.0.0` and remain part of current
schema `3.0.0`. The analyzer never imports or executes a target module, calls a
dynamic module factory, or starts Nest.

## Static module boundary

The extractor recognizes checker-resolved `Module` and `Global` decorators from
`@nestjs/common`. The `Module` argument must be an object literal. `imports`,
`providers`, `exports`, and `controllers` support direct arrays, direct repository
class references, one-hop unmodified local `const` arrays, bounded spreads of those
arrays, and direct `forwardRef(() => ModuleClass)` references.

The v2 graph uses these predicates and rules:

| Predicate                    | Rule                           | Meaning                                                 |
| ---------------------------- | ------------------------------ | ------------------------------------------------------- |
| `MODULE_IMPORTS_MODULE`      | `nest.module.import.v1`        | A module directly imports a proven repository module.   |
| `MODULE_PROVIDES_CLASS`      | `nest.module.provider.v1`      | A module directly provides a proven repository class.   |
| `MODULE_EXPORTS_CLASS`       | `nest.module.export-class.v1`  | A module exports a proven repository class.             |
| `MODULE_EXPORTS_MODULE`      | `nest.module.export-module.v1` | A module re-exports a proven repository module.         |
| `MODULE_DECLARES_CONTROLLER` | `nest.module.controller.v1`    | A module declares a proven repository controller class. |

Module records preserve `isGlobal` and `metadataCompleteness`. The derived visibility
resolver computes own, imported, re-exported, and global provider classes using a
cycle-safe fixed point. It is a view over canonical assertions and creates no new
facts.

Dynamic module calls such as `forRoot()`/`forRootAsync()`, mutated or multi-hop const
arrays, computed metadata, arbitrary factories, unsupported provider shapes, and
unresolved class references emit `NEST_MODULE_METADATA_UNRESOLVED` or a more specific
global-guard diagnostic. No dynamic value is evaluated and no likely edge is guessed.

## Proven global registrations

The supported `APP_GUARD` forms require the checker-proven token exported by
`@nestjs/core`:

- `{ provide: APP_GUARD, useClass: GuardClass }`;
- `{ provide: APP_GUARD, useExisting: GuardClass }` when that class is a direct
  provider in the same statically resolved module; and
- direct `app.useGlobalGuards(new GuardClass(...))` calls when `app` is uniquely bound
  to `NestFactory.create(RootModule)` and neither the call nor application binding
  crosses the supported direct-call boundary.

Canonical registration records retain the module, guard, registration kind, evidence,
supporting assertion, and a contiguous deterministic order. Provider-array and
`useGlobalGuards(...)` argument order is retained. Across independent modules/files,
the canonical order is deterministic inventory order; it is not a claim about runtime
initialization order between unrelated Nest application graphs.

`useFactory`, `useValue`, duplicate/conflicting strategies, conditional registration,
application aliases or escapes, computed/spread provider objects, and unresolved guard
classes emit `NEST_GLOBAL_GUARD_UNRESOLVED` or
`NEST_BOOTSTRAP_GUARD_UNRESOLVED`. They make global analysis incomplete and do not
produce a registration.

## State interpretation

The canonical global state is:

| State         | Interpretation                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `declared`    | At least one supported application-global guard registration is proven. Other unresolved registrations may still exist. |
| `none_proven` | A complete scan of the supported boundary found no supported global guard registration.                                 |
| `unknown`     | No supported registration is proven and module/bootstrap completeness is insufficient to claim `none_proven`.           |

Endpoint catalogue and trace views expose direct guards, proven global guards, and:

- `guard_declared` when a supported direct or global guard is present;
- `no_supported_guard_proven` when direct guards are absent and the supported global
  scan is complete with `none_proven`; or
- `unknown` when global completeness is insufficient.

These are guard-declaration states, not authentication classifications.
`no_supported_guard_proven` never means `public`, unauthenticated, or unprotected, and
a declared guard is not automatically an authentication or authorization guard.

## Compatibility

New scans publish analysis schema `3.0.0`. The strict `1.0.0` and `2.0.0` schemas
remain unchanged and readable. When a v1 analysis is consumed, module facts are unavailable and global
and effective guard state remains `unknown`; absence is never migrated to
`none_proven`. Comparison accepts both versions and records effective guard facts as
unavailable for v1 and available for v2/v3.

Analysis v2/v3 cannot be losslessly downgraded to v1. Unknown analysis versions fail
closed at the schema boundary.
