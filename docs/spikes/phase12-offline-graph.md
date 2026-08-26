# Phase 12 offline graph spike

- Date: 2026-08-17
- Runtime: Node.js v22.13.1, Windows x64
- Candidate: Cytoscape.js 3.34.0
- Decision: proceed with a single-file Cytoscape.js report in Phase 23

## Result

The spike generated one 440,347-byte HTML file containing the 435,328-byte minified
Cytoscape browser distribution, graph data, styles, interaction code, and an
accessible text summary. Static inspection found no HTTP, HTTPS, or protocol-relative
`src`/`href` references. The page declares `connect-src 'none'`, so its report code
cannot fetch additional data.

The generated file is disposable spike output under `spikes/phase12/.output/`; it is
not a shipped report or a canonical artifact.

## Reproduction

```text
cd spikes/phase12
pnpm install --ignore-workspace --ignore-scripts
pnpm run offline-graph
```

The build resolves Cytoscape's published browser export and injects it into a static
template. It does not use a CDN, package installer at viewing time, web font, image,
or remote graph-data request.

## Phase 23 constraints

The spike establishes feasibility, not the final report design. Phase 23 must:

- derive graph elements only from a validated report view model;
- HTML-escape labels and serialize data without allowing closing-script injection;
- keep evidence and uncertainty visible rather than flattening them into confident
  edges;
- bound node/edge counts and provide a non-graph summary for large or inaccessible
  cases;
- test the generated file with networking unavailable;
- replace the spike's broad inline-script allowance with generated CSP hashes or an
  equivalently reviewed single-file policy; and
- preserve a text/table path for keyboard and screen-reader users.

No web application, server, or client-side parser is justified for this deliverable.
The single HTML artifact fits the existing deterministic-report boundary and can be
opened locally without executing analyzed target code.

## Reference

- [Cytoscape.js documentation](https://js.cytoscape.org/)
