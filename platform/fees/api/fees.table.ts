/**
 * Fee rules and the fees cases keep (architecture.md §9, ADR-0041; task 0.22a).
 *
 *   fee_rules            a rule by key, owned at the region's root (class C: every unit reads the bureau's rules; only the
 *                        root writes them).
 *   fee_rule_versions    immutable, content-hashed versions (class C). No UPDATE or DELETE: grants and a trigger refuse them.
 *   fee_rule_approvals   the decision on a version (maker-checker, SEC-AC-6): one per version, append-only; a service version
 *                        may name only an approved one.
 *   case_fees            the fee a case was assessed, append-only (class T at the handling unit): number 1 when the request
 *                        is filed, one more each time a correction changes it; the newest holds. 0.22b's payment order
 *                        reads it.
 *   case_fee_lines       its lines, in santim.
 *
 * Money is `bigint` santim (ADR-0014). The audit log holds a version's hash, never its content.
 */
import {
    bigint,
    boolean,
    date,
    index,
    integer,
    jsonb,
    pgSchema,
    text,
    uniqueIndex,
    uuid,
    type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { orgUnits } from '@itrms/kernel/tables';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';
import type { I18nText } from '@itrms/schemas';

export const feesSchema = pgSchema('fees');

const owned = () => ({
    regionId: uuid('region_id').notNull(),
    ownerUnitId: uuid('owner_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the owner unit */
    orgPath: ltree('org_path').notNull().default('')
});

const handled = () => ({
    regionId: uuid('region_id').notNull(),
    handlingUnitId: uuid('handling_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the handling unit */
    orgPath: ltree('org_path').notNull().default('')
});

export const feeRules = withRls(
    audited(
        feesSchema.table(
            'fee_rules',
            {
                ...baseColumns(),
                ...owned(),
                key: text('key').notNull(),
                /** I18nText: Amharic and English required */
                name: jsonb('name').$type<I18nText>().notNull(),
                active: boolean('active').notNull().default(true),
                /** the newest version */
                latestVersionId: uuid('latest_version_id').references((): AnyPgColumn => feeRuleVersions.id)
            },
            (t) => [
                uniqueIndex('fee_rules_key_uq').on(t.regionId, t.key),
                index('fee_rules_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'config'
);

export const feeRuleVersions = withRls(
    audited(
        feesSchema.table(
            'fee_rule_versions',
            {
                ...baseColumns(),
                ...owned(),
                ruleId: uuid('rule_id')
                    .notNull()
                    .references(() => feeRules.id),
                /** 1, 2, 3 … per rule, in the order versions were stored */
                number: integer('number').notNull(),
                contentHash: text('content_hash').notNull(),
                /** the rule (FeeRule, schemaVersion 1) */
                document: jsonb('document').notNull(),
                /** its amounts are placeholders, not the regional schedule */
                demo: boolean('demo').notNull()
            },
            (t) => [
                uniqueIndex('fee_rule_versions_content_uq').on(t.ruleId, t.contentHash),
                uniqueIndex('fee_rule_versions_number_uq').on(t.ruleId, t.number),
                index('fee_rule_versions_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        { omit: ['document'] }
    ),
    'config'
);

export const feeRuleApprovals = withRls(
    audited(
        feesSchema.table(
            'fee_rule_approvals',
            {
                ...baseColumns(),
                ...owned(),
                versionId: uuid('version_id')
                    .notNull()
                    .references(() => feeRuleVersions.id),
                decision: text('decision').$type<'approved' | 'rejected'>().notNull(),
                reason: text('reason'),
                /** who decided: never the version's author; null only for the installation's seed */
                decidedBy: uuid('decided_by')
            },
            (t) => [
                uniqueIndex('fee_rule_approvals_version_uq').on(t.versionId),
                index('fee_rule_approvals_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'config'
);

export const caseFees = withRls(
    audited(
        feesSchema.table(
            'case_fees',
            {
                ...baseColumns(),
                ...handled(),
                /** the case (workflow.cases; the key is in the migration: this slice sits below the workflow's) */
                caseId: uuid('case_id').notNull(),
                number: integer('number').notNull(),
                reason: text('reason').$type<'filed' | 'amended'>().notNull(),
                feeRuleVersionId: uuid('fee_rule_version_id')
                    .notNull()
                    .references(() => feeRuleVersions.id),
                /** the service version's mapping of the rule's inputs to the form's keys, as it was used */
                inputMap: jsonb('input_map').$type<Record<string, string>>().notNull(),
                /** the day the fee counts to (Addis Ababa) */
                asOf: date('as_of').notNull(),
                /** the request it was worked out from (forms.submissions; the key is in the migration); none: a service without a form */
                submissionId: uuid('submission_id'),
                totalSantim: bigint('total_santim', { mode: 'bigint' }).notNull(),
                demo: boolean('demo').notNull()
            },
            (t) => [
                uniqueIndex('case_fees_number_uq').on(t.caseId, t.number),
                index('case_fees_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

export const caseFeeLines = withRls(
    audited(
        feesSchema.table(
            'case_fee_lines',
            {
                ...baseColumns(),
                ...handled(),
                caseFeeId: uuid('case_fee_id')
                    .notNull()
                    .references(() => caseFees.id),
                position: integer('position').notNull(),
                key: text('key').notNull(),
                /** I18nText */
                label: jsonb('label').$type<I18nText>().notNull(),
                /** the units charged (a per-unit or percent line), else null */
                quantity: integer('quantity'),
                amountSantim: bigint('amount_santim', { mode: 'bigint' }).notNull()
            },
            (t) => [
                uniqueIndex('case_fee_lines_position_uq').on(t.caseFeeId, t.position),
                index('case_fee_lines_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);
