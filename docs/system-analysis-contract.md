# System Identity and Stitching Contract

Phase 45 defined the cross-service identity boundary; Phase 46 implements correlation
strictly over completed artifacts. The stitcher does not scan repositories, inspect
source-control state, or create a proven distributed causal path. The authoritative
model, topology schema, correlation engine, integrity validator, stable-ID
constructors, and canonical serializer live under `src/system-analysis/`.

Phase 47 leaves this schema and identity boundary unchanged. With `--with-graph`, the
command uses the exact already-loaded source artifacts to derive a separately
validated `SystemReportDocument`, Markdown summary, and offline HTML system graph.
Only declared-realm candidates can form conditional broker paths. See
[Conditional System Graph and Policies](system-report.md).

## Separate document boundary

`SystemAnalysisDocument` schema `1.0.0` references completed analysis artifacts by
service namespace, analysis ID, schema version, result state, and a human-readable
artifact label. It never embeds or merges source `AnalysisDocument` collections. The
literal `sourceDocumentsEmbedded: false` and the strict schema reject fields such as
`sourceFiles`, `methods`, `assertions`, or `evidence` at the system-document root.

Each source record is represented by three identities:

- its unchanged canonical `analysisRecordId` from one source analysis;
- a user-declared `serviceId`, derived only from the stable service namespace; and
- a `namespacedId`, derived from service namespace plus source record ID.

Consequently, identical canonical record IDs from two repositories cannot collide.
Repository paths, checkout directory names, and artifact locations never become
service identity or environment evidence.

## Explicit broker realms

A broker realm is declared topology, not a discovery guess. Its stable identity uses:

- an explicit environment alias and broker alias;
- technology (`bullmq` or `nest_microservices`);
- transport (`bullmq`, `tcp`, `redis`, `rmq`, or `kafka`);
- one queue, topic, or pattern destination;
- an optional prefix; and
- an optional namespace.

Aliases are labels, not broker hostnames or credentials. Absolute paths, URLs,
passwords, payloads, and runtime configuration values are excluded. A duplicate
environment-plus-broker alias with different realm content fails integrity validation.

## Structural contracts

Only `job_queue` and `microservice_message` are correlatable. A job contract retains
technology, queue, and an exact or queue-wide job identity. A message contract retains
mode, pattern kind, and canonical static pattern. Client DI tokens do not replace realm
identity, and payloads never participate.

Every producer and consumer endpoint remains a namespaced reference to its source
interaction or interaction-handler record. The system document does not rewrite those
records or upgrade their source-analysis resolution status. A source-proven transport
is retained on the endpoint: topology may supplement a null transport premise, but a
manifest that contradicts a known transport fails closed.

## Correlation states

| State                      | Meaning                                                                                | Later conditional edge eligibility                              |
| -------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `declared_realm_candidate` | Exact structural contract and all members share one explicit broker realm              | Eligible for a conditional candidate edge; never delivery proof |
| `target_only_candidate`    | Static target text matches but no shared explicit realm is available                   | Never eligible                                                  |
| `ambiguous`                | Multiple job/request consumers or conflicting realm candidates remain                  | Never eligible until resolved by explicit topology              |
| `unmatched`                | Producer-only, consumer-only, realm mismatch, target mismatch, or unsupported identity | No edge                                                         |

There is deliberately no `proven`, `delivered`, or `executed` state. Even a
`declared_realm_candidate` does not prove broker routing, deployment, delivery,
acknowledgement, ordering, retries, handler execution, or downstream effects.

## Real ticket-to-CTT basis

The frozen RMQ slice is derived from the supplied repositories:

- `ticket-service-example` injects `MESSAGE_QUEUE_SERVICE`, registers RMQ queue
  `intt_ctt_queue`, and calls both `ClientProxy.send()` and `ClientProxy.emit()` with
  pattern `tmf-update-ctt-list` from its CTT/NTT services; and
- `ctt-queue-service-example` connects an RMQ microservice to the same queue and
  declares `@MessagePattern('tmf-update-ctt-list')` in its CTT controller.

With a topology manifest explicitly assigning both artifacts to the same environment
and broker alias, this pair is a `declared_realm_candidate`. Without that declaration,
it is only a `target_only_candidate`. The source text alone cannot establish that two
configuration variables resolve to the same runtime broker.

The non-executed source slices and 14-case BullMQ/Nest microservice matrix live under
`test/fixtures/system-stitching/`. Gate S0 requires same-target/different-realm
collisions and missing-topology cases to remain non-edges.

## Topology manifest

Topology JSON is schema `1.0.0` and strict. It contains `systemName`, explicit
`brokerRealms`, and structural `bindings`. A binding selects a service namespace,
producer or consumer role, a job/message contract, and a realm alias. It may also
select one exact canonical interaction/handler ID. It never contains an analysis path,
broker hostname, credential, payload, or environment value.

BullMQ bindings require the declared queue destination; producers also require an
exact job, while a proven queue-wide worker may use `job: null`. Nest microservice
bindings require a static canonical pattern. Duplicate realms, incompatible
technology/transport combinations, repeated bindings, missing realm aliases, and
bindings that select no source record fail closed.

The real frozen declaration is
`test/fixtures/system-stitching/ticket-ctt.topology.json`. Its
`selected-environment` label is intentionally a user premise, not runtime discovery.

## Artifact-only CLI

```powershell
pnpm run cli -- stitch `
  ticket-service=C:\reports\ticket\.api-intel `
  ctt-queue-service=C:\reports\ctt\analysis.json `
  --topology test\fixtures\system-stitching\ticket-ctt.topology.json `
  --output C:\reports\ticket-ctt-system
```

Every positional input must use `service-namespace=path`. A directory input must be
literally named `.api-intel`; otherwise pass its `analysis.json` file. The loader
accepts interaction-capable schemas v3–v7 only and requires `completed` or
`completed_with_gaps`. It validates each source document independently and never
embeds it in the output.

The engine inventories all BullMQ and Nest-microservice source records. Dynamic
producer targets, cold/unknown request-response activation, dynamic handler targets,
and non-proven handler registration become explicit unsupported correlations. Missing
or partial source interaction capability produces a source-analysis diagnostic rather
than silent completeness.

Publication writes two deterministic files atomically:

```text
system-analysis.json
system-analysis.md
```

With `--with-graph`, publication additionally writes:

```text
system-report.json
system-report.md
api-intel-system-graph.html
```

The Markdown file is a concise view of the validated JSON. Absolute artifact paths do
not enter either canonical identity or report content.

## Phase boundary history

Phase 45 provides no `stitch` CLI, topology-manifest loader, artifact discovery,
correlation engine, Markdown report, or publication workflow. Phase 46 adds those
components while retaining Gate S0: every possible cross-service relationship remains
conditional, ambiguous, target-only, or unmatched—never delivered or executed.
