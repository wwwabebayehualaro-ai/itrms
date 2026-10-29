'use client';

/**
 * The settings of a unit (task 0.21a, ADR-0026): every setting the installed modules declare, its value here and where
 * it comes from (the default, the installation, the region, a unit above, the unit's type, the unit itself), what the
 * unit would inherit without its own value, and, where the person may, a change or a reset of the unit's own value or of
 * the region's value for every unit of its type. The API checks the level, the value, the scope and the version read.
 */
import { useState } from 'react';
import { LANGUAGE_ENDONYMS } from '@itrms/schemas';
import {
    Badge,
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    PageHeader,
    RadioGroup,
    RadioGroupItem,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    confirmAction,
    useNotify
} from '@itrms/ui';

import { isApiError } from '@/lib/api/client';
import { getApiErrorMessage } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/auth/authStore';
import { useText } from '@/lib/preferences';
import {
    useChangeSetting,
    useSubtree,
    useUnitSettings,
    type SettingSource,
    type SettingTarget,
    type UnitSetting,
    type UnitSettings
} from '@/lib/settings';

/** A value as a person reads it: a choice by its name, a list of choices, a number, or the value as it is. */
function useShow() {
    const { text } = useText();
    return (setting: UnitSetting, value: unknown): string => {
        const nameOf = (v: unknown) => {
            if (typeof v !== 'string') return String(v);
            const option = setting.options?.find((o) => o.value === v);
            if (option?.name) return text(option.name);
            return (LANGUAGE_ENDONYMS as Record<string, string>)[v] ?? v;
        };
        if (Array.isArray(value)) return value.map(nameOf).join(', ');
        if (typeof value === 'object' && value !== null) return JSON.stringify(value);
        return nameOf(value);
    };
}

/** Where a value comes from, named for the person. */
function useSourceName(data: UnitSettings | undefined) {
    const { t, text } = useText();
    return (source: SettingSource): string => {
        if (source.level === 'unit' || source.level === 'region') {
            const unit = data?.units.find((u) => u.id === source.unitId);
            return unit ? text(unit.name) : t(`shell.settings.source.${source.level}`);
        }
        return t(`shell.settings.source.${source.level}`);
    };
}

