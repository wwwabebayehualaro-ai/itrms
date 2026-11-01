/**
 * Fee rules from a seed file (task 0.22a): written at the region's root, checked as a person's version is. A demo rule's
 * version (placeholder amounts) is approved as the installation's own step (no actor: `decided_by` stays null, as an
 * installation's writes do); any other waits for a person's decision (maker-checker, SEC-AC-6: a real schedule is never
 * approved by a seed). Idempotent by key and content: a file run again stores nothing new, and a changed rule becomes its
 * next version.
 */
import { and, eq, max } from 'drizzle-orm';
import { contentHash, insertAudited, updateAudited, type Tx } from '@itrms/kernel/db';
import { feeRuleSchema, i18nTextSchema } from '@itrms/schemas';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { FEE_RULE_KEY } from '../contracts';
import { feeRuleProblems } from '../api/fee-rules.service';
import { feeRuleApprovals, feeRules, feeRuleVersions } from '../api/fees.table';

export const feeRuleSeedSchema = z.object({
    rules: z.array(
        z.strictObject({
            key: z.string().regex(FEE_RULE_KEY),
            name: i18nTextSchema,
            document: feeRuleSchema
        })
    )
});
export type FeeRuleSeed = z.infer<typeof feeRuleSeedSchema>['rules'][number];

export const parseFeeRules = (text: string): FeeRuleSeed[] => feeRuleSeedSchema.parse(parseYaml(text)).rules;

/** The rules in a region (its root unit): returns how many versions were stored. */
export async function importFeeRules(
    tx: Tx,
    root: { id: string; regionId: string },
    entries: readonly FeeRuleSeed[]
): Promise<number> {
    let stored = 0;
    for (const entry of entries) {
        const problems = feeRuleProblems(entry.document, 'en');
        if (problems.length)
            throw new Error(`fee rule ${entry.key}: ${problems.map((p) => `${p.path} ${p.message}`).join('; ')}`);
        let [rule] = await tx
            .select()
            .from(feeRules)
            .where(and(eq(feeRules.regionId, root.regionId), eq(feeRules.key, entry.key)))
            .for('update');
        if (!rule)
            rule = await insertAudited(tx, feeRules, {
                regionId: root.regionId,
                ownerUnitId: root.id,
                key: entry.key,
                name: entry.name
            });
        const hash = contentHash(entry.document);
        const [existing] = await tx
            .select()
            .from(feeRuleVersions)
            .where(and(eq(feeRuleVersions.ruleId, rule.id), eq(feeRuleVersions.contentHash, hash)));
        if (existing && rule.latestVersionId === existing.id) continue;
        let version = existing;
        if (!version) {
            const [last] = await tx
                .select({ number: max(feeRuleVersions.number) })
                .from(feeRuleVersions)
                .where(eq(feeRuleVersions.ruleId, rule.id));
            version = await insertAudited(tx, feeRuleVersions, {
                regionId: rule.regionId,
                ownerUnitId: rule.ownerUnitId,
                ruleId: rule.id,
                number: (last?.number ?? 0) + 1,
                contentHash: hash,
                document: entry.document,
                demo: entry.document.demo
            });
            if (entry.document.demo)
                await insertAudited(tx, feeRuleApprovals, {
                    regionId: rule.regionId,
                    ownerUnitId: rule.ownerUnitId,
                    versionId: version.id,
                    decision: 'approved',
                    reason: 'installation seed (demo amounts)',
                    decidedBy: null
                });
            stored += 1;
        }
        await updateAudited(tx, feeRules, rule.id, rule.rowVersion, { latestVersionId: version.id });
    }
    return stored;
}
