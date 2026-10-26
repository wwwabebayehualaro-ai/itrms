'use client';

/**
 * The form builder (v2): palette, canvas, inspector. Opens what the gallery put in the builder store (the template, its fields
 * and runtime) and saves `form_config` as `{ schemaVersion: 2, fields, runtime }` — the flat field list the backend and both
 * renderers read. Undo/redo, keyboard shortcuts, a live preview on the real renderer, and conflict handling on save (another
 * person saved the form meanwhile: reload theirs or replace it).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    pointerWithin,
    rectIntersection,
    useSensor,
    useSensors,
    type CollisionDetection,
    type DragEndEvent,
    type DragMoveEvent,
    type DragStartEvent
} from '@dnd-kit/core';
import {
    ArrowLeft,
    Braces,
    Check,
    Database,
    Eye,
    FilePlus2,
    Languages,
    MoreHorizontal,
    PencilRuler,
    Redo2,
    Save,
    Undo2
} from 'lucide-react';
import {
    Badge,
    Button,
    Card,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    IconButton,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    Spinner,
    ToggleGroup,
    ToggleGroupItem,
    confirmAction,
    useNotify
} from '@itrms/ui';
import { requestErrorMessage } from '../host/client';
import { TemplateStatusTag } from '../renderer/TemplateStatusTag';
import { useTemplateList, useTemplateMutations } from '../api/templates';
import { useFields, useFormActions, useRuntimeConfig, useTemplate } from '../renderer/store/formStore';
import { REQUIRED_TEXT_LANGUAGES, EMPTY_RUNTIME, formTextIn, type TemplateRuntimeConfig } from '@itrms/schemas';
import { readDocument, untranslatedTexts } from '../core';
import { EngineForm } from '../renderer/EngineForm';
import { unsupportedFields } from '../renderer/kit';
import '../renderer/fields/registerAll';
import { DataSources } from './DataSources';
import { Canvas, DragStateProvider, LIST_PREFIX, PALETTE_PREFIX, dropTarget, type DragState } from './Canvas';
import { EMPTY_DOC, accepts, fromStored, slugify, subtree, toStored, type DesignDoc } from './document';
import { Inspector } from './Inspector';
import { TranslationsSheet, endonym } from './Translations';
import { Palette, type PaletteEntry } from './Palette';
import {
    DesignerProvider,
    createDesignerStore,
    useDesigner,
    useDesignerActions,
    useDesignerApi,
    type DesignerStore
} from './store';
import { LANGUAGE_TAG, type FormTemplate } from '@itrms/schemas';

import { useFormsHost, useFormsLanguages, useFormsLocation } from '../host/FormsHost';
import { useEngineText } from '../host/text';

const area = (r?: { width: number; height: number } | null) => (r ? r.width * r.height : Infinity);

export function FormDesigner() {
    const template = useTemplate();
    const fields = useFields();
    const runtime = useRuntimeConfig();
    const notify = useNotify();
    const { t } = useEngineText();
    const { language } = useFormsLanguages();
    const [{ store, problems }] = useState(() => {
        // the stored text language; an existing form without one was written in Amharic, a new form in the builder's language
        const stored = (template.form_config as { textLanguage?: unknown } | null | undefined)?.textLanguage;
        const textLanguage =
            typeof stored === 'string' && LANGUAGE_TAG.test(stored)
                ? stored
                : template.id || fields.length
                  ? 'am'
                  : language;
        const { doc, problems } = fromStored({ fields, textLanguage }, runtime ?? EMPTY_RUNTIME);
        return { store: createDesignerStore(doc, template, language), problems };
    });
    const told = useRef(false);
    useEffect(() => {
        if (told.current || !problems.length) return;
        told.current = true;
        notify.warn(
            t('form-engine.designer.notice.fixed', { count: problems.length, list: problems.slice(0, 3).join('; ') })
        );
    }, [problems, notify, t]);
    return (
        <DesignerProvider value={store}>
            <DesignerScreen />
        </DesignerProvider>
    );
}

function DesignerScreen() {
    const store = useDesignerApi();
    const actions = useDesignerActions();
    const notify = useNotify();
    const { t, word } = useEngineText();
    const { templatesHref } = useFormsHost();
    const { push } = useFormsLocation();
    const legacy = useFormActions();
    const template = useDesigner((s) => s.template);
    const dirty = useDesigner((s) => s.doc !== s.saved);
    const canUndo = useDesigner((s) => s.past.length > 0);
    const canRedo = useDesigner((s) => s.future.length > 0);
    const empty = useDesigner((s) => Object.keys(s.doc.byId).length === 0);
    const language = useDesigner((s) => s.language);
    const doc = useDesigner((s) => s.doc);
    const plainAs = doc.textLanguage;
    const { languages } = useFormsLanguages();
    const untranslated = useMemo(() => untranslatedTexts(toStored(doc).fields, plainAs).length, [doc, plainAs]);
    const [translationsOpen, setTranslationsOpen] = useState(false);
    const [mode, setMode] = useState<'design' | 'preview'>('design');
    const [naming, setNaming] = useState(false);
    const [jsonOpen, setJsonOpen] = useState(false);
    const [sourcesOpen, setSourcesOpen] = useState(false);
    const [drag, setDrag] = useState<DragState & { label?: string }>({ activeId: null, target: null });
    const { create, update } = useTemplateMutations();
    const saving = create.isPending || update.isPending;

    // ---- saving ------------------------------------------------------------------------------------------------------------
    const afterSave = (saved: FormTemplate, sent: DesignDoc) => {
        actions.markSaved(saved, sent);
        const stored = toStored(sent);
        legacy.setTemplate(saved);
        legacy.setFields(stored.fields);
        legacy.setRuntime(stored.runtime);
        notify.success(t('form-engine.designer.notice.saved', { name: saved.name }));
    };
    const save = async (force = false) => {
        const { doc, template: current } = store.getState();
        if (!current.id) return setNaming(true);
        try {
            const saved = await update.mutateAsync({
                id: current.id,
                data: {
                    form_config: toStored(doc),
                    ...(force ? {} : { row_version: (current as FormTemplate & { row_version?: number }).row_version })
                }
            });
            afterSave(saved, doc);
        } catch (e: any) {
            if (e?.response?.status === 409)
                void confirmAction({
                    header: t('form-engine.designer.conflict.header'),
                    message: t('form-engine.designer.conflict.message'),
                    acceptLabel: t('form-engine.designer.conflict.accept'),
                    rejectLabel: t('form-engine.designer.conflict.reject'),
                    danger: true,
                    onAccept: () => save(true),
                    onReject: () => window.location.reload()
                });
            // other failures were reported by the mutation (QueryProvider)
        }
    };
    const saveNew = async (names: Record<string, string>, category: string) => {
        const { doc } = store.getState();
        try {
            const saved = await create.mutateAsync({
                name: formTextIn(names, language) ?? '',
                names,
                slug: slugify(names),
                version: '1.0.0',
                is_active: true,
                ...(category && { category }),
                form_config: toStored(doc)
            });
            afterSave(saved, doc);
            setNaming(false);
        } catch (e) {
            if (requestErrorMessage(e, '', t).toLowerCase().includes('slug'))
                notify.error(t('form-engine.designer.notice.nameTaken'));
        }
    };
    const saveRef = useRef(save);
    useEffect(() => {
        saveRef.current = save;
    });

    useEffect(() => {
        if (!dirty) return;
        const warn = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const leave = () =>
        dirty
            ? void confirmAction({
                  header: t('form-engine.designer.leave.header'),
                  message: t('form-engine.designer.leave.message'),
                  acceptLabel: t('form-engine.designer.leave.accept'),
                  rejectLabel: t('form-engine.designer.leave.reject'),
                  danger: true,
                  onAccept: () => push(templatesHref)
              })
            : push(templatesHref);
    const startNew = () =>
        void confirmAction({
            header: t('form-engine.designer.startNew.header'),
            message: dirty
                ? t('form-engine.designer.startNew.messageDirty')
                : t('form-engine.designer.startNew.messageClean'),
            acceptLabel: t('form-engine.designer.startNew.accept'),
            rejectLabel: t('form-engine.designer.startNew.reject'),
            danger: dirty,
            onAccept: () => {
                const blank: FormTemplate = { name: '', slug: '', form_config: {} };
                legacy.setTemplate(blank);
                legacy.setFields([]);
                legacy.setRuntime(EMPTY_RUNTIME);
                actions.load({ ...EMPTY_DOC, textLanguage: language }, blank);
            }
        });

    // ---- keyboard ------------------------------------------------------------------------------------------------------------
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();
            if (mod && key === 's') {
                e.preventDefault();
                void saveRef.current();
                return;
            }
            const t = e.target as HTMLElement | null;
            if (
                t?.closest(
                    'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]'
                )
            )
                return;
            if (document.querySelector('[role="dialog"][data-state="open"]')) return;
            const { selected } = store.getState();
            if (mod && key === 'z') {
                e.preventDefault();
                if (e.shiftKey) actions.redo();
                else actions.undo();
            } else if (mod && key === 'y') {
                e.preventDefault();
                actions.redo();
            } else if (mode !== 'design') return;
            else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
                e.preventDefault();
                actions.remove(selected);
            } else if (mod && key === 'd' && selected) {
                e.preventDefault();
                actions.duplicate(selected);
            } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && selected) {
                e.preventDefault();
                actions.nudge(selected, e.key === 'ArrowUp' ? -1 : 1);
            } else if (e.key === 'Escape' && selected) actions.select(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [actions, store, mode]);

    // ---- drag and drop -------------------------------------------------------------------------------------------------------
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor)
    );
    // the innermost drop target under the pointer; never the dragged field or anything inside it
    const collision = useMemo<CollisionDetection>(
        () => (args) => {
            const id = String(args.active.id);
            const own = id.startsWith(PALETTE_PREFIX)
                ? new Set<string>()
                : new Set(subtree(store.getState().doc, id).flatMap((x) => [x, `${LIST_PREFIX}${x}`]));
            const usable = {
                ...args,
                droppableContainers: args.droppableContainers.filter((c) => !own.has(String(c.id)))
            };
            const hits = pointerWithin(usable);
            return [...(hits.length ? hits : rectIntersection(usable))].sort(
                (a, b) => area(args.droppableRects.get(a.id)) - area(args.droppableRects.get(b.id))
            );
        },
        [store]
    );
    const typeOf = (activeId: string) =>
        activeId.startsWith(PALETTE_PREFIX)
            ? activeId.slice(PALETTE_PREFIX.length)
            : store.getState().doc.byId[activeId]?.type;
    const targetFor = (e: DragMoveEvent | DragEndEvent) => {
        const { doc } = store.getState();
        const r = e.active.rect.current.translated;
        const t = dropTarget(doc, e.over, r ? r.top + r.height / 2 : null);
        const type = typeOf(String(e.active.id));
        return t && type && accepts(doc, t.parent, type) ? t : null;
    };
    const onDragStart = (e: DragStartEvent) => {
        const id = String(e.active.id);
        const entry = e.active.data.current?.entry as PaletteEntry | undefined;
        const f = store.getState().doc.byId[id];
        setDrag({
            activeId: id,
            target: null,
            label: entry ? word(entry.label) : (formTextIn(f?.label, store.getState().language) ?? f?.id)
        });
    };
    const onDragMove = (e: DragMoveEvent) => {
        const target = targetFor(e);
        setDrag((d) =>
            d.target?.parent === target?.parent && d.target?.index === target?.index ? d : { ...d, target }
        );
    };
    const onDragEnd = (e: DragEndEvent) => {
        const target = targetFor(e);
        setDrag({ activeId: null, target: null });
        if (!target) return;
        const id = String(e.active.id);
        if (id.startsWith(PALETTE_PREFIX)) {
            const entry = e.active.data.current?.entry as PaletteEntry | undefined;
            if (entry) actions.add(entry.type, entry.label, target);
        } else if (!actions.move(id, target.parent, target.index))
            notify.warn(t('form-engine.designer.notice.cannotMove'));
        else actions.select(id);
    };

    return (
        <div className="@container flex flex-col gap-3" data-designer>
            <header className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-xs">
                <IconButton label={t('form-engine.designer.toolbar.back')} onClick={leave}>
                    <ArrowLeft />
                </IconButton>
                <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
                    <h1 className="truncate text-lg font-semibold">
                        {template.name || t('form-engine.designer.toolbar.newForm')}
                    </h1>
                    {template.id && <TemplateStatusTag template={template} />}
                    {dirty && (
                        <Badge variant="outline" className="text-muted-foreground" data-unsaved>
                            {t('form-engine.designer.toolbar.unsaved')}
                        </Badge>
                    )}
                </div>
                <IconButton
                    label={t('form-engine.designer.toolbar.undo')}
                    tooltip={t('form-engine.designer.toolbar.undoTip')}
                    disabled={!canUndo}
                    onClick={actions.undo}
                >
                    <Undo2 />
                </IconButton>
                <IconButton
                    label={t('form-engine.designer.toolbar.redo')}
                    tooltip={t('form-engine.designer.toolbar.redoTip')}
                    disabled={!canRedo}
                    onClick={actions.redo}
                >
                    <Redo2 />
                </IconButton>
                <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={mode}
                    onValueChange={(v) => v && setMode(v as 'design' | 'preview')}
                    aria-label={t('form-engine.designer.toolbar.mode')}
                >
                    <ToggleGroupItem value="design" className="gap-1.5 px-3">
                        <PencilRuler />
                        {t('form-engine.designer.toolbar.design')}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="preview" className="gap-1.5 px-3">
                        <Eye />
                        {t('form-engine.designer.toolbar.preview')}
                    </ToggleGroupItem>
                </ToggleGroup>
                <div className="flex items-center gap-1.5">
                    <Label htmlFor="texts-in" className="text-xs text-muted-foreground">
                        {t('form-engine.designer.toolbar.textsIn')}
                    </Label>
                    <Select value={language} onValueChange={actions.setLanguage}>
                        <SelectTrigger id="texts-in" size="sm" aria-label={t('form-engine.designer.toolbar.textsIn')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {languages.map((tag) => (
                                <SelectItem key={tag} value={tag}>
                                    {endonym(tag)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setTranslationsOpen(true)}>
                    <Languages />
                    {t('form-engine.designer.toolbar.translations')}
                    {untranslated > 0 && (
                        <Badge className="bg-status-warning-bg text-status-warning-fg" data-untranslated-badge>
                            {untranslated}
                        </Badge>
                    )}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setSourcesOpen(true)}>
                    <Database />
                    {t('form-engine.designer.toolbar.dataSources')}
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('form-engine.designer.toolbar.more')}
                        >
                            <MoreHorizontal />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setJsonOpen(true)}>
                            <Braces />
                            {t('form-engine.designer.toolbar.viewJson')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={startNew}>
                            <FilePlus2 />
                            {t('form-engine.designer.toolbar.startNew')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <Button
                    type="button"
                    size="sm"
                    disabled={saving || empty || (!dirty && !!template.id)}
                    onClick={() => void save()}
                    title={t('form-engine.designer.toolbar.saveTip')}
                >
                    {saving ? <Spinner /> : <Save />}
                    {template.id ? t('form-engine.designer.toolbar.save') : t('form-engine.designer.toolbar.saveAs')}
                </Button>
            </header>

            {mode === 'preview' ? (
                <Preview />
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={collision}
                    onDragStart={onDragStart}
                    onDragMove={onDragMove}
                    onDragEnd={onDragEnd}
                    onDragCancel={() => setDrag({ activeId: null, target: null })}
                >
                    <DragStateProvider value={drag}>
                        {/* three panels as soon as the builder (not the window) is wide enough; stacked below that */}
                        <div className="grid gap-3 @4xl:grid-cols-[12.5rem_minmax(0,1fr)_19rem] @4xl:items-start @7xl:grid-cols-[14rem_minmax(0,1fr)_22rem]">
                            <aside className="order-2 rounded-xl border bg-card p-2 shadow-xs @4xl:order-none @4xl:sticky @4xl:top-18 @4xl:max-h-[calc(100vh-5.5rem)] @4xl:overflow-y-auto">
                                <Palette />
                            </aside>
                            <main className="order-1 min-w-0 @4xl:order-none">
                                <Canvas />
                            </main>
                            <aside
                                className="order-3 rounded-xl border bg-card p-4 shadow-xs @4xl:order-none @4xl:sticky @4xl:top-18 @4xl:max-h-[calc(100vh-5.5rem)] @4xl:overflow-y-auto"
                                aria-label={t('form-engine.designer.toolbar.fieldSettings')}
                            >
                                <Inspector />
                            </aside>
                        </div>
                    </DragStateProvider>
                    <DragOverlay dropAnimation={null}>
                        {drag.activeId ? (
                            <div className="rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-lg">
                                {drag.label || t('form-engine.designer.toolbar.dragField')}
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            )}

            <SaveAsDialog
                open={naming}
                onOpenChange={setNaming}
                saving={create.isPending}
                languages={languages}
                onSave={(names, category) => void saveNew(names, category)}
            />
            <JsonDialog open={jsonOpen} onOpenChange={setJsonOpen} store={store} />
            <DataSourcesSheet open={sourcesOpen} onOpenChange={setSourcesOpen} />
            <TranslationsSheet open={translationsOpen} onOpenChange={setTranslationsOpen} />
        </div>
    );
}

