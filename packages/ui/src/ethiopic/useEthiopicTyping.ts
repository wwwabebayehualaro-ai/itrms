'use client';
/**
 * Ethiopic typing in a text field (task 0.13): F9 turns it on and off. While on, the Latin letters of the word being typed
 * are kept and the word is shown in Fidel as it grows (`s` ስ, `se` ሰ, `sel` ሰል, `sela` ሰላ, `selam` ሰላም). Moving the
 * caret, deleting, or typing a space or a digit ends the word. `,` gives ፣, `;` ፤, and `::` ።. The change reaches React
 * as an ordinary input event, so controlled fields and forms see it like any typing.
 */
import * as React from 'react';

import { announce } from './announce';
import { isLatinWordChar, PUNCTUATION, transliterate } from './transliterate';

type Field = HTMLInputElement | HTMLTextAreaElement;

/** The key that turns Ethiopic typing on and off. */
export const ETHIOPIC_TOGGLE_KEY = 'F9';

const ENDS_WORD = new Set([
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'Backspace',
    'Delete',
    'Enter',
    'Tab',
    'Escape'
]);

/**
 * Replaces [from, to) with text the way typing would: the value, the caret, and an input event for React. Nothing when the
 * result would pass the field's maxLength (typing would not either).
 */
function replace(field: Field, from: number, to: number, text: string): boolean {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const value = field.value.slice(0, from) + text + field.value.slice(to);
    if (field.maxLength >= 0 && value.length > field.maxLength && value.length > field.value.length) return false;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value);
    const caret = from + text.length;
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

/** What a screen reader hears when F9 turns Ethiopic typing on or off (the app gives them in the person's language). */
export interface EthiopicTypingLabels {
    on: string;
    off: string;
}

const ENGLISH_LABELS: EthiopicTypingLabels = {
    on: `Ethiopic typing on (${ETHIOPIC_TOGGLE_KEY} turns it off)`,
    off: `Ethiopic typing off (${ETHIOPIC_TOGGLE_KEY} turns it on)`
};
const LabelsContext = React.createContext<EthiopicTypingLabels>(ENGLISH_LABELS);

export function EthiopicTypingProvider({
    labels,
    children
}: {
    labels: EthiopicTypingLabels;
    children: React.ReactNode;
}) {
    return React.createElement(LabelsContext.Provider, { value: labels }, children);
}

export interface EthiopicTyping<T extends Field> {
    on: boolean;
    /** Attach to the field (merged with the caller's ref). */
    ref: React.RefCallback<T>;
}

/** `enabled`: the field takes free text (not a number, an e-mail, a password). `initial`: on from the start. */
export function useEthiopicTyping<T extends Field>(enabled: boolean, initial = false): EthiopicTyping<T> {
    const [on, setOn] = React.useState(initial);
    const labels = React.useContext(LabelsContext);
    const labelsRef = React.useRef(labels);
    React.useEffect(() => {
        labelsRef.current = labels;
    }, [labels]);
    // the native listeners read the mode from here (they are attached once per field)
    const onRef = React.useRef(on);
    React.useEffect(() => {
        onRef.current = on;
    }, [on]);
    const composing = React.useRef<{ start: number; latin: string; length: number; text: string } | null>(null);
    const cleanup = React.useRef<() => void>(undefined);

    const ref = React.useCallback(
        (field: T | null) => {
            cleanup.current?.();
            cleanup.current = undefined;
            if (!field || !enabled) return;

            const keydown = (e: KeyboardEvent) => {
                if (e.key === ETHIOPIC_TOGGLE_KEY) {
                    e.preventDefault();
                    composing.current = null;
                    const next = !onRef.current;
                    onRef.current = next;
                    setOn(next);
                    // the dashed edge shows the mode; a screen reader is told
                    announce(next ? labelsRef.current.on : labelsRef.current.off);
                } else if (ENDS_WORD.has(e.key)) composing.current = null;
            };
            const beforeinput = (e: InputEvent) => {
                if (!onRef.current) return;
                const data = e.data;
                if (e.inputType !== 'insertText' || !data || data.length !== 1) {
                    composing.current = null;
                    return;
                }
                const start = field.selectionStart ?? field.value.length;
                const end = field.selectionEnd ?? start;
                if (isLatinWordChar(data)) {
                    e.preventDefault();
                    let word = composing.current;
                    // a word goes on only where it ended, with nothing selected, and only if it is still there (a form
                    // reset or another change to the value since ends it)
                    if (
                        !word ||
                        word.start + word.length !== start ||
                        start !== end ||
                        field.value.slice(word.start, start) !== word.text
                    )
                        word = { start, latin: '', length: 0, text: '' };
                    const latin = word.latin + data;
                    const text = transliterate(latin);
                    if (replace(field, word.start, end, text))
                        composing.current = { start: word.start, latin, length: text.length, text };
                    return;
                }
                composing.current = null;
                if (data === ':' && start === end && field.value[start - 1] === ':') {
                    e.preventDefault();
                    replace(field, start - 1, end, '።');
                } else if (PUNCTUATION[data] && PUNCTUATION[data] !== data) {
                    e.preventDefault();
                    replace(field, start, end, PUNCTUATION[data]);
                }
            };
            // a click, or coming back to the field, starts a new word
            const pointer = () => (composing.current = null);
            // as an HTMLElement: the typed event overloads (a generic field type would get the untyped one)
            const element: HTMLElement = field;
            element.addEventListener('keydown', keydown);
            element.addEventListener('beforeinput', beforeinput);
            element.addEventListener('pointerdown', pointer);
            element.addEventListener('focus', pointer);
            cleanup.current = () => {
                element.removeEventListener('keydown', keydown);
                element.removeEventListener('beforeinput', beforeinput);
                element.removeEventListener('pointerdown', pointer);
                element.removeEventListener('focus', pointer);
            };
        },
        [enabled]
    );
    return { on: enabled && on, ref };
}

/** One ref callback for several refs (the caller's and the hook's). */
export function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
    return (value) => {
        for (const ref of refs) {
            if (typeof ref === 'function') ref(value);
            else if (ref) ref.current = value;
        }
    };
}
