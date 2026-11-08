'use client';

/**
 * The forms gallery: browse, search and filter the tenant's forms as cards or a list. `manage` (Manage Templates): preview, edit in
 * the builder, settings, publish, delete (one or several). `start` (Templates Pool): open a form and fill in a request.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Clock,
    Eye,
    File,
    FileImage,
    FileText,
    FileVideo,
    LayoutGrid,
    List,
    PencilRuler,
    Plus,
    RotateCcw,
    Search,
    Send,
    Settings2,
    SquarePen,
    Tag,
    Trash2,
    X
} from 'lucide-react';
import {
    Badge,
    Button,
    Checkbox,
    Combobox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    IconButton,
    InlineStatus,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    ToggleGroup,
    ToggleGroupItem,
    cn,
    confirmAction,
    useNotify
} from '@itrms/ui';
import {
    EMPTY_RUNTIME,
    FormRenderer,
    TemplateStatusTag,
    getRuntimeConfig,
    isViewTemplate,
    useTemplateList,
    useTemplateLoader,
    useTemplateMutations
} from '@itrms/form-engine/renderer';
import { fileRelationsOf, storedFieldsOf } from '@itrms/schemas';
import { PublishDialog, useBuilderActions } from '@itrms/form-engine/designer';
import { useCan } from '@/lib/auth/authHooks';
import { getApiErrorMessage } from '@/lib/api/errors';
import { formatDate } from '@/lib/format';
import { useText } from '@/lib/preferences';
import type { IFormTemplate } from '@/types/template_builder/form';
import { DraftedForm } from './DraftedForm';
import { DraftsList } from './DraftsList';
import TemplatePreviewDialog from './TemplatePreviewDialog';
import type { DraftStart } from '@/lib/drafts';
import { TemplateSettingsForm } from './TemplateSettingsForm';

export interface TemplatesManagerProps {
    /** `manage` (default): the editors' gallery; `start`: pick a form and fill in a request. */
    mode?: 'manage' | 'start';
    /** `start`: stores a filled-in request (the screen adds what it needs, e.g. device details). */
    onFormSubmit?: (submission: IFormSubmissionBase) => void | Promise<unknown>;
}

type Sort = 'newest' | 'oldest' | 'name-asc' | 'name-desc';
type Status = 'all' | 'active' | 'inactive';

const fileIcon = (t: IFormTemplate) => {
    const files = fileRelationsOf(t.file_relations);
    const type = (files[0] as { content_type?: string } | undefined)?.content_type;
    if (!files.length) return File;
    if (type?.startsWith('image/')) return FileImage;
    if (type?.startsWith('video/')) return FileVideo;
    return FileText;
};

