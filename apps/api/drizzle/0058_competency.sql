CREATE SCHEMA "competency";
--> statement-breakpoint
CREATE TABLE "competency"."driver_licences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"person_id" uuid NOT NULL,
	"number" text,
	"status" text DEFAULT 'pending_national' NOT NULL,
	"kind" text DEFAULT 'temporary' NOT NULL,
	"issued_on" date,
	"valid_until" date,
	"national_reference" text,
	"case_id" uuid,
	"void_reason" text,
	CONSTRAINT "driver_licences_active_check" CHECK (status <> 'active' OR (number IS NOT NULL AND issued_on IS NOT NULL AND valid_until IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "competency"."exam_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"session_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"theory" integer,
	"practical" integer,
	"passed" boolean NOT NULL,
	CONSTRAINT "exam_results_scores_check" CHECK (coalesce(theory, 0) BETWEEN 0 AND 100 AND coalesce(practical, 0) BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "competency"."exam_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"held_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competency"."licence_grade_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"family" text NOT NULL,
	"min_age" integer,
	"min_education" integer NOT NULL,
	"prerequisites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prerequisite_months" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competency"."licence_grades" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"handling_org_path" "ltree" DEFAULT '' NOT NULL,
	"licence_id" uuid NOT NULL,
	"grade_type_id" uuid NOT NULL,
	"permanent_since" date
);
--> statement-breakpoint
CREATE TABLE "competency"."licence_print_batch_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"batch_id" uuid NOT NULL,
	"licence_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competency"."licence_print_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"national_reference" text
);
--> statement-breakpoint
CREATE TABLE "competency"."medical_certificates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"person_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"facility" text NOT NULL,
	"examined_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competency"."training_enrolments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"person_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"grade_type_id" uuid NOT NULL,
	"status" text DEFAULT 'enrolled' NOT NULL,
	"completed_on" date,
	CONSTRAINT "training_enrolments_completed_check" CHECK ((status = 'completed') = (completed_on IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "competency"."driver_licences" ADD CONSTRAINT "driver_licences_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."exam_results" ADD CONSTRAINT "exam_results_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."exam_results" ADD CONSTRAINT "exam_results_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "competency"."exam_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."exam_sessions" ADD CONSTRAINT "exam_sessions_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."licence_grade_types" ADD CONSTRAINT "licence_grade_types_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."licence_grades" ADD CONSTRAINT "licence_grades_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."licence_grades" ADD CONSTRAINT "licence_grades_licence_id_driver_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "competency"."driver_licences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."licence_grades" ADD CONSTRAINT "licence_grades_grade_type_id_licence_grade_types_id_fk" FOREIGN KEY ("grade_type_id") REFERENCES "competency"."licence_grade_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."licence_print_batch_items" ADD CONSTRAINT "licence_print_batch_items_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."licence_print_batch_items" ADD CONSTRAINT "licence_print_batch_items_batch_id_licence_print_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "competency"."licence_print_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."licence_print_batch_items" ADD CONSTRAINT "licence_print_batch_items_licence_id_driver_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "competency"."driver_licences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."licence_print_batches" ADD CONSTRAINT "licence_print_batches_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."medical_certificates" ADD CONSTRAINT "medical_certificates_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."training_enrolments" ADD CONSTRAINT "training_enrolments_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency"."training_enrolments" ADD CONSTRAINT "training_enrolments_grade_type_id_licence_grade_types_id_fk" FOREIGN KEY ("grade_type_id") REFERENCES "competency"."licence_grade_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_licences_number_uq" ON "competency"."driver_licences" USING btree ("region_id","number") WHERE number IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_licences_case_uq" ON "competency"."driver_licences" USING btree ("case_id") WHERE case_id IS NOT NULL AND status <> 'voided';--> statement-breakpoint
CREATE INDEX "driver_licences_person_idx" ON "competency"."driver_licences" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "driver_licences_valid_until_idx" ON "competency"."driver_licences" USING btree ("valid_until") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "driver_licences_handling_org_path_gist" ON "competency"."driver_licences" USING gist ("handling_org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_results_attempt_uq" ON "competency"."exam_results" USING btree ("case_id","attempt");--> statement-breakpoint
CREATE INDEX "exam_results_session_idx" ON "competency"."exam_results" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "exam_results_org_path_gist" ON "competency"."exam_results" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_sessions_uq" ON "competency"."exam_sessions" USING btree ("handling_unit_id","held_on");--> statement-breakpoint
CREATE INDEX "exam_sessions_org_path_gist" ON "competency"."exam_sessions" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "licence_grade_types_key_uq" ON "competency"."licence_grade_types" USING btree ("region_id","key");--> statement-breakpoint
CREATE INDEX "licence_grade_types_org_path_gist" ON "competency"."licence_grade_types" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "licence_grades_uq" ON "competency"."licence_grades" USING btree ("licence_id","grade_type_id");--> statement-breakpoint
CREATE INDEX "licence_grades_handling_org_path_gist" ON "competency"."licence_grades" USING gist ("handling_org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "licence_print_batch_items_uq" ON "competency"."licence_print_batch_items" USING btree ("batch_id","licence_id");--> statement-breakpoint
CREATE INDEX "licence_print_batch_items_org_path_gist" ON "competency"."licence_print_batch_items" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "licence_print_batches_open_uq" ON "competency"."licence_print_batches" USING btree ("handling_unit_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "licence_print_batches_org_path_gist" ON "competency"."licence_print_batches" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "medical_certificates_case_uq" ON "competency"."medical_certificates" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "medical_certificates_org_path_gist" ON "competency"."medical_certificates" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "training_enrolments_uq" ON "competency"."training_enrolments" USING btree ("person_id","school_id","grade_type_id");--> statement-breakpoint
CREATE INDEX "training_enrolments_school_idx" ON "competency"."training_enrolments" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "training_enrolments_org_path_gist" ON "competency"."training_enrolments" USING gist ("org_path");
--> statement-breakpoint
-- The register's rules (ADR-0047): its foreign keys to the people register, its scope triggers, grants and RLS classes. What was
-- recorded of an exam or a batch's contents does not change; a licence changes only in the columns its life moves through.
ALTER TABLE "competency"."driver_licences" ADD CONSTRAINT "driver_licences_person_fk" FOREIGN KEY ("person_id") REFERENCES "parties"."persons"("id");
--> statement-breakpoint
ALTER TABLE "competency"."medical_certificates" ADD CONSTRAINT "medical_certificates_person_fk" FOREIGN KEY ("person_id") REFERENCES "parties"."persons"("id");
--> statement-breakpoint
ALTER TABLE "competency"."training_enrolments" ADD CONSTRAINT "training_enrolments_person_fk" FOREIGN KEY ("person_id") REFERENCES "parties"."persons"("id");
--> statement-breakpoint
ALTER TABLE "competency"."training_enrolments" ADD CONSTRAINT "training_enrolments_school_fk" FOREIGN KEY ("school_id") REFERENCES "parties"."organisations"("id");
--> statement-breakpoint
ALTER TABLE "competency"."exam_results" ADD CONSTRAINT "exam_results_person_fk" FOREIGN KEY ("person_id") REFERENCES "parties"."persons"("id");
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."licence_grade_types"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."driver_licences"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."licence_grades"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id', 'handling_org_path');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."medical_certificates"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."training_enrolments"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."exam_sessions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."exam_results"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."licence_print_batches"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "competency"."licence_print_batch_items"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
GRANT USAGE ON SCHEMA "competency" TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "competency"."licence_grade_types",
    "competency"."driver_licences",
    "competency"."licence_grades",
    "competency"."medical_certificates",
    "competency"."training_enrolments",
    "competency"."exam_sessions",
    "competency"."exam_results",
    "competency"."licence_print_batches",
    "competency"."licence_print_batch_items" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("name", "family", "min_age", "min_education", "prerequisites", "prerequisite_months", "active", "updated_at", "updated_by", "row_version")
    ON "competency"."licence_grade_types" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("number", "status", "kind", "issued_on", "valid_until", "national_reference", "void_reason", "updated_at", "updated_by", "row_version")
    ON "competency"."driver_licences" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("permanent_since", "updated_at", "updated_by", "row_version") ON "competency"."licence_grades" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("person_id", "facility", "examined_on", "updated_at", "updated_by", "row_version") ON "competency"."medical_certificates" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "completed_on", "updated_at", "updated_by", "row_version") ON "competency"."training_enrolments" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("status", "national_reference", "updated_at", "updated_by", "row_version") ON "competency"."licence_print_batches" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('competency.licence_grade_types', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('competency.driver_licences', 'registry', 'handling_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('competency.licence_grades', 'registry', 'handling_org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('competency.medical_certificates', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('competency.training_enrolments', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('competency.exam_sessions', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('competency.exam_results', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('competency.licence_print_batches', 'transaction', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('competency.licence_print_batch_items', 'transaction', 'org_path');
