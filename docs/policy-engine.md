# Typed Architecture Policy Engine

`api-intel check` evaluates a strict set of built-in policies over a validated
canonical analysis. An optional validated baseline enables the diagnostic-diff rule.
It does not rescan source, load executable configuration, inspect repository history,
or execute the target application.

## Commands and artifacts

```text
pnpm run cli -- check analysis.json --config api-intel.config.json
pnpm run cli -- check analysis.json --baseline before.json --config api-intel.config.json
pnpm run cli -- check analysis.json --config api-intel.config.json --format markdown
```

JSON is the default and writes `policy-results.json`; Markdown writes
`policy-results.md`. Without `--output`, the artifact is placed beside the current
analysis. Both formats are derived from the same validated `PolicyResultsDocument`
`1.0.0`, and publication uses the existing atomic-file boundary.

## Configuration

The checked-in JSON Schema is
[`schemas/api-intel.config.schema.json`](../schemas/api-intel.config.schema.json).
Configuration is strict JSON: unknown rules, properties, severities, versions, and
option types are rejected.

The version-1 policy-only form below remains accepted byte-for-byte. A version-2
project configuration is also accepted by `check`, as is version 3, when it contains a
non-empty `rules` object; analysis, output, and report categories do not alter
evaluation of an existing canonical analysis. See
[Project Configuration](project-configuration.md).

```json
{
  "$schema": "./schemas/api-intel.config.schema.json",
  "version": 1,
  "rules": {
    "no-repository-access-in-controller": "error",
    "require-guard-on-write-endpoint": ["error", { "onUnknown": "error" }],
    "require-complete-write-trace": ["warn", { "onUnknown": "warn" }],
    "no-new-diagnostics": ["warn", { "minimumSeverity": "warning", "onUnknown": "error" }]
  }
}
```

A string setting supplies both finding severity and unknown severity. The tuple form
can set `onUnknown` separately. `no-new-diagnostics` additionally accepts
`minimumSeverity` (`info`, `warning`, or `error`) and defaults to `warning` when the
short string form is used. Omit a rule to disable it; at least one rule is required.

Analysis controls such as maximum call depth and interaction traversal limits are
ignored by `check` in a valid version-2 or version-3 project config. They belong to
`scan` and are already recorded in canonical analysis.
This prevents policy evaluation from pretending it can retroactively change trace depth.
There is no JavaScript/TypeScript config, expression language, regular-expression guard
classification, generic graph query, or repository-state discovery.

## Four-state result contract

Every evaluated semantic subject produces exactly one result:

| Outcome          | Meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `pass`           | Available supported facts satisfy the rule.                             |
| `fail`           | Available supported facts violate the rule.                             |
| `unknown`        | A relevant ambiguity or unsupported/unresolved boundary blocks a claim. |
| `not_applicable` | The rule has no relevant subject or required baseline.                  |

Unknown is never changed into pass or fail. It retains the `unknown` outcome and uses
the configured `onUnknown` severity. A `fail` or `unknown` result blocks only when its
effective severity is `error`; warning findings are published but exit successfully.

Each result includes its rule/version, effective severity, outcome, blocking state,
reason code, message, subject semantic key, snapshot canonical IDs, and evidence IDs.
Rules and subjects have canonical ordering, and reference arrays are deduplicated and
sorted. Cross-record validation checks summaries, configured-rule coverage, duplicate
subject results, severity, and blocking consistency before publication.

## Built-in rules

### `no-repository-access-in-controller` v1.0.0

Evaluates each proven controller class. Resolved direct repository injection or direct
method-to-table access fails. Repository usage reached only through a downstream
service does not fail the controller. Relevant ambiguous/unresolved repository facts
produce unknown; a clean controller passes; an analysis without controllers is not
applicable.

### `require-guard-on-write-endpoint` v1.0.0

Evaluates each endpoint. A resolved reachable write terminal with a resolved direct or
application-global guard declaration passes. A complete supported global scan proving
no supported guard declaration fails. Ambiguous write reachability or unresolved/global
unknown guard state produces unknown. Endpoints without a reachable write are not
applicable.

This is a guard-policy rule only. It does not label a guard as authentication and does
not claim that an endpoint is public, authenticated, or authorized at runtime.
For analysis v3 it remains intentionally synchronous: local-event handler writes and
BullMQ distributed-conditional effects do not turn an initiating endpoint into a
write endpoint. Those effects stay visible in traces and structured exports under
their own causal classes.

### `require-complete-write-trace` v1.0.0

Evaluates endpoint write traces. A resolved write with no persistence-relevant gap
passes. A resolved write plus a non-resolved trace step or relevant DI/call-depth/
TypeORM diagnostic fails. An ambiguous write, or a mutation-shaped endpoint whose
potential write path crosses such a gap, is unknown. Endpoints with no write subject
are not applicable. `TYPEORM_SAVE_COLUMNS_UNKNOWN` is not a table-trace gap because it
limits column precision while preserving the table write fact.
QueryBuilder ambiguity, unsupported flow, unresolved target, and missing-terminal
diagnostics are persistence-relevant gaps for this rule. Resolved QueryBuilder writes
otherwise require no policy-specific inference because they use the canonical write
predicate.
Raw-SQL dialect, receiver, source, limit, parse, and unsupported-statement diagnostics
are also persistence-relevant gaps. A resolved PostgreSQL raw-SQL write uses the same
canonical predicate and therefore needs no parser-specific policy rule.

### `no-new-diagnostics` v1.0.0

Compares the optional baseline with the current analysis through the semantic diff
engine. New diagnostics at or above `minimumSeverity` fail. Ambiguous diagnostic
identity produces unknown when no definite threshold violation is already known. No
qualifying new diagnostic passes. Without `--baseline`, the rule is not applicable.

## Exit behavior

| Exit code | Meaning                                                        |
| --------: | -------------------------------------------------------------- |
|         0 | Evaluation published with no blocking finding                  |
|         8 | Evaluation published with at least one blocking policy finding |
|         9 | Policy configuration is missing, malformed, or schema-invalid  |

Existing codes remain unchanged: usage is `2`, failed/canceled analysis state is `6`,
invalid canonical analysis is `7`, internal failure is `1`, and cancellation is `130`.
Ordinary warning findings still produce the artifact and exit `0`. Configuration is
loaded and validated before analysis evaluation, so an invalid configuration always
fails at the configuration boundary first.
