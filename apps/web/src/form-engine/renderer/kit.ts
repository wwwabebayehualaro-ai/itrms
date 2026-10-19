/**
 * Field kit: one definition per field type, built on the design system (`@platform/ui`). The renderer looks a stored field's
 * `type` up here; the type name is the stable key saved in templates, so the kit can replace how a type looks without touching
 * saved forms.
 *
 * A definition says how the type renders and whether it can render a particular field (`supports`): a form is rendered by this
 * renderer only when every field in it is supported, otherwise the original renderer keeps rendering that form.
 */
import type { ComponentType, ReactNode } from 'react';
import type { z } from 'zod';
import type { EngineField } from '../core';

/** Props of a value field (an input). The renderer owns label, help text, error message, visibility and layout. */
export interface ValueFieldProps<T = unknown> {
    field: EngineField;
    /** DOM id of the control (unique inside repeated rows). The label points at it. */
    id: string;
    value: T;
    onChange: (value: T) => void;
    onBlur: () => void;
    disabled: boolean;
    invalid: boolean;
    /** Id of the help / error text, for `aria-describedby`. */
    describedBy?: string;
}

/** Props of a container (panel, card, fieldset): its children are already rendered. */
export interface ContainerFieldProps {
    field: EngineField;
    children: ReactNode;
    disabled: boolean;
}

/** Props of a display field (a table of API data): no value of its own. */
export interface DisplayFieldProps {
    field: EngineField;
}

/** Groups of the builder's palette, in the order they are shown. */
export const PALETTE_GROUPS = ['Text & numbers', 'Choices', 'Date & time', 'Files & media', 'Layout', 'Data'] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/**
 * How the form builder offers a type: its palette entry and its settings. `settings` is a Zod object over the field's stored
 * `props` (the names templates already use); each entry's `.meta({ title, description, ... })` describes it for people, and the
 * builder's inspector is generated from it (see `designer/SettingsForm.tsx` for the supported metadata).
 */
export interface DesignMeta {
    label: string;
    icon: ComponentType<{ className?: string }>;
    group: PaletteGroup;
    /** One line for the palette tooltip. */
    hint?: string;
    keywords?: string[];
    settings?: z.ZodObject;
    /** Which rule editors the inspector offers (validation lives in `behavior.validation.rules` / props). */
    rules?: Array<'length' | 'pattern' | 'range' | 'dates' | 'files' | 'items'>;
    /** The field takes its choices from options (static or a data source). */
    options?: boolean;
    /** Settings a new field of this type starts with (stored in its `props`). */
    defaults?: Record<string, unknown>;
    /** A container kind that holds no fields (a divider). Default: containers and sections hold fields. */
    leaf?: boolean;
}

interface BaseDef {
    type: string;
    /** False when this field uses a setting the kit cannot honour yet (the form then keeps the original renderer). */
    supports?: (field: EngineField) => boolean;
    /** Offered in the form builder (v2) when present. */
    design?: DesignMeta;
}
export interface ValueFieldDef extends BaseDef {
    kind: 'value';
    Render: ComponentType<ValueFieldProps<any>>;
    /** `inline`: the control prints its own label beside it (checkbox, switch). Default `top`. */
    label?: 'top' | 'inline';
}
export interface ContainerFieldDef extends BaseDef {
    kind: 'container';
    Render: ComponentType<ContainerFieldProps>;
}
export interface DisplayFieldDef extends BaseDef {
    kind: 'display';
    Render: ComponentType<DisplayFieldProps>;
}
/** The repeatable section is rendered by the renderer itself (it owns the rows); listed so forms that use it are supported. */
export interface SectionFieldDef extends BaseDef {
    kind: 'section';
}
export type FieldTypeDef = ValueFieldDef | ContainerFieldDef | DisplayFieldDef | SectionFieldDef;

const kit = new Map<string, FieldTypeDef>();

/** Add or replace a field type (feature teams can register their own types the same way). */
export function defineFieldType(def: FieldTypeDef): void {
    kit.set(def.type, def);
}

export const getFieldType = (type: string): FieldTypeDef | undefined => kit.get(type);

/** Attach (or replace) the builder's description of a registered type. */
export function describeFieldType(type: string, design: DesignMeta): void {
    const def = kit.get(type);
    if (def) kit.set(type, { ...def, design });
}

/** Every registered type name (what a stored field's `type` may be). */
export const registeredTypes = (): string[] => [...kit.keys()];

/** Every registered type the builder can offer, in registration order. */
export const designableTypes = (): Array<FieldTypeDef & { design: DesignMeta }> =>
    [...kit.values()].filter((d): d is FieldTypeDef & { design: DesignMeta } => !!d.design);

/** Types (and settings) of `fields` this renderer cannot render; empty = the whole form is supported. */
export function unsupportedFields(fields: EngineField[]): EngineField[] {
    return fields.filter((f) => {
        const def = kit.get(f.type);
        return !def || (def.supports ? !def.supports(f) : false);
    });
}
