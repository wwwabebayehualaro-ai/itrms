'use client';

import React, { useState } from 'react';
import { Textarea } from '../primitives/textarea';
import { cn } from '../lib/utils';

/** JSON textarea that only commits valid JSON (empty commits `undefined`). */
export function JsonEditor({
    value,
    onChange,
    rows = 5,
    placeholder,
    'aria-label': ariaLabel,
    id
}: {
    value: unknown;
    onChange: (v: unknown) => void;
    rows?: number;
    placeholder?: string;
    'aria-label'?: string;
    id?: string;
}) {
    const [text, setText] = useState(value === undefined ? '' : JSON.stringify(value, null, 2));
    const [error, setError] = useState('');
    return (
        <div className="flex flex-col gap-1">
            <Textarea
                id={id}
                className={cn('font-mono text-xs', error && 'border-destructive')}
                rows={rows}
                value={text}
                placeholder={placeholder}
                aria-label={ariaLabel}
                aria-invalid={error ? true : undefined}
                spellCheck={false}
                onChange={(e) => {
                    setText(e.target.value);
                    if (!e.target.value.trim()) {
                        setError('');
                        return onChange(undefined);
                    }
                    try {
                        onChange(JSON.parse(e.target.value));
                        setError('');
                    } catch {
                        setError('Not valid JSON yet');
                    }
                }}
            />
            {error && <small className="text-xs text-destructive">{error}</small>}
        </div>
    );
}
