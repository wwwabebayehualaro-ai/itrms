'use client';

/** Container field types on the design system: their children are laid out by the renderer and passed in. */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Separator,
    cn
} from '@itrms/ui';
import type { EngineField } from '../../core';
import { defineFieldType, type ContainerFieldProps } from '../kit';

// the palette's placeholder titles are never shown to people: the field's own label is used instead
const PLACEHOLDER_TITLES = new Set(['Panel Header', 'Card Title', 'Group Title', 'Section Title']);
const titleOf = (f: EngineField, ...keys: string[]) => {
    for (const k of keys) {
        const v = f.props[k];
        if (typeof v === 'string' && v && !PLACEHOLDER_TITLES.has(v)) return v;
    }
    return f.label;
};

/** A titled box whose body can be collapsed (`toggleable`, starting closed with `collapsed`). */
function Collapsable({
    field,
    title,
    children,
    framed,
    legend
}: {
    field: EngineField;
    title: string;
    children: React.ReactNode;
    framed: string;
    legend?: boolean;
}) {
    const toggleable = Boolean(field.props.toggleable);
    const [open, setOpen] = useState(!field.props.collapsed);
    const Heading = legend ? 'legend' : 'div';
    const head = (
        <Heading
            className={cn(
                'flex w-full items-center gap-2 text-sm font-semibold',
                legend ? 'px-1' : 'border-b px-4 py-3'
            )}
        >
            <span className="flex-1 text-left">{title}</span>
            {toggleable && (
                <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} aria-hidden="true" />
            )}
        </Heading>
    );
    const Box = legend ? 'fieldset' : 'section';
    return (
        <Collapsible open={!toggleable || open} onOpenChange={setOpen} asChild>
            <Box className={framed} aria-label={legend ? undefined : title} data-field-container={field.type}>
                {toggleable ? (
                    <CollapsibleTrigger
                        className="w-full cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
                    >
                        {head}
                    </CollapsibleTrigger>
                ) : (
                    head
                )}
                <CollapsibleContent>
                    <div className={legend ? 'p-3' : 'p-4'}>{children}</div>
                </CollapsibleContent>
            </Box>
        </Collapsible>
    );
}

function PanelField({ field, children }: ContainerFieldProps) {
    return (
        <Collapsable
            field={field}
            title={titleOf(field, 'header')}
            framed="rounded-lg border bg-card text-card-foreground"
        >
            {children}
        </Collapsable>
    );
}

function FieldsetField({ field, children }: ContainerFieldProps) {
    return (
        <Collapsable
            field={field}
            title={titleOf(field, 'legend', 'header')}
            framed="rounded-lg border px-3 pb-1"
            legend
        >
            {children}
        </Collapsable>
    );
}

function CardField({ field, children }: ContainerFieldProps) {
    const sub = typeof field.props.subTitle === 'string' ? field.props.subTitle : undefined;
    const footer = typeof field.props.footer === 'string' ? field.props.footer : undefined;
    return (
        <Card className="gap-4 py-4" data-field-container="Card">
            <CardHeader className="px-4">
                <CardTitle>{titleOf(field, 'title', 'header')}</CardTitle>
                {sub && <CardDescription>{sub}</CardDescription>}
            </CardHeader>
            <CardContent className="px-4">{children}</CardContent>
            {footer && <div className="px-4 text-sm text-muted-foreground">{footer}</div>}
        </Card>
    );
}

function SectionField({ field, children }: ContainerFieldProps) {
    const description = typeof field.props.description === 'string' ? field.props.description : undefined;
    return (
        <section
            className="rounded-lg border p-4"
            aria-label={titleOf(field, 'title')}
            data-field-container="FormSection"
        >
            <h3 className="mb-1 text-base font-semibold">
                {titleOf(field, 'title')}
                {Boolean(field.props.required) && <span className="ml-1 text-destructive">*</span>}
            </h3>
            {description && <p className="mb-3 text-sm text-muted-foreground">{description}</p>}
            {children}
        </section>
    );
}

function DividerField({ field }: ContainerFieldProps) {
    const text = typeof field.props.content === 'string' ? field.props.content : '';
    return text ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Separator className="flex-1" />
            {text}
            <Separator className="flex-1" />
        </div>
    ) : (
        <Separator className={field.props.type === 'dashed' ? 'border-t border-dashed bg-transparent' : undefined} />
    );
}

defineFieldType({ kind: 'container', type: 'Panel', Render: PanelField });
defineFieldType({ kind: 'container', type: 'Fieldset', Render: FieldsetField });
defineFieldType({ kind: 'container', type: 'Card', Render: CardField });
defineFieldType({
    kind: 'container',
    type: 'FormSection',
    Render: SectionField,
    supports: (f) => !f.props.collapsible
});
defineFieldType({
    kind: 'container',
    type: 'Divider',
    Render: DividerField,
    supports: (f) => f.props.layout !== 'vertical'
});
defineFieldType({ kind: 'section', type: 'FormArray' });
