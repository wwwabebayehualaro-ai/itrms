// HTTP entry that registers a job: the system pool becomes reachable from the HTTP process.
import { pool } from './jobs/pool';
export const freightApi = pool;
