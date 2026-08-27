# Offline Interactive Graph Report

The `graph` command generates one self-contained HTML file for exploring validated endpoint facts
without a server, hosted account, telemetry, or another analysis engine.

## Generate a report

```powershell
pnpm run cli -- graph .api-intel/analysis.json `
  --policy-results .api-intel/policy-results.json `
  --impact-results .api-intel/impact.json `
  --output .api-intel
```

The command writes `api-intel-graph.html`. `analysis.json` is required. Policy and
impact inputs are optional, but they must be strict validated documents containing the
same analysis snapshot. The impact document may contain the analysis on its `before`
or `after` side; the report records which side it uses.

For a one-step impact-aware graph, provide the canonical before snapshot directly:

```powershell
pnpm run cli -- graph .tmp/after/analysis.json `
  --baseline .tmp/before/analysis.json `
  --output .tmp/graph-with-impact
```

`--baseline` and `--impact-results` are mutually exclusive. The positional analysis is
always the current/after side. Baseline mode calls the same potential-impact analyzer
in memory and passes its validated result to the existing graph projection; it does not
write `impact.json`. Use `pnpm run cli -- impact` first when the impact document itself must
be retained, reviewed, or rendered as Markdown.

## Preview after publication

Use `--open` or `-O` to request a one-time preview in the desktop's default browser:

```powershell
pnpm run cli -- graph .api-intel/analysis.json --output .api-intel --open
```

Preview is an explicit CLI effect, not stored configuration. It runs only after the
complete HTML artifact has been atomically committed. Windows uses
`rundll32.exe url.dll,FileProtocolHandler`, macOS uses `/usr/bin/open`, and graphical
Linux sessions use `xdg-open`. Each launcher receives the absolute report path as one
discrete argument with `shell: false`; spaces and shell metacharacters are not
interpreted by a command shell.

An unavailable launcher, unsupported platform, headless Linux session, child-process
error, or cancellation during preview emits a warning containing the published path.
The report remains usable and the command retains exit code 0. Failure or cancellation
before publication retains the existing command semantics and never invokes a launcher.
Automated tests inject launcher fakes and never open a real browser.

The graph command never scans source, starts NestJS, imports target modules, connects
to a database, or reads repository state outside its explicit inputs. Its independently
versioned `GraphReportDocument` schema is `1.0.0` for analysis v1/v2 reports and
`3.0.0` for current analysis v3 reports. Historical Phase 31-33 graph schema `2.0.0`,
used when canonical interaction nodes are present, remains readable but is no longer
emitted. The HTML is a rendering of the validated document, not a second fact graph.

## Endpoint-centered exploration

The report initially opens one endpoint-centered scene. It does not render the entire
repository graph. The sidebar supports:

- search by HTTP method, normalized path, or handler;
- exact HTTP-method filtering;
- effective-guard filtering for declared, none proven, and unknown;
- with/without diagnostic filtering;
- read, write, read-and-write, none-proven, and unknown persistence filtering;
- policy pass/fail/unknown/not-applicable filtering when policy results are supplied;
- direct, potential, unknown, and no-impact filtering when impact results are supplied.

Selecting a node or edge highlights its proven predecessor/successor path and displays
its retained evidence. Evidence uses a selectable repository-relative
`path:line:column` location rather than a `file://` link. Snippets remain bounded and
redacted exactly as they were in canonical analysis.

The endpoint → handler → called method → table, outbound-HTTP, or local-event path is
built from the existing endpoint trace. Graph v3 separates the initiating method,
interaction record, process boundary, external HTTP target, local handler declaration,
and implementing handler method. HTTP producer labels show activation/timing while the
external-target node shows the sanitized target and resolution; dynamic targets remain
visibly unknown. Effective guards are derived from the existing
guard view. Optional request parameter → field origin → entity-column edges use only
canonical Phase 19-21 records
and retain `direct`, `derived`, or `unknown`. No reachability edge becomes data lineage.

