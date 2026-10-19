// types/fileUpload.d.ts

interface IFileUploadResponse {
    file_id: string;
    url: string;
    filename: string;
    content_type: string;
    size: number;
    metadata?: Record<string, any>;
}

interface IBatchFileUploadResponse {
    files: IFileUploadResponse[];
}
