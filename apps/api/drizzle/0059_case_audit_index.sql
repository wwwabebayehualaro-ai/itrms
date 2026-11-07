-- A case's audit trail (task 0.25e): its rows are found by the case they name, as platform/workflow/api/case-audit.ts asks
-- (the same expression, so the planner uses this index). The case's own row is found by audit_log_row_idx.
CREATE INDEX "audit_log_case_idx" ON "kernel"."audit_log"
    ((coalesce("diff"->'after'->>'caseId', "diff"->'before'->>'caseId', "diff"->>'caseId')));
