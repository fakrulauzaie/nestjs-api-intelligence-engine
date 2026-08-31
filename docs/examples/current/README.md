# Current Generated Examples

These files are generated from the repository-local `example-nestjs-app` by the
current scanner and are checked against current renderer output by Documentation Gate
D1. They demonstrate analysis schema `7.0.0`; the compact JSON file is a documented
summary, not a complete canonical analysis document. The checked-in Markdown replaces
the revision-sensitive analysis ID with `<run-specific-analysis-id>` so the examples
remain valid across repository revisions and local Git trust settings. The conformance
check also treats order-only differences among equivalent evidence entries as
run-specific because their stable IDs include the repository revision.

- `endpoints.md` — complete current endpoint catalogue;
- `read-trace.md` — current `GET /notes` trace;
- `write-trace.md` — current `POST /notes` trace; and
- `analysis-summary.json` — current schema, capability, and record-count summary.

Regenerate the source artifacts with:

```powershell
pnpm run build
pnpm run cli -- scan example-nestjs-app --output .tmp/docs-current-example
```

Do not hand-edit the generated Markdown files. Update them only after the current
renderer and documentation conformance test agree.
