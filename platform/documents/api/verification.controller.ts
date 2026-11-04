/**
 * The public verification endpoint (ADR-0045, task 0.23b): no sign-in, and only a checker's minimum. Nginx on `verify.<domain>` is
 * the only way here from outside, rate-limited; it proxies these two paths and nothing else.
 */
import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import { Public } from '@itrms/kernel/iam';

import type { VerificationKeysOut, VerificationOut } from '../contracts';
import { VerificationService } from './verification.service';

@Public()
@Controller('api/v1/public')
export class VerificationController {
    constructor(@Inject(VerificationService) private readonly verification: VerificationService) {}

    // a rotated key reaches phones within minutes; a document's status is never cached
    @Get('verification-keys')
    @Header('Cache-Control', 'public, max-age=300')
    keys(): Promise<VerificationKeysOut> {
        return this.verification.keys();
    }

    @Get('verifications/:token')
    @Header('Cache-Control', 'no-store')
    verify(@Param('token') token: string): Promise<VerificationOut> {
        return this.verification.verify(token);
    }
}
