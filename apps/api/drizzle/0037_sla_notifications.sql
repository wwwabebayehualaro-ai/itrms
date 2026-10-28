CREATE TABLE "kernel"."notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"message_key" text NOT NULL,
	"params" jsonb NOT NULL,
	"link" jsonb,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow"."holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow"."working_calendars" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"week" jsonb NOT NULL,
	"half_days" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow"."case_tasks" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow"."case_tasks" ADD COLUMN "overdue_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow"."cases" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kernel"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "kernel"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kernel"."notifications" ADD CONSTRAINT "notifications_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow"."holidays" ADD CONSTRAINT "holidays_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow"."working_calendars" ADD CONSTRAINT "working_calendars_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "kernel"."notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_org_path_gist" ON "kernel"."notifications" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_unit_date_uq" ON "workflow"."holidays" USING btree ("unit_id","date");--> statement-breakpoint
CREATE INDEX "holidays_org_path_gist" ON "workflow"."holidays" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "working_calendars_unit_uq" ON "workflow"."working_calendars" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "working_calendars_org_path_gist" ON "workflow"."working_calendars" USING gist ("org_path");--> statement-breakpoint
CREATE INDEX "case_tasks_due_idx" ON "workflow"."case_tasks" USING btree ("due_at") WHERE status = 'open' and overdue_at is null;--> statement-breakpoint
CREATE INDEX "cases_due_idx" ON "workflow"."cases" USING btree ("due_at") WHERE due_at is not null and closed_at is null;