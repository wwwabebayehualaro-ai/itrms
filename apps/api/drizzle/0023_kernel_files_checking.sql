DROP INDEX "kernel"."files_purge_idx";--> statement-breakpoint
CREATE INDEX "files_purge_idx" ON "kernel"."files" USING btree ("expires_at") WHERE "kernel"."files"."status" in ('pending', 'checking', 'rejected') or ("kernel"."files"."status" = 'stored' and "kernel"."files"."linked_id" is null);--> statement-breakpoint
-- Hand-written (task 0.15 review): `checking`, the state one confirmation holds while it copies and checks an upload
ALTER TABLE "kernel"."files" DROP CONSTRAINT "files_status_check";
--> statement-breakpoint
ALTER TABLE "kernel"."files"
    ADD CONSTRAINT "files_status_check" CHECK ("status" IN ('pending', 'checking', 'stored', 'rejected', 'expired'));
