/**
 * Fee rules (ADR-0041, task 0.22a): written by the bureau at the region's root, as immutable, content-hashed versions
 * (sending the same content again names the version that holds it). Each version is decided once by another person, in a
 * role the region's `fees.rules.approverRoles` names (maker-checker, SEC-AC-6); a service version may name only an
 * approved version of an active rule. Every write is audited in its transaction; the audit holds a version's hash.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { contentHash, insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { SettingsService } from '@itrms/kernel/settings';
import { orgUnits } from '@itrms/kernel/tables';
import { checkFeeRule } from '@itrms/form-engine/core';
import { feeRuleSchema, type FeeRule } from '@itrms/schemas';

import { FEE_APPROVER_ROLES_SETTING, type FeeRuleCreate, type FeeRuleOut, type FeeRuleVersionOut } from '../contracts';
import { feeRuleApprovals, feeRules, feeRuleVersions } from './fees.table';

type RuleRow = typeof feeRules.$inferSelect;
type VersionRow = typeof feeRuleVersions.$inferSelect;
type ApprovalRow = typeof feeRuleApprovals.$inferSelect;

/** An approved version, as a service version charges by it. */
export interface ApprovedFeeRule {
    versionId: string;
    ruleId: string;
    rule: FeeRule;
    demo: boolean;
    contentHash: string;
}

/** Why a version cannot be charged by (a service version's publication names the problem). */
export type FeeRuleUnusable = 'fee_rule_unknown' | 'fee_rule_off' | 'fee_rule_not_approved' | 'fee_rule_not_regional';

const isUniqueViolation = (error: unknown, constraint: string): boolean => {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint: name } = e as { code?: string; constraint?: string };
        if (code === '23505' && name === constraint) return true;
    }
    return false;
};

@Injectable()
export class FeeRulesService {
    constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

    /** The rule's problems beyond its schema (its formulas), as a 422 listing every one. */
    private valid(document: FeeRule): FeeRule {
        const problems = checkFeeRule(document);
        if (problems.length)
            throw new ValidationError('validation_failed', {
                detail: 'The fee rule is not valid: fix what is listed.',
                errors: problems.map((p) => ({ path: `document.${p.path}`, code: p.code, message: p.message }))
            });
        return document;
    }

    /** A rule checked without storing it. */
    check(document: FeeRule) {
        return { problems: checkFeeRule(document) };
    }

    /** The region's root, if the person's seat is there: fee rules are the bureau's. */
    private async atRoot(tx: Tx, ctx: DbContext) {
        const [root] = await tx
            .select()
            .from(orgUnits)
            .where(eq(orgUnits.id, ctx.regionId ?? ''));
        if (!root) throw new NotFoundError();
        if (root.path !== ctx.scopePath)
            throw new ForbiddenError({ audit: { reason: 'fee_rule_below_region', unit: ctx.unitId ?? '' } });
        return root;
    }

    async create(tx: Tx, ctx: DbContext, input: FeeRuleCreate): Promise<FeeRuleOut> {
        const root = await this.atRoot(tx, ctx);
        const document = this.valid(feeRuleSchema.parse(input.document));
        let row: RuleRow;
        try {
            row = await insertAudited(tx, feeRules, {
                regionId: root.regionId,
                ownerUnitId: root.id,
                key: input.key,
                name: input.name
            });
        } catch (error) {
            if (isUniqueViolation(error, 'fee_rules_key_uq'))
                throw new ConflictError('duplicate_reference', {
                    detail: 'A fee rule with this key already exists in the region.',
                    cause: error
                });
            throw error;
        }
        const version = await this.store(tx, row, document);
        await updateAudited(tx, feeRules, row.id, row.rowVersion, { latestVersionId: version.id });
        return this.get(tx, row.id);
    }

