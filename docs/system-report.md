# Conditional System Graph and Policies

Phase 47 adds a derived `SystemReportDocument` schema `1.0.0` and a self-contained
offline system graph. The report is built only while `stitch` already holds the exact
validated source artifacts in memory. It does not scan repositories, read deployment
state, merge source documents, or add facts back to `SystemAnalysisDocument`.

## Command

```powershell
pnpm run cli -- stitch `
  ticket-service=C:\reports\ticket\.api-intel `
  ctt-queue-service=C:\reports\ctt\.api-intel `
  --topology test\fixtures\system-stitching\ticket-ctt.topology.json `
  --output "C:\reports\ticket ctt system" `
  --with-graph --open
```

`--with-graph` adds these files beside the Phase 46 outputs:

```text
system-report.json
system-report.md
api-intel-system-graph.html
```

`--max-nodes <10-500>` and `--max-edges <10-1000>` bound only the displayed graph.
Canonical correlation, policy, diagnostic, and conditional-path summaries remain in
`system-report.json`; omitted display counts remain explicit. `--open`/`-O` is valid
only with `--with-graph`, runs only after successful publication, and a preview failure
does not remove the artifacts.

## Conditional path semantics

Only a Phase 46 `declared_realm_candidate` may create graph edges across a broker.
The rendered path is:

```text
HTTP root (when statically reached in producer artifact)
  -> producer interaction
  - - conditional route candidate - -> declared broker destination
  - - candidate handler; delivery not proven - -> consumer handler
  - - conditional worker-side effect - -> table/resource effect
```

target-only, ambiguous, and unmatched correlations remain searchable inventory rows;
they never create a broker edge or `SystemConditionalPath`. A null HTTP root means the
producer is not reached from a supported HTTP endpoint in that source artifact. It is
not a dead-code claim and can represent scheduled, inbound-message, library, or
otherwise unmodeled roots.

## Graph views and layout

The graph opens in **Conditional paths** view. This view includes only nodes connected
by report edges plus their service and broker parents, so disconnected inventory does
not force the meaningful architecture into a tiny initial zoom. A deterministic,
compound-aware layered layout places producer services before broker realms and
consumer services after them. Nodes inside each compound are placed in bounded rows
instead of using force-directed repulsion.

**All interactions** restores every displayed inventory node using the same compact
layout. Selecting a correlation switches to a focused view containing its producer,
consumer candidates, any associated path/effect nodes, and required compound parents.
Unmatched and target-only records remain edge-free in that view; the renderer does not
invent a relationship for layout purposes. **Fit view** recenters the current view,
and resizing the window refits only the currently visible elements.

Worker effects come from the independently validated consumer handler trace. Table
labels retain direction and table name. Resource labels retain only technology,
operation, and resource kind; payloads and runtime values are not copied. A path is
`incomplete` when a local step is ambiguous, trace diagnostics remain, or the handler
cannot be traced. Even a `complete` path is still conditional across the distributed
boundary: the report never claims deployment, routing, delivery, acknowledgement,
handler execution, or effect execution.

## Bounded callback forwarding

The local call extractor additionally supports the concrete controller-wrapper form
used by the CTT queue service:

```typescript
return this.handleMessage(
  ctx,
  'label',
  this.cttService.tmfSendUpdateCttList.bind(this.cttService),
  dto,
);
```

`nest.call.same-class-method.v1` proves the direct `this.handleMessage()` call.
`nest.call.bound-callback-forward.v1` is emitted only when the TypeChecker proves the
bound injected-member method and the corresponding wrapper parameter is directly
invoked in the same method body. Merely retaining, returning, passing onward, or
dynamically selecting a callback does not create the forwarded call edge.

## Typed system policies

The report evaluates two fixed, typed rules over the validated system document:

- `require-declared-realm-candidate` passes only for an exact producer/consumer match
  sharing one declared realm, fails for a definite missing candidate, and stays
  unknown for ambiguity or unsupported identity;
- `forbid-ambiguous-system-correlation` fails only when the system document records an
  ambiguous producer selection.

These results describe static topology quality. They are not broker, availability,
security, or compliance assertions, and they do not affect the `stitch` exit code.

## Offline and provenance boundary

The HTML embeds pinned Cytoscape.js, the validated system-report JSON, and all styles
and application code. Its CSP uses hash-authorized scripts/styles and
`connect-src 'none'`; it has no HTTP, HTTPS, or protocol-relative resource reference.
The graph container is explicitly `position: relative`, and Cytoscape uses its default
wheel sensitivity.

Every source-derived graph node retains a namespaced analysis-record reference and
never an absolute repository or artifact path. Source and system diagnostics retain
origin, typed code/severity, subject, and namespaced service association. The
accessible node/edge table publishes the same certainty and provenance labels as the
interactive graph.
