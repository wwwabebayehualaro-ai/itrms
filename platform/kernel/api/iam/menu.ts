/**
 * The effective menu of a person in their active unit (ADR-0028, navigation-and-menus.md §3): the installed modules' menu
 * items, shown only where the unit offers one of the item's services, the unit's type has its capabilities and the person
 * holds its permission here. The bureau overlay (rename, reorder, hide) comes in Phase 1; it can never widen this.
 * Code checks services and capabilities, never unit names or type keys (ADR-0026).
 */
import { MENU_GROUPS, type MenuRequires, type ModuleManifest } from '@itrms/module-sdk';
import type { I18nText } from '@itrms/schemas';

export interface MenuContext {
    permissions: ReadonlySet<string>;
    /** The active unit's effective services. */
    services: ReadonlySet<string>;
    /** The capabilities of the active unit's type. */
    capabilities: ReadonlySet<string>;
}

export interface MenuLink {
    key: string;
    label: I18nText;
    route: string;
}

export interface EffectiveMenuItem extends MenuLink {
    icon: string;
    quickActions: MenuLink[];
}

export interface EffectiveMenuGroup {
    /** `home`, `my-work`, `work-process:1` … `work-process:10`, `registries`, `reports`, `administration`, `help` */
    key: string;
    label: I18nText;
    items: EffectiveMenuItem[];
}

export type Catalogues = Readonly<Record<string, Readonly<Record<string, string>>>>;

export function allowed(requires: MenuRequires, context: MenuContext): boolean {
    if (requires.permission && !context.permissions.has(requires.permission)) return false;
    if (requires.services.length > 0 && !requires.services.some((s) => context.services.has(s))) return false;
    return requires.capabilities.every((c) => context.capabilities.has(c));
}

/** A message in every language that has it (the loader made sure of `am` and `en`). */
export function textOf(messages: Catalogues, key: string): I18nText {
    const text: Record<string, string> = {};
    for (const [language, catalogue] of Object.entries(messages)) {
        const value = catalogue[key];
        if (value) text[language] = value;
    }
    return { am: text.am ?? key, en: text.en ?? key, ...text };
}

export function effectiveMenu(
    manifests: readonly ModuleManifest[],
    messages: Catalogues,
    context: MenuContext
): EffectiveMenuGroup[] {
    type Collected = EffectiveMenuItem & { order: number };
    const groups = new Map<string, { key: string; label: I18nText; items: Collected[]; rank: number }>();
    for (const m of manifests)
        for (const item of m.menu) {
            if (!allowed(item.requires, context)) continue;
            const process = item.group === 'work-process' ? m.workProcess : undefined;
            const key = process === undefined ? item.group : `work-process:${process}`;
            let group = groups.get(key);
            if (!group) {
                group = {
                    key,
                    // the work process's name is its module's title
                    label:
                        process !== undefined && m.title ? m.title : textOf(messages, `kernel.nav.group.${item.group}`),
                    items: [],
                    rank: MENU_GROUPS.indexOf(item.group) * 100 + (process ?? 0)
                };
                groups.set(key, group);
            }
            group.items.push({
                order: item.order,
                key: item.key,
                label: textOf(messages, item.label),
                icon: item.icon,
                route: item.route,
                quickActions: item.quickActions
                    .filter((a) => allowed(a.requires, context))
                    .map((a) => ({ key: a.key, label: textOf(messages, a.label), route: a.route }))
            });
        }
    // several modules feed one group (registries, reports, administration): their items are ordered together
    return [...groups.values()]
        .sort((a, b) => a.rank - b.rank)
        .map(({ key, label, items }) => ({
            key,
            label,
            items: items
                .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
                .map(({ key: itemKey, label: itemLabel, icon, route, quickActions }) => ({
                    key: itemKey,
                    label: itemLabel,
                    icon,
                    route,
                    quickActions
                }))
        }));
}

/** A role's message key: `competency.officer` → `competency.role.officer`; a kernel role `cashier` → `kernel.role.cashier`. */
export function roleLabelKey(role: string): string {
    const dot = role.indexOf('.');
    return dot < 0 ? `kernel.role.${role}` : `${role.slice(0, dot)}.role.${role.slice(dot + 1)}`;
}

/** The roles' names in every language, for the screens (a role key is never shown to a person). */
export const roleLabels = (messages: Catalogues, roles: Iterable<string>): Record<string, I18nText> =>
    Object.fromEntries([...new Set(roles)].map((r) => [r, textOf(messages, roleLabelKey(r))]));

/** Settings a browser may see: display settings only (`ui.*`, `i18n.*`); security and service settings never leave. */
export const CLIENT_SETTINGS = /^(ui|i18n)\./;
