import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { FormsModule, RegistryLookups } from '@itrms/forms/api';

import { OrganisationLookup, PersonLookup } from './lookups';
import { MergesController, OrganisationsController, PersonsController } from './parties.controller';
import { MergesService } from './merges.service';
import { OrganisationsService } from './organisations.service';
import { PersonsService } from './persons.service';

/**
 * The register of people and organisations (task 0.14). Other slices read persons through PersonsService; forms pick a
 * person or an organisation through the lookup providers registered here (task 0.18).
 */
@Module({
    imports: [FormsModule],
    controllers: [PersonsController, MergesController, OrganisationsController],
    providers: [PersonsService, MergesService, OrganisationsService, PersonLookup, OrganisationLookup],
    exports: [PersonsService]
})
export class PartiesModule implements OnModuleInit {
    constructor(
        @Inject(RegistryLookups) private readonly lookups: RegistryLookups,
        @Inject(PersonLookup) private readonly person: PersonLookup,
        @Inject(OrganisationLookup) private readonly organisation: OrganisationLookup
    ) {}

    onModuleInit(): void {
        this.lookups.register(this.person);
        this.lookups.register(this.organisation);
    }
}
