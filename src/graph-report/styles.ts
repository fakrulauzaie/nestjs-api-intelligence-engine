export const OFFLINE_GRAPH_REPORT_STYLES = String.raw`
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #172033;
  background: #eef2f7;
  --panel: #ffffff;
  --line: #d5dce8;
  --muted: #637087;
  --primary: #2457d6;
  --primary-soft: #eaf0ff;
  --danger: #b42318;
  --warning: #9a6700;
  --unknown: #6f42c1;
  --success: #18794e;
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { min-height: 100vh; }
button, input, select { font: inherit; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible {
  outline: 3px solid #86a8ff;
  outline-offset: 2px;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1.15rem;
  color: #fff;
  background: #172033;
  border-bottom: 3px solid #2457d6;
}
.brand { display: flex; align-items: baseline; gap: 0.65rem; }
.brand h1 { margin: 0; font-size: 1.05rem; letter-spacing: 0.015em; }
.brand span { color: #c8d4ec; font-size: 0.78rem; }
.snapshot { color: #dbe5f7; font-size: 0.76rem; text-align: right; }

.layout {
  display: grid;
  grid-template-columns: minmax(280px, 350px) minmax(0, 1fr);
  min-height: calc(100vh - 58px);
}
.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--panel);
  border-right: 1px solid var(--line);
}
.filters { padding: 1rem; border-bottom: 1px solid var(--line); }
.filters h2, .main h2, .inspector h3 { margin: 0; }
.filters h2 { font-size: 0.92rem; margin-bottom: 0.8rem; }
.filter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
.filter-grid label { color: #3b4659; font-size: 0.72rem; font-weight: 700; }
.filter-grid label:first-child { grid-column: 1 / -1; }
.filter-grid input, .filter-grid select {
  width: 100%;
  margin-top: 0.25rem;
  padding: 0.48rem 0.55rem;
  color: #172033;
  background: #fff;
  border: 1px solid #b9c3d3;
  border-radius: 6px;
}
.result-count { margin: 0; padding: 0.65rem 1rem; color: var(--muted); font-size: 0.78rem; }
.endpoint-list { overflow: auto; margin: 0; padding: 0 0.65rem 1rem; list-style: none; }
.endpoint-button {
  width: 100%;
  margin-bottom: 0.45rem;
  padding: 0.62rem 0.7rem;
  text-align: left;
  color: #263247;
  background: #f8fafc;
  border: 1px solid var(--line);
  border-radius: 7px;
  cursor: pointer;
}
.endpoint-button:hover { border-color: #8ca8e8; }
.endpoint-button[aria-pressed="true"] { background: var(--primary-soft); border-color: var(--primary); }
.endpoint-route { display: block; margin-top: 0.28rem; overflow-wrap: anywhere; font-size: 0.82rem; }

.main { min-width: 0; padding: 1rem; }
.endpoint-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 0.55rem; }
.endpoint-heading h2 { margin-right: auto; font-size: 1.15rem; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.65rem 0; }
.chip, .badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.025em;
}
.chip { padding: 0.25rem 0.48rem; color: #3f4d63; background: #e9eef5; }
.badge { padding: 0.18rem 0.38rem; color: #334057; background: #e7edf5; }
.badge.resolved, .badge.none { color: #0d5b3c; background: #dff4e9; }
.badge.ambiguous, .badge.unknown { color: #5d319a; background: #efe5ff; }
.badge.unresolved, .badge.unsupported, .badge.direct { color: #8f1d14; background: #fde5e2; }
.badge.potential { color: #805500; background: #fff0c2; }
.method { color: #fff; background: #2457d6; }

.notice {
  margin: 0.6rem 0;
  padding: 0.55rem 0.7rem;
  color: #5d4300;
  background: #fff7d6;
  border: 1px solid #ead792;
  border-radius: 6px;
  font-size: 0.78rem;
}
.workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 320px); gap: 0.8rem; }
.graph-card, .inspector, .fallback, .facts {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 9px;
  box-shadow: 0 1px 2px rgba(18, 32, 56, 0.05);
}
.graph-card { min-width: 0; overflow: hidden; }
.graph-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  min-height: 2.8rem;
  padding: 0.5rem 0.65rem;
  color: var(--muted);
  background: #f7f9fc;
  border-bottom: 1px solid var(--line);
  font-size: 0.72rem;
}
.graph-toolbar button {
  padding: 0.36rem 0.55rem;
  color: #263247;
  background: #fff;
  border: 1px solid #b9c3d3;
  border-radius: 5px;
  cursor: pointer;
}
.graph-toolbar button:hover:not(:disabled) { border-color: #6f91df; background: var(--primary-soft); }
.graph-toolbar button:disabled { color: #8a94a6; cursor: not-allowed; }
.graph-toolbar span { margin-left: auto; }
#graph { position: relative; width: 100%; min-height: 520px; background: #fbfcfe; }
.graph-caption { margin: 0; padding: 0.48rem 0.7rem; color: var(--muted); border-top: 1px solid var(--line); font-size: 0.72rem; }
.inspector { min-height: 520px; padding: 0.8rem; overflow: auto; }
.inspector h3 { font-size: 0.9rem; }
.inspector-empty { color: var(--muted); font-size: 0.8rem; }
.evidence-card { margin-top: 0.7rem; padding-top: 0.65rem; border-top: 1px solid var(--line); }
.evidence-card code { display: block; margin: 0.25rem 0; color: #24334d; overflow-wrap: anywhere; font-size: 0.72rem; user-select: text; }
.evidence-card pre {
  max-height: 180px;
  margin: 0.4rem 0 0;
  padding: 0.55rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: #dbe6ff;
  background: #182238;
  border-radius: 5px;
  font: 0.7rem ui-monospace, SFMono-Regular, Consolas, monospace;
}

.facts { margin-top: 0.8rem; padding: 0.8rem; }
.facts-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.8rem; }
.facts h3 { margin: 0 0 0.4rem; font-size: 0.82rem; }
.facts ul { margin: 0; padding-left: 1.1rem; color: #445069; font-size: 0.76rem; }
.facts li { margin-bottom: 0.28rem; overflow-wrap: anywhere; }

.fallback { margin-top: 0.8rem; overflow: hidden; }
.fallback summary { padding: 0.75rem 0.85rem; cursor: pointer; font-weight: 750; }
.table-scroll { overflow: auto; border-top: 1px solid var(--line); }
table { width: 100%; border-collapse: collapse; font-size: 0.74rem; }
th, td { padding: 0.48rem 0.55rem; text-align: left; border-bottom: 1px solid #e2e7ef; vertical-align: top; }
th { color: #354258; background: #f3f6fa; }
td { overflow-wrap: anywhere; }
.empty { padding: 2rem; color: var(--muted); text-align: center; }
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 980px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { max-height: 520px; border-right: 0; border-bottom: 1px solid var(--line); }
  .workspace { grid-template-columns: 1fr; }
  .inspector { min-height: 220px; }
}
@media (max-width: 620px) {
  .app-header, .endpoint-heading { align-items: flex-start; flex-direction: column; }
  .snapshot { text-align: left; }
  .filter-grid, .facts-grid { grid-template-columns: 1fr; }
  .filter-grid label:first-child { grid-column: auto; }
  .main { padding: 0.65rem; }
  .graph-toolbar span { width: 100%; margin-left: 0; }
}
`;
