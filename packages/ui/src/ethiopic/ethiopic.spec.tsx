import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Input } from '../primitives/input';
import { transliterate } from './transliterate';

describe('phonetic Latin → Ethiopic', () => {
    it('writes the seven orders, the labialised form and the digraphs', () => {
        expect(['le', 'lu', 'li', 'la', 'lie', 'lE', 'l', 'lo', 'lwa'].map(transliterate)).toEqual([
            'ለ',
            'ሉ',
            'ሊ',
            'ላ',
            'ሌ',
            'ሌ',
            'ል',
            'ሎ',
            'ሏ'
        ]);
        expect(transliterate('selam')).toBe('ሰላም');
        expect(transliterate('ityoPya')).toBe('ኢትዮጵያ');
        expect(transliterate('shiferaw')).toBe('ሺፈራው');
        expect(transliterate('tsehay')).toBe('ጸሃይ');
        expect(transliterate('chala')).toBe('ቻላ');
        expect(transliterate('`alem')).toBe('ዓለም');
        expect(transliterate('amaregna')).toBe('አማረኛ');
        // what it does not know stays
        expect(transliterate('A1')).toBe('ኣ1');
    });
});

/** Types one key the way a browser does: beforeinput, then (if not prevented) the value and an input event. */
function typeKey(field: HTMLInputElement, key: string) {
    if (key === 'F9') {
        fireEvent.keyDown(field, { key });
        return;
    }
    const event = new InputEvent('beforeinput', {
        data: key,
        inputType: 'insertText',
        bubbles: true,
        cancelable: true
    });
    if (!field.dispatchEvent(event)) return;
    const at = field.selectionStart ?? field.value.length;
    fireEvent.input(field, { target: { value: field.value.slice(0, at) + key + field.value.slice(at) } });
    field.setSelectionRange(at + 1, at + 1);
}

function Controlled() {
    const [value, setValue] = React.useState('');
    return <Input aria-label="name" value={value} onChange={(e) => setValue(e.target.value)} />;
}

describe('Ethiopic typing in the base Input', () => {
    it('is off until F9, then writes each word in Fidel as it is typed, with Ethiopic punctuation', () => {
        render(<Controlled />);
        const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'name' });
        field.focus();
        for (const key of 'ab') typeKey(field, key);
        expect(field.value).toBe('ab');
        typeKey(field, 'F9');
        expect(field.dataset.ethiopic).toBe('on');
        for (const key of ' selam, ') typeKey(field, key);
        for (const key of 'dehna') typeKey(field, key);
        typeKey(field, ':');
        typeKey(field, ':');
        expect(field.value).toBe('ab ሰላም፣ ደህና።');
        typeKey(field, 'F9');
        typeKey(field, 'x');
        expect(field.value).toBe('ab ሰላም፣ ደህና።x');
    });

    it('starts a new word when the value was changed from outside (a form reset), and keeps to maxLength', () => {
        render(<Controlled />);
        const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'name' });
        field.focus();
        typeKey(field, 'F9');
        for (const key of 'se') typeKey(field, key);
        expect(field.value).toBe('ሰ');
        fireEvent.input(field, { target: { value: 'x' } });
        field.setSelectionRange(1, 1);
        typeKey(field, 'l');
        expect(field.value).toBe('xል');
        field.maxLength = 2;
        typeKey(field, 'a');
        expect(field.value).toBe('xላ');
        typeKey(field, ' ');
        typeKey(field, 'b');
        expect(field.value).toBe('xላ ');
    });

    it('is not offered where the field is not free text', () => {
        render(<Input aria-label="count" type="number" ethiopic />);
        expect(screen.getByRole('spinbutton', { name: 'count' }).dataset.ethiopic).toBeUndefined();
    });
});
