// types/form.d.ts
import { UUID } from 'crypto';

// Form Template Types
interface IFormTemplateBase {
    name: string;
    slug: string;
    version?: string;
    form_config: Record<string, any>;
    thumbnail_url?: string | null;
    thumbnail?: any[];
    category?: string | null;
    is_active?: boolean;
    file_relations?: Record<string, any>;
}

interface IFormTemplate extends IFormTemplateBase {
    id?: UUID;
    created_at?: string; // ISO date string
    updated_at?: string; // ISO date string
    /** Version the server holds; sent back on save so a concurrent edit is reported (409) instead of overwritten. */
    row_version?: number;
    /** draft: the working copy differs from what people fill in; pending_approval: a publish waits for approval; published. */
    status?: 'draft' | 'pending_approval' | 'published';
    /** The version people fill in (null: never published, cannot take requests yet). */
    published_version_id?: UUID | null;
    published_at?: string | null;
}

// File Relation Types
interface IFileRelationCreate {
    file_ids: UUID[];
}

interface IFileRelationResponse {
    template_id: UUID;
    file_ids: UUID[];
}

// API Response Types
interface IApiResponse<T> {
    data?: T;
    error?: string;
    success: boolean;
}
