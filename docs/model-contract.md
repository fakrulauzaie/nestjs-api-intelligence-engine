# Canonical Model Contract

This document records the Phase 2 contracts that future extractors and reporters must
use. The TypeScript types and Zod schemas in `src/model/` are authoritative.

## Canonical and volatile documents

`analysis.json` is represented by `AnalysisDocument`. It contains repository-relative
paths, semantic records, assertions, evidence, and diagnostics. It must not contain
absolute checkout paths, timestamps, durations, or other machine-specific values.

`run.json` is represented by `RunDocument`. It may contain an absolute input path,
timestamps, and duration. `normalizeRunForComparison()` removes these volatile fields
before repeatability comparisons.

Endpoint trace files are derived views represented by `EndpointTraceView`. They do not
replace or add facts to `AnalysisDocument`.

## Stable identities

All IDs use `<kind>:<32 lowercase hexadecimal characters>`. Their hashes are derived
only from normalized semantic identity components. Repository revision may be included;
timestamps and display labels are not.

Important identity inputs include:

- source: repository revision and normalized repository-relative path;
- class: revision, source path, and qualified name;
- method: revision, source path, qualified class name, method name, and signature;
- endpoint: revision, normalized HTTP method/path, and handler method ID;
- evidence: source file ID, exact range, evidence role, and source content hash;
- assertion: subject, predicate, target, and deterministic rule ID;
- module: its canonical class ID;
- global guard registration: module, guard, kind, and registration evidence;
- QueryBuilder literal table: normalized literal table name plus
  `query_builder_literal` provenance;
- raw-SQL physical table: PostgreSQL-normalized qualified name plus
  `raw_sql_literal` provenance;
- contract type: normalized source path plus qualified class/interface name;
- contract field: effective contract type plus property name;
- request parameter: method, parameter index, and supported Nest source kind;
- response contract: handler method; and
- entity column: effective entity, declaring class, and property name.

The integrity validator rejects repeated IDs. It distinguishes an identical duplicate
from an unequal-content stable-ID collision; neither is silently overwritten.

## Assertions and uncertainty

Assertions use one of four statuses:

- `resolved`: one supported target is proven;
- `ambiguous`: the assertion represents one plausible target among multiple candidates;
- `unresolved`: a target should exist but cannot be found;
- `unsupported`: source exists, but the construct is outside a supported rule.

Resolved and ambiguous assertions require a non-null `objectId`. Unresolved and
unsupported assertions may use `null` rather than inventing a placeholder object. All
resolved assertions require at least one evidence record. Unsupported conditions may
also be represented by diagnostics when no relationship can be stated honestly.

Assertion predicate subject/target kinds are fixed and checked during integrity
validation. For example, `ENDPOINT_IMPLEMENTED_BY` must connect an endpoint to a
method, and `ENTITY_MAPS_TO_TABLE` must connect a TypeORM entity record to a table.

Direct NestJS guard facts use `ENDPOINT_USES_GUARD`. The deterministic rule IDs
`nest.guard.controller.v1` and `nest.guard.method.v1` preserve declaration scope.
Only TypeChecker-resolved `@nestjs/common` `UseGuards` calls whose arguments resolve to
repository class declarations are supported. A same-named local decorator or a guard
factory is not treated as guard metadata. Endpoint views use `none_declared` only when
no supported direct guard fact exists. They expose `AUTH_GLOBAL_POLICY_UNKNOWN` when
the bounded global scan is incomplete; they never infer that an endpoint is public.

Analysis v2 adds module relationship predicates and evidence-linked global guard
registration records. Derived endpoint state distinguishes `declared`, `none_proven`,
and `unknown` global analysis, then combines supported global, controller, and method
guards. `none_proven` and `no_supported_guard_proven` are bounded negative results,
not public/authentication claims. Analysis v1 remains strict and readable; its missing
module/global families normalize to unavailable/unknown rather than empty proof.

Analysis v2 also accepts `query_builder_literal` and `raw_sql_literal` as
`TableRecord.nameSource` values.
Entity-derived `explicit`/`default_lowercase_class_name` table IDs remain unchanged;
literal targets use provenance-qualified IDs so same-named entity, QueryBuilder, and
raw-SQL tables are not silently merged. Analysis v1 retains its frozen two-value table
source vocabulary and rejects the v2-only `configuration.rawSql` envelope.

