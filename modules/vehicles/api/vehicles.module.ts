import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { FormsModule, RegistryLookups } from '@itrms/forms/api';
import { PartiesModule } from '@itrms/parties/api';

import { VehicleLookup } from './lookups';
import { VehicleRegistry } from './vehicle-registry.service';
import { VehicleCategoriesController, VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

/**
 * The vehicle register (task 1.1a). Other slices read vehicles through VehiclesService and change them through
 * VehicleRegistry in their effects; forms pick a vehicle through the lookup provider registered here.
 */
@Module({
    imports: [FormsModule, PartiesModule],
    controllers: [VehiclesController, VehicleCategoriesController],
    providers: [VehiclesService, VehicleRegistry, VehicleLookup],
    exports: [VehiclesService, VehicleRegistry]
})
export class VehiclesModule implements OnModuleInit {
    constructor(
        @Inject(RegistryLookups) private readonly lookups: RegistryLookups,
        @Inject(VehicleLookup) private readonly vehicle: VehicleLookup
    ) {}

    onModuleInit(): void {
        this.lookups.register(this.vehicle);
    }
}
