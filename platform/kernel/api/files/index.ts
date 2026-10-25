/**
 * @itrms/kernel/files: uploaded files (architecture §14, task 0.15): the object-store port the integrations implement, the
 * files table, and what other slices call: link a stored file to their record, read one.
 */
export { ACCEPTED_FILE_TYPES, GENERATED_FILE_TYPES, MAX_FILE_SIZE, type GeneratedFileType } from '../../contracts';
export { detectType, FILE_TYPES, type FileType } from './file-types';
export {
    beginUpload,
    confirmUpload,
    downloadFile,
    fileOut,
    getFile,
    linkFile,
    partsOf,
    MAX_GENERATED_BYTES,
    PENDING_QUOTA,
    putGeneratedObject,
    recordGeneratedFile,
    removeGeneratedObject,
    type GeneratedObject
} from './files';
export { FILE_STATUSES, files, type FileStatus } from './files.table';
export {
    NO_OBJECT_STORE,
    ObjectStoreRefusal,
    type ListedObject,
    type ObjectStore,
    type PendingMultipart,
    type PresignedPost,
    type StoredObject
} from './object-store';
export { OBJECT_STORE } from '../observability/tokens';