Analysis v2 adds declared contract and entity-column record families plus the
`METHOD_DECLARES_REQUEST_PARAMETER`, `METHOD_DECLARES_RESPONSE`,
`CONTRACT_TYPE_DECLARES_FIELD`, and `ENTITY_DECLARES_COLUMN` predicates. Contract type
shapes distinguish source declarations from checker-derived mapped/generated shapes.
Validator decorators remain declared constraints, manual `@Res()` remains explicit,
and `any`/unknown/complex returns are not expanded from bodies. Column names distinguish
explicit names, a documented property-name fallback, and unknown dynamic options.
None of these declaration records proves effective validation, transformation,
serialization, or naming-strategy output. Phases 20-21 add v2-only
`RequestFieldOriginRecord` and `ColumnInfluenceRecord`, plus
`REQUEST_PARAMETER_HAS_FIELD_ORIGIN` and `REQUEST_FIELD_MAY_FLOW_TO_COLUMN`. The
influence record retains method, field origin, entity column, sink kind,
`direct`/`derived`/`unknown` state, and evidence. Its ordered `callPath` is empty for
same-method influence or contains caller, callee, and call-site evidence for each
proven direct hop. Integrity requires a continuous path from the request handler to
the sink method. This is bounded “may flow” provenance, not exact stored-value
lineage. V1 rejects all of these v2-only families and predicates.

When enabled, `analysisRun.configuration.rawSql` records the explicit dialect, exact
parser name/version, SQL byte and statement limits, observed parse-time limit, and AST
node limit. The same configuration appears in `run.json` and contributes to the
analysis-run ID. The property is absent when raw-SQL analysis is disabled, preserving
the semantic identity and byte output of existing scans.

## Result-state policy

`completed` means the analysis encountered no diagnosed gap; this includes a genuinely
empty repository. `completed_with_gaps` means trustworthy facts or a nonfatal partial
analysis remain available alongside a diagnosed unresolved, unsupported, or unknown
condition. `failed` is reserved for a fatal integrity condition or an error that leaves
no trustworthy facts. `canceled` remains distinct from all three. Record counts,
assertion statuses, and diagnostic codes preserve the difference between empty,
unresolved, and unsupported outcomes rather than overloading the result state.

## Evidence semantics

Evidence locations are repository-relative through their `SourceFile` reference.
Coordinates are one-based. Starts are inclusive and ends are exclusive, matching
TypeScript node offsets after conversion.

Every evidence record repeats the indexed source content hash. Integrity validation
requires the evidence hash to equal its source file hash. Snippets are redacted,
bounded convenience text; they are never identity or independent proof.

## Canonical ordering

Record arrays are ordered by stable ID before serialization except global guard
registrations, which use their contiguous registration order. Class roles and
assertion/diagnostic evidence references receive stable ordering. Trace guard order is
semantic: application-global, controller, then method, preserving proven global
registration order. Object keys are recursively sorted by `canonicalStringify()`.

Canonical serializers never mutate extractor-owned arrays. A shuffled discovery order
must produce byte-identical canonical output.

## Validation boundary

Writing trustworthy canonical output requires both:

1. Zod runtime schema validation; and
2. cross-record integrity validation from `validateAnalysisDocument()`.

Integrity validation checks global ID uniqueness, record-kind prefixes, references,
predicate endpoint kinds, declaration roles, evidence hashes and ranges, class roles,
and evidence requirements. A validation failure makes the analysis unpublishable as a
trusted `analysis.json`.

## Structured export contracts

Phase 22 leaves the canonical analysis schema unchanged. OpenAPI enrichment sidecars
and control-evidence matrices have independent strict schema version `1.0.0`. Their
cross-record validators require the canonical snapshot identity, valid endpoint/table/
evidence references, and complete evidence closure. The matrix additionally requires
exactly one row for every canonical endpoint and accepts policy outcomes only from a
validated policy document for that same snapshot.

An enriched OpenAPI document is a derived copy, not a canonical document. Only a
uniquely exact method/path match may expose endpoint facts. Ambiguous, unresolved, and
unmatched operations retain their state without guessed guards, tables, or lineage.
The source OpenAPI bytes are never changed. CSV is a presentation of the validated
matrix JSON; spreadsheet formula neutralization does not alter the underlying facts.

## Offline graph-view contract

Phase 23 leaves canonical analysis unchanged and publishes an independently versioned,
strict `GraphReportDocument` schema `1.0.0`. Cross-record validation requires snapshot
identity, exactly one view per canonical endpoint, unique node/edge/evidence IDs,
complete scene references, canonical evidence closure, declared display limits, and
summary agreement. Optional policy input must match the analysis ID; optional impact
input must contain that analysis on its validated before or after side.

Each scene is an endpoint-centered projection of existing catalogue, trace, guard, and
provenance views. Gap nodes represent null assertion targets without inventing a
record. Impact styling applies only to the endpoint and canonical assertion steps
present in validated impact paths. HTML is a rendering of this document and is not a
canonical or independently inferred artifact.

Phase 31 adds graph schema `2.0.0` for reports that contain canonical interaction
nodes. Interaction-free reports retain `1.0.0`, preserving the original node-kind
contract. Both versions use the same snapshot, limit, reference-closure, and summary
validation rules. Phase 33 represents exact event producers and local handler records
as interaction-shaped nodes in `2.0.0`; their assertion edges remain labeled as
candidate matches rather than delivery.

## Analysis v3 interaction substrate

