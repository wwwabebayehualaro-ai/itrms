/**
 * The object store of the process (files, task 0.15): the S3 adapter when the installation configures one.
 */
import { S3ObjectStore } from '@itrms/integrations/api';
import type { HttpConfig, WorkerConfig } from '@itrms/kernel/config';

export function objectStoreOf(config: HttpConfig | WorkerConfig): S3ObjectStore | undefined {
    if (!config.S3_ENDPOINT || !config.S3_ACCESS_KEY || !config.S3_SECRET_KEY) return undefined;
    return new S3ObjectStore({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        bucket: config.S3_BUCKET,
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
        publicPath: config.S3_PUBLIC_PATH
    });
}
