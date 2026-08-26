# ADR 0002: Match analysis snapshots with explicit semantic keys

- Status: Accepted
- Date: 2026-08-17
- Owner: Phase 13

## Context

Canonical IDs are integrity identities inside one analysis snapshot. Several IDs are
snapshot-scoped directly or transitively, so the same source declaration can have a
different canonical ID in two independently produced documents. Raw ID equality is
therefore not a valid cross-snapshot comparison rule.

Changing all existing IDs would invalidate v1 goldens and is unnecessary. Comparison
also cannot use fuzzy display-name matching without violating the evidence-first
principle.

## Decision

Build a deterministic semantic projection for each validated input document. A
semantic key is a typed, normalized tuple used only for lookup and comparison. It is
not a replacement canonical ID and is not written back into either analysis.

Initial keys are:

| Kind                | Semantic tuple                                                       |
| ------------------- | -------------------------------------------------------------------- |
| Source file         | normalized repository-relative path                                  |
| Class               | source-file key + checker-qualified class name                       |
| Method              | class key + method name + normalized signature                       |
| Exact endpoint      | upper-case HTTP method + normalized route path + handler method key  |
| Endpoint route slot | upper-case HTTP method + normalized route path                       |
| Guard               | guard class key                                                      |
| Repository binding  | owner class key + injected member name                               |
| Entity              | entity class key                                                     |
| Table               | normalized optional schema + table name + name-source category       |
| Assertion           | semantic subject + predicate + semantic object + rule family/version |
| Diagnostic          | code + semantic subject when present + projected evidence location   |
| Evidence            | source-file key + one-based range + role + source content hash       |

Keys use an unambiguous length-prefixed or canonical-JSON encoding with Unicode NFC
normalization. Display labels, discovery order, absolute paths, and analysis IDs are
not key inputs.

## Endpoint matching

1. Match exact endpoint keys.
2. For unmatched endpoints, match a route slot only when each side has exactly one
   candidate. This permits a handler change to be classified as modified.
3. A path or HTTP method change is an add/remove pair; no fuzzy route similarity is
   used.
4. Duplicate exact keys or route slots create explicit comparison ambiguity. Array
   order never breaks a tie.

## Relocation and signature policy

- Moving a class or method to another source file changes its semantic key. It is
  reported as removal/addition unless an endpoint route-slot rule can classify the
  handler replacement as a modified endpoint.
- Changing a method signature changes its method key.
- A method-body-only change does not change the method key. Potential impact is a
  Phase 14 concern derived from source content hashes and graph reachability.
- Renaming a display label without changing the qualified declaration identity does
  not create a comparison change.

## Ambiguity and collision policy

Projection construction groups records by semantic key. A group with more than one
non-equivalent record is ambiguous and cannot produce an exact match. The derived
document records candidate canonical IDs and a stable reason code. It does not select
the first record or append an occurrence counter.

Hashing a semantic-key encoding is permitted for compact storage, but the unhashed
tuple must remain available in debug/test output so collisions are auditable. Unequal
tuples with the same digest are an integrity failure.

## Source-control independence

The comparison command accepts two explicit analysis-document paths. It does not
inspect a working tree, resolve branches/commits, discover a baseline, or invoke a
source-control command or provider API. Phase 14 derives changed files solely from
the source records and content hashes already present in those documents.

## Required proofs before Phase 13 exits

- Identical semantics with different snapshot-scoped canonical IDs match.
- Same-named declarations in different files do not match.
- Body-only changes keep semantic method identity but are available to impact
  analysis through source hashes.
- Handler rename under one unique route slot is modified, not arbitrary add/remove.
- Duplicate route slots are ambiguous.
- Shuffled record arrays produce byte-identical projections and diffs.
- v1/v1 and v1/v2 inputs follow ADR 0001 normalization.

## Rejected alternatives

- Raw canonical ID equality: invalid across snapshots.
- Display-name or operation-ID matching: insufficiently unique.
- Fuzzy path/name similarity: nondeterministic and hard to explain.
- Removing snapshot scope from all canonical IDs now: unnecessary breaking change.
