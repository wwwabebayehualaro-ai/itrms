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
    const [open, setOpen] = useState(false);
    const notify = useNotify();
    const canShare = useCan('template:update');
    const canCreate = useCan('view:create');
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
        notify.success(`View “${saved.name}” saved`);
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
                                <Star className="size-3 fill-current" aria-label="Default view of this form" />
                            )}
                        </Button>
                        {v.can_edit && (
                            <>
                                {canShare && v.visibility === 'shared' && !v.is_default && (
                                    <IconButton
                                        label={`Make ${v.name} the default`}
                                        tooltip="Make default"
                                        side="left"
                                        onClick={() => update.mutate({ id: v.id, is_default: true })}
                                    >
                                        <Star />
                                    </IconButton>
                                )}
                                <IconButton
                                    label={`Delete ${v.name}`}
                                    tooltip="Delete"
                                    side="left"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => {
                                        setOpen(false); // the confirmation opens on its own, not under this menu
                                        void confirmAction({
                                            header: `Delete “${v.name}”?`,
                                            message:
                                                v.visibility === 'shared'
                                                    ? 'It disappears for everyone.'
                                                    : 'This cannot be undone.',
                                            acceptLabel: 'Delete',
                                            rejectLabel: 'Cancel',
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
                        {active ? active.name : 'Views'}
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(92vw,22rem)] p-2" aria-label="Saved views">
                    <div className="flex flex-col gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={cn('justify-start', !state.viewId && 'font-semibold')}
                            onClick={() => choose(null)}
                        >
                            All requests
                        </Button>
                        {section(
                            'Shared',
                            views.filter((v) => v.visibility === 'shared')
                        )}
                        {section(
                            'Mine',
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
                                Save current view…
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
                                        notify.success(`View “${active.name}” updated`);
                                    })()
                                }
                            >
                                <Save />
                                Update “{active.name}”
                            </Button>
                        )}
                    </div>
                </PopoverContent>
            </Popover>
            <Dialog open={saving} onOpenChange={setSaving}>
                <DialogContent className="sm:max-w-md" data-save-view>
                    <DialogHeader>
                        <DialogTitle>Save this view</DialogTitle>
                        <DialogDescription>
                            Saves the current mode, search, filters, sort and columns.
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="flex flex-col gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (name.trim()) void save();
                        }}
                    >
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="view-name">Name</Label>
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
                                    Share with everyone who can see this form
                                </Label>
                                <Label className="font-normal">
                                    <Checkbox
                                        id="view-default"
                                        checked={isDefault}
                                        onCheckedChange={(c) => setIsDefault(c === true)}
                                    />
                                    Open this view first for everyone
                                </Label>
                            </>
                        )}
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setSaving(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={!name.trim() || create.isPending}>
                                {create.isPending ? <Spinner /> : <Check />}
                                Save view
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}
