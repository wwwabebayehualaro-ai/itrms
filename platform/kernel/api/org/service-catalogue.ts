/**
 * The service catalogue as the kernel sees it (a port, task 0.21b): the catalogue lives in the services slice, above the
 * kernel, which provides this to check a code before a unit turns a service on or off. Without it (the kernel alone, in
 * its own tests) only the code's shape is checked.
 */
import type { Tx } from '../db/types';

export interface ServiceCatalogue {
    /** whether the region's catalogue has the service */
    exists(tx: Tx, regionId: string, code: string): Promise<boolean>;
}

export const SERVICE_CATALOGUE = Symbol('kernel.service-catalogue');
