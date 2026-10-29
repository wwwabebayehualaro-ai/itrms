/**
 * Seed entry of @itrms/services (task 0.21b): the service catalogue of the reference design is
 * `platform/services/seed/catalogue.yaml` (54 services); its text is read here and checked, for `importCatalogue` into a
 * region (`pnpm --filter @itrms/api seed:services <file> --region <code>`).
 */
import { parse } from 'yaml';

import { catalogueSchema, type CatalogueEntry } from '../contracts';

/** The catalogue's services, checked (an invalid file stops the seed, naming the entry). */
export function parseCatalogue(text: string): CatalogueEntry[] {
    return catalogueSchema.parse(parse(text)).services;
}
