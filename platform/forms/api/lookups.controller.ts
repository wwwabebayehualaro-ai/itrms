/**
 * Registry lookups (task 0.18): the registries a form field can point to, a search in one, and the records behind saved
 * values. Reads only; each needs the right to read forms and the registry's own right (person:read …).
 */
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { currentContext } from '@itrms/kernel/context';
import { ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import { Require, currentPrincipal, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import { registryLookupItemsQuerySchema, registryLookupSearchQuerySchema } from '../contracts';
import { RegistryLookups, type RegistryLookupProvider } from './lookups';

class LookupSearchDto extends createZodDto(registryLookupSearchQuerySchema) {}
class LookupItemsDto extends createZodDto(registryLookupItemsQuerySchema) {}

@Controller('api/v1/registry-lookups')
export class RegistryLookupsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(RegistryLookups) private readonly lookups: RegistryLookups
    ) {}

    @Get()
    @Require('form:read')
    list() {
        const language = currentContext()?.language ?? 'am';
        return {
            items: this.lookups.list().map((p) => ({ key: p.key, title: p.title(language), facts: p.facts(language) }))
        };
    }

    @Get(':provider')
    @Require('form:read')
    search(@Param('provider') key: string, @Query() query: LookupSearchDto) {
        const provider = this.allowed(key);
        const language = currentContext()?.language ?? 'am';
        return this.db.scoped(requestDbContext(), async (tx) => ({
            items: await provider.search(tx, query.q, query.limit, language)
        }));
    }

    @Get(':provider/items')
    @Require('form:read')
    items(@Param('provider') key: string, @Query() query: LookupItemsDto) {
        const provider = this.allowed(key);
        const language = currentContext()?.language ?? 'am';
        return this.db.scoped(requestDbContext(), async (tx) => ({
            items: await provider.resolve(tx, query.ids, language)
        }));
    }

    /** The provider, if it exists (404) and the caller may read its registry (403). */
    private allowed(key: string): RegistryLookupProvider {
        const provider = this.lookups.get(key);
        if (!provider) throw new NotFoundError();
        if (!currentPrincipal().permissions.has(provider.permission))
            throw new ForbiddenError({ detail: 'You may not look up records of this registry.' });
        return provider;
    }
}
