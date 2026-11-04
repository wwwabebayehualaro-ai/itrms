/**
 * The region's document templates (task 0.23a), at its root. Idempotent by content: run again it stores nothing new; a changed
 * template is the next version, and documents already issued keep the version they were issued from.
 */
import { and, eq, max } from 'drizzle-orm';
import { contentHash, insertAudited, updateAudited, type Tx } from '@itrms/kernel/db';

import { documentTemplateVersionSchema, TEMPLATE_KEY } from '../contracts';
import { documentTemplates, documentTemplateVersions } from '../api/documents.table';
import { templateProblems } from '../api/render/html';
import { TEMPLATE_SEEDS, type TemplateSeed } from './templates';

export { TEMPLATE_SEEDS, type TemplateSeed } from './templates';

/** Returns how many versions were stored. */
export async function importDocumentTemplates(
    tx: Tx,
    root: { id: string; regionId: string },
    entries: readonly TemplateSeed[] = TEMPLATE_SEEDS
): Promise<number> {
    let stored = 0;
    for (const entry of entries) {
        if (!TEMPLATE_KEY.test(entry.key)) throw new Error(`template key ${entry.key}`);
        const version = documentTemplateVersionSchema.parse(entry.version);
        const problems = templateProblems(version.body);
        if (problems.length) throw new Error(`template ${entry.key}: ${problems.join('; ')}`);
        let [template] = await tx
            .select()
            .from(documentTemplates)
            .where(and(eq(documentTemplates.regionId, root.regionId), eq(documentTemplates.key, entry.key)))
            .for('update');
        if (!template)
            template = await insertAudited(tx, documentTemplates, {
                regionId: root.regionId,
                ownerUnitId: root.id,
                key: entry.key,
                name: entry.name
            });
        const hash = contentHash(version);
        const [existing] = await tx
            .select({ id: documentTemplateVersions.id })
            .from(documentTemplateVersions)
            .where(
                and(
                    eq(documentTemplateVersions.templateId, template.id),
                    eq(documentTemplateVersions.contentHash, hash)
                )
            );
        if (existing && template.latestVersionId === existing.id) continue;
        let versionId = existing?.id;
        if (!versionId) {
            const [newest] = await tx
                .select({ n: max(documentTemplateVersions.number) })
                .from(documentTemplateVersions)
                .where(eq(documentTemplateVersions.templateId, template.id));
            const created = await insertAudited(tx, documentTemplateVersions, {
                regionId: root.regionId,
                ownerUnitId: root.id,
                templateId: template.id,
                number: (newest?.n ?? 0) + 1,
                contentHash: hash,
                ...version
            });
            versionId = created.id;
            stored += 1;
        }
        await updateAudited(tx, documentTemplates, template.id, template.rowVersion, { latestVersionId: versionId });
    }
    return stored;
}
