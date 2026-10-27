-- Which form versions a second person approved (task 0.19b). A workflow names a step form by version; that version must
-- have been approved (SEC-AC-6) though it may no longer be the published one. The publications are class T at the form's
-- owner unit, so an office below the bureau cannot read the bureau's: this reviewed function answers for versions the
-- caller already reads (the ids it is given), in the caller's region, with the approved ones' ids and nothing else.
CREATE FUNCTION "forms"."approved_versions"(p_ids uuid[])
    RETURNS SETOF uuid
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT v.id
      FROM forms.form_versions v
      JOIN forms.form_definitions d ON d.id = v.form_id
     WHERE v.id = ANY (p_ids[1:200])
       AND v.region_id = nullif(current_setting('app.region_id', true), '')::uuid
       AND (d.published_version_id = v.id
            OR EXISTS (SELECT 1 FROM forms.form_publications p
                        WHERE p.form_version_id = v.id AND p.status = 'approved'))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "forms"."approved_versions"(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "forms"."approved_versions"(uuid[]) TO itrms_app;