    /** A new version, numbered after the last; the same content names the version that holds it. */
    async addVersion(tx: Tx, ctx: DbContext, id: string, raw: FeeRule): Promise<FeeRuleVersionOut> {
        await this.atRoot(tx, ctx);
        const document = this.valid(raw);
        // locked: two versions stored at once are numbered one after the other
        const [rule] = await tx.select().from(feeRules).where(eq(feeRules.id, id)).for('update');
        if (!rule) throw new NotFoundError();
        const version = await this.store(tx, rule, document);
        if (rule.latestVersionId !== version.id)
            await updateAudited(tx, feeRules, rule.id, rule.rowVersion, { latestVersionId: version.id });
        return this.version(tx, id, version.id);
    }

    private async store(tx: Tx, rule: RuleRow, document: FeeRule): Promise<VersionRow> {
        const hash = contentHash(document);
        const [existing] = await tx
            .select()
            .from(feeRuleVersions)
            .where(and(eq(feeRuleVersions.ruleId, rule.id), eq(feeRuleVersions.contentHash, hash)));
        if (existing) return existing;
        const [last] = await tx
            .select({ number: max(feeRuleVersions.number) })
            .from(feeRuleVersions)
            .where(eq(feeRuleVersions.ruleId, rule.id));
        return insertAudited(tx, feeRuleVersions, {
            regionId: rule.regionId,
            ownerUnitId: rule.ownerUnitId,
            ruleId: rule.id,
            number: (last?.number ?? 0) + 1,
            contentHash: hash,
            document,
            demo: document.demo
        });
    }

    /**
     * Decides a version, once: at the region's root, by someone other than its author, in a role the region's setting
     * names. Refusals are audited (403); a second decision is a conflict.
     */
    async decide(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        id: string,
        versionId: string,
        input: { decision: 'approved' | 'rejected'; reason?: string }
    ): Promise<FeeRuleVersionOut> {
        const root = await this.atRoot(tx, ctx);
        const [version] = await tx
            .select()
            .from(feeRuleVersions)
            .where(and(eq(feeRuleVersions.id, versionId), eq(feeRuleVersions.ruleId, id)));
        if (!version) throw new NotFoundError();
        if (version.createdBy !== null && version.createdBy === ctx.userId)
            throw new ForbiddenError({
                detail: 'Another person decides a fee rule version you wrote.',
                audit: { reason: 'fee_rule_self_approval', version: version.id }
            });
        const approvers = await this.settings.value<string[]>(tx, root.id, FEE_APPROVER_ROLES_SETTING);
        if (!roles.some((r) => approvers.includes(r)))
            throw new ForbiddenError({
                detail: 'Your role does not decide fee rules in this region.',
                audit: { reason: 'fee_rule_not_approver', version: version.id }
            });
        try {
            await insertAudited(tx, feeRuleApprovals, {
                regionId: version.regionId,
                ownerUnitId: version.ownerUnitId,
                versionId: version.id,
                decision: input.decision,
                reason: input.reason ?? null,
                decidedBy: ctx.userId ?? null
            });
        } catch (error) {
            if (isUniqueViolation(error, 'fee_rule_approvals_version_uq'))
                throw new ConflictError('stale_version', {
                    detail: 'This version has been decided already.',
                    cause: error
                });
            throw error;
        }
        return this.version(tx, id, versionId);
    }

    async list(tx: Tx): Promise<FeeRuleOut[]> {
        const rows = await tx.select().from(feeRules).orderBy(feeRules.key).limit(500);
        return this.out(tx, rows);
    }

    async get(tx: Tx, id: string): Promise<FeeRuleOut> {
        const [row] = await tx.select().from(feeRules).where(eq(feeRules.id, id));
        if (!row) throw new NotFoundError();
        const [out] = await this.out(tx, [row]);
        if (!out) throw new NotFoundError();
        return out;
    }

    async versions(tx: Tx, id: string): Promise<FeeRuleVersionOut[]> {
        await this.get(tx, id);
        const rows = await tx
            .select()
            .from(feeRuleVersions)
            .where(eq(feeRuleVersions.ruleId, id))
            .orderBy(desc(feeRuleVersions.number));
        return this.versionsOut(tx, rows);
    }

