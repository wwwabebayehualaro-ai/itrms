ALTER TABLE "vehicles"."plate_assignments" ADD COLUMN "replaced_by_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles"."plate_assignments" ADD CONSTRAINT "plate_assignments_replaced_check" CHECK ("vehicles"."plate_assignments"."replaced_by_id" is null or ("vehicles"."plate_assignments"."until" is not null and "vehicles"."plate_assignments"."replaced_by_id" <> "vehicles"."plate_assignments"."id"));--> statement-breakpoint
-- task 1.2c: a plate that ended for another points at the period that replaced it, on the same vehicle. The new period's row is
-- written after the old one ends, in the same transaction: the key is checked at commit.
ALTER TABLE "vehicles"."plate_assignments" ADD CONSTRAINT "plate_assignments_vehicle_id_uq" UNIQUE ("vehicle_id", "id");
--> statement-breakpoint
ALTER TABLE "vehicles"."plate_assignments" ADD CONSTRAINT "plate_assignments_replaced_by_fk"
    FOREIGN KEY ("vehicle_id", "replaced_by_id") REFERENCES "vehicles"."plate_assignments" ("vehicle_id", "id")
    DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
GRANT UPDATE ("replaced_by_id") ON "vehicles"."plate_assignments" TO itrms_app;
--> statement-breakpoint
-- the plates already ended for another before this change: the period that began the day they ended
UPDATE "vehicles"."plate_assignments" AS old
   SET "replaced_by_id" = nxt."id"
  FROM "vehicles"."plate_assignments" AS nxt
 WHERE old."until" IS NOT NULL AND old."replaced_by_id" IS NULL
   AND nxt."vehicle_id" = old."vehicle_id" AND nxt."since" = old."until" AND nxt."id" <> old."id";
