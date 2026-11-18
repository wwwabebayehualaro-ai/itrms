-- A certificate of a libre is superseded only by a document of the same kind: the same region, template and subject table, and the
-- same libre (a reissue, a correction) or the libre that replaces it (task 1.5). Deferred, because the old one is marked before
-- the new one is inserted (supersedeDocument, supersede_libre_certificate); checked at commit. SECURITY DEFINER because the
-- successor may be another office's document, which the caller's RLS hides. Run by the trigger only: no grant to anyone.
CREATE FUNCTION "documents"."check_certificate_successor"() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    successor documents.issued_documents%ROWTYPE;
    old documents.issued_documents%ROWTYPE;
BEGIN
    SELECT * INTO old FROM documents.issued_documents WHERE id = NEW.id;
    IF NOT FOUND OR old.superseded_by IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO successor FROM documents.issued_documents WHERE id = old.superseded_by;
    IF NOT FOUND OR successor.region_id <> old.region_id OR successor.template_id <> old.template_id
       OR successor.subject_table IS DISTINCT FROM old.subject_table
       OR NOT (
            successor.subject_id IS NOT DISTINCT FROM old.subject_id
            OR EXISTS (SELECT 1 FROM vehicles.libres l WHERE l.id = successor.subject_id AND l.replaces_id = old.subject_id)
       ) THEN
        RAISE EXCEPTION 'documents: certificate % is superseded by a document that is not its successor', old.id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'certificate_successor';
    END IF;
    RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "documents"."check_certificate_successor"() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "certificate_successor" AFTER UPDATE OF "superseded_by" ON "documents"."issued_documents"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.subject_table = 'vehicles.libres' AND NEW.superseded_by IS NOT NULL)
    EXECUTE FUNCTION "documents"."check_certificate_successor"();
--> statement-breakpoint
-- The standing registration certificate of a libre, superseded by the office that now documents the libre afresh (task 1.5c: a new
-- plate changes what the certificate prints). A vehicle moved to another office keeps the certificate its first office issued, and
-- documents.issued_documents is class T on the issuing office's path: the office replacing the plate cannot see it, and cannot
-- issue a new one for the same libre either (one document of a record stands at a time, issued_documents_subject_uq). This is the
-- one narrow way across, a sibling of vehicles.retire_libre_certificate: only for a person, only for the libre in force of a
-- vehicle of the caller's own scope, only that libre's standing certificate of the template named, and only to a new document id
-- not yet used (the caller issues the document with that id in the same transaction; the key to it is deferred and checked at
-- commit, and so is certificate_successor above: the document must be this libre's own certificate of the template). It writes the columns supersedeDocument writes (documents/api/issue.ts) and returns the old document's id, number and
-- language, which the caller keeps on the new certificate and audits. Nothing is returned when no certificate stands.
CREATE FUNCTION "vehicles"."supersede_libre_certificate"(p_libre uuid, p_template text, p_new_document uuid)
    RETURNS TABLE (o_document uuid, o_number text, o_language text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    who uuid := kernel.ctx_user();
    l vehicles.libres%ROWTYPE;
    tpl uuid;
    old documents.issued_documents%ROWTYPE;
BEGIN
    IF kernel.ctx_region() IS NULL OR who IS NULL OR kernel.ctx_scope() IS NULL THEN
        RAISE EXCEPTION 'vehicles: a certificate is superseded by a person' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO l FROM vehicles.libres WHERE id = p_libre;
    -- the function's search_path leaves out public, where ltree's operators live: named in full
    IF NOT FOUND OR l.region_id <> kernel.ctx_region() OR NOT (l.handling_org_path OPERATOR(public.<@) kernel.ctx_scope()) THEN
        RAISE EXCEPTION 'vehicles: the libre is not one of an office of the caller' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF l.status <> 'issued' THEN
        RAISE EXCEPTION 'vehicles: libre % is not in force', l.id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'libre_not_in_force';
    END IF;
    IF p_new_document IS NULL OR EXISTS (SELECT 1 FROM documents.issued_documents WHERE id = p_new_document) THEN
        RAISE EXCEPTION 'vehicles: the new certificate takes an id not used before' USING ERRCODE = 'check_violation',
            CONSTRAINT = 'certificate_id_used';
    END IF;
    SELECT t.id INTO tpl FROM documents.document_templates t WHERE t.region_id = l.region_id AND t.key = p_template;
    IF tpl IS NULL THEN
        RETURN;
    END IF;
    SELECT * INTO old FROM documents.issued_documents d
     WHERE d.region_id = l.region_id AND d.template_id = tpl AND d.subject_id = l.id AND d.subject_table = 'vehicles.libres'
       AND d.superseded_by IS NULL AND d.revoked_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    UPDATE documents.issued_documents SET superseded_by = p_new_document, updated_at = now(), updated_by = who,
           row_version = row_version + 1 WHERE id = old.id;
    o_document := old.id;
    o_number := old.number;
    o_language := old.language;
    RETURN NEXT;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "vehicles"."supersede_libre_certificate"(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "vehicles"."supersede_libre_certificate"(uuid, text, uuid) TO itrms_app;
