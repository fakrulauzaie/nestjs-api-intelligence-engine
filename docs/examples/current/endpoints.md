# Endpoint Catalogue

Analysis: `<run-specific-analysis-id>`  
Result: `completed_with_gaps`  
Endpoints: 7 of 7

| Method | Path | Handler | Selection | Direct guards | Global guards | Effective state | Authorization metadata | Evidence |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | AppController.getHello | resolved | none_declared | unknown | unknown | none_proven | src/app.controller.ts:4:1<br>src/app.controller.ts:8:3<br>src/app.controller.ts:9:3 |
| GET | `/admin/notes/count` | AdminNotesController.count | resolved | controller: AuthGuard<br>method: AuditGuard | unknown | guard_declared | none_proven | src/notes/admin-notes.controller.ts:11:3<br>src/notes/admin-notes.controller.ts:13:3<br>src/notes/admin-notes.controller.ts:6:1 |
| GET | `/notes` | NotesController.findAll | resolved | none_declared | unknown | unknown | none_proven | src/notes/notes.controller.ts:12:1<br>src/notes/notes.controller.ts:27:3<br>src/notes/notes.controller.ts:28:3 |
| POST | `/notes` | NotesController.create | resolved | none_declared | unknown | unknown | none_proven | src/notes/notes.controller.ts:12:1<br>src/notes/notes.controller.ts:21:3<br>src/notes/notes.controller.ts:22:3 |
| DELETE | `/notes/:id` | NotesController.remove | resolved | method: AuthGuard | unknown | guard_declared | none_proven | src/notes/notes.controller.ts:12:1<br>src/notes/notes.controller.ts:39:3<br>src/notes/notes.controller.ts:41:3 |
| GET | `/notes/archived` | NotesController.findArchived | resolved | none_declared | unknown | unknown | none_proven | src/notes/notes.controller.ts:12:1<br>src/notes/notes.controller.ts:33:3<br>src/notes/notes.controller.ts:34:3<br>src/notes/notes.controller.ts:9:7 |
| PUT | `/notes/legacy/:id` | NotesController.updateLegacy | resolved | none_declared | unknown | unknown | none_proven | src/notes/notes.controller.ts:12:1<br>src/notes/notes.controller.ts:47:3<br>src/notes/notes.controller.ts:48:3 |

## Diagnostics

- `AUTH_GLOBAL_POLICY_UNKNOWN`: Static module/bootstrap analysis is incomplete; additional global guard declarations may exist.
- `DI_TOKEN_UNSUPPORTED`: Injection token for LegacyNotifierService.sink is outside class-only constructor injection.
- `NEST_MODULE_METADATA_UNRESOLVED`: Module import TypeOrmModule.forFeature([Note]) is dynamic or not a proven repository @Module class.
- `NEST_MODULE_METADATA_UNRESOLVED`: Module import TypeOrmModule.forRoot({
      type: 'better-sqlite3' as any,
      database: 'db.sqlite',
      entities: [Note, AuditRecord],
      synchronize: true, // Only for development/testing
    }) is dynamic or not a proven repository @Module class.
- `NEST_ROUTE_DYNAMIC`: Unsupported computed route path on NotesController.computedStatus.
- `TYPEORM_OPERATION_UNSUPPORTED`: TypeORM repository operation preload is outside the supported read/write catalogue.
- `TYPEORM_SAVE_COLUMNS_UNKNOWN`: Repository.save proves a table write, but exact written columns are not proven.
