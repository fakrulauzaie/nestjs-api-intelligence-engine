# CLI and Reporting Workflow

The synopsis uses the installed binary name `api-intel`. In this private repository,
build first and replace that prefix with `pnpm run cli --`; for example,
`pnpm run cli -- graph .api-intel/analysis.json --open`.

The CLI has ten complete commands:

```text
api-intel scan <repository> [--config <path> | --no-config]
  [--tsconfig <path>] [--output <directory>]
  [--max-call-depth <1-3>] [--raw-sql-dialect <postgresql-18>]
  [--controller <name>] [--route <path>]
  [--with-graph] [--with-controls] [--with-openapi <openapi.json>]
  [--max-nodes <10-500>] [--max-edges <10-1000>] [--open]
api-intel endpoints <analysis.json> [--controller <name>] [--route <path>]
api-intel trace <analysis.json> --method <method> --path <path>
api-intel report <analysis.json> [--output <directory>]
  [--controller <name>] [--route <path>]
api-intel diff <before-analysis.json> <after-analysis.json>
  [--format json|markdown] [--output <directory>]
api-intel impact <before-analysis.json> <after-analysis.json>
  [--format json|markdown] [--output <directory>]
api-intel check <analysis.json> --config <api-intel.config.json>
  [--baseline <analysis.json>] [--format json|markdown] [--output <directory>]
api-intel openapi <analysis.json> --document <openapi.json>
  [--path-prefix <prefix>] [--include-evidence] [--output <directory>]
api-intel controls <analysis.json>
  [--policy-results <policy-results.json>] [--output <directory>]
api-intel graph <analysis.json>
  [--baseline <before-analysis.json> | --impact-results <impact.json>]
  [--policy-results <policy-results.json>]
  [--max-nodes <10-500>] [--max-edges <10-1000>] [--output <directory>] [--open]
```

`scan` defaults to the repository's primary `tsconfig.json`, writes to
`<repository>/.api-intel`, and uses a maximum call depth of three. An explicit tsconfig
is resolved within the repository. The configured depth must be an integer from one to
three and is recorded in both canonical analysis metadata and `run.json`.

Before scanning, `scan` checks only `<repository>/api-intel.config.json`. An explicit
`--config` selects another file, while `--no-config` disables discovery; the two flags
are mutually exclusive. Versions 2 and 3 supply analysis, output, policy-rule, policy,
graph, controls, and OpenAPI report recipes. Version 3 additionally accepts bounded
interaction-traversal limits; those values do not enable extractors. The current eager
and Nest `HttpService` outbound-HTTP extractors, exact/configured-wildcard in-process
EventEmitter analysis, bounded BullMQ queue analysis, and bounded Nest microservice
analysis are enabled automatically.
They have no network, environment-value, broker, or target-runtime configuration
option. Explicit CLI options take precedence.
Every requested report uses the same in-memory analysis and standalone renderer;
`--open` remains invocation-only and is valid only when a graph is effectively
requested. See
[Project Configuration](project-configuration.md) for strict schema, path, migration,
and identity rules.

Raw-SQL extraction is disabled unless the CLI supplies
`--raw-sql-dialect postgresql-18` or version-2/version-3/version-4 configuration explicitly selects the
same dialect. The exact `libpg-query@18.1.2` parser identity and effective byte,
statement, parse-time, and AST-node limits are then recorded in both artifacts. Other
CLI dialect values fail as usage errors before scanning; invalid configured values fail
at the configuration boundary. See [Static PostgreSQL Raw-SQL
Analysis](postgresql-raw-sql.md) for source and statement boundaries.

## View-only filters

`--controller` accepts an exact controller display or qualified name. `--route`
accepts an exact route path after the same normalization used by extraction. Filters
limit only emitted endpoint and trace reports. They never limit source scanning or
remove records, assertions, evidence, or diagnostics from `analysis.json`.

An unfiltered `report` recreates the reports produced by an unfiltered `scan` from
`analysis.json` alone. To recreate a filtered report, pass the same filter options to
`report`. Report headers show the active filters and the selected-versus-total endpoint
count.

`diff` consumes exactly two validated canonical files and writes `diff.json` by
default or `diff.md` with `--format markdown`. It does not rescan source. Without an
output option, the artifact is written beside the after analysis. See [Analysis
Comparison](comparison.md) for semantic matching and ambiguity behavior.

`impact` consumes the same two explicit canonical inputs and writes `impact.json` by
default or `impact.md`. It derives changed paths only from source-file records and
content hashes, traverses both assertion graphs, and does not inspect other repository
state. See [Potential Change-Impact Analysis](impact-analysis.md).

`check` validates its strict JSON configuration first, then consumes one current
canonical analysis and an optional baseline. It writes `policy-results.json` by
default or `policy-results.md`. Warning findings publish successfully; error-severity
failures and unknowns use the dedicated policy-violation exit. See [Architecture
Policy Engine](policy-engine.md).

