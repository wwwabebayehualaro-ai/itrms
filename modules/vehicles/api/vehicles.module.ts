import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { FormsModule, RegistryLookups } from '@itrms/forms/api';
import { PartiesModule } from '@itrms/parties/api';

import { ENCUMBRANCE_EFFECTS_LIST } from './encumbrance.effects';
import { EncumbrancesController } from './encumbrances.controller';
import { EncumbranceService } from './encumbrances.service';
import { VehicleArrivals } from './arrival.service';
import { VehicleHandovers } from './handover.service';
import { VehicleLookup } from './lookups';
import { PlateStockController } from './plate-stock.controller';
import { PlateStock } from './plate-stock.service';
import { VehicleRegistry } from './vehicle-registry.service';
import { VehicleCategoriesController, VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

/**
 * The vehicle register (task 1.1a). Other slices read vehicles through VehiclesService and change them through
 * VehicleRegistry in their effects (a plate from the stock: VehicleRegistry.assignStockPlate, task 1.2a); the holds on a vehicle are
 * EncumbranceService (task 1.4a), whose check a service's workflow names as an effect; forms pick a vehicle through the lookup provider registered here.
 */
@Module({
    imports: [FormsModule, PartiesModule],
    controllers: [VehiclesController, VehicleCategoriesController, PlateStockController, EncumbrancesController],
    providers: [
        VehiclesService,
        VehicleRegistry,
        VehicleLookup,
        PlateStock,
        EncumbranceService,
        VehicleHandovers,
        VehicleArrivals,
        ...ENCUMBRANCE_EFFECTS_LIST
    ],
    exports: [VehiclesService, VehicleRegistry, PlateStock, EncumbranceService, VehicleHandovers, VehicleArrivals]
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
