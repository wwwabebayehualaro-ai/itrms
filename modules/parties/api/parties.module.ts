import { Module } from '@nestjs/common';

import { MergesController, OrganisationsController, PersonsController } from './parties.controller';
import { MergesService } from './merges.service';
import { OrganisationsService } from './organisations.service';
import { PersonsService } from './persons.service';

/** The register of people and organisations (task 0.14). Other slices read persons through PersonsService. */
@Module({
    controllers: [PersonsController, MergesController, OrganisationsController],
    providers: [PersonsService, MergesService, OrganisationsService],
    exports: [PersonsService]
})
export class PartiesModule {}
