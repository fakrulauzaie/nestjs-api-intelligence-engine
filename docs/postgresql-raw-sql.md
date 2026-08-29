# Static PostgreSQL Raw-SQL Analysis

The opt-in raw-SQL analyzer extracts physical table reads and writes from static SQL issued through
checker-proven TypeORM raw-query APIs. Extraction is opt-in and currently supports
only the exact `postgresql-18` dialect mode backed by `libpg-query@18.1.2`.

```text
pnpm run cli -- scan <repository> --raw-sql-dialect postgresql-18
```

The same opt-in may be supplied as `analysis.rawSqlDialect` in a strict version-2,
version-3, or version-4
[`api-intel.config.json`](project-configuration.md). Without an explicit CLI or config
selection, a proven TypeORM raw-SQL call produces
`TYPEORM_RAW_SQL_DIALECT_UNSELECTED` and no raw-SQL table fact. A different dialect
value is rejected as invalid CLI input. The selected dialect, parser name/version, and
effective safety limits are recorded in both `analysis.json` and `run.json` under
`configuration.rawSql`.

## Proven call sites

The receiver's checker type must resolve exclusively to one or more of these TypeORM
package declarations:

- `Repository<T>`;
- `DataSource`;
- `EntityManager`; or
- `QueryRunner`.

The supported APIs are `.query(sql, parameters?)` and the `.sql` tagged template. A
same-named local class or arbitrary object is ignored. A union mixing a TypeORM
receiver with a non-TypeORM receiver is ambiguous and creates no table assertion.

For `.query()`, the first argument must be a string literal, no-substitution template,
or one uniquely initialized immutable local `const` hop. Concatenation, mutable
bindings, identifier chains, and other computed SQL are never parsed.

For `.sql` tags, ordinary interpolations become PostgreSQL value placeholders (`$1`,
`$2`, and so on) before parsing. Function-wrapped fragments are rejected because
TypeORM uses that form for unescaped identifiers or raw SQL structure. A direct value
interpolation placed where PostgreSQL expects an identifier fails parsing rather than
being reclassified as source text.

## Statement and direction model

The private PostgreSQL visitor handles:

| Statement context                          | Canonical direction               |
| ------------------------------------------ | --------------------------------- |
| `SELECT` `FROM`, joins, and nested selects | read                              |
| `INSERT INTO` target                       | write                             |
| `INSERT ... SELECT` sources                | read                              |
| `UPDATE` target                            | write                             |
| `UPDATE ... FROM` and nested sources       | read                              |
| `DELETE FROM` target                       | write                             |
| `DELETE ... USING` and nested sources      | read                              |
| `WITH`/CTE query bodies                    | their proven statement directions |

CTE names are scoped aliases, not physical tables. A schema-qualified CTE reference is
therefore still a physical relation. Multiple statements are accepted only when every
statement is supported; one unsupported statement discards all candidate facts from
that SQL source.

Schema qualification is preserved. PostgreSQL-normalized lowercase identifiers render
without quotes; case-sensitive or otherwise non-simple identifiers render with the
minimum quotes needed to preserve their semantic components, for example
`audit."EventLog"`. The parser cannot distinguish an unnecessarily quoted lowercase
identifier from its equivalent unquoted form.

Every physical table uses v2-only `raw_sql_literal` name provenance and a
provenance-qualified table ID. It is not silently merged with a same-named
entity-derived or QueryBuilder-literal table.

Resolved accesses publish the existing `METHOD_READS_TABLE` and
`METHOD_WRITES_TABLE` predicates with `typeorm.raw-sql.*.v1` rule IDs. Those facts feed
endpoint trace, semantic diff, potential impact, and architecture policy without
parser-specific inference. The parser AST and SQL text are never canonical records.

## Evidence and limits

Every assertion cites the call/tag site, checker-proven receiver, and bounded static SQL
source. PostgreSQL `RangeVar.location` offsets refer to the decoded SQL string and are
not currently mapped back through TypeScript literal escapes or template segments, so
table-specific parser offsets are not claimed as source locations.

The default enabled limits are:

- 65,536 UTF-8 bytes per static SQL source;
- eight statements per source;
- 250 milliseconds observed parser time; and
- 20,000 retained AST nodes.

All limits and their hard schema maxima are part of run configuration. Input length and
retained-node bounds constrain parser/visitor memory exposure; the parser runs as its
packaged WebAssembly implementation. An over-limit parse is discarded. Cancellation
is checked before every candidate and races parser completion. No timeout or failure
path falls back to regex extraction.

## Explicit uncertainty

| Diagnostic                              | Boundary                                                                |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `TYPEORM_RAW_SQL_DIALECT_UNSELECTED`    | A proven call has no supported explicit dialect/parser configuration    |
| `TYPEORM_RAW_SQL_RECEIVER_AMBIGUOUS`    | Receiver types mix TypeORM and non-TypeORM possibilities                |
| `TYPEORM_RAW_SQL_SOURCE_UNSUPPORTED`    | Dynamic/computed SQL or a function-wrapped tagged fragment              |
| `TYPEORM_RAW_SQL_LIMIT_EXCEEDED`        | SQL bytes, statements, observed parse time, or AST nodes exceed a limit |
| `TYPEORM_RAW_SQL_PARSE_FAILED`          | PostgreSQL 18 rejects the static source                                 |
| `TYPEORM_RAW_SQL_STATEMENT_UNSUPPORTED` | Parsed statement or AST shape is outside the bounded visitor            |

DDL, `CALL`, procedural bodies, `SELECT INTO`, temporary-table lifecycle, cross-database
names, dynamically constructed identifiers, and unsupported PostgreSQL extensions
produce no guessed table facts. Parser success alone is not evidence: the bounded
visitor must explain every statement before any access from that SQL source is
published.
