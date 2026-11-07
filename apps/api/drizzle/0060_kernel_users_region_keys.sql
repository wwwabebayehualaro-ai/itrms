-- a role is held, or asked for, by a user of the row's own region (security review 0.26c1 R3): the composite keys' target first
ALTER TABLE "kernel"."users" ADD CONSTRAINT "users_id_region_uq" UNIQUE("id","region_id");
--> statement-breakpoint
ALTER TABLE "kernel"."role_assignments" DROP CONSTRAINT "role_assignments_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "kernel"."role_grant_requests" DROP CONSTRAINT "role_grant_requests_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "kernel"."role_assignments" ADD CONSTRAINT "role_assignments_user_fk" FOREIGN KEY ("user_id","region_id") REFERENCES "kernel"."users"("id","region_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."role_grant_requests" ADD CONSTRAINT "role_grant_requests_user_fk" FOREIGN KEY ("user_id","region_id") REFERENCES "kernel"."users"("id","region_id") ON DELETE no action ON UPDATE no action;