`openapi` enriches a copy of an OpenAPI 3.0/3.1 JSON document and publishes a strict
match/evidence sidecar. Operations match by exact normalized HTTP method and path,
with only documented Nest `:name` to OpenAPI `{name}` conversion and an optional
explicit path prefix. The source document is never overwritten. `controls` publishes
one strict JSON and formula-safe CSV row per canonical endpoint, optionally attaching
validated policy results for the same analysis snapshot. Both commands derive facts
only from validated inputs. Analysis v5 outputs separately expose outbound
interactions, local interactions/effects, and—when BullMQ records exist—distributed
interactions and distributed-conditional effects without changing synchronous
`dbReads`/`dbWrites`. See
[Structured Evidence Exports](structured-evidence-exports.md).

`graph` publishes `api-intel-graph.html`, a single self-contained offline interactive
report. Its optional policy and impact inputs must contain the current canonical
snapshot. Node/edge options bound each endpoint-centered scene; omitted counts remain
visible. The file embeds pinned Cytoscape.js, uses hash-authorized scripts plus
`connect-src 'none'`, and includes an accessible node/edge table. See [Offline
Interactive Graph Report](offline-graph-report.md).
Current v5 reports use graph schema v6 and distinguish interaction, handler, boundary,
external-target, and BullMQ branch nodes. Interaction edges say `initiates`,
`dispatches`, `matches local handler`, or identify a branch effect; they never claim
delivery. Endpoint facts also list redacted authorization requirements and their
`proven_enforced`, `configured_relationship`, or `enforcement_unknown` state.

`graph --baseline <before-analysis.json>` computes the same validated potential-impact
overlay in memory with the positional analysis as the current/after side. It is mutually
exclusive with `--impact-results` and does not publish `impact.json`; use the standalone
`impact` command when a durable JSON or Markdown impact artifact is required.

`graph --open` (short form `-O`) requests a one-time local preview only after the HTML
artifact has been atomically published. The launcher passes the absolute report path as
one argument without a shell. Preview is never a project default: unsupported or
headless platforms, missing launchers, and launch cancellation produce a warning that
retains the published path and exit code 0. Generation failures and cancellation before
publication do not launch anything.

## Artifacts and overwrites

The output directory contains:

```text
run.json
analysis.json
endpoints.md
contracts.md
traces/
  <method>-<safe-route>-<stable-id-prefix>.md
bundle.json
```

Trace filenames contain only lowercase ASCII letters, digits, and hyphens before the
`.md` extension. The stable endpoint-ID prefix prevents collisions between duplicate
or similarly sanitized routes. Ambiguous method/path selectors remain visible in the
catalogue but do not receive a guessed trace report.

`contracts.md` is derived from v2 declaration and provenance records. It inventories
supported request sources, DTO/interface fields, handler return types, entity columns,
and bounded same-/inter-method request-to-column influence with canonical call paths.
It does not claim effective validation, transformation, exact stored values, or
serialized response behavior.

An explicitly selected scan bundle may additionally contain `policy-results.json`,
`api-intel-graph.html`, control-evidence JSON/CSV, and the OpenAPI enriched copy and
sidecar. There is deliberately no `--all` option. The final strict `bundle.json` lists
the selected reporters, input snapshot IDs, artifact-relative paths, content hashes,
byte sizes, stability class, and `complete` state. See [Selected Scan
Bundles](selected-scan-bundles.md).

Only these tool-owned target files are overwritten. A small hidden report manifest
tracks generated trace filenames so reports that are no longer selected can be removed
without deleting unrelated files. Every selected artifact is rendered, validated, and
collision-checked before commit. Each new file is fully staged beside its destination;
`bundle.json` is committed last as the completeness marker. Existing unrelated files
are preserved. Interruption exits with code 130; staged temporary files are removed and
a prior complete bundle survives cancellation before commit.

## Result and error behavior

`completed_with_gaps` is a successful partial analysis and remains visible in console
and Markdown output. `failed` and `canceled` analyses cannot be listed, traced, or
reported as trustworthy results. Usage errors, invalid canonical input, endpoint
misses, ambiguous selectors, failed analyses, internal failures, and cancellation use
distinct stable exit codes.

| Exit code | Meaning                                                                    |
| --------: | -------------------------------------------------------------------------- |
|         0 | Success, including trustworthy `completed_with_gaps` output                |
|         1 | Unexpected internal failure                                                |
|         2 | Invalid command usage or option value                                      |
|         4 | Endpoint selector not found                                                |
|         5 | Endpoint selector ambiguous                                                |
|         6 | Analysis is failed or canceled and cannot be consumed                      |
|         7 | Analysis file missing, malformed, schema-invalid, or integrity-invalid     |
|         8 | Policy results published with at least one blocking finding                |
|         9 | Project/policy configuration missing, malformed, or schema-invalid         |
|        10 | Structured export input missing, malformed, schema-invalid, or unsupported |
|       130 | Operation canceled by user interruption                                    |

A published diff or impact report uses exit code 0 even when it contains changes,
comparison ambiguities, potential impacts, unreachable changed files, or explicit
uncertainty. Policy evaluation uses exit code 8 only for published `error`-severity
`fail` or `unknown` results; warning findings use exit code 0.
OpenAPI output/input collisions are usage errors. A policy result from another
snapshot, or an impact document that contains neither the current before nor after
snapshot, is rejected as an analysis-consumption failure, and no export is published.
