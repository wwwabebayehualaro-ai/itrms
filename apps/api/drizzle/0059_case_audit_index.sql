-- A case's audit trail (task 0.25e): its rows are found by the case they name, which every audited write of a row that belongs to a
-- case puts beside its change (diff.caseId), and an event puts in its data. The same expression as platform/workflow/api/
-- case-audit.ts asks, so the planner uses this index; the case's own row is found by audit_log_row_idx. Plain, not CONCURRENTLY:
-- migrations run in a transaction, and an installation's audit log is still small (Phase 0); a large one builds it ahead.
CREATE INDEX "audit_log_case_idx" ON "kernel"."audit_log" ((("diff"->>'caseId')));
