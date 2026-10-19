// Form Submission Types
interface IFormSubmissionBase {
    template_id: UUID;
    submission_data: Record<string, any>;
    files_uploaded?: Record<string, any> | null;
    form_metadata?: Record<string, any> | null;
    status?: 'draft' | 'submitted' | 'processing' | 'completed' | 'failed';
    submitted_by?: UUID | null; // User ID if authenticated
    submission_duration?: number; // Time taken to complete form in seconds
    validation_errors?: Record<string, string[]> | null;
}

interface IFormSubmission extends IFormSubmissionBase {
    id: UUID;
    created_at: string;
    updated_at: string;
    version?: number; // For version control if forms are updated after submission
    is_deleted?: boolean;
    deleted_at?: string | null;
}

// Add this type to match your FastAPI PaginatedSubmissions
interface PaginatedSubmissions {
    items: IFormSubmission[];
    total: number;
    page: number;
    page_size: number;
}
