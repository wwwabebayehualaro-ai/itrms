import { Module } from '@nestjs/common';

import { AssessFeeEffect } from './assess.effect';
import { CashierSessionsController } from './cashier-sessions.controller';
import { CashierSessionsService } from './cashier-sessions.service';
import { ExternalPaymentsController } from './external-payments.controller';
import { ExternalPaymentsService } from './external-payments.service';
import { CreatePaymentOrderEffect } from './payment-order.effect';
import { PaymentOrdersService } from './payment-orders.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { FeesController } from './fees.controller';
import { FeeRulesService } from './fee-rules.service';
import { FeesService } from './fees.service';
import { StationeryController } from './stationery.controller';
import { StationeryStock } from './stationery.service';

/**
 * Fee rules, their approval, the preview of a request's fee and the fee a case keeps (task 0.22a). The services slice
 * files a request's fee through FeesService and gives the preview its request (FEE_REQUEST_SOURCE). Payment orders, the
 * cashier's payments, receipts and reversals (task 0.22b); money paid elsewhere (task 0.22c); the workflow moves the case
 * (FEE_CASE_PORT). Controlled stationery (task 1.12a): the stock of serial-numbered forms, used by the slices that print or
 * issue on them (StationeryStock). Cashier sessions and the daily closing (task 1.12, ADR-0063).
 */
@Module({
    controllers: [
        FeesController,
        PaymentsController,
        ExternalPaymentsController,
        StationeryController,
        CashierSessionsController
    ],
    providers: [
        FeeRulesService,
        FeesService,
        PaymentOrdersService,
        PaymentsService,
        CashierSessionsService,
        ExternalPaymentsService,
        AssessFeeEffect,
        CreatePaymentOrderEffect,
        StationeryStock
    ],
    exports: [
        FeeRulesService,
        FeesService,
        PaymentOrdersService,
        PaymentsService,
        CashierSessionsService,
        StationeryStock
    ]
})
export class FeesModule {}
