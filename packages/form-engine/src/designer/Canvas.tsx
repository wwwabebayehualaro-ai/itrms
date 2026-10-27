'use client';

/**
 * The builder's canvas: the form drawn with the field kit itself (what people will fill in), in design mode. Controls are inert
 * (a click selects the field instead of typing into it); containers and repeating rows hold their own lists of fields. Each
 * field subscribes to its own entry of the document, so an edit re-renders that field only.
 *
 * Drag and drop: every field is draggable and a drop target; every list ends in a drop zone (the whole area when it is empty).
 * Where a drop lands is worked out by `dropTarget` (shared with the palette).
 */
import { createContext, memo, useContext, useMemo, type ReactNode } from 'react';
import { useDraggable, useDroppable, type Over } from '@dnd-kit/core';
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2, Undo2 } from 'lucide-react';
import { Badge, Button, FieldDescription, Field as FieldShell, FieldLabel, IconButton, cn } from '@itrms/ui';
import { initialValueOf, toEngineField, type EngineField, type StoredField } from '../core';
import { text as plainText } from '../core/runtime/path';
import { useEngineText } from '../host/text';
import { getFieldType, type ValueFieldDef } from '../renderer/kit';
import { widthOf } from '../renderer/FieldTree';
import { ROOT, parentOf, type DesignDoc } from './document';
import { useDesigner, useDesignerActions } from './store';

export const LIST_PREFIX = 'list:';
export const PALETTE_PREFIX = 'palette:';

/** Where a dragged field would land, given what it is over and where the dragged box's middle is. */
export function dropTarget(
    doc: DesignDoc,
    over: Over | null,
    centerY: number | null
): { parent: string; index: number } | null {
    if (!over) return null;
    const id = String(over.id);
    if (id.startsWith(LIST_PREFIX)) {
        const parent = id.slice(LIST_PREFIX.length);
        return { parent, index: (doc.children[parent] ?? []).length };
    }
    if (!doc.byId[id]) return null;
    const parent = parentOf(doc, id);
    const at = (doc.children[parent] ?? []).indexOf(id);
    const after = centerY !== null && centerY > over.rect.top + over.rect.height / 2;
    return { parent, index: at + (after ? 1 : 0) };
}

/** The drag in progress, for the drop line. */
export interface DragState {
    activeId: string | null;
    target: { parent: string; index: number } | null;
}
const DragCtx = createContext<DragState>({ activeId: null, target: null });
export const DragStateProvider = DragCtx.Provider;

const designValue = (f: EngineField) => {
    const v = initialValueOf(f, []);
    return v === undefined && (f.type === 'Checkbox' || f.type === 'InputSwitch') ? false : v;
};
const noop = () => undefined;

function DropLine() {
    return <div className="pointer-events-none h-0.5 w-full rounded-full bg-primary" aria-hidden />;
}

/** The fields of one container (or of the form), with the drop line and the drop zone at the end. */
export function DesignList({
    parent,
    inRow = false,
    emptyText
}: {
    parent: string;
    inRow?: boolean;
    emptyText?: string;
}) {
    const { t } = useEngineText();
    const ids = useDesigner((s) => s.doc.children[parent]);
    const { activeId, target } = useContext(DragCtx);
    const { setNodeRef, isOver } = useDroppable({ id: `${LIST_PREFIX}${parent}` });
    const list = ids ?? [];
    const lineAt = activeId && target?.parent === parent ? target.index : -1;
    const empty = list.length === 0;
    return (
        <div className="fe-flow" data-design-list={parent || 'form'}>
            {list.map((id, i) => (
                <ListItem key={id} id={id} inRow={inRow} line={lineAt === i} />
            ))}
            {lineAt === list.length && !empty && <DropLine />}
            <div
                ref={setNodeRef}
                className={cn(
                    'w-full rounded-md transition-colors',
                    empty
                        ? 'flex min-h-16 items-center justify-center border border-dashed p-4 text-sm text-muted-foreground'
                        : 'h-3',
                    empty && (isOver || lineAt === 0) && 'border-primary bg-primary/5 text-foreground'
                )}
                data-drop-zone={parent || 'form'}
            >
                {empty && (emptyText ?? t('form-engine.designer.canvas.dropHere'))}
            </div>
        </div>
    );
}

function ListItem({ id, inRow, line }: { id: string; inRow: boolean; line: boolean }) {
    return (
        <>
            {line && <DropLine />}
            <DesignNode id={id} inRow={inRow} />
        </>
    );
}

