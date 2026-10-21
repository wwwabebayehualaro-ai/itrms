import { describe, expect, it } from 'vitest';

import { KeycloakIdentityAdmin } from './keycloak-identity-admin';

interface FakeGroup {
    id: string;
    name: string;
    parent?: string;
    attributes?: Record<string, string[]>;
}

/** The parts of Keycloak's admin REST API the adapter uses, on maps. */
function fakeKeycloak() {
    const groups = new Map<string, FakeGroup>();
    const members = new Map<string, Set<string>>([['sub-1', new Set()]]);
    const calls: string[] = [];
    let n = 0;
    const json = (body: unknown, status = 200) => Response.json(body, { status });
    const children = (parent?: string) =>
        [...groups.values()]
            .filter((g) => g.parent === parent)
            .map((g) => ({
                ...g,
                subGroupCount: [...groups.values()].filter((c) => c.parent === g.id).length
            }));
    const text = (body: unknown) =>
        typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : '';
    const respond = (input: RequestInfo | URL, init?: RequestInit): Response => {
        const url = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
        const method = init?.method ?? 'GET';
        const path = url.pathname.replace('/admin/realms/itrms', '');
        calls.push(`${method} ${path}`);
        if (path.endsWith('/token')) {
            expect(text(init?.body)).toContain('grant_type=client_credentials');
            return json({ access_token: 't', expires_in: 300 });
        }
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t');
        const body = init?.body ? (JSON.parse(text(init.body)) as FakeGroup) : undefined;
        let m: RegExpMatchArray | null;
        if (path === '/groups' && method === 'GET') return json(children());
        if ((m = /^\/groups\/([^/]+)\/children$/.exec(path)) && method === 'GET') return json(children(m[1]));
        if ((path === '/groups' || (m = /^\/groups\/([^/]+)\/children$/.exec(path))) && method === 'POST' && body) {
            const parent = path === '/groups' ? undefined : m?.[1];
            if (body.id) {
                const g = groups.get(body.id);
                if (g) g.parent = parent;
                return new Response(null, { status: 204 });
            }
            const id = `g${++n}`;
            groups.set(id, { id, name: body.name, parent, attributes: body.attributes });
            return new Response(null, {
                status: 201,
                headers: { location: `http://kc/admin/realms/itrms/groups/${id}` }
            });
        }
        if ((m = /^\/groups\/([^/]+)$/.exec(path)) && method === 'PUT' && body) {
            const g = groups.get(m[1] ?? '');
            if (g) Object.assign(g, { name: body.name, attributes: body.attributes });
            return new Response(null, { status: 204 });
        }
        if ((m = /^\/users\/([^/]+)\/groups$/.exec(path))) {
            const set = members.get(decodeURIComponent(m[1] ?? ''));
            if (!set) return json({ error: 'User not found' }, 404);
            return json([...set].map((id) => groups.get(id)));
        }
        if ((m = /^\/users\/([^/]+)\/groups\/([^/]+)$/.exec(path))) {
            const set = members.get(decodeURIComponent(m[1] ?? ''));
            if (method === 'PUT') set?.add(m[2] ?? '');
            if (method === 'DELETE') set?.delete(m[2] ?? '');
            return new Response(null, { status: 204 });
        }
        return json({ error: 'unexpected' }, 500);
    };
    const fetch: typeof globalThis.fetch = (input, init) => Promise.resolve(respond(input, init));
    return { groups, members, calls, fetch };
}

const admin = (kc: ReturnType<typeof fakeKeycloak>) =>
    new KeycloakIdentityAdmin({
        url: 'http://kc',
        realm: 'itrms',
        clientId: 'itrms-identity-admin',
        clientSecret: 'secret',
        fetch: kc.fetch
    });

const tree = [
    { id: 'u-region', code: 'SER', parentId: null, name: 'ደቡብ ኢትዮጵያ' },
    { id: 'u-zone', code: 'WOL', parentId: 'u-region', name: 'ወላይታ' },
    { id: 'u-town', code: 'WOL-BODITI', parentId: 'u-zone', name: 'ቦዲቲ' }
];

describe('Keycloak identity admin', () => {
    it('mirrors the tree as nested groups, and a second run changes nothing', async () => {
        const kc = fakeKeycloak();
        expect(await admin(kc).syncUnits(tree)).toEqual({ created: 3, updated: 0 });
        const town = [...kc.groups.values()].find((g) => g.name === 'WOL-BODITI');
        const zone = [...kc.groups.values()].find((g) => g.name === 'WOL');
        expect(town?.parent).toBe(zone?.id);
        expect(town?.attributes).toEqual({ itrms_unit_id: ['u-town'], itrms_unit_name: ['ቦዲቲ'] });
        expect(await admin(kc).syncUnits(tree)).toEqual({ created: 0, updated: 0 });
    });

    it('renames and moves a group with its unit, and leaves hand-made groups alone', async () => {
        const kc = fakeKeycloak();
        kc.groups.set('hand', { id: 'hand', name: 'ICT staff' });
        await admin(kc).syncUnits(tree);
        const moved = [
            ...tree.slice(0, 2),
            { id: 'u-town', code: 'SER-BODITI', parentId: 'u-region', name: 'ቦዲቲ ከተማ' }
        ];
        expect(await admin(kc).syncUnits(moved)).toEqual({ created: 0, updated: 1 });
        const town = [...kc.groups.values()].find((g) => g.attributes?.itrms_unit_id?.[0] === 'u-town');
        const region = [...kc.groups.values()].find((g) => g.name === 'SER');
        expect(town).toMatchObject({ name: 'SER-BODITI', parent: region?.id });
        expect(kc.groups.get('hand')).toEqual({ id: 'hand', name: 'ICT staff' });
    });

    it('makes a person a member of exactly the units they hold a role in', async () => {
        const kc = fakeKeycloak();
        const identity = admin(kc);
        await identity.syncUnits(tree);
        kc.groups.set('hand', { id: 'hand', name: 'hand' });
        kc.members.get('sub-1')?.add('hand');
        await identity.syncMemberships({ keycloakSub: 'sub-1', unitIds: ['u-zone', 'u-town'] });
        const names = () => [...(kc.members.get('sub-1') ?? [])].map((id) => kc.groups.get(id)?.name ?? id).sort();
        expect(names()).toEqual(['WOL', 'WOL-BODITI', 'hand']);
        await identity.syncMemberships({ keycloakSub: 'sub-1', unitIds: ['u-town'] });
        expect(names()).toEqual(['WOL-BODITI', 'hand']);
        // an account Keycloak doesn't have is skipped
        await expect(identity.syncMemberships({ keycloakSub: 'nobody', unitIds: ['u-town'] })).resolves.toBeUndefined();
    });
});
