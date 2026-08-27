# Selected Scan Bundles

`scan` can derive a deliberately selected report set from one validated in-memory
analysis. It does not rescan source, reload the just-created `analysis.json`, or provide
an ambiguous all-reports shortcut.

```powershell
pnpm run cli -- scan C:\code\my-nest-app `
  --with-graph `
  --with-controls `
  --with-openapi C:\code\my-nest-app\openapi.json `
  --output C:\reports\my-nest-app `
  --open
```

Markdown catalogue, contracts, and endpoint traces remain normal scan outputs.
`--with-graph` adds the self-contained offline graph. `--with-controls` adds strict JSON
and formula-safe CSV. `--with-openapi` requires one explicit OpenAPI 3.x JSON input and
adds an enriched copy plus its match/evidence sidecar. The input remains byte-identical.
`--open` is valid only with an effective graph and runs after complete publication.
There is no `--all` flag and no implicit search for Swagger/OpenAPI documents.

Version-2 `reports.policy`, `reports.graph`, `reports.controls`, and `reports.openapi`
recipes provide equivalent project defaults. Policy is intentionally config-only: an
enabled policy recipe requires explicit rules. Its result is evaluated once, published
as `policy-results.json`, and passed directly to graph and controls. Warning findings
retain exit code 0. Blocking error findings use exit code 8 only after every artifact
and the final bundle manifest have been committed.

## Coherent publication

Every reporter has a preparation step that validates and renders bytes without writing
its destination. Scan combines these prepared artifacts into one plan and rejects:

- duplicate resolved destinations;
- any generated destination equal to the OpenAPI source; and
- an input path equal to the final bundle manifest.

The plan records content hashes and byte sizes before writing. All files are staged,
then committed in plan order with `bundle.json` last. A preparation error or cancellation
before commit leaves a previous complete bundle intact. Stale, tool-tracked trace files
are removed only after a successful publication; unrelated files are never swept.

## `bundle.json`

The strict `1.0.0` manifest is derived run metadata, not a second fact document. It
contains:

- `completionState: "complete"`;
- canonical analysis identity, schema, and trustworthy result state;
- the exact requested reporter names;
- analysis and optional OpenAPI input snapshot IDs;
- every published artifact's output-relative path, SHA-256 content hash, byte size, and
  `canonical` or `run_metadata` stability class.

The manifest does not list itself, avoiding recursive self-hashing. It is deterministic
for the same prepared bytes. `run.json` is explicitly marked `run_metadata`; its hash
may change because repository paths and scan timing are intentionally non-canonical.

Bundled graph, controls, OpenAPI, and policy files use the exact existing standalone
renderers and serializers. With equivalent inputs and options their bytes are identical
to the corresponding standalone command outputs.
