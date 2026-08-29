# Structured Evidence Exports

Structured evidence export publishes validated analysis facts to OpenAPI consumers and auditor-friendly
JSON/CSV without changing canonical analysis or inferring a second fact graph. Both
exporters consume an explicit, validated `analysis.json`; neither scans source.

## OpenAPI 3.x enrichment

```powershell
pnpm run cli -- openapi .api-intel/analysis.json `
  --document openapi.json `
  --output .api-intel/exports
```

Only JSON OpenAPI 3.0.x and 3.1.x documents are accepted. YAML and Swagger/OpenAPI 2
are rejected as structured-input errors. The command writes:

- `openapi.enriched.json`: a copy with one versioned `x-api-intel` object per operation;
- `openapi-enrichment.json`: strict match/evidence sidecar (`1.0.0` for analysis
  v1/v2, capability-appropriate v2-v4 for analysis v3/v4, and `5.0.0` for analysis v5).

The input document is read-only and remains byte-identical. If its path would collide
with either generated filename, publication is refused. Unrelated top-level, path,
operation, and custom extension fields are preserved in the enriched copy. An existing
reserved `x-api-intel` field is replaced in the copy only.

### Exact matching

Matching uses only:

1. exact case-normalized HTTP method;
2. Nest `:id` to OpenAPI `{id}` conversion with the same parameter name;
3. route normalization that removes duplicate and trailing slashes except root; and
4. an optional explicit `--path-prefix`, such as `/api/v1`.

There is no fuzzy path, operation-ID, handler-name, or parameter-name matching. Two
OpenAPI source slots that normalize to the same method/path, or multiple canonical
endpoints for one slot, are `ambiguous`. A unique route with unresolved handler facts
is `unresolved`. Missing matches are `unmatched`. All states and unmatched canonical
endpoints remain in the sidecar.

### Extension contract

A resolved operation receives:

```json
{
  "x-api-intel": {
    "schemaVersion": "1.0.0",
    "resolution": "resolved",
    "analysisId": "analysis:...",
    "endpointId": "endpoint:...",
    "guards": {
      "direct": ["AuditGuard"],
      "global": ["AuthGuard"],
      "directState": "declared",
      "globalState": "declared",
      "effectiveState": "guard_declared"
    },
    "dbReads": ["note"],
    "dbWrites": [],
    "diagnosticCodes": [],
    "evidenceIds": []
  }
}
```

Evidence paths remain in the sidecar by default. `--include-evidence` also copies the
canonical evidence IDs into each resolved extension. Non-resolved extensions contain
only their resolution, snapshot, candidates, diagnostics, and empty evidence—not
guessed guards or persistence facts.

For analysis v3 without distributed records, resolved `x-api-intel` extensions use
schema `2.0.0` and add three separate collections:

- `outboundInteractions` for sanitized HTTP targets plus activation/boundary/timing;
- `localInteractions` for local event identities and candidate registration states;
- `localCausalEffects` for handler-reached tables and their synchronous/asynchronous
  local causal class.

The existing `dbReads` and `dbWrites` arrays remain the endpoint's synchronous path.
An event-emitting endpoint can therefore show an empty `dbWrites` array alongside a
local causal write without changing the older field's meaning.

## Control-evidence matrix

```powershell
pnpm run cli -- controls .api-intel/analysis.json `
  --policy-results .api-intel/policy-results.json `
  --output .api-intel/exports
```

The optional policy file must be a validated Phase 16 result for the same analysis
snapshot. The command always writes both:

- `control-evidence.json`: independently versioned strict schema (`1.0.0` for
  analysis v1/v2, capability-appropriate v2-v4 for analysis v3/v4, and `5.0.0` for
  analysis v5);
- `control-evidence.csv`: deterministic UTF-8 CSV with the same endpoint rows.

There is exactly one row per canonical endpoint. Each row repeats snapshot/schema/tool
identity and includes handler selection, direct/global/effective guard states, proven
read/write tables, write/non-write/unknown classification, request-to-column summaries,
relevant diagnostics/incompleteness, applicable policy outcomes, canonical evidence
IDs, and repository-relative source locations.

Schema `2.0.0` adds the same outbound/local/local-causal collections as OpenAPI. CSV
v2 adds `outbound_interactions`, `local_interactions`, and `local_causal_effects`
columns in a deterministic position; JSON remains the authoritative structured form.

Schema `3.0.0` adds `distributedInteractions` and
`distributedConditionalEffects` to resolved OpenAPI endpoint extensions and control
rows. The control CSV adds `distributed_interactions` and
`distributed_conditional_effects`. BullMQ queue/job and Nest microservice
mode/pattern/client/transport labels are sanitized identities; worker/handler effects
remain explicitly `distributed_conditional`. Analyses without a distributed queue or
microservice interaction/handler retain their prior v1/v2 export version and shape.

Schema `4.0.0` is emitted for analysis v4 and adds `jobQueueBranchIds` to every
resolved OpenAPI extension and control row. The array identifies the exact, common,
or supported unmatched branches selected by that endpoint trace. It may be empty;
older schemas mean branch capability is unavailable. Control CSV v4 adds the
`job_queue_branch_ids` column.

Schema `5.0.0` is emitted for analysis v5 and adds `authorizationRequirements` to
resolved OpenAPI extensions and control rows. Each entry contains the exact metadata
key, controller/method scope, source kind, redacted value shape, enforcement state,
optional exact guard name, and evidence IDs. Control CSV v5 adds the
`authorization_requirements` column without exporting metadata values. Empty arrays
mean the authorization extractor completed without finding a supported requirement;
older schemas mean that fact family is unavailable.

`write` means at least one synchronous canonical write terminal is present. `non_write`
means a unique supported synchronous trace has no write terminal or persistence-relevant gap. `unknown`
preserves ambiguous/unresolved selection or an incomplete persistence path. It is not
an HTTP-method heuristic.

### CSV safety

CSV values use double-quote escaping and CRLF records. Commas, quotes, newlines, and
Unicode are preserved, and lists are never truncated. Every cell beginning with `=`,
`+`, `-`, or `@` is prefixed with an apostrophe to neutralize spreadsheet formula
execution. That apostrophe is export safety syntax and must not be treated as original
source text.

## Trust boundary

The sidecar and matrix schemas validate before publication. Cross-record validation
requires snapshot identity, exactly one matrix row per endpoint, canonical endpoint,
table and evidence references, and complete nested evidence closure. Policy evidence
is accepted only from the supplied validated policy document.

These exports are static evidence inventories, not runtime behavior, certification,
or compliance conclusions. PDF is deliberately excluded until a real auditor supplies
a required layout and terminology. YAML/OpenAPI 2, fuzzy matching, input overwrite,
and Git-facing workflows are outside Phase 22.
