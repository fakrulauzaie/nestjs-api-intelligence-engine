# Endpoint Catalogue

Analysis: `analysis:1126173b1ce46d053395dca1566c4efa`  
Result: `completed_with_gaps`  
Endpoints: 4 of 4

| Method | Path         | Handler                 | Selection | Direct guards | Global guards | Effective state | Evidence                                                                                                       |
| ------ | ------------ | ----------------------- | --------- | ------------- | ------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/users`     | UsersController.findAll | resolved  | none_declared | unknown       | unknown         | src/users/users.controller.ts:14:1<br>src/users/users.controller.ts:23:3<br>src/users/users.controller.ts:24:3 |
| POST   | `/users`     | UsersController.create  | resolved  | none_declared | unknown       | unknown         | src/users/users.controller.ts:14:1<br>src/users/users.controller.ts:18:3<br>src/users/users.controller.ts:19:3 |
| DELETE | `/users/:id` | UsersController.remove  | resolved  | none_declared | unknown       | unknown         | src/users/users.controller.ts:14:1<br>src/users/users.controller.ts:33:3<br>src/users/users.controller.ts:34:3 |
| GET    | `/users/:id` | UsersController.findOne | resolved  | none_declared | unknown       | unknown         | src/users/users.controller.ts:14:1<br>src/users/users.controller.ts:28:3<br>src/users/users.controller.ts:29:3 |

## Diagnostics

- `AUTH_GLOBAL_POLICY_UNKNOWN`: Only direct controller and method @UseGuards declarations are analyzed; global authentication policy is unknown.
- `TYPEORM_SAVE_COLUMNS_UNKNOWN`: Repository.save proves a table write, but exact written columns are not proven.
