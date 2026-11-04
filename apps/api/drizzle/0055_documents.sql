CREATE SCHEMA "documents";
--> statement-breakpoint
CREATE TABLE "documents"."document_template_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"template_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"content_hash" text NOT NULL,
	"body" text NOT NULL,
	"strings" jsonb NOT NULL,
	"paper" text NOT NULL,
	"data_schema" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents"."document_templates" (
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
	"latest_version_id" uuid
);
--> statement-breakpoint
CREATE TABLE "documents"."issued_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"handling_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"case_id" uuid,
	"subject_table" text,
	"subject_id" uuid,
	"number" text,
	"language" text NOT NULL,
	"data" jsonb NOT NULL,
	"header" jsonb NOT NULL,
	"office_name" jsonb NOT NULL,
	"state" text DEFAULT 'requested' NOT NULL,
	"failure" text,
	"file_id" uuid,
	"sha256" text
);
--> statement-breakpoint
ALTER TABLE "documents"."document_template_versions" ADD CONSTRAINT "document_template_versions_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents"."document_template_versions" ADD CONSTRAINT "document_template_versions_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "documents"."document_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents"."document_templates" ADD CONSTRAINT "document_templates_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents"."document_templates" ADD CONSTRAINT "document_templates_latest_version_id_document_template_versions_id_fk" FOREIGN KEY ("latest_version_id") REFERENCES "documents"."document_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD CONSTRAINT "issued_documents_handling_unit_id_org_units_id_fk" FOREIGN KEY ("handling_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD CONSTRAINT "issued_documents_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "documents"."document_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD CONSTRAINT "issued_documents_template_version_id_document_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "documents"."document_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD CONSTRAINT "issued_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "kernel"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_content_uq" ON "documents"."document_template_versions" USING btree ("template_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_number_uq" ON "documents"."document_template_versions" USING btree ("template_id","number");--> statement-breakpoint
CREATE INDEX "document_template_versions_org_path_gist" ON "documents"."document_template_versions" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "document_templates_key_uq" ON "documents"."document_templates" USING btree ("region_id","key");--> statement-breakpoint
CREATE INDEX "document_templates_org_path_gist" ON "documents"."document_templates" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "issued_documents_subject_uq" ON "documents"."issued_documents" USING btree ("template_id","subject_id") WHERE subject_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "issued_documents_case_idx" ON "documents"."issued_documents" USING btree ("case_id") WHERE case_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "issued_documents_subject_idx" ON "documents"."issued_documents" USING btree ("subject_id") WHERE subject_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "issued_documents_org_path_gist" ON "documents"."issued_documents" USING gist ("org_path");--> statement-breakpoint
-- Hand-written (task 0.23a, ADR-0044): templates (class C at the region's root, versions never change) and issued documents
-- (class T at the handling unit, what was frozen never changes; only the worker records the PDF). Scope triggers, checks,
-- keys to other slices' tables, grants, RLS.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "documents"."document_templates"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "documents"."document_template_versions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "documents"."issued_documents"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('handling_unit_id');
--> statement-breakpoint
ALTER TABLE "documents"."document_templates"
    ADD CONSTRAINT "document_templates_key_check" CHECK ("key" ~ '^[a-z][a-z0-9-]{1,62}$'),
    ADD CONSTRAINT "document_templates_name_check" CHECK (
        jsonb_typeof("name") = 'object' AND pg_column_size("name") <= 4096);
--> statement-breakpoint
ALTER TABLE "documents"."document_template_versions"
    ADD CONSTRAINT "document_template_versions_number_check" CHECK ("number" >= 1),
    ADD CONSTRAINT "document_template_versions_paper_check" CHECK ("paper" IN ('A4', 'A5', 'card')),
    ADD CONSTRAINT "document_template_versions_body_check" CHECK (length("body") BETWEEN 1 AND 200000),
    ADD CONSTRAINT "document_template_versions_strings_check" CHECK (jsonb_typeof("strings") = 'object'),
    ADD CONSTRAINT "document_template_versions_id_template_uq" UNIQUE ("id", "template_id");
--> statement-breakpoint
-- a template's latest version is one of its own
ALTER TABLE "documents"."document_templates"
    ADD CONSTRAINT "document_templates_latest_version_fk" FOREIGN KEY ("latest_version_id", "id")
        REFERENCES "documents"."document_template_versions" ("id", "template_id");
--> statement-breakpoint
ALTER TABLE "documents"."issued_documents"
    ADD CONSTRAINT "issued_documents_state_check" CHECK ("state" IN ('requested', 'rendered', 'failed')),
    ADD CONSTRAINT "issued_documents_failed_check" CHECK (("state" = 'failed') = ("failure" IS NOT NULL)),
    ADD CONSTRAINT "issued_documents_rendered_check" CHECK (
        ("state" = 'rendered') = ("file_id" IS NOT NULL) AND ("file_id" IS NULL) = ("sha256" IS NULL)),
    ADD CONSTRAINT "issued_documents_sha256_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "issued_documents_subject_check" CHECK (("subject_table" IS NULL) = ("subject_id" IS NULL)),
    ADD CONSTRAINT "issued_documents_number_check" CHECK ("number" IS NULL OR length("number") BETWEEN 1 AND 80),
    ADD CONSTRAINT "issued_documents_data_check" CHECK (
        jsonb_typeof("data") = 'object' AND pg_column_size("data") <= 1048576),
    ADD CONSTRAINT "issued_documents_header_check" CHECK (
        jsonb_typeof("header") = 'object' AND pg_column_size("header") <= 1048576),
    ADD CONSTRAINT "issued_documents_office_check" CHECK (jsonb_typeof("office_name") = 'object'),
    -- the version it was made from is one of its template's
    ADD CONSTRAINT "issued_documents_version_fk" FOREIGN KEY ("template_version_id", "template_id")
        REFERENCES "documents"."document_template_versions" ("id", "template_id"),
    ADD CONSTRAINT "issued_documents_case_fk" FOREIGN KEY ("case_id") REFERENCES "workflow"."cases" ("id");
--> statement-breakpoint
CREATE FUNCTION "documents"."append_only"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "document_template_versions_append_only" BEFORE UPDATE OR DELETE ON "documents"."document_template_versions"
    FOR EACH ROW EXECUTE FUNCTION "documents"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "document_template_versions_no_truncate" BEFORE TRUNCATE ON "documents"."document_template_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION "documents"."append_only"();
--> statement-breakpoint
-- An issued document moves once, from requested; what it says never changes.
CREATE FUNCTION "documents"."issued_once"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    moving constant text[] := ARRAY['org_path', 'state', 'failure', 'file_id', 'sha256', 'updated_at', 'updated_by',
        'row_version'];
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
            RETURN NEW;
        END IF;
        IF OLD.state = 'requested' AND (to_jsonb(NEW) - moving) = (to_jsonb(OLD) - moving) THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'documents.issued_documents keeps what was issued: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "issued_documents_once" BEFORE UPDATE OR DELETE ON "documents"."issued_documents"
    FOR EACH ROW EXECUTE FUNCTION "documents"."issued_once"();
--> statement-breakpoint
CREATE TRIGGER "issued_documents_no_truncate" BEFORE TRUNCATE ON "documents"."issued_documents"
    FOR EACH STATEMENT EXECUTE FUNCTION "documents"."append_only"();
--> statement-breakpoint
GRANT USAGE ON SCHEMA "documents" TO itrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "documents"."document_templates", "documents"."document_template_versions",
    "documents"."issued_documents" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("latest_version_id", "name", "updated_at", "updated_by", "row_version")
    ON "documents"."document_templates" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('documents.document_templates', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('documents.document_template_versions', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('documents.issued_documents', 'transaction', 'org_path');