/** The form as people will fill it in, on the real renderer, with the canvas's current state. Nothing is sent. */
function Preview() {
    const { t } = useEngineText();
    const doc = useDesigner((s) => s.doc);
    const template = useDesigner((s) => s.template);
    const language = useDesigner((s) => s.language);
    const stored = useMemo(() => toStored(doc), [doc]);
    const unsupported = useMemo(() => unsupportedFields(readDocument(stored, { language }).fields), [stored, language]);
    const [result, setResult] = useState<Record<string, unknown> | null>(null);
    // no submit data source: a preview never calls the form's API
    const runtime = useMemo<TemplateRuntimeConfig>(() => ({ ...stored.runtime, submit: undefined }), [stored.runtime]);
    return (
        <div className="mx-auto grid w-full max-w-5xl gap-3">
            <p className="text-sm text-muted-foreground">{t('form-engine.designer.preview.intro')}</p>
            {unsupported.length > 0 && (
                <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                    {t('form-engine.designer.preview.unsupported', {
                        fields: unsupported.map((f) => f.label || f.id).join(', ')
                    })}
                </p>
            )}
            <EngineForm
                silent
                language={language}
                fields={stored.fields}
                runtime={runtime}
                template={{ ...template, id: template.id ?? 'preview', form_config: stored }}
                onFormSubmit={(s: { submission_data: Record<string, unknown> }) => setResult(s.submission_data)}
            />
            {result && (
                <Card className="p-4">
                    <h3 className="mb-2 text-sm font-semibold">{t('form-engine.designer.preview.stored')}</h3>
                    <pre className="overflow-x-auto text-xs" data-preview-result>
                        {JSON.stringify(result, null, 2)}
                    </pre>
                </Card>
            )}
        </div>
    );
}

