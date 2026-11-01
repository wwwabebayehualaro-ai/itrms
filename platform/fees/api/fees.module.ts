import { Module } from '@nestjs/common';

import { AssessFeeEffect } from './assess.effect';
import { FeesController } from './fees.controller';
import { FeeRulesService } from './fee-rules.service';
import { FeesService } from './fees.service';

/**
 * Fee rules, their approval, the preview of a request's fee and the fee a case keeps (task 0.22a). The services slice
 * files a request's fee through FeesService and gives the preview its request (FEE_REQUEST_SOURCE).
 */
@Module({
    controllers: [FeesController],
    providers: [FeeRulesService, FeesService, AssessFeeEffect],
    exports: [FeeRulesService, FeesService]
})
export class FeesModule {}
