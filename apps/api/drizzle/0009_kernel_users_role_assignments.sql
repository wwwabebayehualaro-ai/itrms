CREATE TABLE "kernel"."role_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"user_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"granted_by" uuid,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kernel"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"home_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"keycloak_sub" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kernel"."role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "kernel"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."role_assignments" ADD CONSTRAINT "role_assignments_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."users" ADD CONSTRAINT "users_home_unit_id_org_units_id_fk" FOREIGN KEY ("home_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_assignments_user_idx" ON "kernel"."role_assignments" USING btree ("user_id","unit_id");--> statement-breakpoint
CREATE INDEX "role_assignments_unit_idx" ON "kernel"."role_assignments" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_open_uq" ON "kernel"."role_assignments" USING btree ("user_id","unit_id","role_key") WHERE valid_to is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_keycloak_sub_uq" ON "kernel"."users" USING btree ("keycloak_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "kernel"."users" USING btree ("username");