function SaveAsDialog({
    open,
    onOpenChange,
    saving,
    languages,
    onSave
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    saving: boolean;
    languages: readonly string[];
    onSave: (names: Record<string, string>, category: string) => void;
}) {
    const { t } = useEngineText();
    const [names, setNames] = useState<Record<string, string>>({});
    const [category, setCategory] = useState('');
    const { data: all } = useTemplateList();
    const categories = useMemo(
        () => Array.from(new Set((all ?? []).map((t) => t.category).filter((c): c is string => !!c))).sort(),
        [all]
    );
    // Amharic and English are required; the installation's other languages are optional
    const required = (tag: string) => (REQUIRED_TEXT_LANGUAGES as readonly string[]).includes(tag);
    const complete = REQUIRED_TEXT_LANGUAGES.every((tag) => !!names[tag]?.trim());
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md" data-save-form>
                <DialogHeader>
                    <DialogTitle>{t('form-engine.designer.saveAs.title')}</DialogTitle>
                    <DialogDescription>{t('form-engine.designer.saveAs.description')}</DialogDescription>
                </DialogHeader>
                <form
                    className="flex flex-col gap-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!complete) return;
                        onSave(
                            Object.fromEntries(
                                Object.entries(names)
                                    .map(([tag, v]) => [tag, v.trim()] as const)
                                    .filter(([, v]) => v !== '')
                            ),
                            category.trim()
                        );
                    }}
                >
                    {languages.map((tag, i) => (
                        <div key={tag} className="flex flex-col gap-2">
                            <Label htmlFor={`form-name-${tag}`}>
                                {t(
                                    required(tag)
                                        ? 'form-engine.designer.saveAs.nameIn'
                                        : 'form-engine.designer.saveAs.nameInOptional',
                                    {
                                        language: endonym(tag)
                                    }
                                )}
                            </Label>
                            <Input
                                id={`form-name-${tag}`}
                                value={names[tag] ?? ''}
                                onChange={(e) => setNames((n) => ({ ...n, [tag]: e.target.value }))}
                                autoFocus={i === 0}
                                maxLength={200}
                            />
                        </div>
                    ))}
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="form-category">{t('form-engine.designer.saveAs.category')}</Label>
                        <Input
                            id="form-category"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            list="form-categories"
                            maxLength={60}
                        />
                        <datalist id="form-categories">
                            {categories.map((c) => (
                                <option key={c} value={c} />
                            ))}
                        </datalist>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            {t('form-engine.designer.saveAs.cancel')}
                        </Button>
                        <Button type="submit" disabled={!complete || saving}>
                            {saving ? <Spinner /> : <Check />}
                            {t('form-engine.designer.saveAs.submit')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function JsonDialog({
    open,
    onOpenChange,
    store
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    store: DesignerStore;
}) {
    const notify = useNotify();
    const { t } = useEngineText();
    const text = open ? JSON.stringify(toStored(store.getState().doc), null, 2) : '';
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{t('form-engine.designer.json.title')}</DialogTitle>
                    <DialogDescription>{t('form-engine.designer.json.description')}</DialogDescription>
                </DialogHeader>
                <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">{text}</pre>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                            void (async () => {
                                await navigator.clipboard?.writeText(text);
                                notify.success(t('form-engine.designer.notice.copied'));
                            })()
                        }
                    >
                        {t('form-engine.designer.json.copy')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** The form's data sources, variables and submit settings (part of the document: undoable). */
function DataSourcesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    const { t } = useEngineText();
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-4xl">
                <SheetHeader>
                    <SheetTitle>{t('form-engine.designer.toolbar.dataSources')}</SheetTitle>
                    <SheetDescription>{t('form-engine.designer.sheet.description')}</SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-4">{open && <DataSources />}</div>
            </SheetContent>
        </Sheet>
    );
}
