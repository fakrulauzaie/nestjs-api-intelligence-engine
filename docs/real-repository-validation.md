# Real Repository Validation

> **Historical validation record (2026-08-17).** This document and its generated
> outputs describe the Phase 11 analyzer, not the current report shape or supported
> feature set. Use [Supported Static-Analysis Patterns](supported-patterns.md) for
> current capability and [`examples/current/`](examples/current/) for current v3
> output. The record below is preserved as evidence of what was verified at that time.

## Target and selection

Phase 11 was validated on the official
[NestJS SQL TypeORM sample](https://github.com/nestjs/nest/tree/841df8792fbedd1fbba12c9fe999aee307a155c7/sample/05-sql-typeorm)
at commit `841df8792fbedd1fbba12c9fe999aee307a155c7` on 2026-08-17.

It is independent of this project's synthetic fixture and fits the MVP boundary:

- one NestJS application and primary `tsconfig.json`;
- standard `Controller`, `Get`, `Post`, and `Delete` decorators;
- `UsersController` constructor-injecting `UsersService`;
- `UsersService` using `InjectRepository(User)` and `Repository<User>`;
- `find`, `findOneBy`, `save`, and `delete` operations;
- no custom route layer, dynamic module requirement, or QueryBuilder on the demo paths.

The sample has no direct `UseGuards` declaration. That was accepted because direct
guards are optional in the selection criteria, and the result explicitly retains
`AUTH_GLOBAL_POLICY_UNKNOWN` rather than calling an endpoint public.

## Reproduction commands

The automated equivalent is `pnpm run demo`. The manual setup used a sparse checkout
and never started the target application:

```powershell
git clone --filter=blob:none --no-checkout https://github.com/nestjs/nest.git .demo/reference-nest
git -C .demo/reference-nest sparse-checkout set sample/05-sql-typeorm
git -C .demo/reference-nest checkout --detach 841df8792fbedd1fbba12c9fe999aee307a155c7
pnpm --dir .demo/reference-nest/sample/05-sql-typeorm install --ignore-workspace --ignore-scripts
pnpm run build
pnpm run cli -- scan .demo/reference-nest/sample/05-sql-typeorm --output .demo/official-nest-output
```

No target `start`, `build`, `test`, database, or Docker command was invoked.

## Catalogue audit

All four detected entries were compared with `src/users/users.controller.ts`:

| Endpoint            | Handler                   | Route evidence                                             | Manual result |
| ------------------- | ------------------------- | ---------------------------------------------------------- | ------------- |
| `POST /users`       | `UsersController.create`  | controller line 14, decorator line 18, declaration line 19 | Exact         |
| `GET /users`        | `UsersController.findAll` | controller line 14, decorator line 23, declaration line 24 | Exact         |
| `GET /users/:id`    | `UsersController.findOne` | controller line 14, decorator line 28, declaration line 29 | Exact         |
| `DELETE /users/:id` | `UsersController.remove`  | controller line 14, decorator line 33, declaration line 34 | Exact         |

There were no missing or extra supported endpoints, and every selector was unique.

## Read trace audit

Selected endpoint: `GET /users/:id`.

| Trace step                                             | Generated evidence                                                                                                                                            | Source comparison                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Endpoint implemented by `UsersController.findOne`      | controller decorator `src/users/users.controller.ts:14:1`; `Get` decorator `:28:3`; method declaration `:29:3`                                                | Exact controller prefix, method path, and handler declaration     |
| `UsersController.findOne` calls `UsersService.findOne` | constructor binding `src/users/users.controller.ts:16:15`; call site `:30:12`                                                                                 | Exact injected member and direct call                             |
| `UsersService.findOne` reads table `user`              | entity decorator `src/users/user.entity.ts:3:1`; entity declaration `:4:1`; repository injection `src/users/users.service.ts:10:5`; `findOneBy` call `:27:12` | Exact entity, binding, read operation, and default table fallback |

The terminal is `UsersService.findOne -> READ user`. Every step and every emitted
evidence location was inspected; no correction was needed.

## Write trace audit

Selected endpoint: `POST /users`.

| Trace step                                           | Generated evidence                                                                                                                                       | Source comparison                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Endpoint implemented by `UsersController.create`     | controller decorator `src/users/users.controller.ts:14:1`; `Post` decorator `:18:3`; method declaration `:19:3`                                          | Exact controller prefix and handler               |
| `UsersController.create` calls `UsersService.create` | constructor binding `src/users/users.controller.ts:16:15`; call site `:20:12`                                                                            | Exact injected member and direct call             |
| `UsersService.create` writes table `user`            | entity decorator `src/users/user.entity.ts:3:1`; entity declaration `:4:1`; repository injection `src/users/users.service.ts:10:5`; `save` call `:19:12` | Exact entity, binding, write operation, and table |

The terminal is `UsersService.create -> WRITE user`. The analyzer correctly emits
`TYPEORM_SAVE_COLUMNS_UNKNOWN`: assignments to `firstName` and `lastName` are visible,
but `save()` alone does not prove the exact SQL column set.

The `DELETE /users/:id` report was also checked. It terminates at
`UsersService.remove -> WRITE user`, with the `delete` call at
`src/users/users.service.ts:31:11`.

## Observed limitations and disposition

| Source pattern                                  | Phase 11 analyzer behavior                        | Historical disposition                  |
| ----------------------------------------------- | ------------------------------------------------- | --------------------------------------- |
| No direct guard declarations                    | `none_declared` plus `AUTH_GLOBAL_POLICY_UNKNOWN` | Correct P0 uncertainty; no public claim |
| `Repository.save(user)` after DTO assignments   | Table write plus `TYPEORM_SAVE_COLUMNS_UNKNOWN`   | Correct table-level precision           |
| `Body`, `Param`, `ParseIntPipe`, and DTO fields | Not modeled as facts                              | Documented P1 boundary                  |
| Nest module and database configuration          | Not modeled as endpoint trace facts               | Documented P0 boundary                  |

No false positive, missing supported fact, invalid evidence reference, or in-scope
extractor defect was found. Consequently, no production rule was broadened and no
regression fixture was required from this validation run.

## Fresh-install verification

A dependency-free temporary copy containing only package metadata, TypeScript
configuration, and `src/` was used to verify the documented release path:

1. `pnpm install --frozen-lockfile` installed 174 packages from the project lockfile.
2. `pnpm run build` produced the CLI from source.
3. The fresh CLI scanned the pinned official sample without running it.
4. It produced four endpoints, four traces, and the same two diagnostics.
5. Its canonical `analysis.json` SHA-256 was
   `A3DB1223A91B4E2D002DD84DB04604D37603F645466B4A29E0732CFACD0194F2`,
   byte-identical to the main-workspace demo output.

The temporary verification directory was removed after the comparison.

## Result

- Result state: `completed_with_gaps`
- Endpoints: 4
- Complete table traces: 4
- Diagnostics: `AUTH_GLOBAL_POLICY_UNKNOWN`, `TYPEORM_SAVE_COLUMNS_UNKNOWN`
- Target application executions: 0

Sanitized output is stored under
[examples/official-nestjs-typeorm](examples/official-nestjs-typeorm/).
