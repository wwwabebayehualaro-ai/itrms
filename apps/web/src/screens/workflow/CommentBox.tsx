'use client';

/**
 * A comment on a case (task 0.20b): internal, for the staff working on it. Typing `@` (or the mention button) opens a
 * search of the people who work on the case; picking one writes `@Name` into the text and adds them to the comment's
 * mentions, and each is told when it is posted. A mention whose name is taken out of the text is dropped.
 */
import { useRef, useState } from 'react';
import { AtSign, Send, X } from 'lucide-react';
import {
    Badge,
    Button,
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
    Label,
    Popover,
    PopoverAnchor,
    PopoverContent,
    Textarea
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useText } from '@/lib/preferences';
import { useCasePeople, useComment, type PersonRef } from '@/lib/workflow';

export function CommentBox({ caseId }: { caseId: string }) {
    const { t } = useText();
    const comment = useComment(caseId);
    const [text, setText] = useState('');
    const [mentions, setMentions] = useState<PersonRef[]>([]);
    const [picking, setPicking] = useState(false);
    const [q, setQ] = useState('');
    const people = useCasePeople(caseId, q, picking);
    const area = useRef<HTMLTextAreaElement>(null);
    // only the mentions whose name is still in the text
    const kept = mentions.filter((m) => text.includes(`@${m.name}`));

    const pick = (person: PersonRef) => {
        const at = area.current?.selectionStart ?? text.length;
        // the `@` typed to open the search is replaced by the whole mention
        const before = text.slice(0, at).replace(/@$/, '');
        setText(`${before}@${person.name} ${text.slice(at)}`);
        if (!mentions.some((m) => m.id === person.id)) setMentions([...mentions, person]);
        setPicking(false);
        setQ('');
        area.current?.focus();
    };

    const post = () =>
        comment.mutate(
            { text: text.trim(), mentions: kept.map((m) => m.id) },
            {
                onSuccess: () => {
                    setText('');
                    setMentions([]);
                }
            }
        );

    return (
        <section className="flex flex-col gap-2 rounded-md border p-4" data-comment-box>
            <Label htmlFor="case-comment">{t('workflow.comment.label')}</Label>
            <Popover open={picking} onOpenChange={setPicking}>
                <PopoverAnchor asChild>
                    <Textarea
                        id="case-comment"
                        ref={area}
                        value={text}
                        maxLength={2000}
                        placeholder={t('workflow.comment.placeholder')}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === '@') setPicking(true);
                        }}
                    />
                </PopoverAnchor>
                <PopoverContent className="w-72 p-0" align="start">
                    <Command shouldFilter={false}>
                        <CommandInput
                            autoFocus
                            value={q}
                            onValueChange={setQ}
                            placeholder={t('workflow.comment.searchPeople')}
                            aria-label={t('workflow.comment.searchPeople')}
                        />
                        <CommandList>
                            {q.trim() && !people.isFetching && (
                                <CommandEmpty>{t('workflow.comment.noPeople')}</CommandEmpty>
                            )}
                            {(people.data ?? []).map((p) => (
                                <CommandItem key={p.id} value={p.id} onSelect={() => pick(p)} data-person={p.id}>
                                    {p.name}
                                </CommandItem>
                            ))}
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            {kept.length > 0 && (
                <div className="flex flex-wrap items-center gap-2" data-mentions>
                    <span className="text-muted-foreground text-xs">{t('workflow.comment.willTell')}</span>
                    {kept.map((m) => (
                        <Badge key={m.id} variant="secondary" data-mention={m.id}>
                            @{m.name}
                            <button
                                type="button"
                                className="ml-1"
                                aria-label={t('workflow.comment.removeMention', { name: m.name })}
                                onClick={() => setText(text.replaceAll(`@${m.name}`, m.name))}
                            >
                                <X className="size-3" />
                            </button>
                        </Badge>
                    ))}
                </div>
            )}
            {comment.error && (
                <p className="text-destructive text-sm" role="alert">
                    {getApiErrorMessage(comment.error)}
                </p>
            )}
            <div className="flex justify-between gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setPicking(true)}>
                    <AtSign />
                    {t('workflow.comment.mention')}
                </Button>
                <Button type="button" disabled={!text.trim() || comment.isPending} onClick={post}>
                    <Send />
                    {t('workflow.comment.post')}
                </Button>
            </div>
            <p className="text-muted-foreground text-xs">{t('workflow.comment.internal')}</p>
        </section>
    );
}
