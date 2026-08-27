# Endpoint Trace

Analysis: `<run-specific-analysis-id>`  
Endpoint: `GET /notes`  
Direct guards: `none_declared`  
Global guards: `unknown`  
Effective guard state: `unknown`

## Guards

No supported effective guard declaration was found. This is not proof that the endpoint is public or unprotected.

## Trace steps

| From | Relation | To | Status | Evidence |
|---|---|---|---|---|
| GET /notes | ENDPOINT_IMPLEMENTED_BY | NotesController.findAll | resolved | declaration src/notes/notes.controller.ts:28:3<br>decorator src/notes/notes.controller.ts:12:1<br>decorator src/notes/notes.controller.ts:27:3 |
| NotesService.findAll | METHOD_READS_TABLE | note | resolved | declaration src/notes/entities/note.entity.ts:4:1<br>decorator src/notes/entities/note.entity.ts:3:1<br>resolution_basis src/notes/notes.service.ts:11:5<br>call_site src/notes/notes.service.ts:25:12 |
| NotesController.findAll | METHOD_CALLS_METHOD | NotesService.findAll | resolved | call_site src/notes/notes.controller.ts:29:12<br>resolution_basis src/notes/notes.controller.ts:15:5 |

## Causal summary

Synchronous effects: 1  
Local interaction effects: 0  
Distributed conditional effects: 0  
Outbound interactions: 0  
Local interactions: 0  
Completeness: incomplete (AUTH_GLOBAL_POLICY_UNKNOWN)

## Table access

| Method | Direction | Table | Causal class |
|---|---|---|---|
| NotesService.findAll | READ | note | synchronous |

## Diagnostics

None.

## Limitations

- `AUTH_GLOBAL_POLICY_UNKNOWN`: Static module/bootstrap analysis is incomplete; additional global guard declarations may exist.