const DesignNode = memo(function DesignNode({ id, inRow }: { id: string; inRow: boolean }) {
    const stored = useDesigner((s) => s.doc.byId[id]);
    const selected = useDesigner((s) => s.selected === id);
    const actions = useDesignerActions();
    const { activeId } = useContext(DragCtx);
    const language = useDesigner((s) => s.language);
    const { word } = useEngineText();
    const field = useMemo(
        () => (stored ? toEngineField(stored as unknown as StoredField, language) : null),
        [stored, language]
    );
    const drag = useDraggable({ id });
    const drop = useDroppable({ id });
    if (!field) return null;
    const def = getFieldType(field.type);
    const width = widthOf(field, inRow);
    const dragging = activeId === id;

    let body: ReactNode;
    if (!def) body = <Unknown field={field} />;
    else if (def.kind === 'value')
        body = <DesignValue field={field} inline={def.label === 'inline'} Render={def.Render} />;
    else if (def.kind === 'section') body = <DesignRows field={field} />;
    else if (def.kind === 'display')
        body = (
            <div inert className="pointer-events-none">
                <def.Render field={field} />
            </div>
        );
    else
        body = (
            <def.Render field={{ ...field, props: { ...field.props, collapsed: false } }} disabled={false}>
                {field.isContainer ? <DesignList parent={field.id} /> : null}
            </def.Render>
        );

    return (
        <div
            ref={(el) => {
                drag.setNodeRef(el);
                drop.setNodeRef(el);
            }}
            {...drag.attributes}
            {...drag.listeners}
            tabIndex={0}
            aria-current={selected || undefined}
            aria-label={`${field.label || field.id} (${def?.design ? word(def.design.label) : field.type})`}
            onClick={(e) => {
                e.stopPropagation();
                actions.select(id);
            }}
            onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    actions.select(id);
                } else drag.listeners?.onKeyDown?.(e); // Space picks the field up (keyboard drag)
            }}
            className={cn(
                'field-renderer group/design relative cursor-pointer rounded-lg p-2 outline-none transition-shadow',
                width.className,
                selected
                    ? 'bg-primary/5 ring-2 ring-primary'
                    : 'hover:ring-1 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring',
                dragging && 'opacity-40',
                field.removed && 'opacity-60 grayscale'
            )}
            style={width.style}
            data-span={width.span}
            data-design-field={id}
            data-selected={selected || undefined}
            data-field-type={field.type}
            data-removed={field.removed || undefined}
        >
            {field.removed && <RemovedBar id={id} />}
            {selected && <Toolbar id={id} label={def?.design ? word(def.design.label) : field.type} />}
            {body}
        </div>
    );
});

/** A published key taken out of the form: it stays (old answers stay readable) but people no longer see it. */
function RemovedBar({ id }: { id: string }) {
    const actions = useDesignerActions();
    const { t } = useEngineText();
    return (
        <div
            className="mb-1 flex items-center gap-2"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            <Badge variant="outline" data-removed-badge>
                {t('form-engine.designer.removed.badge')}
            </Badge>
            <Button type="button" variant="ghost" size="xs" onClick={() => actions.restore(id)}>
                <Undo2 />
                {t('form-engine.designer.removed.restore')}
            </Button>
        </div>
    );
}

/** Actions of the selected field, on its top edge. */
function Toolbar({ id, label }: { id: string; label: string }) {
    const actions = useDesignerActions();
    const { t } = useEngineText();
    const stop = {
        onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
        onClick: (e: React.MouseEvent) => e.stopPropagation()
    };
    return (
        <div
            className="absolute -top-3.5 right-2 z-10 flex items-center gap-0.5 rounded-md border bg-background px-1 shadow-sm"
            {...stop}
        >
            <GripVertical className="size-3.5 text-muted-foreground" aria-hidden />
            <Badge variant="secondary" className="mr-1 h-5 px-1.5">
                {label}
            </Badge>
            <IconButton
                label={t('form-engine.designer.canvas.moveUp')}
                tooltip={t('form-engine.designer.canvas.moveUpTip')}
                size="icon-xs"
                onClick={() => actions.nudge(id, -1)}
            >
                <ArrowUp />
            </IconButton>
            <IconButton
                label={t('form-engine.designer.canvas.moveDown')}
                tooltip={t('form-engine.designer.canvas.moveDownTip')}
                size="icon-xs"
                onClick={() => actions.nudge(id, 1)}
            >
                <ArrowDown />
            </IconButton>
            <IconButton
                label={t('form-engine.designer.canvas.duplicate')}
                tooltip={t('form-engine.designer.canvas.duplicateTip')}
                size="icon-xs"
                onClick={() => actions.duplicate(id)}
            >
                <Copy />
            </IconButton>
            <IconButton
                label={t('form-engine.designer.canvas.delete')}
                tooltip={t('form-engine.designer.canvas.deleteTip')}
                size="icon-xs"
                className="text-destructive hover:text-destructive"
                onClick={() => actions.remove(id)}
            >
                <Trash2 />
            </IconButton>
        </div>
    );
}

