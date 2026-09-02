export const OFFLINE_SYSTEM_REPORT_STYLES = String.raw`
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #08111f; color: #e8eef8; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 20% 0%, #14284a 0, #08111f 34rem); }
header { display: flex; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; border-bottom: 1px solid #29405f; background: #0b1728e8; }
h1, h2, h3, p { margin-top: 0; }
h1 { margin-bottom: .2rem; font-size: 1.35rem; }
.subtitle, .snapshot, .muted { color: #a9b8cd; }
.snapshot { text-align: right; font-size: .78rem; }
.notice { margin: 1rem; padding: .8rem 1rem; border: 1px solid #d7a934; border-radius: .5rem; background: #332709; color: #ffe7a3; }
.layout { display: grid; grid-template-columns: minmax(15rem, 22rem) 1fr; min-height: calc(100vh - 76px); }
.sidebar { padding: 1rem; border-right: 1px solid #29405f; background: #0b1728cc; overflow: auto; }
label { display: grid; gap: .35rem; margin-bottom: .7rem; font-size: .76rem; color: #a9b8cd; }
input, select { width: 100%; padding: .55rem; border: 1px solid #365171; border-radius: .4rem; background: #0d1c30; color: #e8eef8; }
.correlations { list-style: none; padding: 0; margin: .75rem 0; display: grid; gap: .45rem; }
.correlations button { width: 100%; padding: .65rem; text-align: left; border: 1px solid #2f4969; border-radius: .45rem; background: #10223a; color: inherit; cursor: pointer; }
.correlations button:hover, .correlations button.active { border-color: #6eb5ff; background: #183657; }
.state { display: inline-block; margin-top: .35rem; padding: .15rem .4rem; border-radius: 999px; background: #243b58; color: #c8daf1; font-size: .68rem; }
.main { padding: 1rem; min-width: 0; }
.summary { display: flex; flex-wrap: wrap; gap: .45rem; margin-bottom: 1rem; }
.chip { padding: .35rem .55rem; border: 1px solid #2f4969; border-radius: 999px; background: #10223a; font-size: .74rem; }
.workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(15rem, 22rem); gap: 1rem; }
.card { border: 1px solid #29405f; border-radius: .65rem; background: #0c1829e8; overflow: hidden; }
.graph-card { display: grid; grid-template-rows: auto 1fr; }
.graph-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: .45rem; min-height: 2.9rem; padding: .55rem .7rem; border-bottom: 1px solid #29405f; background: #0b1728; }
.graph-toolbar button { padding: .38rem .6rem; border: 1px solid #365171; border-radius: .4rem; background: #10223a; color: #e8eef8; cursor: pointer; }
.graph-toolbar button:hover, .graph-toolbar button[aria-pressed="true"] { border-color: #6eb5ff; background: #183657; }
.graph-toolbar .muted { margin-left: auto; font-size: .74rem; }
#graph { position: relative; width: 100%; min-height: 32rem; }
.inspector { padding: 1rem; min-height: 12rem; }
.inspector dl { display: grid; grid-template-columns: max-content 1fr; gap: .45rem .75rem; font-size: .8rem; }
.inspector dt { color: #91a6c0; }
.inspector dd { margin: 0; overflow-wrap: anywhere; }
.section { margin-top: 1rem; padding: 1rem; }
.table-scroll { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: .78rem; }
th, td { padding: .55rem; border-bottom: 1px solid #263c58; text-align: left; vertical-align: top; }
th { color: #a9b8cd; }
.pass { color: #72e5aa; }
.fail { color: #ff8e8e; }
.unknown { color: #ffd271; }
code { color: #b9d8ff; }
@media (max-width: 900px) { .layout, .workspace { grid-template-columns: 1fr; } .sidebar { border-right: 0; border-bottom: 1px solid #29405f; } .graph-toolbar .muted { width: 100%; margin-left: 0; } #graph { min-height: 28rem; } }
`;
