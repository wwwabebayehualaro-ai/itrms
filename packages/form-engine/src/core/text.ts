/**
 * What a form leaves untranslated (task 0.17a): the texts with nothing of their own in a required language (Amharic,
 * English). The builder's translation table and the publish warning count them; a missing optional language is
 * reported per column but not counted (i18n-and-languages.md: the publish check warns, it does not block).
 */
import { REQUIRED_TEXT_LANGUAGES, fieldTexts, missingIn, type FieldText } from '@itrms/schemas';

export interface UntranslatedText extends FieldText {
    fieldId: string;
    /** the required languages it has no text of its own in */
    missing: string[];
}

/**
 * The texts of stored fields missing in a required language. `plainAs`: the language a plain string was written in
 * (the builder's authoring language). An empty label of a field with no other text is not a text to translate.
 */
export function untranslatedTexts(
    fields: readonly unknown[],
    plainAs: string,
    required: readonly string[] = REQUIRED_TEXT_LANGUAGES
): UntranslatedText[] {
    const out: UntranslatedText[] = [];
    for (const field of fields) {
        const raw = (field as { id?: unknown } | null)?.id;
        const id = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
        for (const text of fieldTexts(field)) {
            if (text.value === undefined || text.value === null || text.value === '') continue;
            const missing = required.filter((language) => missingIn(text.value, language, plainAs));
            if (missing.length) out.push({ ...text, fieldId: id, missing });
        }
    }
    return out;
}
