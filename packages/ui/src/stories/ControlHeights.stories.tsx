/**
 * Controls in one row line up in every density and language: a default and an outline button, an input and a select
 * trigger are all exactly --field-height tall (checked in a browser in every mode). Amharic text has taller lines, so
 * a button's padding must leave room for them inside that height.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

import { Button } from '../primitives/button';
import { Input } from '../primitives/input';
import { Select, SelectTrigger, SelectValue } from '../primitives/select';
import { TEXT } from './fixtures';
import { T, useText } from './locale';

const meta = { title: 'Foundations/Control heights' } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Row() {
    const search = useText(TEXT.search);
    const woreda = useText(TEXT.selectWoreda);
    return (
        <div className="flex items-end gap-2" data-testid="row">
            <Input aria-label={search} placeholder={search} className="w-48" />
            <Select>
                <SelectTrigger aria-label={woreda} className="w-48">
                    <SelectValue placeholder={woreda} />
                </SelectTrigger>
            </Select>
            <Button variant="outline">
                <T text={TEXT.cancel} />
            </Button>
            <Button>
                <T text={TEXT.search} />
            </Button>
        </div>
    );
}

export const OneRow: Story = {
    render: () => <Row />,
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector<HTMLElement>('[data-testid="row"]');
        if (!row) throw new Error('row not rendered');
        const expected = Number.parseFloat(getComputedStyle(row).getPropertyValue('--field-height')) * 16;
        const heights = [...row.children].map((el) => Math.round(el.getBoundingClientRect().height));
        // every control is the density's field height (rem → px at the 16 px root)
        for (const h of heights) await expect(h).toBe(Math.round(expected));
    }
};
