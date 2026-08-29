# ADR 0004: Publish BullMQ branch facts through analysis v4

- Status: Accepted
- Date: 2026-08-28
- Owner: Phase 39

## Context

Analysis v3 represents a BullMQ worker as one queue-wide `InteractionHandlerRecord`.
This is honest for Phase 35, but it cannot distinguish effects selected by
`job.name`, work common to every job, unmatched/default work, or effects in an
unsupported residual region.

The v3 schema is strict. Adding optional branch arrays to it would silently change a
published contract and make absence ambiguous: an older document has no branch
capability, whereas a newer scan might prove that a handler has no branches. Copying
job names onto handlers would also collapse handler identity, branch selection, and
broker delivery into one misleading record.

## Decision

1. Freeze analysis schema `3.0.0`. Phase 39 introduces an internal, independently
   validated branch contract and publishes no branch facts in an analysis document.
2. Phase 40 will introduce analysis schema `4.0.0` with three top-level record
   families:
   `interactionHandlerDispatches`, `interactionHandlerBranches`, and
   `interactionHandlerBranchEffects`.
3. Keep the queue-wide `InteractionHandlerRecord` and
   `INTERACTION_MATCHES_LOCAL_HANDLER` assertion. Candidate matching selects a local
   handler first; branch applicability is evaluated only after that candidate edge.
   Neither relationship proves worker execution or broker delivery.
4. A dispatch is `complete`, `partial`, or `unsupported`. Branch selectors are:
   exact job sets, all jobs, unmatched jobs with exact exclusions, and unknown.
5. Common prelude and `finally` effects use `all_jobs`. Default and supported
   unmatched fallthrough use `unmatched_jobs`. Unsupported control flow retains its
   effects under `unknown`; effects are never dropped or copied to every exact job.
6. A branch effect references an existing canonical assertion. It proves that the
   assertion's call-site evidence lies in one branch; it does not create a competing
   call, table, or interaction fact model.
7. The bounded Phase 40 grammar starts with direct `switch (job.name)` and direct
   equality chains on the exact `process()` parameter symbol. Mutation, aliases,
   compound predicates, dynamic labels, and non-empty fallthrough fail closed into
   residual unknown regions.
8. Comparison semantic keys will be structural:
   - dispatch: handler key plus dispatch rule;
   - branch: dispatch key plus canonical selector and control-flow kind; and
   - effect: branch key plus effect kind, target semantic key, and source assertion
     semantic key.
9. V1, v2, and v3 readers report branch capability as unavailable, not as a proven
   empty branch family. Comparison, impact, policies, structured exports, Markdown,
   and graph schemas migrate independently and must be audited in Phase 40.

## Compatibility contract

| Reader/view             | v1-v3                                       | v4                                                    |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------- |
| Queue-wide handler      | Available in v3                             | Retained                                              |
| Branch capability       | Unavailable                                 | Available, possibly with complete/partial/unsupported |
| Exact-job applicability | Not representable                           | Derived from compatible selector records              |
| Broker delivery         | Never proven                                | Never proven                                          |
| Unsupported effects     | Queue-wide with `JOB_QUEUE_FILTER_UNPROVEN` | Preserved under an explicit unknown residual selector |

## Consequences

- Phase 39 can freeze semantic ground truth without churning every strict v3
  producer, fixture, and consumer.
- Phase 40 has an explicit migration boundary and cannot quietly reinterpret old
  queue-wide facts as exact-job facts.
- Branch effects reuse existing evidence-backed assertions, so trace consumers do not
  need two sources of truth for calls or database access.
- A v4 migration is intentionally broader than extractor code because all derived
  artifact schemas must distinguish unavailable branch data from an empty result.

## Rejected alternatives

- Add optional arrays to v3: rejected because absence conflates unsupported
  capability with an empty result and changes a frozen strict document.
- Duplicate one handler per exact job: rejected because one worker method remains one
  deployment candidate and common/residual work would be over-attributed.
- Add a job predicate to every assertion: rejected because it creates a second
  assertion identity and complicates unrelated consumers.
- Implement a general control-flow graph first: rejected as speculative and too broad
  for the bounded BullMQ value target.
- Drop unsupported branch effects: rejected because false negatives violate the
  engine's evidence-preserving contract.
