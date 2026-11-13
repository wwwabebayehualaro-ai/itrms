/** How a request's answers print on a document (the application copy, task 0.23a; lookups and files, task 0.25d). */
import { isBlankChecklist, isFileField, printValueText } from '@itrms/form-engine/core';
import type { openFieldsFor } from '@itrms/forms/api';

import am from '../messages/am.json';
import en from '../messages/en.json';
import { ethiopianDay, pick } from './render/format';

type Field = ReturnType<typeof openFieldsFor>[number];

/**
 * What an answer prints as, in the document's language: an option's label, a day in the Ethiopian calendar, yes or no, a file's
 * name, and a registry record's name (a lookup stores only its id: `labels` holds the names the registry gives, task 0.25d).
 */
export function valueOf(field: Field, value: unknown, language: string, labels: ReadonlyMap<string, string>): string {
    const words = language === 'en' ? en : am;
    if (value === null || value === undefined) return '';
    // a checklist prints its outcome and the items that failed, a place its coordinates, as the printed form does (task 1.13a)
    if (field.type === 'Checklist' || field.type === 'GeoPoint')
        return isBlankChecklist(value) ? '' : printValueText(field, value, { language });
    const one = (v: unknown): string => {
        if (typeof v === 'boolean') return words[v ? 'documents.answer.yes' : 'documents.answer.no'];
        if (field.type === 'RegistryLookup' && typeof v === 'string') return labels.get(v) ?? '';
        if (isFileField(field)) {
            // as uploaded (`name`), or as an older form stored it (`filename`)
            const { name, filename } = (v && typeof v === 'object' ? v : {}) as { name?: unknown; filename?: unknown };
            return typeof name === 'string' ? name : typeof filename === 'string' ? filename : '';
        }
        const option = field.options?.find((o) => o.value === v);
        if (option) return pick(option.label, language);
        if (field.type === 'EthDate' || field.type === 'DatePicker') return ethiopianDay(v, language);
        return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
    };
    if (value === null || value === undefined) return '';
    return Array.isArray(value) ? value.map(one).filter(Boolean).join(', ') : one(value);
}
