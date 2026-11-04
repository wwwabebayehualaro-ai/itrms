/**
 * `fees.createPaymentOrder` (task 0.22b): named on the transition into a workflow's payment step, it turns the case's
 * newest fee into a payment order and gives the case its fact `payment` (workflows guard on `payment.settled`). Run again
 * (a step taken twice), it names the order it made; a case without a fee is settled with nothing to pay.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { CREATE_PAYMENT_ORDER_EFFECT } from '../contracts';
import { PaymentOrdersService } from './payment-orders.service';

@Injectable()
@Effect(CREATE_PAYMENT_ORDER_EFFECT)
export class CreatePaymentOrderEffect implements WorkflowEffect {
    constructor(@Inject(PaymentOrdersService) private readonly orders: PaymentOrdersService) {}

    async run({ tx, caseId, caseNumber, regionId, handlingUnitId, config }: EffectRun) {
        const payment = await this.orders.followFee(tx, { caseId, caseNumber, regionId, handlingUnitId, config });
        return { facts: { payment } };
    }
}