/** A value field as the person will see it: label, control (inert), help text. */
function DesignValue({
    field: real,
    inline,
    Render
}: {
    field: EngineField;
    inline: boolean;
    Render: ValueFieldDef['Render'];
}) {
    const { t } = useEngineText();
    const domId = `design-${real.id}`;
    const sources = useDesigner((s) => s.doc.runtime.dataSources);
    // the builder never calls data sources: a field fed by one says which, instead of "Loading…"
    const field = useMemo(() => {
        if (!real.optionsBinding) return real;
        const ds = sources.find((d) => d.id === real.optionsBinding?.dataSourceId);
        return {
            ...real,
            optionsBinding: undefined,
            options: [],
            props: {
                ...real.props,
                placeholder: t('form-engine.designer.canvas.optionsFrom', {
                    source: ds?.name || ds?.id || t('form-engine.designer.canvas.aDataSource')
                })
            }
        };
    }, [real, sources, t]);
    return (
        <FieldShell>
            {!inline && (
                <FieldLabel htmlFor={domId} className="pointer-events-none">
                    {field.label || (
                        <span className="text-muted-foreground italic">{t('form-engine.designer.canvas.noLabel')}</span>
                    )}
                    {field.rules.required && <span className="text-destructive">*</span>}
                </FieldLabel>
            )}
            <div inert className="pointer-events-none">
                <Render
                    field={field}
                    id={domId}
                    value={designValue(field)}
                    onChange={noop}
                    onBlur={noop}
                    disabled={false}
                    invalid={false}
                />
            </div>
            {field.helpText && <FieldDescription>{field.helpText}</FieldDescription>}
            {(field.computed || field.visibleWhen.length > 0) && (
                <div className="flex gap-1">
                    {field.visibleWhen.length > 0 && (
                        <Badge variant="outline">{t('form-engine.designer.canvas.shownWhen')}</Badge>
                    )}
                    {field.computed && <Badge variant="outline">{t('form-engine.designer.canvas.calculated')}</Badge>}
                </div>
            )}
        </FieldShell>
    );
}

/** Repeating rows in design mode: the fields of one row, and the (inactive) add button. */
function DesignRows({ field }: { field: EngineField }) {
    const { t } = useEngineText();
    const noun = plainText(field.props.itemLabel || t('form-engine.renderer.rows.item'));
    return (
        <div className="flex flex-col gap-3" data-formarray={field.id}>
            <div className="flex items-center gap-2 text-sm font-medium">
                {field.label || t('form-engine.designer.canvas.repeatingRows')}
                <Badge variant="outline">
                    {t('form-engine.designer.canvas.onePerRow', { noun: noun.toLowerCase() })}
                </Badge>
            </div>
            <div className="rounded-lg border border-dashed bg-muted/30 p-3">
                <DesignList
                    parent={field.id}
                    inRow
                    emptyText={t('form-engine.designer.canvas.dropRow', { noun: noun.toLowerCase() })}
                />
            </div>
            <div inert>
                <Button type="button" variant="outline" size="sm">
                    <Plus />
                    {plainText(field.props.addButtonLabel || t('form-engine.renderer.rows.add'))}
                </Button>
            </div>
        </div>
    );
}

function Unknown({ field }: { field: EngineField }) {
    const { t } = useEngineText();
    return (
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            <strong className="text-foreground">{field.label || field.id}</strong>{' '}
            {t('form-engine.designer.canvas.unknown', { type: field.type })}
        </div>
    );
}

/** The whole form on the canvas. */
export function Canvas() {
    const actions = useDesignerActions();
    const count = useDesigner((s) => (s.doc.children[ROOT] ?? []).length);
    const { t } = useEngineText();
    return (
        <div
            className="min-h-[60vh] rounded-xl border bg-card p-6 shadow-xs"
            onClick={() => actions.select(null)}
            data-canvas
        >
            <DesignList parent={ROOT} emptyText={count === 0 ? t('form-engine.designer.canvas.empty') : undefined} />
        </div>
    );
}
