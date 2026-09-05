# Backend API Intelligence Platform Expansion Implementation Plan

Status: deferred internal implementation plan  
Scope begins only when explicitly resumed  
Prerequisite baseline: completed Phase 47 engine and report contracts

This plan turns the existing deterministic artifact engine into reusable agent and CI
integrations without weakening its proof boundaries. It is intentionally separate from
the completed/refactoring expansion plans. No phase in this document is active merely
because the plan exists.

## Product and semantic rules

- Describe results as supported static paths to side-effect operations, never proof
  that a runtime effect, broker delivery, lock acquisition, guard authorization, or
  deployment occurred.
- Keep the canonical analysis and system documents authoritative. Adapters consume
  validated documents and do not recreate extraction or matching logic.
- Every query result identifies its artifact/schema, result state, canonical subjects,
  evidence, diagnostics, uncertainty, and omitted-result counts.
- Default integrations are local, read-only, bounded, deterministic, and offline.
- Do not match distributed producers and consumers by target text alone. Preserve the
  existing topology-realm and correlation-state contract.
- Treat repository content and generated summaries as untrusted data in CI. Never
  evaluate repository-derived text, interpolate it into commands, or publish it without
  validation, escaping, and size limits.
- A policy gate blocks only configured blocking outcomes. Ordinary changes, potential
  impact, unknown results, and analysis gaps remain distinct.
- Marketing claims about agent reliability or architecture prevention require measured
  evaluations; they are not engine facts.

## Shared gates

### Gate PK0 — Query contract

Pass only when:

1. Query selectors return zero, one, or explicit multiple matches; ambiguity never
   selects an arbitrary record.
2. Responses have deterministic ordering and configurable hard limits.
3. Full canonical IDs and evidence remain available even when display labels are short.
4. Frozen v1-v7 analysis compatibility and system-schema compatibility pass.
5. Query code performs no target import, target execution, network access, or write.

### Gate MK0 — Local MCP safety

Pass only when:

1. The server is artifact-backed and read-only.
2. Startup roots are explicit and canonicalized; tool arguments cannot escape them.
3. Tool responses are bounded and exclude environment/configuration values already
   protected by analyzer redaction rules.
4. Protocol tests cover initialization, discovery, successful calls, ambiguity,
   invalid input, cancellation, and output limits.
5. No scan, shell, arbitrary-file, mutation, sampling, or remote transport is exposed.

### Gate CK0 — CI trust boundary

Pass only when:

1. Baseline provenance includes tool version, document schema, repository revision,
   effective configuration hash, and relevant topology hash.
2. Candidate analysis can run without target lifecycle scripts.
3. Untrusted repository data is schema-validated, escaped, and bounded before entering
   annotations, summaries, artifacts, or comments.
4. Analysis failure, policy failure, impact, unknown, and incomplete-with-gaps produce
   distinct machine outcomes.
5. Fork-safe workflows need no write token or secret while analyzing candidate code.

## Milestone P0 — Vendor-neutral query kernel

### Phase P0.1 — Query model and selectors

Status: deferred

Goal: expose stable programmatic queries above validated canonical documents.

Deliverables:

1. Add a dedicated query module that accepts already validated analysis, comparison,
   impact, policy, system-analysis, and system-report documents.
2. Define common query metadata: document ID, schema version, result state, limits,
   omitted counts, diagnostics, and evidence references.
3. Implement exact endpoint resolution by method/path and canonical ID.
4. Implement symbol resolution by repository-relative path, qualified name, optional
   source location, and canonical ID.
5. Return explicit `not_found`, `resolved`, or `ambiguous` selector states.
6. Freeze ordering and response schemas with positive and negative fixtures.

Non-goals:

- Transport protocols, CI environment discovery, branch operations, or source scans.
- Name-only symbol selection when multiple declarations are possible.

### Phase P0.2 — Bounded evidence queries

Status: deferred

Goal: provide the reusable semantic operations required by both adapters.

Deliverables:

