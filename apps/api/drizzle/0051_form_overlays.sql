CREATE TABLE "forms"."form_overlay_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"overlay_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"content_hash" text NOT NULL,
	"patch" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms"."form_overlays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"form_id" uuid NOT NULL,
	"patch" jsonb NOT NULL,
	"patch_hash" text NOT NULL,
	"patch_updated_by" uuid,
	"published_version_id" uuid,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "forms"."form_publications_pending_uq";--> statement-breakpoint
DROP INDEX "forms"."form_versions_content_uq";--> statement-breakpoint
DROP INDEX "forms"."form_versions_number_uq";--> statement-breakpoint
ALTER TABLE "forms"."form_publications" ADD COLUMN "overlay_id" uuid;--> statement-breakpoint
ALTER TABLE "forms"."form_publications" ADD COLUMN "overlay_version_id" uuid;--> statement-breakpoint
ALTER TABLE "forms"."form_versions" ADD COLUMN "base_version_id" uuid;--> statement-breakpoint
ALTER TABLE "forms"."form_versions" ADD COLUMN "overlay_version_ids" uuid[];--> statement-breakpoint
ALTER TABLE "forms"."form_overlay_versions" ADD CONSTRAINT "form_overlay_versions_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_overlay_versions" ADD CONSTRAINT "form_overlay_versions_overlay_id_form_overlays_id_fk" FOREIGN KEY ("overlay_id") REFERENCES "forms"."form_overlays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_overlay_versions" ADD CONSTRAINT "form_overlay_versions_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_overlays" ADD CONSTRAINT "form_overlays_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_overlays" ADD CONSTRAINT "form_overlays_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_overlays" ADD CONSTRAINT "form_overlays_published_version_id_form_overlay_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "forms"."form_overlay_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_overlay_versions_number_uq" ON "forms"."form_overlay_versions" USING btree ("overlay_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "form_overlay_versions_content_uq" ON "forms"."form_overlay_versions" USING btree ("overlay_id","content_hash");--> statement-breakpoint
CREATE INDEX "form_overlay_versions_org_path_gist" ON "forms"."form_overlay_versions" USING gist ("org_path");--> statement-breakpoint
CREATE UNIQUE INDEX "form_overlays_unit_uq" ON "forms"."form_overlays" USING btree ("form_id","owner_unit_id");--> statement-breakpoint
CREATE INDEX "form_overlays_org_path_gist" ON "forms"."form_overlays" USING gist ("org_path");--> statement-breakpoint
ALTER TABLE "forms"."form_publications" ADD CONSTRAINT "form_publications_overlay_id_form_overlays_id_fk" FOREIGN KEY ("overlay_id") REFERENCES "forms"."form_overlays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_publications" ADD CONSTRAINT "form_publications_overlay_version_id_form_overlay_versions_id_fk" FOREIGN KEY ("overlay_version_id") REFERENCES "forms"."form_overlay_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms"."form_versions" ADD CONSTRAINT "form_versions_base_version_id_form_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "forms"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_publications_overlay_pending_uq" ON "forms"."form_publications" USING btree ("overlay_id") WHERE "forms"."form_publications"."status" = 'pending' and overlay_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_composed_uq" ON "forms"."form_versions" USING btree ("owner_unit_id","base_version_id","content_hash") WHERE base_version_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "form_publications_pending_uq" ON "forms"."form_publications" USING btree ("form_id") WHERE "forms"."form_publications"."status" = 'pending' and overlay_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_content_uq" ON "forms"."form_versions" USING btree ("form_id","content_hash") WHERE base_version_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_number_uq" ON "forms"."form_versions" USING btree ("form_id","number") WHERE base_version_id is null;--> statement-breakpoint
-- Hand-written (task 0.21f, form-platform.md §4): form overlays. An overlay and its versions are class C at the unit (its
-- subtree and the units above read, the subtree writes); an overlay version, like a form version, never changes. A
-- composed version (a bureau version with a unit's overlays applied) belongs to the filing unit and names both.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."form_overlays"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "forms"."form_overlay_versions"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
CREATE FUNCTION "forms"."form_overlay_versions_immutable"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'forms.form_overlay_versions is immutable: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "form_overlay_versions_immutable" BEFORE UPDATE OR DELETE ON "forms"."form_overlay_versions"
    FOR EACH ROW EXECUTE FUNCTION "forms"."form_overlay_versions_immutable"();
--> statement-breakpoint
CREATE TRIGGER "form_overlay_versions_no_truncate" BEFORE TRUNCATE ON "forms"."form_overlay_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION "forms"."form_overlay_versions_immutable"();
--> statement-breakpoint
ALTER TABLE "forms"."form_overlays"
    ADD CONSTRAINT "form_overlays_patch_check" CHECK (
        jsonb_typeof("patch") = 'object' AND pg_column_size("patch") <= 524288);
--> statement-breakpoint
ALTER TABLE "forms"."form_overlay_versions"
    ADD CONSTRAINT "form_overlay_versions_number_check" CHECK ("number" >= 1),
    ADD CONSTRAINT "form_overlay_versions_patch_check" CHECK (
        jsonb_typeof("patch") = 'object' AND pg_column_size("patch") <= 524288);
--> statement-breakpoint
-- a composed version names its base and the overlays applied, or neither
ALTER TABLE "forms"."form_versions"
    ADD CONSTRAINT "form_versions_composed_check" CHECK (
        ("base_version_id" IS NULL) = ("overlay_version_ids" IS NULL)
        AND ("overlay_version_ids" IS NULL OR cardinality("overlay_version_ids") BETWEEN 1 AND 20));
--> statement-breakpoint
-- an overlay's publication names the overlay and its version asked for, or neither
ALTER TABLE "forms"."form_publications"
    ADD CONSTRAINT "form_publications_overlay_check" CHECK (("overlay_id" IS NULL) = ("overlay_version_id" IS NULL));
--> statement-breakpoint
GRANT SELECT, INSERT ON "forms"."form_overlays", "forms"."form_overlay_versions" TO itrms_app;
--> statement-breakpoint
GRANT UPDATE ("patch", "patch_hash", "patch_updated_by", "published_version_id", "published_at", "updated_at",
    "updated_by", "row_version") ON "forms"."form_overlays" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('forms.form_overlays', 'config', 'org_path');
--> statement-breakpoint
SELECT kernel.apply_rls('forms.form_overlay_versions', 'config', 'org_path');
--> statement-breakpoint
-- Which form versions a second person approved (0036), now with composed versions: a composed one is approved when its
-- base is and every overlay version applied to it is (approved, or its overlay's published one).
CREATE OR REPLACE FUNCTION "forms"."approved_versions"(p_ids uuid[])
    RETURNS SETOF uuid
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    WITH asked AS (
        SELECT v.id, v.form_id, coalesce(v.base_version_id, v.id) AS base_id, v.overlay_version_ids
          FROM forms.form_versions v
         WHERE v.id = ANY (p_ids[1:200])
           AND v.region_id = nullif(current_setting('app.region_id', true), '')::uuid
    )
    SELECT a.id
      FROM asked a
      JOIN forms.form_definitions d ON d.id = a.form_id
     WHERE (d.published_version_id = a.base_id
            OR EXISTS (SELECT 1 FROM forms.form_publications p
                        WHERE p.form_version_id = a.base_id AND p.overlay_id IS NULL AND p.status = 'approved'))
       AND NOT EXISTS (
            SELECT 1 FROM unnest(coalesce(a.overlay_version_ids, '{}'::uuid[])) AS ov(id)
             WHERE NOT EXISTS (SELECT 1 FROM forms.form_overlays o WHERE o.published_version_id = ov.id)
               AND NOT EXISTS (SELECT 1 FROM forms.form_publications p
                                WHERE p.overlay_version_id = ov.id AND p.status = 'approved'))
$$;
