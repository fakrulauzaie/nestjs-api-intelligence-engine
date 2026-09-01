# System Stitching Gate S0 Corpus

This frozen corpus defines Phase 45 topology semantics without running either source
service or implementing the Phase 46 stitch engine. The RMQ pair is reduced from the
real `ticket-service-example` producer and `ctt-queue-service-example` consumer. The
BullMQ pair provides the equivalent queue/worker boundary.

Every `.ts.txt` file is parsed and type-checked in an isolated temporary project and
must throw if accidentally executed. `gate.expected.json` covers co-located,
producer-only, consumer-only, multi-service, same-target collision, missing-topology,
and ambiguity cases for both technologies.

The corpus never treats a declared-realm candidate as broker delivery. Pattern,
queue, or job equality without an explicit environment and broker alias remains a
`target_only_candidate` and can never be a proven cross-service edge.
