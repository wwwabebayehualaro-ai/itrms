CREATE TABLE "documents"."signing_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"region_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"org_path" "ltree" DEFAULT '' NOT NULL,
	"key_id" text NOT NULL,
	"public_key" text NOT NULL,
	"private_key" "bytea" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "documents"."issued_documents_subject_uq";--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD COLUMN "verification_token_hash" text;--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD COLUMN "signing_key_id" uuid;--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD COLUMN "holder_mask" text;--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD COLUMN "valid_until" date;--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "documents"."signing_keys" ADD CONSTRAINT "signing_keys_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "kernel"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signing_keys_key_id_uq" ON "documents"."signing_keys" USING btree ("region_id","key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_keys_active_uq" ON "documents"."signing_keys" USING btree ("region_id") WHERE active;--> statement-breakpoint
CREATE INDEX "signing_keys_org_path_gist" ON "documents"."signing_keys" USING gist ("org_path");--> statement-breakpoint
ALTER TABLE "documents"."issued_documents" ADD CONSTRAINT "issued_documents_signing_key_id_signing_keys_id_fk" FOREIGN KEY ("signing_key_id") REFERENCES "documents"."signing_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issued_documents_token_uq" ON "documents"."issued_documents" USING btree ("verification_token_hash") WHERE verification_token_hash IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "issued_documents_subject_uq" ON "documents"."issued_documents" USING btree ("template_id","subject_id") WHERE subject_id IS NOT NULL AND superseded_by IS NULL;--> statement-breakpoint
-- Hand-written (task 0.23b, ADR-0045): signing keys and what a document needs to be verified. A private key is out of the app's
-- reach by column grant; only the system pool reads it. A document's status is read by token hash through one narrow function:
-- the public endpoint has no session, and it answers a checker's minimum.
CREATE TRIGGER "set_org_path" BEFORE INSERT OR UPDATE ON "documents"."signing_keys"
    FOR EACH ROW EXECUTE FUNCTION "kernel"."set_org_path"('owner_unit_id');
--> statement-breakpoint
ALTER TABLE "documents"."signing_keys"
    ADD CONSTRAINT "signing_keys_retired_check" CHECK ("active" = ("retired_at" IS NULL)),
    ADD CONSTRAINT "signing_keys_public_key_check" CHECK ("public_key" ~ '^[A-Za-z0-9_-]{43}$'),
    ADD CONSTRAINT "signing_keys_key_id_check" CHECK ("key_id" ~ '^[a-z0-9]{4,16}$');
--> statement-breakpoint
-- A signing key only ever retires; what it is never changes, and it is never deleted: old documents still verify by it.
CREATE FUNCTION "documents"."key_retires_once"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    moving constant text[] := ARRAY['org_path', 'active', 'retired_at', 'updated_at', 'updated_by', 'row_version'];
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
            RETURN NEW;
        END IF;
        IF OLD.active AND NOT NEW.active AND (to_jsonb(NEW) - moving) = (to_jsonb(OLD) - moving) THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'documents.signing_keys only retire: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "signing_keys_retire_once" BEFORE UPDATE OR DELETE ON "documents"."signing_keys"
    FOR EACH ROW EXECUTE FUNCTION "documents"."key_retires_once"();
--> statement-breakpoint
CREATE TRIGGER "signing_keys_no_truncate" BEFORE TRUNCATE ON "documents"."signing_keys"
    FOR EACH STATEMENT EXECUTE FUNCTION "documents"."append_only"();
--> statement-breakpoint
-- the app reads a key's public half; its private half is the PDF worker's
GRANT SELECT ("id", "created_at", "created_by", "updated_at", "updated_by", "row_version", "region_id", "owner_unit_id",
    "org_path", "key_id", "public_key", "active", "retired_at") ON "documents"."signing_keys" TO itrms_app;
--> statement-breakpoint
SELECT kernel.apply_rls('documents.signing_keys', 'config', 'org_path');
--> statement-breakpoint
ALTER TABLE "documents"."issued_documents"
    ADD CONSTRAINT "issued_documents_token_check" CHECK (
        "verification_token_hash" IS NULL OR "verification_token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "issued_documents_verification_check" CHECK (
        ("verification_token_hash" IS NULL) = ("signing_key_id" IS NULL)
        AND ("state" <> 'rendered' OR "verification_token_hash" IS NOT NULL)),
    ADD CONSTRAINT "issued_documents_revoked_check" CHECK (("revoked_at" IS NULL) = ("revoke_reason" IS NULL)),
    ADD CONSTRAINT "issued_documents_revoke_reason_check" CHECK (
        "revoke_reason" IS NULL OR length("revoke_reason") BETWEEN 1 AND 200),
    -- at commit: a correction marks the old document before the new one exists, so one of a record stands at a time
    ADD CONSTRAINT "issued_documents_superseded_by_fk" FOREIGN KEY ("superseded_by")
        REFERENCES "documents"."issued_documents" ("id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- An issued document moves once, from requested, with its PDF; after that only its revocation and what supersedes it may be
-- set, once each. What it says never changes.
CREATE OR REPLACE FUNCTION "documents"."issued_once"() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
AS $$
DECLARE
    rendering constant text[] := ARRAY['org_path', 'state', 'failure', 'file_id', 'sha256', 'verification_token_hash',
        'signing_key_id', 'updated_at', 'updated_by', 'row_version'];
    closing constant text[] := ARRAY['org_path', 'revoked_at', 'revoke_reason', 'superseded_by', 'updated_at',
        'updated_by', 'row_version'];
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'org_path') = (to_jsonb(OLD) - 'org_path') THEN
            RETURN NEW;
        END IF;
        IF OLD.state = 'requested' AND (to_jsonb(NEW) - rendering) = (to_jsonb(OLD) - rendering) THEN
            RETURN NEW;
        END IF;
        IF (to_jsonb(NEW) - closing) = (to_jsonb(OLD) - closing)
           AND (OLD.revoked_at IS NULL OR NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at)
           AND (OLD.superseded_by IS NULL OR NEW.superseded_by IS NOT DISTINCT FROM OLD.superseded_by) THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'documents.issued_documents keeps what was issued: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
GRANT UPDATE ("revoked_at", "revoke_reason", "superseded_by", "updated_at", "updated_by", "row_version")
    ON "documents"."issued_documents" TO itrms_app;
--> statement-breakpoint
-- The status of a document by its token's hash: no region, no session, only what a checker needs. The hash is of 128 random
-- bits, so it can't be guessed, and it names one document.
CREATE FUNCTION "documents"."verification"(p_hash text)
    RETURNS TABLE (document_name jsonb, number text, office jsonb, issued_on date, valid_until date, holder text,
                   revoked boolean, superseded boolean)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT t.name, d.number, d.office_name, (d.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date, d.valid_until,
           d.holder_mask, d.revoked_at IS NOT NULL, d.superseded_by IS NOT NULL
      FROM documents.issued_documents d
      JOIN documents.document_templates t ON t.id = d.template_id
     WHERE d.verification_token_hash = p_hash AND d.state = 'rendered'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "documents"."verification"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "documents"."verification"(text) TO itrms_app;
