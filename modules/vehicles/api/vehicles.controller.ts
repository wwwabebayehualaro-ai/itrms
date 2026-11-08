/**
 * The register's HTTP side (task 1.1a; api-guidelines.md): reads only. A vehicle is registered, transferred and changed
 * through a case's effects (roles-and-permissions.md §2), never by a request of its own. Thin handlers: a permission each, Zod
 * in, a service call out.
 */
import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { Require, requestDbContext } from '@itrms/kernel/iam';
import { RateLimit } from '@itrms/kernel/limits';
import { createZodDto } from 'nestjs-zod';

import { vehicleSearchQuerySchema } from '../contracts';
import { VehiclesService } from './vehicles.service';

class VehicleSearchDto extends createZodDto(vehicleSearchQuerySchema) {}

@Controller('api/v1/vehicles')
export class VehiclesController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(VehiclesService) private readonly vehicles: VehiclesService
    ) {}

    @Get()
    @RateLimit('search')
    @Require('vehicle:read')
    search(@Query() query: VehicleSearchDto) {
        return this.db.scoped(requestDbContext(), (tx) => this.vehicles.search(tx, query));
    }

    @Get(':id')
    @Require('vehicle:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.vehicles.get(tx, id));
    }
}

@Controller('api/v1/vehicle-categories')
export class VehicleCategoriesController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(VehiclesService) private readonly vehicles: VehiclesService
    ) {}

    @Get()
    @Require('vehicle:read')
    list() {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.vehicles.categories(tx) }));
    }
}