1. `listEndpoints` with filters and pagination/limits.
2. `getEndpointTrace` using the existing canonical trace builder.
3. `compareAnalyses` and `getChangeImpact` over explicit before/after documents.
4. `getSymbolDependents` as current-snapshot reverse reachability, clearly distinct
   from before/after impact.
5. `findDistributedCandidates` over a validated system document, requiring interaction
   kind plus structural target and preserving declared-realm/target-only/ambiguous/
   unmatched states.
6. `getPolicyResults` with blocking and unknown states kept separate.
7. Gate PK0 verification.

## Milestone P1 — Local read-only MCP server

### Phase P1.1 — Artifact registry and stdio server

Status: deferred

Goal: let local AI hosts query explicit completed artifacts without rescanning.

Deliverables:

1. Add a separately addressable MCP entry point using the stable TypeScript MCP SDK.
2. Accept explicit `--analysis`, `--system`, and named before/after artifact arguments.
3. Load and validate each document once at startup into an immutable artifact registry.
4. Serve through stdio only; keep stdout protocol-clean and route diagnostics to stderr.
5. Publish server/tool version metadata independently from analysis schema versions.

### Phase P1.2 — Initial tools and resources

Status: deferred

Goal: expose high-confidence, low-token queries.

Initial tools:

- `list_endpoints`
- `get_endpoint_trace`
- `resolve_symbol`
- `get_symbol_dependents`
- `compare_analyses`
- `get_change_impact`
- `find_distributed_candidates`
- `get_policy_results`

Resources:

- Bounded artifact summaries.
- Individual evidence records by canonical evidence ID.
- Explicitly selected canonical records or report fragments.

Rules:

- Tools return structured content plus concise text, not entire multi-megabyte documents.
- `find_distributed_candidates` never accepts queue/pattern text as sufficient identity.
- Do not name current-snapshot dependency queries “blast radius.” Reserve that term for
  evidence-backed before/after or explicitly modelled hypothetical impact.

### Phase P1.3 — MCP hardening and evaluation

Status: deferred

Deliverables:

1. Add adversarial path, oversized-output, malformed-artifact, ambiguity, and protocol
   fixtures.
2. Verify byte-stable structured results across repeated calls.
3. Create an agent evaluation corpus comparing unsupported unaided answers with
   artifact-grounded answers; measure citation accuracy, omitted dependencies, and
   false relationship claims.
4. Pass Gate MK0 and publish local setup documentation for multiple MCP hosts without
   claiming universal host feature parity.

Non-goals for MCP v1:

- Remote HTTP, OAuth, multi-tenancy, background tasks, target scanning, file writes,
  shell execution, source editing, or agent sampling.

## Milestone P2 — Vendor-neutral CI evaluation

### Phase P2.1 — CI result contract

Status: deferred

Goal: compose existing artifacts into one portable, proof-bounded CI result.

Deliverables:

1. Define a strict `CiEvaluationDocument` with baseline/candidate provenance.
2. Summarize endpoint changes, repository-local potential impact, policy outcomes,
   diagnostics, gaps, and evidence locations.
3. Define distinct process outcomes for success, configured policy violation, invalid
   input, incompatible baseline, analysis failure, and cancellation.
4. Render deterministic Markdown, machine JSON, and a neutral annotation stream.
5. Do not add repository checkout or branch comparison logic to the engine core.

### Phase P2.2 — Reproducible scan recipe

Status: deferred

Goal: document and verify a safe way for CI wrappers to obtain compatible artifacts.

Deliverables:

1. Pin the engine distribution, Node range, and project configuration.
2. Install target dependencies from its lockfile with lifecycle scripts disabled.
3. Scan baseline and candidate in isolated directories, or consume a trusted baseline
   artifact with complete provenance.
4. Reject missing, stale, differently configured, or schema-incompatible baselines
   rather than silently comparing them.
5. Cache only immutable, keyed inputs; never let untrusted candidate jobs overwrite a
   trusted baseline cache.
6. Pass Gate CK0.

