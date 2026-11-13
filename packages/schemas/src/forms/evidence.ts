/**
 * The inspection and evidence field types (task 1.13a): what a `Checklist` field's settings hold (its sections and items,
 * stored in `props`), what a checklist answer and a `GeoPoint` answer look like, and the outcome the server works out of a
 * checklist answer. The form engine checks a stored form's checklist against `checklistDefinitionSchema` on every save, and
 * a submitted answer against the definition; `Signature` and `Photo` answers are files, of the same shape as `FileUpload`'s.
 */
import { z } from 'zod';

import { formTextSchema } from './text';

/** An item's or a section's key: letters, digits and underscores (a checklist answer is keyed by it). */
export const CHECKLIST_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** The most sections, and items in all, one checklist holds. */
export const MAX_CHECKLIST_SECTIONS = 50;
export const MAX_CHECKLIST_ITEMS = 300;
/** The most points one item gives. */
export const MAX_ITEM_POINTS = 1000;
/** The longest remark on an item. */
export const MAX_REMARK_LENGTH = 500;

/**
 * How the items are answered: `passFail`, each item passes, fails or does not apply (a bolo inspection: any failed item
 * fails the checklist); `points`, each item is given points up to its own (the practical exam's 100 points, the vehicle
 * grading): the checklist passes on a total at or above the pass mark, with no critical item left without points.
 */
export const CHECKLIST_SCORING = ['passFail', 'points'] as const;
export type ChecklistScoring = (typeof CHECKLIST_SCORING)[number];

export const checklistItemSchema = z.strictObject({
    key: z.string().regex(CHECKLIST_KEY, 'is not an item key'),
    text: formTextSchema,
    /** points: what the item gives at most (points scoring only, then required) */
    points: z.number().int().min(1).max(MAX_ITEM_POINTS).optional(),
    /** an item the checklist cannot pass without: failed, or given no points */
    critical: z.boolean().optional()
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistSectionSchema = z.strictObject({
    key: z.string().regex(CHECKLIST_KEY, 'is not a section key'),
    title: formTextSchema.optional(),
    items: z.array(checklistItemSchema).min(1).max(MAX_CHECKLIST_ITEMS)
});
export type ChecklistSection = z.infer<typeof checklistSectionSchema>;

/** A checklist's settings as `props` stores them (other settings of the field are not this schema's). */
export const checklistDefinitionSchema = z
    .object({
        scoring: z.enum(CHECKLIST_SCORING).default('passFail'),
        sections: z.array(checklistSectionSchema).min(1).max(MAX_CHECKLIST_SECTIONS),
        /** points scoring: the lowest total that passes (none: a total alone never fails) */
        passMark: z.number().int().min(0).optional(),
        /** an item may be answered "does not apply" (default yes) */
        allowNotApplicable: z.boolean().default(true),
        /** a failed item, or one given no points, needs a remark */
        remarkOnFail: z.boolean().default(false)
    })
    .superRefine((def, ctx) => {
        const items = def.sections.flatMap((s, i) => s.items.map((item, j) => ({ item, at: [i, j] as const })));
        if (items.length > MAX_CHECKLIST_ITEMS)
            ctx.addIssue({ code: 'custom', path: ['sections'], message: `at most ${MAX_CHECKLIST_ITEMS} items` });
        const seen = new Set<string>();
        for (const { item, at } of items) {
            const path = ['sections', at[0], 'items', at[1]];
            if (seen.has(item.key))
                ctx.addIssue({
                    code: 'custom',
                    path: [...path, 'key'],
                    message: `the item key "${item.key}" is used twice`
                });
            seen.add(item.key);
            if (def.scoring === 'points' && item.points === undefined)
                ctx.addIssue({
                    code: 'custom',
                    path: [...path, 'points'],
                    message: 'an item of a points checklist needs its points'
                });
        }
        const sections = new Set<string>();
        def.sections.forEach((s, i) => {
            if (sections.has(s.key))
                ctx.addIssue({
                    code: 'custom',
                    path: ['sections', i, 'key'],
                    message: `the section key "${s.key}" is used twice`
                });
            sections.add(s.key);
        });
        if (def.passMark !== undefined && def.scoring === 'points') {
            const max = items.reduce((sum, { item }) => sum + (item.points ?? 0), 0);
            if (def.passMark > max)
                ctx.addIssue({
                    code: 'custom',
                    path: ['passMark'],
                    message: `the pass mark is above the ${max} points the items give`
                });
        }
    });
export type ChecklistDefinition = z.infer<typeof checklistDefinitionSchema>;

/** What an item was answered: passed, failed or not applicable (pass/fail), or its points (points scoring). */
export const CHECKLIST_RESULTS = ['pass', 'fail', 'na'] as const;
export type ChecklistResult = (typeof CHECKLIST_RESULTS)[number];

export interface ChecklistAnswer {
    result?: ChecklistResult;
    points?: number;
    remark?: string;
}

/**
 * What the server works out of the answers (never what a browser sent): the points or passed items, out of how many, the
 * items failed (a failed item, or one given no points) and the critical ones among them, and whether the checklist
 * passed. `passed` is null while an item is unanswered.
 */
export interface ChecklistOutcome {
    total: number;
    max: number;
    failed: string[];
    criticalFailed: string[];
    passed: boolean | null;
}

/** A checklist field's value: the answers by item key, and the outcome the server set. */
export interface ChecklistValue {
    items: Record<string, ChecklistAnswer>;
    outcome?: ChecklistOutcome;
}

/** A point on the earth (WGS 84 degrees) and how sure the device was, in metres. */
export const geoPointSchema = z.strictObject({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100_000).optional()
});
export type GeoPoint = z.infer<typeof geoPointSchema>;
