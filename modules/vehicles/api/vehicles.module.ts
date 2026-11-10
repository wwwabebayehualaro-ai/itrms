import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { FormsModule, RegistryLookups } from '@itrms/forms/api';
import { PartiesModule } from '@itrms/parties/api';

import { VehicleLookup } from './lookups';
import { PlateStockController } from './plate-stock.controller';
import { PlateStock } from './plate-stock.service';
import { VehicleRegistry } from './vehicle-registry.service';
import { VehicleCategoriesController, VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

/**
 * The vehicle register (task 1.1a). Other slices read vehicles through VehiclesService and change them through
 * VehicleRegistry in their effects (a plate from the stock: VehicleRegistry.assignStockPlate, task 1.2a); forms pick a vehicle through the lookup provider registered here.
 */
@Module({
    imports: [FormsModule, PartiesModule],
    controllers: [VehiclesController, VehicleCategoriesController, PlateStockController],
    providers: [VehiclesService, VehicleRegistry, VehicleLookup, PlateStock],
    exports: [VehiclesService, VehicleRegistry, PlateStock]
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
