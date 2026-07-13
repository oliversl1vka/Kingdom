-- KingdomOS Phase 1 — P1.3 Process-isolated worker leases
-- A running job is owned by exactly one OS process. lease_owner_pid records the
-- PID of the worker process; lease_expires_at is renewed by the heartbeat. The
-- crash-recovery reconciler (P1.4) treats a running/streaming job whose owning
-- PID is dead (or whose lease has expired with no live PID) as provably orphaned
-- and rolls it back. cancellation.ts kills the worker by this PID.

INSERT INTO schema_version (version) VALUES (18);

ALTER TABLE jobs ADD COLUMN lease_owner_pid   INTEGER;
ALTER TABLE jobs ADD COLUMN lease_expires_at  TEXT;
