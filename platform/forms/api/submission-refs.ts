/**
 * What a submission's answers point to outside the form (task 0.18): uploaded files and registry records. Both are checked
 * on the server against what the caller's scope shows, never against what the browser claims. One place for them, so a
 * later update path of submissions runs the same checks.
 */
import type { Tx } from '@itrms/kernel/db';
import { NotFoundError } from '@itrms/kernel/errors';
import { getFile } from '@itrms/kernel/files';
import {
    holdsValue,
    isFormArray,
    lookupRefs,
    scopeFields,
    type EngineField,
    type Scope
} from '@itrms/form-engine/core';

import type { RegistryLookups } from './lookups';

import am from '../messages/am.json';
import en from '../messages/en.json';

export type ProblemCode = 'invalid' | 'invalid_reference' | 'invalid_file';

/** One refused answer: where (`members[0].photo`), why (a code the screens translate) and the message in the caller's language. */
export interface AnswerProblem {
    path: string;
    code: ProblemCode;
    message: string;
}

/** A stored file the submission takes: it is linked to the submission once that exists. */
export interface TakenFile {
    id: string;
    documentType: string | null;
}

type MessageKey =
    'forms.validation.invalidReference' | 'forms.validation.fileNotUsable' | 'forms.validation.wrongDocumentType';

const message = (key: MessageKey, language: string): string => (language === 'en' ? en : am)[key];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The files of the answers (rows too) as the stored rows show them: found in the caller's scope, confirmed, not expired,
 * not attached to another record, and of the document type the field asks for. Each file's answer is rewritten from its
 * row (name, size, content type, document type), so the checks that follow see real values. Run on the answers after
 * hidden fields were dropped, before `validateForm`.
 */
export async function resolveFiles(
    tx: Tx,
    fields: EngineField[],
    answers: Record<string, unknown>,
    language: string,
    /** who submits: only a file they uploaded themselves is taken */
    userId: string | null | undefined
): Promise<{ answers: Record<string, unknown>; problems: AnswerProblem[]; files: TakenFile[] }> {
    const problems: AnswerProblem[] = [];
    const taken = new Map<string, TakenFile>();

    const one = async (field: EngineField, entry: unknown, path: string): Promise<unknown> => {
        const fileId = isRecord(entry) && typeof entry.file_id === 'string' ? entry.file_id : null;
        if (!fileId) {
            // an object that names no stored file is not one this server can take (a non-object is validate's to refuse)
            if (isRecord(entry))
                problems.push({
                    path,
                    code: 'invalid_file',
                    message: message('forms.validation.fileNotUsable', language)
                });
            return entry;
        }
        const unusable = (key: MessageKey) => {
            problems.push({ path, code: 'invalid_file', message: message(key, language) });
            return entry;
        };
        // a malformed id is not a uuid the database could compare
        if (!UUID.test(fileId)) return unusable('forms.validation.fileNotUsable');
        let row;
        try {
            row = await getFile(tx, fileId);
        } catch (error) {
            if (error instanceof NotFoundError) return unusable('forms.validation.fileNotUsable');
            throw error;
        }
        // a generated file (an export) or another person's upload is not for a submission to take
        if (
            row.origin !== 'upload' ||
            !userId ||
            row.createdBy !== userId ||
            row.status !== 'stored' ||
            row.linkedId !== null ||
            (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now())
        )
            return unusable('forms.validation.fileNotUsable');
        const wanted = field.props.docType;
        if (typeof wanted === 'string' && wanted !== '' && row.documentType !== wanted)
            return unusable('forms.validation.wrongDocumentType');
        taken.set(row.id, { id: row.id, documentType: row.documentType });
        return {
            file_id: row.id,
            name: row.filename,
            size: row.size,
            type: row.contentType,
            ...(row.documentType ? { documentType: row.documentType } : {})
        };
    };

    const walk = async (
        parentId: string | null,
        current: Record<string, unknown>,
        prefix: string
    ): Promise<Record<string, unknown>> => {
        const out = { ...current };
        for (const f of scopeFields(fields, parentId)) {
            if (!holdsValue(f) || !Object.hasOwn(out, f.id)) continue;
            const value = out[f.id];
            const path = `${prefix}${f.id}`;
            if (isFormArray(f)) {
                if (!Array.isArray(value)) continue;
                const rows: unknown[] = [];
                for (const [i, row] of value.entries())
                    rows.push(isRecord(row) ? await walk(f.id, row, `${path}[${i}].`) : row);
                out[f.id] = rows;
            } else if (f.type === 'FileUpload' && Array.isArray(value)) {
                const entries: unknown[] = [];
                for (const entry of value) entries.push(await one(f, entry, path));
                out[f.id] = entries;
            }
        }
        return out;
    };

    const resolved = await walk(null, answers, '');
    return { answers: resolved, problems, files: [...taken.values()] };
}

/**
 * The registry records the answers point to must exist in the caller's scope and be active; a provider the form names but
 * this installation does not have refuses its values too. A value already refused for another reason (`skip`) is not
 * looked up again. The provider's read permission is not needed: filling in a form may choose a record the caller cannot
 * browse, but never one outside their scope.
 */
export async function checkReferences(
    tx: Tx,
    lookups: RegistryLookups,
    fields: EngineField[],
    answers: Record<string, unknown>,
    scope: Scope,
    language: string,
    skip: ReadonlySet<string>
): Promise<AnswerProblem[]> {
    const refs = lookupRefs(fields, answers, scope).filter((r) => !skip.has(r.path));
    const refused = (path: string): AnswerProblem => ({
        path,
        code: 'invalid_reference',
        message: message('forms.validation.invalidReference', language)
    });
    const problems: AnswerProblem[] = [];
    const byProvider = new Map<string, typeof refs>();
    for (const ref of refs) byProvider.set(ref.provider, [...(byProvider.get(ref.provider) ?? []), ref]);
    for (const [key, wanted] of byProvider) {
        const provider = lookups.get(key);
        if (!provider) {
            problems.push(...wanted.map((r) => refused(r.path)));
            continue;
        }
        // an id that is no uuid (a row never shape-checked, a disabled field) is refused here, never handed to the database
        const valid = wanted.filter((r) => UUID.test(r.id));
        problems.push(...wanted.filter((r) => !UUID.test(r.id)).map((r) => refused(r.path)));
        if (valid.length === 0) continue;
        const found = await provider.resolve(tx, [...new Set(valid.map((r) => r.id.toLowerCase()))], language);
        const usable = new Set(found.filter((i) => i.active).map((i) => i.id.toLowerCase()));
        problems.push(...valid.filter((r) => !usable.has(r.id.toLowerCase())).map((r) => refused(r.path)));
    }
    return problems;
}
