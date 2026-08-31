# Endpoint Trace

Analysis: `<run-specific-analysis-id>`  
Endpoint: `POST /notes`  
Direct guards: `none_declared`  
Global guards: `unknown`  
Effective guard state: `unknown`

## Guards

No supported effective guard declaration was found. This is not proof that the endpoint is public or unprotected.

## Authorization metadata

No supported authorization metadata declaration was proven.

## Trace steps

| From | Relation | To | Status | Evidence |
|---|---|---|---|---|
| POST /notes | ENDPOINT_IMPLEMENTED_BY | NotesController.create | resolved | decorator src/notes/notes.controller.ts:12:1<br>declaration src/notes/notes.controller.ts:22:3<br>decorator src/notes/notes.controller.ts:21:3 |
| NotesController.create | METHOD_CALLS_METHOD | NotesService.create | resolved | call_site src/notes/notes.controller.ts:23:12<br>resolution_basis src/notes/notes.controller.ts:15:5 |
| NotesService.create | METHOD_CALLS_METHOD | NotesFormatterService.normalize | resolved | call_site src/notes/notes.service.ts:17:28<br>resolution_basis src/notes/notes.service.ts:13:5 |
| NotesService.create | METHOD_WRITES_TABLE | note | resolved | declaration src/notes/entities/note.entity.ts:4:1<br>call_site src/notes/notes.service.ts:18:12<br>decorator src/notes/entities/note.entity.ts:3:1<br>resolution_basis src/notes/notes.service.ts:11:5 |

## Causal summary

Synchronous effects: 1  
Local interaction effects: 0  
Critical-section conditional effects: 0<br>
Distributed conditional effects: 0  
Outbound interactions: 0  
Local interactions: 0  
Completeness: incomplete (AUTH_GLOBAL_POLICY_UNKNOWN)

## Table access

| Method | Direction | Table | Causal class |
|---|---|---|---|
| NotesService.create | WRITE | note | synchronous |

## Non-relational resource access

No supported cache or Redis access was reached.

## Diagnostics

None.

## Limitations

- `AUTH_GLOBAL_POLICY_UNKNOWN`: Static module/bootstrap analysis is incomplete; additional global guard declarations may exist.