## Milestone P3 — Native CI checks

### Phase P3.1 — GitHub check integration

Status: deferred

Goal: provide useful pull-request feedback without comment permissions.

Deliverables:

1. Package a pinned GitHub Action or container wrapper around the CI evaluation.
2. Run candidate analysis under the ordinary `pull_request` trust boundary.
3. Publish a job summary, bounded file/line annotations, and downloadable JSON/
   Markdown/offline-graph artifacts.
4. Request read-only repository permissions by default and no secrets for fork code.
5. Never use `pull_request_target` to execute candidate code or dependency scripts.

### Phase P3.2 — GitLab check integration

Status: deferred

Goal: provide equivalent semantics using GitLab-native reports.

Deliverables:

1. Publish a reusable CI component/template.
2. Map supported findings to Code Quality or SARIF-style report artifacts and retain
   the canonical CI evaluation as a downloadable artifact.
3. Keep merge-request comments out of the required path because ordinary job tokens
   may not have note-writing permission.
4. Test GitLab.com and document self-managed/version constraints explicitly.

## Milestone P4 — Differential system impact

### Phase P4.1 — System comparison contract

Status: deferred

Goal: make cross-service change statements evidence-backed.

Deliverables:

1. Compare explicit baseline/current service artifact sets and topology manifests.
2. Track added/removed/modified producers, consumers, realms, bindings, ambiguity, and
   conditional paths.
3. Preserve missing-service and incompatible-artifact states as unknown, not absent.
4. Define a versioned `SystemImpactDocument` before adding CI presentation.

### Phase P4.2 — Conditional cross-service blast radius

Status: deferred

Deliverables:

1. Propagate changes only across `declared_realm_candidate` correlations.
2. Mark downstream worker effects as distributed-conditional.
3. Add bounded paths, cycle protection, provenance, deterministic ordering, and impact
   graph overlays.
4. Only after this phase may CI claim that a changed service potentially affects a
   worker or side effect in another service.

## Milestone P5 — Optional comment publisher

### Phase P5.1 — Sanitized comment document

Status: deferred

Deliverables:

1. Project a small, schema-validated comment model from `CiEvaluationDocument`.
2. Escape all repository-derived Markdown and enforce item/byte limits.
3. Include the run identity and artifact links; keep full evidence in CI artifacts.
4. Upsert one identified bot comment rather than appending a comment every run.

### Phase P5.2 — Privileged publisher adapters

Status: deferred

Deliverables:

1. Separate analysis from authenticated publication.
2. Add optional GitHub and GitLab publishers with least-privilege tokens.
3. Treat candidate-produced artifacts as untrusted input; validate them without
   executing or interpolating their content.
4. Degrade to summaries/annotations when comment permission is unavailable.

## Milestone P6 — Remote MCP only on demonstrated demand

Status: deferred

Goal: host query capabilities without weakening local guarantees.

Required work:

1. Streamable HTTP transport and protocol-version compatibility.
2. OAuth/resource audience validation, scoped authorization, and tenant isolation.
3. Artifact encryption, retention, deletion, audit logging, quotas, and rate limits.
4. Network threat model, penetration testing, and operational ownership.

Explicitly excluded until P6 is activated:

- Public unauthenticated endpoints.
- Token passthrough.
- Arbitrary filesystem roots supplied per tool call.
- Remote source scanning or target-code execution.

## Deferred adjacent ideas

- A proof-only in-process event-cycle policy may be planned separately. Broker cycles
  must not be inferred from candidate delivery links.
- Hypothetical symbol impact requires a dedicated semantic contract and must not be
  approximated by fabricating a before/after document.
- Reliability multiplier claims require the P1.3 evaluation corpus.

## Recommended activation order

1. P0 query kernel.
2. P1 local read-only MCP.
3. P2 vendor-neutral CI evaluation.
4. P3 native GitHub/GitLab checks.
5. P4 differential system impact.
6. P5 optional comment publisher.
7. P6 remote MCP only if demand and operational ownership justify it.
