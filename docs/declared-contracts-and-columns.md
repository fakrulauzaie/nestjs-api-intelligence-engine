# Declared Request/Response Contracts and Entity Columns

Phase 19 inventories source declarations needed by later provenance analysis. It does
not execute the target application, decorators, mapped-type factories, validators,
transformers, naming strategies, interceptors, or serializers.

## Canonical v2 records

Analysis schema `2.0.0` adds five record families:

- `ContractTypeRecord` identifies an in-repository class or interface and labels its
  visible shape as `declarations`, `checker_derived`, or `unknown`;
- `ContractFieldRecord` records checker-visible fields, optional/readonly/inherited
  state, a proven declaring type where available, and class-validator annotations as
  declared constraints only;
- `RequestParameterRecord` records the handler method, parameter index/name,
  checker-proven Nest source, selector state, and declared/checker type shape;
- `ResponseContractRecord` records the outer handler return type, one bounded
  `Promise<T>` unwrap, simple arrays/unions, and manual response handling; and
- `EntityColumnRecord` records the effective entity, declaring class, property and
  database names, supported primary/generated kind, literal insert/update options,
  transformer presence, and proven in-repository inheritance.

The ownership predicates are `METHOD_DECLARES_REQUEST_PARAMETER`,
`METHOD_DECLARES_RESPONSE`, `CONTRACT_TYPE_DECLARES_FIELD`, and
`ENTITY_DECLARES_COLUMN`. These are declaration relationships, not value-flow edges.
Analysis v1 remains strict and does not accept these fields or predicates.

## Request declarations

The supported decorators are checker-proven `@nestjs/common` `Body`, `Param`, and
`Query`. The analyzer records whole-value use, a string-literal selector, or an
explicit `unknown` selector state. Same-named local decorators are ignored.

Referenced in-repository classes and interfaces receive distinct identities from their
normalized source path and qualified name, so same-named DTOs in different files do
not merge. Inherited properties are projected into the effective DTO shape while
retaining their declaring type. Optional and readonly modifiers remain declaration
facts.

Mapped-type heritage such as `PartialType(CreateDto)` is never invoked. The checker may
expose fields, but the type and its projected fields remain `checker_derived`; the
record does not fabricate source decorators or executed runtime metadata.

Class-validator decorators are listed with their source argument text and evidence as
declared constraints. Their presence does not prove that a `ValidationPipe` is active,
that the request is valid, or that transformation occurs.

## Declared responses

Every supported route handler receives one declared response record. Explicit return
annotations use `declared`; inferred checker return types use `checker_derived`. The
extractor unwraps at most one `Promise<T>` and represents simple arrays and unions
without choosing one union member. `void`, `any`, `unknown`, anonymous shapes, and
complex generics remain explicit states instead of being expanded from method bodies.

A checker-proven `@Res()` declaration marks handling as `manual`. The declared return
type is still visible, but no serialized HTTP response schema is claimed. Interceptors,
class-transformer, content negotiation, and adapter-specific response behavior are
outside this phase.

## TypeORM entity columns

The supported decorator set is `Column`, `PrimaryColumn`, and
`PrimaryGeneratedColumn` from checker-proven `typeorm`. Literal object options expose
an explicit `name`, `insert`, `update`, and transformer-presence flag. With no dynamic
options, the property name is retained as a documented `property_name_fallback`.

That fallback is not proof of a physical database identifier under a configured naming
strategy. Dynamic options and object spreads produce `unknown` metadata rather than a
guessed name or flag. Transformer code is never evaluated. Embedded prefixes,
relations, virtual columns, `EntitySchema`, database-generated side effects, and
project naming strategies remain outside the record.

In-repository base classes are followed through checker-proven inheritance. An
effective entity column retains both its entity and its declaring class; a derived
property with the same name replaces the inherited declaration for this bounded
inventory.

## Report artifact

`scan` and `report` write `contracts.md` beside `endpoints.md`. It lists supported
request sources, referenced DTO/interface fields, declared returns, and entity columns
with repository-relative evidence. The report is a presentation over validated
canonical JSON and cannot add validation or serialization. Phase 20 provenance is
reported separately in the same artifact and cannot add inter-method or exact-value lineage
claims.

Phase 20 consumes these stable origin and sink identities for bounded local influence
analysis. The separate
[provenance guide](request-to-column-provenance.md) defines the supported flow and
`REQUEST_FIELD_MAY_FLOW_TO_COLUMN` honesty boundary.

Phase 19 itself emits no `REQUEST_FIELD_MAY_FLOW_TO_COLUMN` edge; that relationship is
owned exclusively by the bounded Phase 20 provenance pass.
