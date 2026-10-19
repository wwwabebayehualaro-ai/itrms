'use client';

import React from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '../primitives/button';
import { Input } from '../primitives/input';

/** Editable string→string map (query params, headers, path params, field mappings). */
export function KeyValueEditor({
    value,
    onChange,
    keyPlaceholder = 'key',
    valuePlaceholder = 'value or {{form.x}}',
    'aria-label': ariaLabel = 'Entries'
}: {
    value?: Record<string, string>;
    onChange: (v: Record<string, string> | undefined) => void;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    'aria-label'?: string;
}) {
    const entries = Object.entries(value ?? {});
    const commit = (next: [string, string][]) => onChange(next.length ? Object.fromEntries(next) : undefined);
    return (
        <div className="flex flex-col gap-2" role="group" aria-label={ariaLabel}>
            {entries.map(([k, v], i) => (
                <div key={i} className="grid grid-cols-[2fr_3fr_auto] gap-2">
                    <Input
                        value={k}
                        placeholder={keyPlaceholder}
                        aria-label={`${ariaLabel} ${i + 1} name`}
                        className="font-mono text-xs"
                        onChange={(e) =>
                            commit(entries.map<[string, string]>((en, j) => (j === i ? [e.target.value, en[1]] : en)))
                        }
                    />
                    <Input
                        value={v}
                        placeholder={valuePlaceholder}
                        aria-label={`${ariaLabel} ${i + 1} value`}
                        className="font-mono text-xs"
                        onChange={(e) =>
                            commit(entries.map<[string, string]>((en, j) => (j === i ? [en[0], e.target.value] : en)))
                        }
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => commit(entries.filter((_, j) => j !== i))}
                        aria-label={`Remove ${ariaLabel} ${i + 1}`}
                    >
                        <X />
                    </Button>
                </div>
            ))}
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => commit([...entries, ['', '']])}
            >
                <Plus />
                Add
            </Button>
        </div>
    );
}
