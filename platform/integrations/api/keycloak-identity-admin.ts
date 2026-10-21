/**
 * The Keycloak adapter of the kernel's IdentityAdmin port (ADR-0004): org units as nested groups, people as members of the
 * units they hold a role in. It signs in as the `itrms-identity-admin` service account (client credentials; the realm
 * gives it `manage-users`, `view-users`, `query-users` and `query-groups`). `manage-users` can also reset any
 * account's password and second factor, administrators' included: its secret is as sensitive as the realm's admin
 * password, held only by the worker and the seed (`KEYCLOAK_ADMIN_CLIENT_SECRET`, kernel config). Keycloak's
 * fine-grained admin permissions narrowing it to groups and memberships are a follow-up. A group mirrors a unit when
 * its `itrms_unit_id` attribute names it; groups an administrator made by hand are never touched.
 */
import type { IdentityAdmin, IdentityMember, IdentityUnit } from '@itrms/kernel/iam';

export interface KeycloakAdminOptions {
    /**
     * Keycloak's internal base URL (`http://keycloak:8080/auth` on the Compose network). Never the public one: Nginx
     * answers 404 to `/auth/admin`.
     */
    url: string;
    realm: string;
    clientId: string;
    clientSecret: string;
    fetch?: typeof fetch;
}

interface Group {
    id: string;
    name: string;
    parentId?: string;
    attributes?: Record<string, string[]>;
    subGroupCount?: number;
}

const UNIT_ATTRIBUTE = 'itrms_unit_id';

export class KeycloakIdentityAdmin implements IdentityAdmin {
    private readonly fetch: typeof fetch;
    private token?: { value: string; expiresAt: number };
    /** unit id → group id, from the last walk of the realm's groups */
    private unitGroups?: Map<string, string>;

    constructor(private readonly options: KeycloakAdminOptions) {
        this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    }

    private async accessToken(): Promise<string> {
        if (this.token && this.token.expiresAt - Date.now() > 30_000) return this.token.value;
        const { url, realm, clientId, clientSecret } = this.options;
        const res = await this.fetch(`${url}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret
            })
        });
        if (!res.ok) throw new Error(`Keycloak refused the identity-admin client (${res.status})`);
        const body = (await res.json()) as { access_token: string; expires_in: number };
        this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
        return this.token.value;
    }

    /** An admin REST call; a 404 on a read comes back to the caller, any other failure throws (without the body). */
    private async call(method: string, path: string, body?: unknown): Promise<Response> {
        const res = await this.fetch(
            `${this.options.url}/admin/realms/${encodeURIComponent(this.options.realm)}${path}`,
            {
                method,
                headers: {
                    authorization: `Bearer ${await this.accessToken()}`,
                    ...(body === undefined ? {} : { 'content-type': 'application/json' })
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(30_000)
            }
        );
        if (!res.ok && !(res.status === 404 && method === 'GET'))
            throw new Error(`Keycloak ${method} ${path.split('?')[0]} → ${res.status}`);
        return res;
    }

    /** Every group of the realm, walked level by level (Keycloak lists children per parent). */
    private async allGroups(): Promise<Group[]> {
        const groups: Group[] = [];
        const page = async (path: string, parentId?: string) => {
            for (let first = 0; ; first += 500) {
                const sep = path.includes('?') ? '&' : '?';
                const batch = (await (
                    await this.call('GET', `${path}${sep}briefRepresentation=false&first=${first}&max=500`)
                ).json()) as Group[];
                for (const g of batch) {
                    groups.push({ ...g, parentId });
                    if ((g.subGroupCount ?? 1) > 0) await page(`/groups/${g.id}/children`, g.id);
                }
                if (batch.length < 500) return;
            }
        };
        await page('/groups');
        return groups;
    }

    private async groupsByUnit(): Promise<Map<string, Group>> {
        const byUnit = new Map<string, Group>();
        for (const g of await this.allGroups()) {
            const unitId = g.attributes?.[UNIT_ATTRIBUTE]?.[0];
            if (unitId) byUnit.set(unitId, g);
        }
        return byUnit;
    }

    async syncUnits(units: readonly IdentityUnit[]) {
        const byUnit = await this.groupsByUnit();
        let created = 0;
        let updated = 0;
        for (const unit of units) {
            const parentGroup = unit.parentId ? byUnit.get(unit.parentId) : undefined;
            if (unit.parentId && !parentGroup)
                throw new Error(`unit ${unit.code}: its parent has no group (parents first)`);
            const attributes = { [UNIT_ATTRIBUTE]: [unit.id], itrms_unit_name: [unit.name] };
            const existing = byUnit.get(unit.id);
            const where = parentGroup ? `/groups/${parentGroup.id}/children` : '/groups';
            if (!existing) {
                const res = await this.call('POST', where, { name: unit.code, attributes });
                const id = res.headers.get('location')?.split('/').pop();
                if (!id) throw new Error(`unit ${unit.code}: Keycloak returned no group id`);
                byUnit.set(unit.id, { id, name: unit.code, parentId: parentGroup?.id, attributes });
                created++;
                continue;
            }
            const moved = existing.parentId !== parentGroup?.id;
            const changed =
                existing.name !== unit.code || existing.attributes?.itrms_unit_name?.[0] !== unit.name || moved;
            if (!changed) continue;
            // posting an existing group under a parent moves it there (or to the top level)
            if (moved) await this.call('POST', where, { id: existing.id, name: unit.code });
            await this.call('PUT', `/groups/${existing.id}`, { ...existing, name: unit.code, attributes });
            byUnit.set(unit.id, { ...existing, name: unit.code, parentId: parentGroup?.id, attributes });
            updated++;
        }
        this.unitGroups = new Map([...byUnit].map(([unitId, g]) => [unitId, g.id]));
        return { created, updated };
    }

    async syncMemberships({ keycloakSub, unitIds }: IdentityMember) {
        const user = encodeURIComponent(keycloakSub);
        const res = await this.call('GET', `/users/${user}/groups?briefRepresentation=false&max=1000`);
        // an ITRMS user whose Keycloak account does not exist (yet): nothing to do
        if (res.status === 404) return;
        const current = ((await res.json()) as Group[]).filter((g) => g.attributes?.[UNIT_ATTRIBUTE]?.[0]);
        const wanted = new Set(unitIds);
        this.unitGroups ??= new Map([...(await this.groupsByUnit())].map(([unitId, g]) => [unitId, g.id]));
        const unitGroups = this.unitGroups;
        for (const g of current)
            if (!wanted.has(g.attributes?.[UNIT_ATTRIBUTE]?.[0] ?? ''))
                await this.call('DELETE', `/users/${user}/groups/${g.id}`);
        const have = new Set(current.map((g) => g.attributes?.[UNIT_ATTRIBUTE]?.[0]));
        for (const unitId of wanted) {
            const groupId = unitGroups.get(unitId);
            if (groupId && !have.has(unitId)) await this.call('PUT', `/users/${user}/groups/${groupId}`);
        }
    }
}