    async version(tx: Tx, id: string, versionId: string): Promise<FeeRuleVersionOut> {
        const [row] = await tx
            .select()
            .from(feeRuleVersions)
            .where(and(eq(feeRuleVersions.id, versionId), eq(feeRuleVersions.ruleId, id)));
        if (!row) throw new NotFoundError();
        const [out] = await this.versionsOut(tx, [row]);
        if (!out) throw new NotFoundError();
        return out;
    }

    /**
     * The version a service version would charge by, or why it cannot: it must exist, be approved, and be of an active
     * rule owned at `regionPath` (the region's root: a zone's rule is not read by the other zones' offices).
     */
    async usable(
        tx: Tx,
        versionId: string,
        regionPath?: string
    ): Promise<{ ok: true; rule: ApprovedFeeRule } | { ok: false; problem: FeeRuleUnusable }> {
        const [row] = await tx
            .select({ v: feeRuleVersions, active: feeRules.active, orgPath: feeRules.orgPath, a: feeRuleApprovals })
            .from(feeRuleVersions)
            .innerJoin(feeRules, eq(feeRules.id, feeRuleVersions.ruleId))
            .leftJoin(feeRuleApprovals, eq(feeRuleApprovals.versionId, feeRuleVersions.id))
            .where(eq(feeRuleVersions.id, versionId));
        if (!row) return { ok: false, problem: 'fee_rule_unknown' };
        if (!row.active) return { ok: false, problem: 'fee_rule_off' };
        if (row.a?.decision !== 'approved') return { ok: false, problem: 'fee_rule_not_approved' };
        if (regionPath !== undefined && row.orgPath !== regionPath)
            return { ok: false, problem: 'fee_rule_not_regional' };
        return {
            ok: true,
            rule: {
                versionId: row.v.id,
                ruleId: row.v.ruleId,
                rule: feeRuleSchema.parse(row.v.document),
                demo: row.v.demo,
                contentHash: row.v.contentHash
            }
        };
    }

    /** A version as it was stored (a case's fee is worked out again on the version it was filed on). */
    async stored(tx: Tx, versionId: string): Promise<ApprovedFeeRule> {
        const [row] = await tx.select().from(feeRuleVersions).where(eq(feeRuleVersions.id, versionId));
        if (!row) throw new NotFoundError();
        return {
            versionId: row.id,
            ruleId: row.ruleId,
            rule: feeRuleSchema.parse(row.document),
            demo: row.demo,
            contentHash: row.contentHash
        };
    }

    private async versionsOut(tx: Tx, rows: VersionRow[]): Promise<FeeRuleVersionOut[]> {
        const decisions: ApprovalRow[] = rows.length
            ? await tx
                  .select()
                  .from(feeRuleApprovals)
                  .where(
                      inArray(
                          feeRuleApprovals.versionId,
                          rows.map((r) => r.id)
                      )
                  )
            : [];
        const byVersion = new Map(decisions.map((d) => [d.versionId, d]));
        return rows.map((r) => {
            const d = byVersion.get(r.id);
            return {
                id: r.id,
                ruleId: r.ruleId,
                number: r.number,
                document: feeRuleSchema.parse(r.document),
                demo: r.demo,
                createdBy: r.createdBy,
                createdAt: r.createdAt.toISOString(),
                status: d ? d.decision : 'pending',
                decidedBy: d?.decidedBy ?? null,
                decidedAt: d ? d.createdAt.toISOString() : null,
                reason: d?.reason ?? null
            };
        });
    }

    private async out(tx: Tx, rows: RuleRow[]): Promise<FeeRuleOut[]> {
        const latestIds = rows.map((r) => r.latestVersionId).filter((v): v is string => Boolean(v));
        const latest = latestIds.length
            ? await this.versionsOut(
                  tx,
                  await tx.select().from(feeRuleVersions).where(inArray(feeRuleVersions.id, latestIds))
              )
            : [];
        const byId = new Map(latest.map((v) => [v.id, v]));
        return rows.map((row) => ({
            id: row.id,
            key: row.key,
            name: row.name,
            active: row.active,
            latestVersion: (row.latestVersionId && byId.get(row.latestVersionId)) || null
        }));
    }
}
