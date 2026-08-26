# Phase 12 PostgreSQL parser spike

- Date: 2026-08-17
- Runtime: Node.js v22.13.1, Windows x64
- Decision: use `libpg-query@18.1.2` directly in Phase 18
- PostgreSQL policy: explicit PostgreSQL 18 only for the first raw-SQL release

## Decision

Phase 18 will use the PostgreSQL-native `libpg-query` WASM package, pinned exactly to
`18.1.2`. It loaded through its documented ESM package entry on the supported Node
runtime, parsed every valid statement in the spike, rejected invalid syntax, has the
smallest relevant dependency surface, and exposes the same PostgreSQL parse tree that
the higher-level `pgsql-parser` wrapper returned.

`pgsql-parser@18.1.1` remains a viable substitute if Phase 18 later needs its deparser
or traversal helpers. It is not selected now because raw table-access extraction does
not need SQL regeneration, and its wrapper brings a deparser dependency while yielding
the same measured AST.

`node-sql-parser@5.4.0` is not an automatic fallback. It rejected PostgreSQL
`DELETE ... USING` and its installed package directory was much larger. It may be
reconsidered only behind a future explicit multi-dialect adapter with separate
fixtures and diagnostics.

## Version and failure policy

Phase 18 must make dialect selection explicit in strict configuration. Its initial
supported value is `postgresql-18`; an absent or different dialect cannot emit proven
raw-SQL table facts. A future phase may either leave extraction disabled with an
unsupported diagnostic or add another deliberately tested parser version. It must
never silently parse another PostgreSQL major as 18.

Parser upgrades are deliberate compatibility changes: pin the new exact package
version, add the corresponding configuration value, rerun the frozen SQL corpus, and
review AST-shape goldens before publication. The parser AST is private implementation
data and must never appear in canonical output.

Parse failure, multiple statements where only one is supported, a dynamic SQL
expression, an unrecognized statement, or an unsupported AST shape produces an
explicit gap. None may be converted into a best-effort table edge.

## Reproduction

The spike is an isolated package so none of its candidates are production
dependencies:

```text
cd spikes/phase12
pnpm install --ignore-workspace --ignore-scripts
pnpm run parser
```

The lockfile freezes the compared versions. The harness parses six valid statements
and one invalid statement, then repeats each successfully parsed valid statement 100
times. Timing is a local dependency-selection signal, not a product performance
guarantee.

## Results

| Candidate         | Version | Valid cases | Invalid rejected | Load + warm | Warm parses | Mean warm parse | License    |
| ----------------- | ------: | ----------: | ---------------: | ----------: | ----------: | --------------: | ---------- |
| `libpg-query`     |  18.1.2 |         6/6 |              yes |    36.30 ms |         600 |         0.03 ms | MIT        |
| `pgsql-parser`    |  18.1.1 |         6/6 |              yes |   123.19 ms |         600 |         0.02 ms | MIT        |
| `node-sql-parser` |   5.4.0 |         5/6 |              yes |   131.23 ms |         500 |         0.19 ms | Apache-2.0 |

The valid corpus covers:

- a schema-qualified select with a join;
- `INSERT ... SELECT`;
- `UPDATE ... FROM`;
- `DELETE ... USING`;
- a CTE with a join; and
- a quoted schema and mixed-case table.

Direct published package-directory sizes were 1,825,686 bytes for `libpg-query`,
12,703 bytes for the `pgsql-parser` wrapper, and 92,373,153 bytes for
`node-sql-parser`. The wrapper figure is not its closure: its measured closure is
approximately 2.95 MB because it includes `libpg-query`, `pgsql-deparser`, and shared
PostgreSQL types. The direct `libpg-query` closure is approximately 1.91 MB. These are
unpacked local measurements and are not registry transfer sizes.

## AST findings

Both PostgreSQL-native candidates returned the same tree sizes and `RangeVar` shapes.
That shape preserves quoted identifiers and schema qualification, but a generic
recursive `RangeVar` walk is not a valid extractor:

- statement targets are stored in statement-specific fields and were not all found by
  the generic walk;
- the CTE reference `recent` looks like a relation and must be excluded from physical
  tables; and
- read/write direction depends on statement context, not on a relation node alone.

Phase 18 therefore needs a bounded visitor for supported `SelectStmt`, `InsertStmt`,
`UpdateStmt`, and `DeleteStmt` fields, a CTE-name scope, explicit target/source
direction rules, and an unsupported diagnostic for every unhandled statement or
shape. Parser success alone is not evidence of a database edge.

## References

- [libpg-query Node package source](https://github.com/constructive-io/libpg-query-node)
- [pgsql-parser source and versioned package family](https://github.com/constructive-io/pgsql-parser)
- [node-sql-parser source](https://github.com/taozhi8833998/node-sql-parser)
