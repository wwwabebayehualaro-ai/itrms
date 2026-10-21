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
    PublishedFormRenderer,
    TemplateStatusTag,
    getRuntimeConfig,
    isViewTemplate,
    useTemplateList,
    useTemplateMutations
} from '@itrms/form-engine/renderer';
import { fileRelationsOf, storedFieldsOf } from '@itrms/schemas';
import { useBuilderActions } from '@itrms/form-engine/designer';
import { useCan } from '@/lib/auth/authHooks';
import { getApiErrorMessage } from '@/lib/api/errors';
import { formatDate } from '@/lib/format';
import type { IFormTemplate } from '@/types/template_builder/form';
import TemplatePreviewDialog from './TemplatePreviewDialog';
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
    const notify = useNotify();
    const builder = useBuilderActions();
    const canPublish = useCan('template:publish');
    const { data: all = [], isPending, error, refetch } = useTemplateList();
    const { remove, publish } = useTemplateMutations();
    // people who start requests pick from forms; view templates (reports) are managed here, not filled in
    const templates = useMemo(() => (mode === 'start' ? all.filter((t) => !isViewTemplate(t)) : all), [all, mode]);

    const [q, setQ] = useState('');
    const [status, setStatus] = useState<Status>('all');
    const [sort, setSort] = useState<Sort>('newest');
    const [categories, setCategories] = useState<string[]>([]);
    const [layout, setLayout] = useState<'grid' | 'list'>('grid');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [settings, setSettings] = useState<IFormTemplate | null>(null);
    const [open, setOpen] = useState<{ template: IFormTemplate; as: 'preview' | 'start' } | null>(null);
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

    /** The builder (and previews) work on the form put in the builder store. */
    const putInBuilder = (t: IFormTemplate) => {
        builder.setFields(storedFieldsOf(t.form_config));
        builder.setRuntime(getRuntimeConfig(t.form_config) ?? EMPTY_RUNTIME);
        builder.setTemplate(t);
    };
    const newForm = () => {
        builder.setFields([]);
        builder.setRuntime(EMPTY_RUNTIME);
        builder.setTemplate({ name: '', slug: '', form_config: {} });
        router.push('/dynamic-template/builder');
    };
    const toggle = (id: string) =>
        setSelected((cur) => (cur.has(id) ? new Set([...cur].filter((x) => x !== id)) : new Set([...cur, id])));

    const deleteOne = (t: IFormTemplate) =>
        void confirmAction({
            header: `Delete “${t.name}”?`,
            message: 'The form and its versions are deleted. Requests already filled in stay.',
            acceptLabel: 'Delete',
            danger: true,
            onAccept: async () => {
                try {
                    await remove.mutateAsync(t.id as string);
                    notify.success(`“${t.name}” deleted`);
                } catch {
                    /* rolled back and reported by the mutation */
                }
            }
        });
    const deleteSelected = () =>
        void confirmAction({
            header: `Delete ${selected.size} form${selected.size === 1 ? '' : 's'}?`,
            message: 'The forms and their versions are deleted. Requests already filled in stay.',
            acceptLabel: 'Delete',
            danger: true,
            onAccept: async () => {
                const ids = [...selected];
                const results = await Promise.allSettled(ids.map((id) => remove.mutateAsync(id)));
                const done = results.filter((r) => r.status === 'fulfilled').length;
                if (done) notify.success(`Deleted ${done} form${done === 1 ? '' : 's'}`);
                setSelected(new Set(ids.filter((_, i) => results[i].status === 'rejected')));
            }
        });

    const actions = (t: IFormTemplate) =>
        mode === 'start' ? (
            <Button
                type="button"
                size="sm"
                onClick={() => {
                    putInBuilder(t);
                    setOpen({ template: t, as: 'start' });
                }}
            >
                <SquarePen />
                Start
            </Button>
        ) : (
            <div className="flex items-center gap-0.5">
                <IconButton
                    label={`Preview ${t.name}`}
                    tooltip="Preview"
                    onClick={() => {
                        putInBuilder(t);
                        setOpen({ template: t, as: 'preview' });
                    }}
                >
                    <Eye />
                </IconButton>
                <IconButton
                    label={`Edit ${t.name} in the builder`}
                    tooltip="Edit the form"
                    onClick={() => {
                        putInBuilder(t);
                        router.push('/dynamic-template/builder');
                    }}
                >
                    <PencilRuler />
                </IconButton>
                <IconButton label={`Settings of ${t.name}`} tooltip="Settings" onClick={() => setSettings(t)}>
                    <Settings2 />
                </IconButton>
                {canPublish && t.status === 'draft' && (
                    <IconButton
                        label={`Publish ${t.name}`}
                        tooltip="Publish"
                        disabled={publish.isPending && publish.variables?.id === t.id}
                        onClick={() =>
                            publish.mutate(
                                { id: t.id as string },
                                {
                                    onSuccess: (p) =>
                                        notify.success(
                                            p.status === 'published'
                                                ? 'The form is published'
                                                : 'Sent for approval: it is published once approved'
                                        )
                                }
                            )
                        }
                    >
                        <Send />
                    </IconButton>
                )}
                <IconButton
                    label={`Delete ${t.name}`}
                    tooltip="Delete"
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
                aria-label={hasFile ? `Open the file attached to ${t.name}` : undefined}
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
                        aria-label={`Select ${t.name}`}
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
                    {t.is_active ? 'Active' : 'Inactive'}
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
                    aria-label={`Select ${t.name}`}
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
                    {!t.is_active && ' · inactive'}
                </span>
            </div>
            {actions(t)}
        </div>
    );

    return (
        <div className="flex flex-col gap-4" data-templates={mode}>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">{mode === 'start' ? 'Start a request' : 'Forms'}</h1>
                    <p className="text-sm text-muted-foreground">
                        {mode === 'start'
                            ? 'Pick a form and fill it in.'
                            : 'Build, publish and manage the forms people fill in.'}
                    </p>
                </div>
                {mode === 'manage' &&
                    (selected.size > 0 ? (
                        <div className="flex items-center gap-2">
                            <span className="text-sm">{selected.size} selected</span>
                            <Button type="button" variant="destructive" size="sm" onClick={deleteSelected}>
                                <Trash2 />
                                Delete
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                                <X />
                                Clear selection
                            </Button>
                        </div>
                    ) : (
                        <Button type="button" onClick={newForm}>
                            <Plus />
                            New form
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
                        placeholder="Search forms"
                        aria-label="Search forms"
                        className="pl-8"
                    />
                </div>
                <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                    <SelectTrigger aria-label="Status" className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Any status</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
                    <SelectTrigger aria-label="Sort" className="w-40">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="newest">Newest first</SelectItem>
                        <SelectItem value="oldest">Oldest first</SelectItem>
                        <SelectItem value="name-asc">Name A–Z</SelectItem>
                        <SelectItem value="name-desc">Name Z–A</SelectItem>
                    </SelectContent>
                </Select>
                {allCategories.length > 0 && (
                    <Combobox<string>
                        multiple
                        options={allCategories.map((c) => ({ label: c, value: c }))}
                        value={categories}
                        onChange={(v) => setCategories(v)}
                        placeholder="Any category"
                        aria-label="Categories"
                        className="w-56"
                    />
                )}
                <ToggleGroup
                    type="single"
                    variant="outline"
                    value={layout}
                    onValueChange={(v) => v && setLayout(v as 'grid' | 'list')}
                    aria-label="Layout"
                    className="ml-auto"
                >
                    <ToggleGroupItem value="grid" aria-label="Cards">
                        <LayoutGrid />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="list" aria-label="List">
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
                    <InlineStatus error={getApiErrorMessage(error, 'Could not load the forms')} />
                    <Button type="button" variant="outline" onClick={() => void refetch()}>
                        <RotateCcw />
                        Try again
                    </Button>
                </div>
            ) : shown.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
                    <File className="size-10 text-muted-foreground" />
                    <h3 className="font-semibold">{filtered ? 'No form matches' : 'No forms yet'}</h3>
                    <p className="text-sm text-muted-foreground">
                        {filtered
                            ? 'Change the search or the filters.'
                            : mode === 'manage'
                              ? 'Build the first one.'
                              : 'Nothing to fill in yet.'}
                    </p>
                    {filtered ? (
                        <Button type="button" variant="outline" onClick={reset}>
                            <RotateCcw />
                            Show all forms
                        </Button>
                    ) : (
                        mode === 'manage' && (
                            <Button type="button" onClick={newForm}>
                                <Plus />
                                New form
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
                        <DialogTitle>Form settings</DialogTitle>
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
                            {open?.as === 'start' ? open.template.name : `Preview: ${open?.template.name ?? ''}`}
                        </DialogTitle>
                        <DialogDescription>
                            {open?.as === 'start'
                                ? 'Fill in the form and submit it.'
                                : 'The working version, as people will see it. Nothing is sent.'}
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
                            onFormSubmit={() => notify.info('Preview: nothing was sent')}
                        />
                    )}
                    {open?.as === 'start' && (
                        <PublishedFormRenderer
                            bare
                            template={open.template}
                            onFormSubmit={onFormSubmit}
                            onSuccess={() => setOpen(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <TemplatePreviewDialog template={attachment} onHide={() => setAttachment(null)} />
        </div>
    );
}
