-- The public halves of the installation's signing keys, for the verifier PWA's offline check (ADR-0046): no region, no session.
-- A retired key stays listed, and says the day it stopped signing, because what it signed stays good.
CREATE FUNCTION "documents"."verification_keys"()
    RETURNS TABLE (key_id text, public_key text, retired_on date)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT k.key_id, k.public_key, (k.retired_at AT TIME ZONE 'Africa/Addis_Ababa')::date
      FROM documents.signing_keys k
     ORDER BY k.created_at
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "documents"."verification_keys"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "documents"."verification_keys"() TO itrms_app;
--> statement-breakpoint
-- The names of the kinds of document, so a phone in flight mode can say what a QR's template key means.
CREATE FUNCTION "documents"."verification_document_names"()
    RETURNS TABLE (key text, name jsonb)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT DISTINCT ON (t.key) t.key, t.name
      FROM documents.document_templates t
     ORDER BY t.key, t.created_at
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "documents"."verification_document_names"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "documents"."verification_document_names"() TO itrms_app;
