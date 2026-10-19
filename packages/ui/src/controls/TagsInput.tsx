'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Badge } from '../primitives/badge';
import { cn } from '../lib/utils';

export interface TagsInputProps {
    value: string[] | null | undefined;
    onChange: (value: string[]) => void;
    id?: string;
    placeholder?: string;
    /** Typing it (or pasting text with it) adds the text before it as a tag. Enter always adds. */
    separator?: string;
    disabled?: boolean;
    invalid?: boolean;
    'aria-label'?: string;
    'aria-describedby'?: string;
    className?: string;
    onBlur?: () => void;
}

/** A list of short texts as removable badges; type and press Enter (or the separator) to add, Backspace removes the last. */
export function TagsInput({
    value,
    onChange,
    id,
    placeholder = 'Type and press Enter',
    separator = ',',
    disabled,
    invalid,
    className,
    onBlur,
    ...aria
}: TagsInputProps) {
    const [draft, setDraft] = useState('');
    const list = Array.isArray(value) ? value.map(String) : [];
    const add = (text: string) => {
        const parts = text
            .split(separator)
            .map((s) => s.trim())
            .filter((s, i, all) => s && !list.includes(s) && all.indexOf(s) === i);
        if (parts.length) onChange([...list, ...parts]);
        setDraft('');
    };
    return (
        <div
            className={cn(
                'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input px-2 py-1 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
                invalid && 'border-destructive',
                disabled && 'opacity-50',
                className
            )}
        >
            {list.map((chip) => (
                <Badge key={chip} variant="secondary" className="gap-1">
                    {chip}
                    {!disabled && (
                        <button
                            type="button"
                            aria-label={`Remove ${chip}`}
                            onClick={() => onChange(list.filter((c) => c !== chip))}
                        >
                            <X className="size-3" />
                        </button>
                    )}
                </Badge>
            ))}
            <input
                id={id}
                className="min-w-24 flex-1 bg-transparent text-sm outline-none"
                value={draft}
                disabled={disabled}
                aria-label={aria['aria-label']}
                aria-invalid={invalid || undefined}
                aria-describedby={aria['aria-describedby']}
                placeholder={list.length ? '' : placeholder}
                onChange={(e) => (e.target.value.includes(separator) ? add(e.target.value) : setDraft(e.target.value))}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        add(draft);
                    } else if (e.key === 'Backspace' && !draft && list.length) onChange(list.slice(0, -1));
                }}
                onBlur={() => {
                    if (draft) add(draft);
                    onBlur?.();
                }}
            />
        </div>
    );
}
