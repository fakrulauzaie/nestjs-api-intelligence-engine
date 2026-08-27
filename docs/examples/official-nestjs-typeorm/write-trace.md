# Endpoint Trace

> Historical Phase 11 output. See [`../current/write-trace.md`](../current/write-trace.md)
> for the current v3 report shape.

Analysis: `analysis:1126173b1ce46d053395dca1566c4efa`  
Endpoint: `POST /users`  
Direct guards: `none_declared`  
Global guards: `unknown`  
Effective guard state: `unknown`

## Guards

No supported effective guard declaration was found. This is not proof that the endpoint is public or unprotected.

## Trace steps

| From                   | Relation                | To                     | Status   | Evidence                                                                                                                                                                             |
| ---------------------- | ----------------------- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST /users            | ENDPOINT_IMPLEMENTED_BY | UsersController.create | resolved | declaration src/users/users.controller.ts:19:3<br>decorator src/users/users.controller.ts:14:1<br>decorator src/users/users.controller.ts:18:3                                       |
| UsersService.create    | METHOD_WRITES_TABLE     | user                   | resolved | decorator src/users/user.entity.ts:3:1<br>resolution_basis src/users/users.service.ts:10:5<br>declaration src/users/user.entity.ts:4:1<br>call_site src/users/users.service.ts:19:12 |
| UsersController.create | METHOD_CALLS_METHOD     | UsersService.create    | resolved | resolution_basis src/users/users.controller.ts:16:15<br>call_site src/users/users.controller.ts:20:12                                                                                |

## Table access

| Method              | Direction | Table |
| ------------------- | --------- | ----- |
| UsersService.create | WRITE     | user  |

## Diagnostics

- `TYPEORM_SAVE_COLUMNS_UNKNOWN`: Repository.save proves a table write, but exact written columns are not proven. Evidence: `call_site src/users/users.service.ts:19:12`.

## Limitations

- `AUTH_GLOBAL_POLICY_UNKNOWN`: Only direct controller and method @UseGuards declarations are analyzed; global authentication policy is unknown.
