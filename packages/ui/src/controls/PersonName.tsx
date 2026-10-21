import * as React from 'react';

import { cn } from '../lib/utils';

/** An Ethiopian name: a given name, the father's given name and the grandfather's. There is no family name. */
export interface PersonNameParts {
    given: string;
    father: string;
    grandfather?: string;
}

export type PersonNameForm = 'full' | 'short';

/** "Abebe Kebede Chala"; the short form ("Abebe Kebede") is what lists and greetings use. */
export function formatPersonName(name: PersonNameParts, form: PersonNameForm = 'full'): string {
    const parts = form === 'short' ? [name.given, name.father] : [name.given, name.father, name.grandfather];
    return parts.filter((p) => p?.trim()).join(' ');
}

export interface PersonNameProps extends Omit<React.ComponentProps<'span'>, 'children'> {
    /** The name in Ethiopic script, as written on the ID. */
    ethiopic?: PersonNameParts;
    /** The name in Latin letters (Fayda and passports carry both). */
    latin?: PersonNameParts;
    /** Which script leads; the other follows in brackets when `both` is set. */
    script?: 'ethiopic' | 'latin';
    form?: PersonNameForm;
    both?: boolean;
    /** The language tag of the Ethiopic spelling (am, ti, …), so the Ethiopic type rules apply to it. */
    ethiopicLang?: string;
}

/**
 * A person's name in the script the reader uses, each spelling tagged with its language. Search and sorting stay with
 * the caller: names are compared by given name, as the bureaus file them.
 */
export function PersonName({
    ethiopic,
    latin,
    script = 'ethiopic',
    form = 'full',
    both = false,
    ethiopicLang = 'am',
    className,
    ...props
}: PersonNameProps) {
    const spellings = [
        ethiopic && { text: formatPersonName(ethiopic, form), lang: ethiopicLang },
        latin && { text: formatPersonName(latin, form), lang: 'en' }
    ].filter((s): s is { text: string; lang: string } => !!s && !!s.text);
    if (script === 'latin') spellings.reverse();
    const [lead, other] = spellings;
    if (!lead) return null;
    return (
        <span className={cn('inline', className)} {...props}>
            <span lang={lead.lang}>{lead.text}</span>
            {both && other && (
                <span className="text-muted-foreground">
                    {' ('}
                    <span lang={other.lang}>{other.text}</span>
                    {')'}
                </span>
            )}
        </span>
    );
}
