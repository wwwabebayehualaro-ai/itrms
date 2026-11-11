/**
 * Fee rules from a seed file (task 0.22a): written at the region's root, checked as a person's version is. A demo rule's
 * version (placeholder amounts) is approved as the installation's own step (no actor: `decided_by` stays null, as an
 * installation's writes do); any other waits for a person's decision (maker-checker, SEC-AC-6: a real schedule is never
 * approved by a seed). Idempotent by key and content: a file run again stores nothing new, and a changed rule becomes its
 * next version.
 */
import { and, eq, max, sql } from 'drizzle-orm';
import { contentHash, insertAudited, updateAudited, type Tx } from '@itrms/kernel/db';
import { setUpCounter } from '@itrms/kernel/numbering';
import { feeRuleSchema, i18nTextSchema } from '@itrms/schemas';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { FEE_RULE_KEY, RECEIPT_COUNTER, RECEIPT_PATTERN } from '../contracts';
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

/**
 * The receipt counters of a region (task 0.22b): every active office whose type collects cash numbers its receipts from
 * its own counter, gapless per fiscal year. Installation work (the owner role: the API role cannot create counters), run
 * with the seed and again when offices are added; it never lowers a counter. A pattern keeps the office, the sequence and
 * the fiscal year, so numbers never repeat across years.
 */
export async function setUpReceiptCounters(tx: Tx, regionId: string, pattern = RECEIPT_PATTERN): Promise<number> {
    if (!pattern.includes('{efy}') || !/\{seq(:0\d)?\}/.test(pattern) || !pattern.includes('{unit}'))
        throw new Error(`receipt counters: the pattern ${pattern} needs {unit}, {seq} and {efy}`);
    const offices = await tx.execute<{ id: string }>(sql`
        select u.id from kernel.org_units u join kernel.unit_types t on t.id = u.unit_type_id
         where u.region_id = ${regionId} and u.active and 'collects_cash' = any(t.capabilities)`);
    for (const office of offices.rows)
        await setUpCounter(tx, { key: RECEIPT_COUNTER, unitId: office.id, regionId, pattern });
    return offices.rows.length;
}

export { DEMO_STATIONERY, importStationeryDemo, type StationeryDemoCounts } from './stationery';
