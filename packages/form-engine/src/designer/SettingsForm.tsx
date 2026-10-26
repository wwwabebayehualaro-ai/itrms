'use client';

/**
 * A field type's settings, generated from its Zod schema (`design.settings` in the field kit): one control per entry, chosen
 * by the entry's type (text, number, on/off, one of a list). Labels and help come from `.meta()`:
 * `title`, `description`, `placeholder`, `labels` (enum value -> label), `multiline`, `advanced`.
 */
import { useState, type ReactNode } from 'react';
import type { z } from 'zod';
import { ChevronDown } from 'lucide-react';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Field,
    FieldDescription,
    FieldLabel,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
    Textarea,
    cn
} from '@itrms/ui';
import { NumberInput } from './controls';
import type { SettingMeta } from '../renderer/kit';
import { useEngineText } from '../host/text';

type Meta = Partial<SettingMeta>;

export interface SettingSpec {
    key: string;
    kind: 'string' | 'number' | 'boolean' | 'enum';
    meta: Meta;
    options?: string[];
}

type AnySchema = z.ZodType & {
    def: { type: string };
    unwrap?: () => AnySchema;
    meta: () => Meta | undefined;
    options?: string[];
};

/** The settings of a Zod object, in declaration order. Entries of a type the inspector has no control for are left out. */
export function settingsOf(schema: z.ZodObject | undefined): SettingSpec[] {
    if (!schema) return [];
    return Object.entries(schema.shape).flatMap(([key, raw]) => {
        let s = raw as unknown as AnySchema;
        const meta: Meta = { ...((s.meta() ?? {}) as Meta) };
        while ((s.def.type === 'optional' || s.def.type === 'default' || s.def.type === 'nullable') && s.unwrap) {
            s = s.unwrap();
            Object.assign(meta, { ...((s.meta() ?? {}) as Meta), ...meta });
        }
        const kind = s.def.type;
        if (kind !== 'string' && kind !== 'number' && kind !== 'boolean' && kind !== 'enum') return [];
        return [{ key, kind, meta, options: kind === 'enum' ? (s.options ?? []).map(String) : undefined }];
    });
}

const humanize = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

interface Props {
    schema: z.ZodObject | undefined;
    /** The effective value of a setting (the field's own, else the palette default). */
    value: (key: string) => unknown;
    /** Whether the field itself sets it (otherwise the palette default shows). */
    own: (key: string) => boolean;
    onChange: (key: string, value: unknown) => void;
    /** The text a setting shows as its placeholder while it has none of its own (a translation's fallback). */
    fallback?: (key: string) => string | undefined;
    idPrefix: string;
}

export function SettingsForm({ schema, value, own, onChange, fallback, idPrefix }: Props) {
    const { t } = useEngineText();
    const specs = settingsOf(schema);
    const [more, setMore] = useState(false);
    if (!specs.length) return <p className="text-sm text-muted-foreground">{t('form-engine.settings.form.none')}</p>;
    const main = specs.filter((s) => !s.meta.advanced);
    const advanced = specs.filter((s) => s.meta.advanced);
    const render = (s: SettingSpec) => (
        <SettingControl
            key={s.key}
            spec={s}
            id={`${idPrefix}-${s.key}`}
            value={value(s.key)}
            own={own(s.key)}
            fallback={fallback?.(s.key)}
            onChange={(v) => onChange(s.key, v)}
        />
    );
    return (
        <div className="flex flex-col gap-4">
            {main.map(render)}
            {advanced.length > 0 && (
                <Collapsible open={more} onOpenChange={setMore}>
                    <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
                        <ChevronDown className={cn('size-4 transition-transform', !more && '-rotate-90')} />
                        {t('form-engine.settings.form.more')}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-3 flex flex-col gap-4">{advanced.map(render)}</CollapsibleContent>
                </Collapsible>
            )}
        </div>
    );
}

function Labelled({
    id,
    title,
    description,
    children,
    inline
}: {
    id: string;
    title: string;
    description?: string;
    children: ReactNode;
    inline?: boolean;
}) {
    return inline ? (
        <Field orientation="horizontal" className="items-start justify-between">
            <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={id}>{title}</FieldLabel>
                {description && <FieldDescription>{description}</FieldDescription>}
            </div>
            {children}
        </Field>
    ) : (
        <Field>
            <FieldLabel htmlFor={id}>{title}</FieldLabel>
            {children}
            {description && <FieldDescription>{description}</FieldDescription>}
        </Field>
    );
}

function SettingControl({
    spec,
    id,
    value,
    own,
    fallback,
    onChange
}: {
    spec: SettingSpec;
    id: string;
    value: unknown;
    own: boolean;
    fallback?: string;
    onChange: (v: unknown) => void;
}) {
    const { t, word } = useEngineText();
    const title = spec.meta.title ? word(spec.meta.title) : humanize(spec.key);
    const description = spec.meta.description ? word(spec.meta.description) : undefined;
    // a sample (`USD`) as it is; a button's default text in the language of the screen
    const sample = spec.meta.placeholderWord ? word(spec.meta.placeholderWord) : spec.meta.placeholder;
    switch (spec.kind) {
        case 'boolean':
            return (
                <Labelled id={id} title={title} description={description} inline>
                    <Switch id={id} checked={value === true} onCheckedChange={(c) => onChange(c)} />
                </Labelled>
            );
        case 'number':
            return (
                <Labelled id={id} title={title} description={description}>
                    <NumberInput
                        id={id}
                        value={typeof value === 'number' ? value : undefined}
                        onChange={(n) => onChange(n)}
                        placeholder={sample}
                    />
                </Labelled>
            );
        case 'enum':
            return (
                <Labelled id={id} title={title} description={description}>
                    <Select
                        value={typeof value === 'string' && spec.options?.includes(value) ? value : ''}
                        onValueChange={(v) => onChange(v)}
                    >
                        <SelectTrigger id={id} className="w-full">
                            <SelectValue placeholder={t('form-engine.settings.form.default')} />
                        </SelectTrigger>
                        <SelectContent>
                            {spec.options?.map((o) => (
                                <SelectItem key={o} value={o}>
                                    {spec.meta.labels?.[o] ? word(spec.meta.labels[o]) : o}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Labelled>
            );
        default: {
            const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
            const props = {
                id,
                value: text,
                placeholder: text === '' ? (fallback ?? sample) : sample,
                onChange: (e: { target: { value: string } }) => onChange(e.target.value),
                className: own ? undefined : 'text-muted-foreground'
            };
            return (
                <Labelled id={id} title={title} description={description}>
                    {spec.meta.multiline ? <Textarea rows={3} {...props} /> : <Input {...props} />}
                </Labelled>
            );
        }
    }
}