/** The editor of one value, from the setting's schema: a choice, choices, a number, or a text. */
function ValueEditor({
    setting,
    value,
    onChange
}: {
    setting: UnitSetting;
    value: unknown;
    onChange: (value: unknown) => void;
}) {
    const { t } = useText();
    const show = useShow();
    const { schema } = setting;
    if (setting.options && schema.type === 'array') {
        const chosen = new Set(Array.isArray(value) ? (value as unknown[]) : []);
        return (
            <ul className="flex flex-col gap-2">
                {setting.options.map((o) => (
                    <li key={o.value} className="flex items-center gap-2">
                        <Checkbox
                            id={`option-${o.value}`}
                            checked={chosen.has(o.value)}
                            onCheckedChange={(on) => {
                                const next = setting.options
                                    ?.map((x) => x.value)
                                    .filter((v) => (v === o.value ? on === true : chosen.has(v)));
                                onChange(next);
                            }}
                        />
                        <Label htmlFor={`option-${o.value}`}>{show(setting, o.value)}</Label>
                    </li>
                ))}
            </ul>
        );
    }
    if (setting.options)
        return (
            <Select value={typeof value === 'string' ? value : undefined} onValueChange={onChange}>
                <SelectTrigger aria-label={t('shell.settings.value')} className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {setting.options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                            {show(setting, o.value)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    if (schema.type === 'integer' || schema.type === 'number')
        return (
            <Input
                type="number"
                aria-label={t('shell.settings.value')}
                min={schema.minimum}
                max={schema.maximum}
                step={schema.type === 'integer' ? 1 : 'any'}
                value={typeof value === 'number' ? value : ''}
                onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            />
        );
    return (
        <Input
            aria-label={t('shell.settings.value')}
            value={typeof value === 'string' ? value : JSON.stringify(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}

interface Editing {
    setting: UnitSetting;
    /** the unit's own value, or the region's for every unit of its type */
    target: 'unit' | 'unitType';
    value: unknown;
}

export function SettingsAdmin() {
    const { t, text } = useText();
    const notify = useNotify();
    const show = useShow();
    const active = useAuthStore((s) => s.workspace?.activeUnit);
    const subtree = useSubtree(active?.id);
    const [unitId, setUnitId] = useState<string>();
    const shownUnit = unitId ?? active?.id;
    const settings = useUnitSettings(shownUnit);
    const sourceName = useSourceName(settings.data);
    const change = useChangeSetting();
    const [editing, setEditing] = useState<Editing | null>(null);

    const targetOf = (target: 'unit' | 'unitType'): SettingTarget | null => {
        const data = settings.data;
        if (!data) return null;
        if (target === 'unit') return { unitId: data.unitId };
        return data.unitType ? { unitTypeId: data.unitType.id } : null;
    };

    const failed = async (error: unknown) => {
        // changed meanwhile by another administrator: theirs is shown, the person decides again
        if (isApiError(error) && error.response?.status === 409) notify.error(t('shell.settings.changed'));
        else notify.error(getApiErrorMessage(error));
    };

    const save = async () => {
        if (!editing) return;
        const target = targetOf(editing.target);
        if (!target) return;
        const version = (editing.target === 'unit' ? editing.setting.own : editing.setting.unitType)?.version ?? 0;
        try {
            await change.mutateAsync({ target, key: editing.setting.key, version, value: editing.value });
            setEditing(null);
            notify.success(t('shell.settings.saved'));
        } catch (error) {
            setEditing(null);
            await failed(error);
        }
    };

    const reset = async (setting: UnitSetting, which: 'unit' | 'unitType') => {
        const target = targetOf(which);
        const own = which === 'unit' ? setting.own : setting.unitType;
        const after = which === 'unit' ? setting.inherited : setting.inheritedWithoutType;
        if (!target || !own) return;
        const sure = await confirmAction({
            header: t('shell.settings.resetTitle'),
            message: t('shell.settings.resetMessage', {
                name: text(setting.name),
                value: after ? show(setting, after.value) : ''
            }),
            acceptLabel: t('shell.settings.reset'),
            rejectLabel: t('shell.settings.cancel')
        });
        if (!sure) return;
        try {
            await change.mutateAsync({ target, key: setting.key, version: own.version });
            notify.success(t('shell.settings.resetDone'));
        } catch (error) {
            await failed(error);
        }
    };

    return (
        <div className="flex flex-col gap-6" data-screen="settings">
            <PageHeader title={t('shell.settings.title')} description={t('shell.settings.intro')} />
            <div className="flex max-w-md flex-col gap-2">
                <Label htmlFor="settings-unit">{t('shell.settings.unit')}</Label>
                <Select value={shownUnit} onValueChange={setUnitId}>
                    <SelectTrigger id="settings-unit" className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {(
                            subtree.data ?? (active ? [{ id: active.id, name: active.name, code: active.code }] : [])
                        ).map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                                {text(u.name)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {settings.error ? (
                <p className="text-sm text-destructive">{getApiErrorMessage(settings.error)}</p>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('shell.settings.name')}</TableHead>
                            <TableHead>{t('shell.settings.value')}</TableHead>
                            <TableHead>{t('shell.settings.from')}</TableHead>
                            <TableHead className="text-right">{t('shell.settings.actions')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {settings.isPending && (
                            <TableRow>
                                <TableCell colSpan={4}>
                                    <Skeleton className="h-6 w-full" />
                                </TableCell>
                            </TableRow>
                        )}
                        {settings.data?.settings.map((s) => (
                            <TableRow key={s.key} data-setting={s.key}>
                                <TableCell>
                                    <div className="font-medium">{text(s.name)}</div>
                                    {s.userPreference && (
                                        <div className="text-xs text-muted-foreground">
                                            {t('shell.settings.personal')}
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell data-value>{show(s, s.value)}</TableCell>
                                <TableCell>
                                    <Badge variant={s.own ? 'default' : 'outline'} data-source={s.source.level}>
                                        {s.own ? t('shell.settings.own') : sourceName(s.source)}
                                    </Badge>
                                    {s.own && s.inherited && (
                                        <div className="mt-1 text-xs text-muted-foreground">
                                            {t('shell.settings.inherits', {
                                                value: show(s, s.inherited.value),
                                                from: sourceName(s.inherited.source)
                                            })}
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap justify-end gap-2">
                                        {(s.writable.unit || s.writable.unitType) && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    setEditing({
                                                        setting: s,
                                                        target: s.writable.unit ? 'unit' : 'unitType',
                                                        value: s.value
                                                    })
                                                }
                                            >
                                                {t('shell.settings.change')}
                                            </Button>
                                        )}
                                        {s.own && s.writable.unit && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => void reset(s, 'unit')}
                                            >
                                                {t('shell.settings.reset')}
                                            </Button>
                                        )}
                                        {s.unitType && s.writable.unitType && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => void reset(s, 'unitType')}
                                            >
                                                {t('shell.settings.resetType')}
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
            <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
                {editing && (
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{text(editing.setting.name)}</DialogTitle>
                            <DialogDescription>
                                {editing.setting.sensitive
                                    ? t('shell.settings.sensitive')
                                    : t('shell.settings.editIntro')}
                            </DialogDescription>
                        </DialogHeader>
                        {editing.setting.writable.unit && editing.setting.writable.unitType && (
                            <RadioGroup
                                value={editing.target}
                                onValueChange={(v) => setEditing({ ...editing, target: v as Editing['target'] })}
                            >
                                <div className="flex items-center gap-2">
                                    <RadioGroupItem id="target-unit" value="unit" />
                                    <Label htmlFor="target-unit">{t('shell.settings.forUnit')}</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <RadioGroupItem id="target-type" value="unitType" />
                                    <Label htmlFor="target-type">
                                        {t('shell.settings.forType', {
                                            type: settings.data?.unitType ? text(settings.data.unitType.name) : ''
                                        })}
                                    </Label>
                                </div>
                            </RadioGroup>
                        )}
                        <ValueEditor
                            setting={editing.setting}
                            value={editing.value}
                            onChange={(value) => setEditing({ ...editing, value })}
                        />
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                                {t('shell.settings.cancel')}
                            </Button>
                            <Button
                                type="button"
                                onClick={() => void save()}
                                disabled={change.isPending || editing.value === undefined}
                            >
                                {t('shell.settings.save')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                )}
            </Dialog>
        </div>
    );
}
