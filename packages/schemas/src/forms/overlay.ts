/**
 * A unit's overlay on a bureau form (task 0.21f, form-platform.md §4): what a zone or woreda adds to the form its new
 * cases fill in. It only adds fields after an anchor, and narrows a choice field's options to part of the bureau's; it
 * never changes, hides or removes a bureau field. Added fields' keys are reserved (`x_…`), so a local field can never
 * collide with one the bureau adds later.
 */
import { z } from 'zod';

import { storedFieldSchema } from './schema';

/** The key of a field an overlay adds: reserved for overlays (a bureau or unit-local form may not use it). */
export const OVERLAY_KEY = /^x_[a-z0-9_]{1,60}$/;

/** Why one operation of an overlay was passed over, or refused when it was written. */
export const OVERLAY_CONFLICTS = [
    'anchor_missing',
    'anchor_in_rows',
    'key_taken',
    'key_reserved',
    'nested_outside',
    'not_allowed_property',
    'locked',
    'field_missing',
    'not_choice',
    'option_not_allowed',
    'invalid',
    'not_allowed'
] as const;
export type OverlayConflictCode = (typeof OVERLAY_CONFLICTS)[number];

const fieldKey = z.string().min(1).max(64);

export const formOverlaySchema = z
    .strictObject({
        /** fields added right after the anchor (a top-level one takes the anchor's container; nested ones sit in theirs) */
        add: z
            .array(z.strictObject({ after: fieldKey, fields: z.array(storedFieldSchema).min(1).max(50) }))
            .max(50)
            .default([]),
        /** a choice field's options narrowed to these of the bureau's values (labels stay the bureau's) */
        options: z
            .array(
                z.strictObject({
                    key: fieldKey,
                    values: z
                        .array(z.union([z.string(), z.number()]))
                        .min(1)
                        .max(200)
                })
            )
            .max(100)
            .default([])
    })
    .refine((o) => o.add.reduce((n, a) => n + a.fields.length, 0) <= 300, {
        message: 'an overlay adds at most 300 fields'
    });

export type FormOverlay = z.infer<typeof formOverlaySchema>;
