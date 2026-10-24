/**
 * @itrms/kernel/files: uploaded files (architecture §14, task 0.15): the object-store port the integrations implement, the
 * files table, and what other slices call: link a stored file to their record, read one.
 */
export { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE } from '../../contracts';
export { detectType, FILE_TYPES, type FileType } from './file-types';
export { beginUpload, confirmUpload, downloadFile, fileOut, getFile, linkFile, partsOf, PENDING_QUOTA } from './files';
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
