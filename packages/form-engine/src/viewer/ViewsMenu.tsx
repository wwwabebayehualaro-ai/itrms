'use client';

import { useState } from 'react';
import { Bookmark, Check, Plus, Save, Star, Trash2 } from 'lucide-react';
import {
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    IconButton,
    Input,
    Label,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Separator,
    Spinner,
    cn,
    confirmAction,
    useNotify
} from '@itrms/ui';
import { useCan } from '../host/FormsHost';
import { useEngineText } from '../host/text';
import type { SavedView } from './viewsApi';
import { configOf, stateOf, useSavedViewMutations, useSavedViews } from './viewsApi';
import type { ViewState } from './types';

interface Props {
    templateId: string;
    state: ViewState;
    defaultMode: string;
    patch: (change: Partial<ViewState>) => void;
}

/** Saved views of a form: pick one, save the current view (private, or shared with everyone), update, delete, set the default. */
export function ViewsMenu({ templateId, state, defaultMode, patch }: Props) {
    const { t } = useEngineText();
    const [open, setOpen] = useState(false);
    const notify = useNotify();
    // the forms API's rights: whoever reads the data keeps views of it; sharing one with the office is a right of its own
    const canShare = useCan('submission-view:share');
    const canCreate = useCan('submission:read');
    const { data: views = [] } = useSavedViews(templateId);
    const { create, update, remove } = useSavedViewMutations();
    const [saving, setSaving] = useState(false);
    const [name, setName] = useState('');
    const [shared, setShared] = useState(false);
    const [isDefault, setIsDefault] = useState(false);

    const active = views.find((v) => v.id === state.viewId);
    const choose = (v: SavedView | null) => {
        setOpen(false);
        patch(
            v
                ? { ...stateOf(v.config), viewId: v.id }
                : {
                      mode: defaultMode,
                      search: '',
                      filter: { op: 'and', items: [] },
                      sort: [],
                      columns: [],
                      options: {},
                      viewId: undefined
                  }
        );
    };
    const save = async () => {
        const saved = await create.mutateAsync({
            template_id: templateId,
            name: name.trim(),
            visibility: shared || isDefault ? 'shared' : 'private',
            is_default: isDefault,
            config: configOf(state)
        });
        setSaving(false);
        patch({ viewId: saved.id, page: state.page });
        notify.success(t('form-engine.viewer.views.saved', { name: saved.name }));
    };
    const section = (title: string, list: SavedView[]) =>
        list.length > 0 && (
            <div className="flex flex-col gap-0.5">
                <span className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</span>
                {list.map((v) => (
                    <div key={v.id} className="flex items-center gap-1" data-saved-view={v.name}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={cn('flex-1 justify-start', v.id === state.viewId && 'font-semibold')}
                            onClick={() => choose(v)}
                        >
                            {v.name}
                            {v.is_default && (
                                <Star
                                    className="size-3 fill-current"
                                    aria-label={t('form-engine.viewer.views.defaultOfForm')}
                                />
                            )}
                        </Button>
                        {v.can_edit && (
                            <>
                                {canShare && v.visibility === 'shared' && !v.is_default && (
                                    <IconButton
                                        label={t('form-engine.viewer.views.makeDefaultNamed', { name: v.name })}
                                        tooltip={t('form-engine.viewer.views.makeDefault')}
                                        side="left"
                                        onClick={() => update.mutate({ id: v.id, is_default: true })}
                                    >
                                        <Star />
                                    </IconButton>
                                )}
                                <IconButton
                                    label={t('form-engine.viewer.views.deleteNamed', { name: v.name })}
                                    tooltip={t('form-engine.viewer.views.delete')}
                                    side="left"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => {
                                        setOpen(false); // the confirmation opens on its own, not under this menu
                                        void confirmAction({
                                            header: t('form-engine.viewer.views.deleteHeader', { name: v.name }),
                                            message:
                                                v.visibility === 'shared'
                                                    ? t('form-engine.viewer.views.deleteShared')
                                                    : t('form-engine.viewer.views.deletePrivate'),
                                            acceptLabel: t('form-engine.viewer.views.delete'),
                                            rejectLabel: t('form-engine.viewer.views.cancel'),
                                            danger: true,
                                            onAccept: async () => {
                                                await remove.mutateAsync(v.id);
                                                if (state.viewId === v.id) patch({ viewId: undefined });
                                            }
                                        });
                                    }}
                                >
                                    <Trash2 />
                                </IconButton>
                            </>
                        )}
                    </div>
                ))}
            </div>
        );

    return (
        <>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button type="button" variant={active ? 'secondary' : 'outline'} aria-haspopup="dialog">
                        <Bookmark />
                        {active ? active.name : t('form-engine.viewer.views.button')}
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    align="start"
                    className="w-[min(92vw,22rem)] p-2"
                    aria-label={t('form-engine.viewer.views.title')}
                >
                    <div className="flex flex-col gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={cn('justify-start', !state.viewId && 'font-semibold')}
                            onClick={() => choose(null)}
                        >
                            {t('form-engine.viewer.views.all')}
                        </Button>
                        {section(
                            t('form-engine.viewer.views.shared'),
                            views.filter((v) => v.visibility === 'shared')
                        )}
                        {section(
                            t('form-engine.viewer.views.mine'),
                            views.filter((v) => v.visibility === 'private')
                        )}
                        {(canCreate || active?.can_edit) && <Separator />}
                        {canCreate && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="justify-start"
                                onClick={() => {
                                    setOpen(false);
                                    setName('');
                                    setShared(false);
                                    setIsDefault(false);
                                    setSaving(true);
                                }}
                            >
                                <Plus />
                                {t('form-engine.viewer.views.saveCurrent')}
                            </Button>
                        )}
                        {active?.can_edit && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="justify-start"
                                onClick={() =>
                                    void (async () => {
                                        await update.mutateAsync({ id: active.id, config: configOf(state) });
                                        setOpen(false);
                                        notify.success(t('form-engine.viewer.views.updated', { name: active.name }));
                                    })()
                                }
                            >
                                <Save />
                                {t('form-engine.viewer.views.update', { name: active.name })}
                            </Button>
                        )}
                    </div>
                </PopoverContent>
            </Popover>
            <Dialog open={saving} onOpenChange={setSaving}>
                <DialogContent className="sm:max-w-md" data-save-view>
                    <DialogHeader>
                        <DialogTitle>{t('form-engine.viewer.views.saveTitle')}</DialogTitle>
                        <DialogDescription>{t('form-engine.viewer.views.saveHelp')}</DialogDescription>
                    </DialogHeader>
                    <form
                        className="flex flex-col gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (name.trim()) void save();
                        }}
                    >
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="view-name">{t('form-engine.viewer.views.name')}</Label>
                            <Input
                                id="view-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                autoFocus
                                maxLength={120}
                            />
                        </div>
                        {canShare && (
                            <>
                                <Label className="font-normal">
                                    <Checkbox
                                        id="view-shared"
                                        checked={shared || isDefault}
                                        disabled={isDefault}
                                        onCheckedChange={(c) => setShared(c === true)}
                                    />
                                    {t('form-engine.viewer.views.share')}
                                </Label>
                                <Label className="font-normal">
                                    <Checkbox
                                        id="view-default"
                                        checked={isDefault}
                                        onCheckedChange={(c) => setIsDefault(c === true)}
                                    />
                                    {t('form-engine.viewer.views.makeFirst')}
                                </Label>
                            </>
                        )}
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setSaving(false)}>
                                {t('form-engine.viewer.views.cancel')}
                            </Button>
                            <Button type="submit" disabled={!name.trim() || create.isPending}>
                                {create.isPending ? <Spinner /> : <Check />}
                                {t('form-engine.viewer.views.save')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}