Analysis v3 preserves every v2 family and adds strict `ApplicationRecord`,
`InteractionRecord`, and `InteractionHandlerRecord` collections. The four reserved
interaction kinds are `outbound_http`, `in_process_event`, `job_queue`, and
`microservice_message`. Reservation does not imply extractor support.

`interactionAnalysis` separates `schemaKinds` from `supportedKinds` and
`enabledKinds`. Phase 30 publishes all schema kinds, no supported/enabled kinds, empty
record collections, and `not_run`. Phase 31 publishes `outbound_http` as supported and
enabled, with `complete` or `incomplete` extractor state; the remaining kinds stay
reserved only. Phase 32 does not add another kind; it extends `outbound_http` with
Nest `HttpService` activation and symbolic targets. Phase 33 activates
`in_process_event`, application roots, and independent local handler records.
Integrity requires enabled kinds to be supported, complete
evidence/reference closure, kind-correct interaction/handler matches, and supporting
method/application assertions for canonical records.

Targets are discriminated and strict. HTTP targets retain only method, sanitized
target structure, and query-key names. Event payload classes are not event identity.
Event producer targets retain static string/enum identities or normalized unique-symbol
declaration keys; dynamic and wildcard-shaped producer identities remain explicit and
are never dispatched as patterns. A supported `@OnEvent()` string pattern additionally
retains `{ kind: wildcard, delimiter }`, only when static root configuration proves
wildcards enabled. Exact/wildcard match integrity uses compatible application scope,
EventEmitter2 segment semantics, and the owning rule ID. Phase 35 emits queue targets
with `technology: bullmq` and independently exact/dynamic queue and job identities.
Microservice targets remain representable for a future phase but no current extractor
emits them. Headers, bodies, credentials, environment values, queue payloads, broker
delivery, and remote consumers are not canonical facts.

Phase 31 outbound records use `direction: outbound`, `activation: eager`,
`boundary: external_or_unobserved`, and `dispatchTiming: asynchronous`. Their target
retains a normalized HTTP method, an exact/template/dynamic sanitized URL structure,
and query-key names only. Every record has a resolved
`METHOD_INITIATES_INTERACTION` assertion and initiation/resolution evidence. See
[Eager Outbound HTTP Analysis](outbound-http.md) for the extraction and redaction
contract.

Phase 32 cold producers use `proven_activated`, `constructed_cold`, or `unknown`;
checker-proven `axiosRef` remains `eager`. Symbolic target values contain only bounded
identities such as `{config:PAYMENT_URL}` and `{env:AUTH_SERVICE_URL}`, optional static
path structure, and numbered runtime placeholders. Configuration/environment values
are never resolved or stored. See
[Nest HttpService and Symbolic Targets](nest-http-service.md).

Phase 33 event producers are eager and `in_process`. `emit` is synchronous when every
matched listener timing is statically synchronous; `emitAsync` is asynchronous, and
mixed/unknown listener timing stays unknown. Handler registration is separately
`proven_registered`, `declared_candidate`, or `registration_unknown`. Exact candidate
fan-out never claims runtime delivery. V3 trace terminals may carry `synchronous`,
`local_interaction_synchronous`, or `local_interaction_asynchronous` causal class;
frozen v1/v2 traces omit the field. See
[In-Process Event Analysis](in-process-events.md).

Phase 34 adds configured `*`/`**` handler matching: `*` consumes exactly one segment,
while `**` consumes zero or more, using the statically resolved delimiter. All matches
are candidate assertions; exact matches do not outrank wildcard matches. Handler
configuration evidence is canonical and required for a retained wildcard pattern.
V3 endpoint traces additionally publish a `causalSummary` that partitions synchronous,
local, and distributed-conditional effects and lists outbound/local interaction IDs
plus explicit completeness diagnostics.

Phase 35 queue producers are eager, outbound, and asynchronous. Their boundary is
`external_or_unobserved` until one or more same-queue local `WorkerHost` candidates
exist, then `broker_or_worker_boundary`. Queue-wide handlers use a dynamic job target
by design; matched proven-registered worker terminals are
`distributed_conditional`, never synchronous or exact job-specific. A v3 endpoint
trace includes `distributedInteractionIds` only when such queue interactions are
reachable. See [BullMQ Queue Interactions](bullmq-interactions.md).

The v3 predicates are `APPLICATION_USES_ROOT_MODULE`,
`METHOD_INITIATES_INTERACTION`, `INTERACTION_MATCHES_LOCAL_HANDLER`, and
`HANDLER_IMPLEMENTED_BY`. A handler match is a local static candidate, not proof of
delivery or execution. One-to-many fan-out uses multiple assertions rather than
misusing `ambiguous`.

The pure version normalizer exposes v2 families as unavailable for v1 and interaction
families as unavailable for v1/v2. It never turns a missing historical family into a
proven empty result. V1/v2 writers, schemas, canonical bytes, and analysis-run IDs
remain frozen.
