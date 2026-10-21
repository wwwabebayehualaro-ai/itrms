/**
 * The org admin use cases for the signed-in person (roles-and-permissions.md §2: `org_unit`, `service_config`). Each runs in
 * one scoped transaction, and touches only units in the person's subtree: a unit outside it is "not found" (SEC-AC-3).
 * Moving, deactivating and service overrides need a unit strictly below the person's own (a unit never widens its own
 * services); the person's own unit can only be renamed.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { I18nText } from '@itrms/schemas';

import type { Database } from '../db/database';
import type { Tx } from '../db/types';
import { ForbiddenError, NotFoundError } from '../errors';
import { requestDbContext } from '../iam/access';
import { DATABASE } from '../observability/tokens';
import {
    clearServiceOverride,
    createUnit,
    deactivateUnit,
    describeUnit,
    effectiveServices,
    findUnit,
    moveUnit,
    renameUnit,
    setServiceOverride,
    subtree,
    type NewUnit,
    type OrgUnit
} from './org-tree';

/** Is `path` the scope itself or below it? (ltree labels are dot-separated) */
export const withinScope = (path: string, scope: string) => path === scope || path.startsWith(`${scope}.`);

@Injectable()
export class OrgAdminService {
    constructor(@Inject(DATABASE) private readonly db: Database) {}

    private run<T>(fn: (tx: Tx, scope: string) => Promise<T>): Promise<T> {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => fn(tx, ctx.scopePath ?? ''));
    }

    /** The unit, if the person may see it. */
    private async visible(tx: Tx, scope: string, id: string): Promise<OrgUnit> {
        const unit = await findUnit(tx, id);
        if (!unit || !withinScope(unit.path, scope)) throw new NotFoundError();
        return unit;
    }

    /** The unit, if it is strictly below the person's own. */
    private async below(tx: Tx, scope: string, id: string): Promise<OrgUnit> {
        const unit = await this.visible(tx, scope, id);
        if (unit.path === scope) throw new ForbiddenError();
        return unit;
    }

    get(id: string) {
        return this.run(async (tx, scope) => describeUnit(tx, await this.visible(tx, scope, id)));
    }

    subtree(id: string) {
        return this.run(async (tx, scope) => {
            const root = await this.visible(tx, scope, id);
            return Promise.all((await subtree(tx, root.path)).map((unit) => describeUnit(tx, unit)));
        });
    }

    create(input: NewUnit) {
        return this.run(async (tx, scope) => {
            await this.visible(tx, scope, input.parentId);
            return describeUnit(tx, await createUnit(tx, input));
        });
    }

    rename(id: string, version: number, name: I18nText) {
        return this.run(async (tx, scope) => {
            await this.visible(tx, scope, id);
            return describeUnit(tx, await renameUnit(tx, id, version, name));
        });
    }

    move(id: string, version: number, parentId: string) {
        return this.run(async (tx, scope) => {
            await this.below(tx, scope, id);
            await this.visible(tx, scope, parentId);
            return describeUnit(tx, await moveUnit(tx, id, version, parentId));
        });
    }

    deactivate(id: string, version: number) {
        return this.run(async (tx, scope) => {
            await this.below(tx, scope, id);
            return describeUnit(tx, await deactivateUnit(tx, id, version));
        });
    }

    services(id: string) {
        return this.run(async (tx, scope) => {
            await this.visible(tx, scope, id);
            return { unitId: id, services: await effectiveServices(tx, id) };
        });
    }

    setService(id: string, serviceCode: string, enabled: boolean, reason: string) {
        return this.run(async (tx, scope) => {
            await this.below(tx, scope, id);
            await setServiceOverride(tx, id, serviceCode, enabled, reason);
            return { unitId: id, services: await effectiveServices(tx, id) };
        });
    }

    resetService(id: string, serviceCode: string) {
        return this.run(async (tx, scope) => {
            await this.below(tx, scope, id);
            await clearServiceOverride(tx, id, serviceCode);
            return { unitId: id, services: await effectiveServices(tx, id) };
        });
    }
}
