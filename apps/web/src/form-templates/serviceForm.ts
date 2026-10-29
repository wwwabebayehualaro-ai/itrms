/** A service's request form and a step's form as the office fills them in (task 0.21c). */
import type { FormField } from '@itrms/form-engine/renderer';

type Text = Readonly<Partial<Record<string, string>>>;

/** A form version's fields, with the office's help texts in place of the bureau's (`help.<field key>`). */
export function withHelp(document: unknown, help: Record<string, Text>): FormField[] {
    const doc = Array.isArray(document) ? { fields: document } : (document as { fields?: unknown[] } | null);
    const fields = Array.isArray(doc?.fields) ? (doc.fields as FormField[]) : [];
    return fields.map((f) => {
        const key = (f as { key?: string }).key ?? f.id;
        const text = help[key];
        return text ? { ...f, props: { ...(f.props ?? {}), helpText: text } } : f;
    }) as FormField[];
}
