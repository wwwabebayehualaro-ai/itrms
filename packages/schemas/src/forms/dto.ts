/**
 * What the forms API sends and takes: templates, the published form, server actions and submissions. The legacy backend
 * (Backend/, until task 0.6) answers in these shapes; the engine and the web app share them from here.
 */
import { z } from 'zod';

/** draft: the working copy differs from what people fill in; pending_approval: a publish waits for approval; published. */
/** The legacy backend stores either shape: an object `{ fields, runtime }`, or (older builders) the bare field list. */
const objectOrList = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

export const formTemplateStatusSchema = z.enum(['draft', 'pending_approval', 'published']);

export const formTemplateSchema = z.object({
    id: z.string().optional(),
    name: z.string(),
    slug: z.string(),
    version: z.string().optional(),
    form_config: objectOrList,
    thumbnail_url: z.string().nullable().optional(),
    thumbnail: z.array(z.unknown()).optional(),
    category: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    file_relations: objectOrList.optional(),
    created_at: z.string().optional(),
    updated_at: z.string().nullable().optional(),
    /** Version the server holds; sent back on save so a concurrent edit is reported (409) instead of overwritten. */
    row_version: z.number().int().optional(),
    status: formTemplateStatusSchema.optional(),
    /** The version people fill in (null: never published, cannot take requests yet). */
    published_version_id: z.string().nullable().optional(),
    published_at: z.string().nullable().optional()
});

export type FormTemplate = z.infer<typeof formTemplateSchema>;

/** The form people fill in: the published version of a template. */
export const publishedFormSchema = z.object({
    template_id: z.string(),
    version_id: z.string(),
    version: z.string(),
    name: z.string(),
    form_config: objectOrList,
    file_relations: objectOrList,
    published_at: z.string().nullable().optional()
});

export type PublishedForm = z.infer<typeof publishedFormSchema>;

/** Coded work a form can run on submit (registered by a module, e.g. posting a transaction), with the fields it reads. */
export const serverActionSchema = z.object({
    key: z.string(),
    title: z.string(),
    description: z.string(),
    fields: z.array(z.object({ id: z.string(), required: z.boolean(), description: z.string().nullable().optional() }))
});

export type ServerAction = z.infer<typeof serverActionSchema>;

export const submissionStatusSchema = z.enum(['draft', 'submitted', 'processing', 'completed', 'failed']);

export const formSubmissionSchema = z.object({
    id: z.string(),
    template_id: z.string(),
    submission_data: z.record(z.string(), z.unknown()),
    files_uploaded: z.record(z.string(), z.unknown()).nullable().optional(),
    form_metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    status: submissionStatusSchema.optional(),
    submitted_by: z.string().nullable().optional(),
    /** Seconds taken to complete the form. */
    submission_duration: z.number().optional(),
    validation_errors: z.record(z.string(), z.array(z.string())).nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    version: z.number().int().optional(),
    is_deleted: z.boolean().optional(),
    deleted_at: z.string().nullable().optional()
});

export type FormSubmission = z.infer<typeof formSubmissionSchema>;

export const submissionPageSchema = z.object({
    items: z.array(formSubmissionSchema),
    total: z.number().int(),
    page: z.number().int(),
    page_size: z.number().int()
});

export type SubmissionPage = z.infer<typeof submissionPageSchema>;

/** A stored upload (an attachment field's value refers to it by `file_id`). */
export const uploadedFileSchema = z.object({
    file_id: z.string(),
    url: z.string(),
    filename: z.string(),
    content_type: z.string(),
    size: z.number(),
    metadata: z.record(z.string(), z.unknown()).optional()
});

export type UploadedFile = z.infer<typeof uploadedFileSchema>;

/** A new submission, or the fields of one to change. */
export const formSubmissionInputSchema = formSubmissionSchema.pick({
    template_id: true,
    submission_data: true,
    files_uploaded: true,
    form_metadata: true,
    status: true,
    submitted_by: true,
    submission_duration: true,
    validation_errors: true
});

export type FormSubmissionInput = z.infer<typeof formSubmissionInputSchema>;
