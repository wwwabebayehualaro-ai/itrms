/**
 * The register's HTTP side (task 0.14; api-guidelines.md): thin handlers, a permission each, Zod in, a service call out.
 * A search by FIN or phone is a POST (`/persons/lookup`): a sensitive value never goes into a URL. Reveal needs
 * `pii:reveal` and a second factor in the last five minutes (SEC-SE-5), and its answer is never kept for replay.
 */
import {
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    Inject,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query
} from '@nestjs/common';
import { DATABASE, NotReplayable } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { Require, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
    duplicateCheckSchema,
    memberAddSchema,
    memberEndSchema,
    MERGE_STATUSES,
    mergeDecisionSchema,
    mergeRequestSchema,
    organisationCreateSchema,
    organisationSearchQuerySchema,
    organisationUpdateSchema,
    personCreateSchema,
    personLookupSchema,
    personSearchQuerySchema,
    personUpdateSchema,
    revealRequestSchema
} from '../contracts';
import { MergesService } from './merges.service';
import { OrganisationsService } from './organisations.service';
import { PersonsService } from './persons.service';

class PersonCreateDto extends createZodDto(personCreateSchema) {}
class PersonUpdateDto extends createZodDto(personUpdateSchema) {}
class PersonSearchDto extends createZodDto(personSearchQuerySchema) {}
class PersonLookupDto extends createZodDto(personLookupSchema) {}
class DuplicateCheckDto extends createZodDto(duplicateCheckSchema) {}
class RevealDto extends createZodDto(revealRequestSchema) {}
class MergeRequestDto extends createZodDto(mergeRequestSchema) {}
class MergeDecisionDto extends createZodDto(mergeDecisionSchema) {}
class MergeListDto extends createZodDto(z.strictObject({ status: z.enum(MERGE_STATUSES).default('pending') })) {}
class OrganisationCreateDto extends createZodDto(organisationCreateSchema) {}
class OrganisationUpdateDto extends createZodDto(organisationUpdateSchema) {}
class OrganisationSearchDto extends createZodDto(organisationSearchQuerySchema) {}
class MemberAddDto extends createZodDto(memberAddSchema) {}
class MemberEndDto extends createZodDto(memberEndSchema) {}

/** Step-up for reveal: a second factor entered in the last five minutes. */
const REVEAL_RECENT_AUTH = 300;

@Controller('api/v1/persons')
export class PersonsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(PersonsService) private readonly persons: PersonsService
    ) {}

    @Get()
    @Require('person:read')
    search(@Query() query: PersonSearchDto) {
        return this.db.scoped(requestDbContext(), async (tx) => ({
            items: await this.persons.search(tx, query.q, query.limit)
        }));
    }

    // the lookup and the duplicate check carry a FIN, phone or birth date: no idempotency record (reads; audited)
    @Post('lookup')
    @HttpCode(200)
    @NotReplayable()
    @Require('person:lookup')
    async lookup(@Body() body: PersonLookupDto) {
        return { items: await this.persons.lookupRecorded(requestDbContext(), body) };
    }

    @Post('duplicates')
    @HttpCode(200)
    @NotReplayable()
    @Require('person:create')
    duplicates(@Body() body: DuplicateCheckDto) {
        return this.persons.duplicatesRecorded(requestDbContext(), body);
    }

    @Post()
    @Require('person:create')
    create(@Body() body: PersonCreateDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.persons.create(tx, ctx, body));
    }

    @Get(':id')
    @Require('person:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.persons.get(tx, id));
    }

    @Patch(':id')
    @Require('person:update')
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: PersonUpdateDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.persons.update(tx, ctx, id, version, body));
    }

    @Post(':id/reveal')
    @HttpCode(200)
    @NotReplayable()
    @Require('pii:reveal', { recentAuth: REVEAL_RECENT_AUTH })
    reveal(@Param('id', ParseUUIDPipe) id: string, @Body() body: RevealDto) {
        return this.persons.reveal(requestDbContext(), id, body.fields, body.reason);
    }
}

@Controller('api/v1/person-merges')
export class MergesController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(MergesService) private readonly merges: MergesService
    ) {}

    @Get()
    @Require('person:read')
    list(@Query() query: MergeListDto) {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.merges.list(tx, query.status) }));
    }

    @Post()
    @Require('person:merge')
    request(@Body() body: MergeRequestDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.merges.request(tx, ctx, body));
    }

    @Post(':id/approval')
    @HttpCode(200)
    @Require('person:approve-merge')
    approve(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: MergeDecisionDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.merges.approve(tx, ctx, id, version, body.note));
    }

    @Post(':id/rejection')
    @HttpCode(200)
    @Require('person:approve-merge')
    reject(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: MergeDecisionDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.merges.reject(tx, ctx, id, version, body.note));
    }
}

@Controller('api/v1/organisations')
export class OrganisationsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(OrganisationsService) private readonly organisations: OrganisationsService
    ) {}

    @Get()
    @Require('organisation:read')
    search(@Query() query: OrganisationSearchDto) {
        return this.db.scoped(requestDbContext(), async (tx) => ({
            items: await this.organisations.search(tx, query.q, query.limit)
        }));
    }

    @Post()
    @Require('organisation:create')
    create(@Body() body: OrganisationCreateDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.organisations.create(tx, ctx, body));
    }

    @Get(':id')
    @Require('organisation:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.organisations.get(tx, id));
    }

    @Patch(':id')
    @Require('organisation:update')
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: OrganisationUpdateDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.organisations.update(tx, ctx, id, version, body));
    }

    @Post(':id/members')
    @Require('organisation:update')
    addMember(@Param('id', ParseUUIDPipe) id: string, @Body() body: MemberAddDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.organisations.addMember(tx, ctx, id, body));
    }

    @Post(':id/members/:memberId/end')
    @HttpCode(200)
    @Require('organisation:update')
    endMember(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('memberId', ParseUUIDPipe) memberId: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: MemberEndDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.organisations.endMember(tx, ctx, id, memberId, version, body.until));
    }
}
