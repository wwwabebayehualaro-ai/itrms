/**
 * Saved views of a form's submissions (task 0.16d; ported from the legacy saved_view_service.py). A view is kept in the
 * unit its owner acts for: private (the owner's alone, whoever else may read the unit's rows) or shared with the unit,
 * which needs `submission-view:share`, as does making a view the unit's default. Others' private views are answered as
 * missing, never as forbidden: a view's existence is not shown to anyone but its owner.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, or } from 'drizzle-orm';
import { deleteAudited, insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import type { z } from 'zod';

import type { SavedView, savedViewCreateSchema, savedViewUpdateSchema } from '../contracts';
import { viewConfigSchema } from '../contracts';
import { FormsService } from './forms.service';
import { savedViews } from './forms.table';
import { required } from './support';

type ViewRow = typeof savedViews.$inferSelect;

const notAllowed = () =>
    new ForbiddenError({
        detail: 'Sharing a view with the office, or making it its default, needs the right to share.'
    });

@Injectable()
export class SavedViewsService {
    constructor(@Inject(FormsService) private readonly forms: FormsService) {}

    /** The unit's shared views of the form and the caller's own, defaults first. */
    async list(tx: Tx, ctx: DbContext, canShare: boolean, formId: string): Promise<SavedView[]> {
        await this.forms.definition(tx, formId);
        const rows = await tx
            .select()
            .from(savedViews)
            .where(
                and(
                    eq(savedViews.formId, formId),
                    eq(savedViews.unitId, required(ctx.unitId)),
                    or(eq(savedViews.visibility, 'unit'), eq(savedViews.createdBy, required(ctx.userId)))
                )
            )
            .orderBy(desc(savedViews.isDefault), savedViews.name, savedViews.id)
            .limit(200);
        return rows.map((r) => viewOf(r, ctx, canShare));
    }

    async create(
        tx: Tx,
        ctx: DbContext,
        canShare: boolean,
        formId: string,
        input: z.infer<typeof savedViewCreateSchema>
    ): Promise<SavedView> {
        const form = await this.forms.definition(tx, formId);
        // the unit's default is a shared view
        const visibility = input.isDefault ? 'unit' : input.visibility;
        if (visibility === 'unit' && !canShare) throw notAllowed();
        if (input.isDefault) await this.clearDefault(tx, form.id, required(ctx.unitId));
        const row = await insertAudited(tx, savedViews, {
            regionId: required(ctx.regionId),
            unitId: required(ctx.unitId),
            formId: form.id,
            name: input.name,
            visibility,
            isDefault: input.isDefault,
            config: input.config
        });
        return viewOf(row, ctx, canShare);
    }

    async update(
        tx: Tx,
        ctx: DbContext,
        canShare: boolean,
        id: string,
        version: number,
        input: z.infer<typeof savedViewUpdateSchema>
    ): Promise<SavedView> {
        const view = await this.editable(tx, ctx, canShare, id);
        const visibility = input.visibility ?? view.visibility;
        // a private view is never the default; a view made the default is shared
        const isDefault = visibility === 'private' ? false : (input.isDefault ?? view.isDefault);
        const finalVisibility = isDefault ? 'unit' : visibility;
        if (finalVisibility === 'unit' && !canShare) throw notAllowed();
        if (isDefault && !view.isDefault) await this.clearDefault(tx, view.formId, view.unitId);
        const row = await updateAudited(tx, savedViews, id, version, {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.config !== undefined ? { config: input.config } : {}),
            visibility: finalVisibility,
            isDefault
        });
        return viewOf(row, ctx, canShare);
    }

    async remove(tx: Tx, ctx: DbContext, canShare: boolean, id: string, version: number): Promise<void> {
        await this.editable(tx, ctx, canShare, id);
        await deleteAudited(tx, savedViews, id, version);
    }

    /** A view of the caller's unit they may change: their own private one, or a shared one with the right to share. */
    private async editable(tx: Tx, ctx: DbContext, canShare: boolean, id: string): Promise<ViewRow> {
        const [view] = await tx.select().from(savedViews).where(eq(savedViews.id, id));
        const mine = view?.createdBy === ctx.userId;
        if (!view || view.unitId !== ctx.unitId || (view.visibility === 'private' && !mine)) throw new NotFoundError();
        if (view.visibility === 'unit' && !canShare) throw notAllowed();
        return view;
    }

    private async clearDefault(tx: Tx, formId: string, unitId: string): Promise<void> {
        const [current] = await tx
            .select()
            .from(savedViews)
            .where(and(eq(savedViews.formId, formId), eq(savedViews.unitId, unitId), eq(savedViews.isDefault, true)));
        if (current) await updateAudited(tx, savedViews, current.id, current.rowVersion, { isDefault: false });
    }
}

function viewOf(row: ViewRow, ctx: DbContext, canShare: boolean): SavedView {
    return {
        id: row.id,
        version: row.rowVersion,
        formId: row.formId,
        unitId: row.unitId,
        name: row.name,
        visibility: row.visibility,
        isDefault: row.isDefault,
        // a view saved under an older shape opens with today's defaults rather than not at all
        config: viewConfigSchema.safeParse(row.config).data ?? viewConfigSchema.parse({}),
        ownerId: row.createdBy,
        canEdit: row.visibility === 'private' ? row.createdBy === ctx.userId : canShare,
        updatedAt: row.updatedAt.toISOString()
    };
}