export default function TemplatesManager({ mode = 'manage', onFormSubmit }: TemplatesManagerProps) {
    const router = useRouter();
    const { t: say } = useText();
    const notify = useNotify();
    const builder = useBuilderActions();
    const canPublish = useCan('form:publish');
    const { data: all = [], isPending, error, refetch } = useTemplateList();
    const { remove, publish } = useTemplateMutations();
    const loadTemplate = useTemplateLoader();
    // people who start requests pick from forms; view templates (reports) are managed here, not filled in
    const templates = useMemo(() => (mode === 'start' ? all.filter((t) => !isViewTemplate(t)) : all), [all, mode]);

    const [publishing, setPublishing] = useState<IFormTemplate | null>(null);
    const [q, setQ] = useState('');
    const [status, setStatus] = useState<Status>('all');
    const [sort, setSort] = useState<Sort>('newest');
    const [categories, setCategories] = useState<string[]>([]);
    const [layout, setLayout] = useState<'grid' | 'list'>('grid');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [settings, setSettings] = useState<IFormTemplate | null>(null);
    const [open, setOpen] = useState<{ template: IFormTemplate; as: 'preview' | 'start'; start?: DraftStart } | null>(
        null
    );
    const [attachment, setAttachment] = useState<IFormTemplate | null>(null);

    const allCategories = useMemo(
        () => [...new Set(templates.map((t) => t.category).filter((c): c is string => !!c))].sort(),
        [templates]
    );
    const shown = useMemo(() => {
        const s = q.trim().toLowerCase();
        const list = templates.filter(
            (t) =>
                (!s || [t.name, t.category ?? '', t.slug].some((x) => x.toLowerCase().includes(s))) &&
                (status === 'all' || (status === 'active' ? t.is_active : !t.is_active)) &&
                (!categories.length || (t.category && categories.includes(t.category)))
        );
        const time = (t: IFormTemplate) => new Date(t.created_at || 0).getTime();
        return list.sort((a, b) =>
            sort === 'name-asc'
                ? a.name.localeCompare(b.name)
                : sort === 'name-desc'
                  ? b.name.localeCompare(a.name)
                  : sort === 'oldest'
                    ? time(a) - time(b)
                    : time(b) - time(a)
        );
    }, [templates, q, status, sort, categories]);
    const filtered = !!q || status !== 'all' || categories.length > 0;
    const reset = () => {
        setQ('');
        setStatus('all');
        setCategories([]);
    };

    /**
     * The builder (and previews) work on the form put in the builder store: the form itself, loaded first (a list item
     * has no document, and a blank builder saved would replace the form's working copy).
     */
    const putInBuilder = async (t: IFormTemplate) => {
        const full = await loadTemplate(String(t.id));
        builder.setFields(storedFieldsOf(full.form_config));
        builder.setRuntime(getRuntimeConfig(full.form_config) ?? EMPTY_RUNTIME);
        builder.setTemplate(full);
        return full;
    };
    const opening = (as: 'preview' | 'start' | 'edit', t: IFormTemplate) => () =>
        void putInBuilder(t).then(
            (full) => (as === 'edit' ? router.push('/dynamic-template/builder') : setOpen({ template: full, as })),
            (e: unknown) => notify.error(getApiErrorMessage(e, say('shell.templates.openFailed')))
        );
    const newForm = () => {
        builder.setFields([]);
        builder.setRuntime(EMPTY_RUNTIME);
        builder.setTemplate({ name: '', slug: '', form_config: {} });
        router.push('/dynamic-template/builder');
    };
    const toggle = (id: string) =>
        setSelected((cur) => (cur.has(id) ? new Set([...cur].filter((x) => x !== id)) : new Set([...cur, id])));

    /** Asks for a publication: the dialog shows what it would do (problems, tests, changes, views) before it is sent. */
    const publishOne = (t: IFormTemplate) => setPublishing(t);

    const deleteOne = (t: IFormTemplate) =>
        void confirmAction({
            header: say('shell.templates.delete.title', { name: t.name }),
            message: say('shell.templates.delete.message'),
            acceptLabel: say('common.action.delete'),
            danger: true,
            onAccept: async () => {
                try {
                    await remove.mutateAsync(t.id as string);
                    notify.success(say('shell.templates.delete.done', { name: t.name }));
                } catch {
                    /* rolled back and reported by the mutation */
                }
            }
        });
    const deleteSelected = () =>
        void confirmAction({
            header:
                selected.size === 1
                    ? say('shell.templates.deleteMany.titleOne')
                    : say('shell.templates.deleteMany.titleMany', { count: String(selected.size) }),
            message: say('shell.templates.deleteMany.message'),
            acceptLabel: say('common.action.delete'),
            danger: true,
            onAccept: async () => {
                const ids = [...selected];
                const results = await Promise.allSettled(ids.map((id) => remove.mutateAsync(id)));
                const done = results.filter((r) => r.status === 'fulfilled').length;
                if (done)
                    notify.success(
                        done === 1
                            ? say('shell.templates.deleteMany.doneOne')
                            : say('shell.templates.deleteMany.doneMany', { count: String(done) })
                    );
                setSelected(new Set(ids.filter((_, i) => results[i].status === 'rejected')));
            }
        });

    const actions = (t: IFormTemplate) =>
        mode === 'start' ? (
            <Button type="button" size="sm" onClick={opening('start', t)}>
                <SquarePen />
                {say('common.action.start')}
            </Button>
        ) : (
            <div className="flex items-center gap-0.5">
                <IconButton
                    label={say('shell.templates.action.previewOf', { name: t.name })}
                    tooltip={say('shell.templates.action.preview')}
                    onClick={opening('preview', t)}
                >
                    <Eye />
                </IconButton>
                <IconButton
                    label={say('shell.templates.action.editOf', { name: t.name })}
                    tooltip={say('shell.templates.action.edit')}
                    onClick={opening('edit', t)}
                >
                    <PencilRuler />
                </IconButton>
                <IconButton
                    label={say('shell.templates.action.settingsOf', { name: t.name })}
                    tooltip={say('shell.templates.action.settings')}
                    onClick={() => setSettings(t)}
                >
                    <Settings2 />
                </IconButton>
                {canPublish && t.status === 'draft' && (
                    <IconButton
                        label={say('shell.templates.action.publishOf', { name: t.name })}
                        tooltip={say('shell.templates.action.publish')}
                        disabled={publish.isPending && publish.variables?.id === t.id}
                        onClick={() => publishOne(t)}
                    >
                        <Send />
                    </IconButton>
                )}
                <IconButton
                    label={say('shell.templates.action.deleteOf', { name: t.name })}
                    tooltip={say('common.action.delete')}
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteOne(t)}
                >
                    <Trash2 />
                </IconButton>
            </div>
        );

    const thumb = (t: IFormTemplate, size: 'lg' | 'sm') => {
        const Icon = fileIcon(t);
        const hasFile = !!fileRelationsOf(t.file_relations)[0];
        return (
            <button
                type="button"
                disabled={!hasFile}
                onClick={() => setAttachment(t)}
                aria-label={hasFile ? say('shell.templates.action.openFile', { name: t.name }) : undefined}
                className={cn(
                    'flex shrink-0 items-center justify-center bg-gradient-to-b from-primary/10 to-primary/5 text-muted-foreground enabled:hover:text-primary',
                    size === 'lg' ? 'h-32 w-full' : 'size-11 rounded-md'
                )}
            >
                <Icon className={size === 'lg' ? 'size-10' : 'size-5'} />
            </button>
        );
    };

    const card = (t: IFormTemplate) => {
        const isSelected = selected.has(t.id as string);
        return (
            <article
                key={t.id as string}
                className={cn(
                    'relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md',
                    isSelected && 'ring-2 ring-primary'
                )}
                data-template-card={t.slug}
            >
                {thumb(t, 'lg')}
                {mode === 'manage' && (
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggle(t.id as string)}
                        aria-label={say('shell.templates.selectOf', { name: t.name })}
                        className="absolute top-2 left-2 bg-background"
                    />
                )}
                <Badge
                    variant="outline"
                    className={cn(
                        'absolute top-2 right-2 bg-background',
                        t.is_active ? 'border-success/40' : 'text-muted-foreground'
                    )}
                >
                    {t.is_active ? say('shell.templates.status.active') : say('shell.templates.status.inactive')}
                </Badge>
                <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                        <h3 className="line-clamp-2 font-semibold">{t.name}</h3>
                        <Badge variant="secondary">v{t.version}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        <TemplateStatusTag template={t} />
                        {t.category && <Badge variant="outline">{t.category}</Badge>}
                    </div>
                    <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                        <Tag className="size-3" />
                        {t.slug}
                    </span>
                    <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="size-3" />
                            {formatDate(t.updated_at || t.created_at)}
                        </span>
                        {actions(t)}
                    </div>
                </div>
            </article>
        );
    };

    const row = (t: IFormTemplate) => (
        <div
            key={t.id as string}
            className={cn(
                'flex flex-wrap items-center gap-3 px-4 py-3',
                selected.has(t.id as string) && 'bg-primary/5'
            )}
            data-template-card={t.slug}
        >
            {mode === 'manage' && (
                <Checkbox
                    checked={selected.has(t.id as string)}
                    onCheckedChange={() => toggle(t.id as string)}
                    aria-label={say('shell.templates.selectOf', { name: t.name })}
                />
            )}
            {thumb(t, 'sm')}
            <div className="min-w-48 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    <Badge variant="secondary">v{t.version}</Badge>
                    <TemplateStatusTag template={t} />
                </div>
                <span className="text-xs text-muted-foreground">
                    {[t.category, t.slug, formatDate(t.updated_at || t.created_at)].filter(Boolean).join(' · ')}
                    {!t.is_active && ` · ${say('shell.templates.status.inactive')}`}
                </span>
            </div>
            {actions(t)}
        </div>
    );

    return (
        <div className="flex flex-col gap-4" data-templates={mode}>
            {mode === 'start' && (
                <DraftsList
                    formName={(id) => all.find((t) => t.id === id)?.name}
                    onResume={(formId, start) => {
                        const template = all.find((t) => t.id === formId);
                        if (template) setOpen({ template, as: 'start', start });
                    }}
                />
            )}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">
                        {mode === 'start' ? say('shell.templates.start.title') : say('shell.templates.manage.title')}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {mode === 'start' ? say('shell.templates.start.intro') : say('shell.templates.manage.intro')}
                    </p>
                </div>
                {mode === 'manage' &&
                    (selected.size > 0 ? (
                        <div className="flex items-center gap-2">
                            <span className="text-sm">
                                {say('shell.templates.selected', { count: String(selected.size) })}
                            </span>
                            <Button type="button" variant="destructive" size="sm" onClick={deleteSelected}>
                                <Trash2 />
                                {say('common.action.delete')}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                                <X />
                                {say('shell.templates.clearSelection')}
                            </Button>
                        </div>
                    ) : (
                        <Button type="button" onClick={newForm}>
                            <Plus />
                            {say('shell.templates.new')}
                        </Button>
                    ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-48 max-w-sm flex-1">
                    <Search
                        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                    />
                    <Input
                        type="search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder={say('shell.templates.search')}
                        aria-label={say('shell.templates.search')}
                        className="pl-8"
                    />
                </div>
                <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                    <SelectTrigger aria-label={say('shell.templates.status.label')} className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{say('shell.templates.status.any')}</SelectItem>
                        <SelectItem value="active">{say('shell.templates.status.active')}</SelectItem>
                        <SelectItem value="inactive">{say('shell.templates.status.inactive')}</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
                    <SelectTrigger aria-label={say('shell.templates.sort.label')} className="w-40">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="newest">{say('shell.templates.sort.newest')}</SelectItem>
                        <SelectItem value="oldest">{say('shell.templates.sort.oldest')}</SelectItem>
                        <SelectItem value="name-asc">{say('shell.templates.sort.nameAsc')}</SelectItem>
                        <SelectItem value="name-desc">{say('shell.templates.sort.nameDesc')}</SelectItem>
                    </SelectContent>
                </Select>
                {allCategories.length > 0 && (
                    <Combobox<string>
                        multiple
                        options={allCategories.map((c) => ({ label: c, value: c }))}
                        value={categories}
                        onChange={(v) => setCategories(v)}
                        placeholder={say('shell.templates.category.any')}
                        aria-label={say('shell.templates.category.label')}
                        className="w-56"
                    />
                )}
                <ToggleGroup
                    type="single"
                    variant="outline"
                    value={layout}
                    onValueChange={(v) => v && setLayout(v as 'grid' | 'list')}
                    aria-label={say('shell.templates.layout.label')}
                    className="ml-auto"
                >
                    <ToggleGroupItem value="grid" aria-label={say('shell.templates.layout.cards')}>
                        <LayoutGrid />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="list" aria-label={say('shell.templates.layout.list')}>
                        <List />
                    </ToggleGroupItem>
                </ToggleGroup>
            </div>

            {isPending ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {Array.from({ length: 6 }, (_, i) => (
                        <Skeleton key={i} className="h-72 rounded-xl" />
                    ))}
                </div>
            ) : error && templates.length === 0 ? (
                <div className="flex flex-col items-center gap-3 p-8" role="alert">
                    <InlineStatus error={getApiErrorMessage(error, say('shell.templates.loadFailed'))} />
                    <Button type="button" variant="outline" onClick={() => void refetch()}>
                        <RotateCcw />
                        {say('common.action.tryAgain')}
                    </Button>
                </div>
            ) : shown.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
                    <File className="size-10 text-muted-foreground" />
                    <h3 className="font-semibold">
                        {filtered ? say('shell.templates.empty.noMatch') : say('shell.templates.empty.none')}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        {filtered
                            ? say('shell.templates.empty.changeFilters')
                            : mode === 'manage'
                              ? say('shell.templates.empty.buildFirst')
                              : say('shell.templates.empty.nothingToFill')}
                    </p>
                    {filtered ? (
                        <Button type="button" variant="outline" onClick={reset}>
                            <RotateCcw />
                            {say('shell.templates.empty.showAll')}
                        </Button>
                    ) : (
                        mode === 'manage' && (
                            <Button type="button" onClick={newForm}>
                                <Plus />
                                {say('shell.templates.new')}
                            </Button>
                        )
                    )}
                </div>
            ) : layout === 'grid' ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{shown.map(card)}</div>
            ) : (
                <div className="divide-y rounded-xl border bg-card">{shown.map(row)}</div>
            )}

            <Dialog open={!!settings} onOpenChange={(o) => !o && setSettings(null)}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{say('shell.templates.dialog.settings')}</DialogTitle>
                        <DialogDescription>{settings?.name}</DialogDescription>
                    </DialogHeader>
                    {settings && (
                        <TemplateSettingsForm
                            key={settings.id as string}
                            template={settings}
                            onSaved={() => setSettings(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>
                            {open?.as === 'start'
                                ? open.template.name
                                : say('shell.templates.dialog.previewTitle', { name: open?.template.name ?? '' })}
                        </DialogTitle>
                        <DialogDescription>
                            {open?.as === 'start'
                                ? say('shell.templates.dialog.startIntro')
                                : say('shell.templates.dialog.previewIntro')}
                        </DialogDescription>
                    </DialogHeader>
                    {open?.as === 'preview' && (
                        <FormRenderer
                            bare
                            silent
                            fields={storedFieldsOf(open.template.form_config)}
                            template={open.template}
                            // a preview never calls the form's submit API
                            runtime={{
                                ...(getRuntimeConfig(open.template.form_config) ?? EMPTY_RUNTIME),
                                submit: undefined
                            }}
                            onFormSubmit={() => notify.info(say('shell.templates.dialog.previewSent'))}
                        />
                    )}
                    {open?.as === 'start' && (
                        // kept as a draft while it is filled in (task 0.20c)
                        <DraftedForm
                            template={open.template}
                            start={open.start}
                            onFormSubmit={onFormSubmit}
                            onSuccess={() => setOpen(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {publishing?.id && (
                <PublishDialog
                    templateId={publishing.id}
                    name={publishing.name}
                    open
                    onOpenChange={(o) => !o && setPublishing(null)}
                />
            )}
            <TemplatePreviewDialog template={attachment} onHide={() => setAttachment(null)} />
        </div>
    );
}
