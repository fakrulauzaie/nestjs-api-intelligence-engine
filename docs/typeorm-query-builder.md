# Bounded TypeORM QueryBuilder Analysis

Phase 17 recognizes common TypeORM QueryBuilder reads and writes without generating or
parsing SQL. It uses the TypeScript checker to prove the receiver, a small method-local
state machine to prove builder transitions, and the existing canonical
`METHOD_READS_TABLE`/`METHOD_WRITES_TABLE` assertions for publication.

## Proven roots

The analyzer starts a builder state only from one of these receivers:

- a constructor-bound member whose checker type is exactly TypeORM `Repository<T>`;
  `T` must resolve to an in-repository `@Entity` to supply the initial table;
- a checker-proven TypeORM `DataSource` or `EntityManager` receiver;
- `DataSource`/`EntityManager.createQueryBuilder(EntityOrLiteral, alias)` with a
  supported target; or
- a select builder that later receives `.from(EntityOrLiteral, alias)`.

Package declaration identity is required. A local class or arbitrary object with a
method named `createQueryBuilder` is ignored. A receiver union containing TypeORM and
non-TypeORM possibilities is ambiguous and creates no table-access assertion.

An entity target must resolve through the existing `@Entity` mapping. A static table
target may be a non-empty string literal, no-substitution template, or one direct,
immutable local `const` hop. Static table targets use v2-only
`query_builder_literal` provenance and a provenance-qualified table ID. They are not
attached to a similarly named entity/table record.

## Bounded flow

Two flow shapes are supported:

1. one direct fluent expression; or
2. one method-local builder variable with an initializer that dominates its uses, no
   reassignment, and no escape through an argument, alias, property, or direct return.

The state machine tracks `select`, `insert`, `update`, and `delete` builder kinds plus
proven root/read/write tables. Common predicates, selection, grouping, ordering,
pagination, values, set, returning, and parameter operations preserve state.

| Transition or terminal                                     | Published fact                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `getOne`, `getMany`, `getRawOne`, `getRawMany`, `getCount` | `METHOD_READS_TABLE` for every proven select/root/join table |
| `stream`                                                   | The same proven read direction                               |
| `insert().into(target).execute()`                          | `METHOD_WRITES_TABLE` with `typeorm.query-builder.insert.v1` |
| `update(target).set(...).execute()`                        | `METHOD_WRITES_TABLE` with `typeorm.query-builder.update.v1` |
| `delete().from(target).execute()`                          | `METHOD_WRITES_TABLE` with `typeorm.query-builder.delete.v1` |
| Explicit entity-class join                                 | Additional read with `typeorm.query-builder.join.v1`         |

Repository-rooted write builders may retain their proven repository entity as the
write target. DataSource/manager write builders require a proven explicit target.
`getSql()` and `getQuery()` only inspect generated text and are never execution
terminals.

## Evidence and canonical output

Every resolved terminal includes evidence for the proven root, constructor/member or
checker resolution, entity/literal table source, builder-kind transition, and execution
terminal. Entity targets also retain their entity decorator/declaration evidence.

No query AST or generated SQL enters `analysis.json`. QueryBuilder operations publish
the existing table-access predicates with these rule IDs:

- `typeorm.query-builder.select.v1`;
- `typeorm.query-builder.join.v1`;
- `typeorm.query-builder.insert.v1`;
- `typeorm.query-builder.update.v1`; and
- `typeorm.query-builder.delete.v1`.

Because the terminal facts use the established predicates, endpoint trace, semantic
diff, potential impact, and architecture-policy evaluation consume them without a
QueryBuilder-specific inference layer.

## Explicit uncertainty

| Diagnostic                               | Boundary                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS`  | Mixed receiver types, multiple entity possibilities, or local reassignment   |
| `TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED` | Callback subquery, CTE, relation join, builder escape, or unknown transition |
| `TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED` | Dynamic/missing entity or table source, or terminal without a proven target  |
| `TYPEORM_QUERY_BUILDER_TERMINAL_MISSING` | No execution terminal, including `getSql()`/`getQuery()` inspection          |

A relation-string join such as `note.comments` produces no joined-table fact because
relation metadata is not modeled. The already-proven repository root read may remain.
Callback sources, CTEs, dynamic sources, builder helpers/escapes, and reassigned local
builders never create guessed table facts. The analyzer does not parse CTE text,
subquery callbacks, relation names, or generated SQL.

Raw SQL through `query()` or tagged SQL remains outside this QueryBuilder state machine
and is handled by the separate opt-in PostgreSQL 18 extractor documented in
[Static PostgreSQL Raw-SQL Analysis](postgresql-raw-sql.md).
