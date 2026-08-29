# Authorization Metadata and Composite Decorators

Analysis v5 inventories supported NestJS authorization metadata without treating the
metadata itself as guard enforcement. It keeps three facts separate: an endpoint has
metadata, an endpoint/application has a guard declaration, and a supported relationship
exists between the metadata and guard.

## Supported source forms

The extractor recognizes checker-proven imports of `SetMetadata`, `applyDecorators`,
and `UseGuards` from `@nestjs/common`. A repository wrapper may be a function or
arrow/function-expression variable whose body is one direct expression or one direct
return. It may return either:

```ts
SetMetadata('roles', roles);
```

or a composite:

```ts
applyDecorators(SetMetadata('roles', roles), UseGuards(AuthGuard));
```

A composite is discovered without configuration when the metadata key is static and
every nested guard expression resolves to exactly one repository class. Direct
`SetMetadata()` and non-composite wrappers require an exact configured metadata key or
decorator symbol. Same-named local framework lookalikes are ignored.

## Redaction and states

Metadata values are not stored. Canonical records retain only one of these shapes:

- scalar type (`string`, `number`, `boolean`, or `null`);
- array item count, observed scalar item types, and whether dynamic items exist;
- object property keys and whether dynamic keys exist; or
- `unknown`.

Every shape is marked `redacted: true`. Dynamic shape produces
`AUTHORIZATION_METADATA_VALUE_DYNAMIC` without exposing the expression value.

Each metadata record has exactly one or more explicit enforcement relationships:

- `proven_enforced`: one package-proven composite co-declares the metadata and exact
  guard;
- `configured_relationship`: exact project configuration relates the metadata key to
  an already proven repository guard declaration; or
- `enforcement_unknown`: no supported exact relationship was established.

These are static declaration states. They do not prove authentication, runtime guard
registration/execution, authorization success, or access denial.

Application-global guards are considered only when their registration module and the
endpoint controller are reachable from the same statically resolved Nest bootstrap
root. A same-module declaration remains a bounded fallback when bootstrap code is not
present. A global guard discovered in a separate application root is never credited to
the endpoint.

## Exact configuration

Authorization configuration requires project configuration version 4. Package symbols
use `moduleSpecifier` plus `exportedName`; repository symbols use normalized
`sourceFile` plus `exportedName`. Enforcement guards must be repository exports. Bare
decorator or guard names are invalid. See [Project Configuration](project-configuration.md)
for the complete JSON form.

## Policies and reports

`require-proven-authorization-enforcement` passes only when every supported requirement
on an endpoint is `proven_enforced`. Configured and unknown relationships remain the
policy outcome `unknown`; endpoints without supported metadata are not applicable.

`require-guard-on-write-endpoint` remains independent. Metadata alone cannot satisfy
it. A configured relationship can coexist with a proven ordinary guard declaration,
so the guard rule may pass while authorization enforcement stays configured/unknown.

Endpoint catalogues, Markdown traces, comparison v4, control/OpenAPI v5, and graph v6
show metadata keys, scopes, redacted shapes, states, and exact guard names where
available. They never render metadata values.

## Unsupported boundary

Dynamic metadata keys, arbitrary wrapper statements/control flow, factories returning
guards, inherited decorators, reflection, generic decorator data-flow, runtime module
composition, and semantic interpretation of unconfigured custom decorators are outside
the bounded contract. Unsupported patterns are not guessed from names.