Local event scenes use distinct interaction, boundary, and handler nodes with edges
labeled `initiates`, `dispatches`, `matches local handler`, and `implemented by`.
Event labels include identity and dispatch timing; wildcard handler labels include
their delimiter and registration state. Only proven
registered handlers are traversed to causal table nodes. A candidate edge is never
rendered as delivery (the renderer never uses `delivered`), and endpoint
`dbReads`/`dbWrites` summaries remain synchronous. Graph v3's facts panel labels that
section explicitly and lists local causal effects separately.

BullMQ scenes reuse the canonical interaction topology but render a distinct queue
target and `broker or worker boundary`. A same-queue `WorkerHost` edge remains
`matches local handler`, never delivery. Proven worker table terminals are listed in
the facts panel as distributed conditional effects and do not enter synchronous
`dbReads`/`dbWrites`.

## Uncertainty and impact

Resolved, ambiguous, unresolved, unsupported, and unknown states remain explicit in
labels, badges, the evidence panel, and the accessible table. Dashed/dotted styling is
paired with visible text, so meaning does not depend on color.

An optional impact document marks the canonical path steps that actually occur in its
validated before/after paths. A directly changed endpoint, a potentially impacted
endpoint, and an incomplete/unknown impact have different text and styles. Supplying
impact does not turn every edge in an affected endpoint scene into a changed edge.

## Display limits

Defaults are 120 nodes and 180 edges per endpoint. `--max-nodes` accepts 10-500 and
`--max-edges` accepts 10-1000. The evidence limit is the selected node limit plus the
selected edge limit plus 100, ensuring room for at least one retained evidence record
per displayed evidence-backed graph item under the configured bounds.

Edges are selected deterministically in assertion, effective-guard, then provenance
order. The endpoint root is always retained. The report publishes omitted node, edge,
and evidence counts both in its strict view model and in the UI. An omitted item is not
presented as absent from analysis.

## Offline and injection boundary

The exact pinned `cytoscape@3.34.0` MIT-licensed browser distribution is embedded in
the generated file. There is no CDN, external font, remote image, stylesheet, API,
telemetry call, or runtime package installation.

The report applies a restrictive Content Security Policy:

- `default-src 'none'` and `connect-src 'none'` block network access;
- each executable inline script and the embedded JSON receive exact SHA-256 hashes;
- the report stylesheet and Cytoscape's exact pinned runtime container rule receive
  SHA-256 hashes;
- objects, frames, workers, media, forms, fonts, and base URLs are disabled;
- only inline style attributes needed by Cytoscape's generated canvas are permitted.

Graph data is canonical JSON inside a non-executable `application/json` element.
`<`, `>`, `&`, and JavaScript line-separator characters are escaped before embedding,
including closing-script sequences. The application parses that element and writes
source-derived values with `textContent`; it does not concatenate them into HTML.

## Accessibility and keyboard use

Filters and endpoint choices are native controls with visible focus. Arrow Up/Down,
Home, and End move through endpoint buttons. The Cytoscape canvas is supplementary and
hidden from assistive technology; every displayed node and edge is also present in an
open semantic table with kind, label/connection, certainty, impact, and evidence count.
Endpoint facts and the evidence inspector remain ordinary selectable text.

## Deliberate boundaries

- No hosted application, local HTTP server, account, storage, telemetry, or CDN.
- No client-side parsing of `analysis.json` and no source rescan.
- No whole-repository graph rendered on initial load.
- No guessed edges for unresolved targets and no flattened uncertainty.
- No executable source snippets or target-code links.
- No Git-facing workflow or repository-provider integration.

Performance and dependency measurements are in
[Phase 23 Offline Graph Benchmark](benchmarks/phase23-offline-graph.md). The direct
baseline workflow is measured separately in the
[Phase 25 Graph Baseline Benchmark](benchmarks/phase25-graph-baseline.md).
