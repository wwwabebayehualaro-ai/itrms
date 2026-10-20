/**
 * The Ethiopic typography rules (design-system.md §5, task 0.4b) checked in a real browser, in every theme and density:
 * labels wrap to a second line without overlapping, body text has a 1.6 line height, nothing Ethiopic is smaller than
 * 14 px, and uppercase or letter-spacing utilities have no effect on Ethiopic text.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

import { Button } from '../primitives/button';
import { Input } from '../primitives/input';
import { Label } from '../primitives/label';
import { TEXT } from './fixtures';

const meta = {
    title: 'Foundations/Ethiopic typography',
    parameters: { layout: 'padded' },
    globals: { locale: 'am' }
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const px = (v: string) => Number.parseFloat(v);

/** A long Amharic label in a narrow field: it wraps to two lines, and the lines don't overlap. */
export const LabelWraps: Story = {
    render: () => (
        <div lang="am" className="grid w-56 gap-2">
            <Label htmlFor="place" data-testid="label">
                {TEXT.longLabel.am}
            </Label>
            <Input id="place" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const label = canvasElement.querySelector<HTMLElement>('[data-testid="label"]');
        if (!label) throw new Error('label not rendered');
        const style = getComputedStyle(label);
        const lineHeight = px(style.lineHeight);
        // two or more line boxes, each at least as tall as the glyphs (no leading-none overlap)
        await expect(label.getBoundingClientRect().height).toBeGreaterThanOrEqual(lineHeight * 2 - 1);
        await expect(lineHeight).toBeGreaterThanOrEqual(px(style.fontSize) * 1.25);
    }
};

/** A long Amharic button label in a narrow container wraps inside it instead of overflowing (found in a dialog). */
export const ButtonLabelWraps: Story = {
    render: () => (
        <div lang="am" data-testid="box" className="w-48 border p-2">
            <Button data-testid="button">{TEXT.longWoreda.am}</Button>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const box = canvasElement.querySelector<HTMLElement>('[data-testid="box"]');
        const button = canvasElement.querySelector<HTMLElement>('[data-testid="button"]');
        if (!box || !button) throw new Error('not rendered');
        await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(box.getBoundingClientRect().right);
        await expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
        await expect(button.getBoundingClientRect().height).toBeGreaterThan(
            px(getComputedStyle(button).lineHeight) * 1.5
        );
    }
};

/** Body text in Amharic: 1.6 line height; the smallest utility size is still 14 px. */
export const BodyAndSmallText: Story = {
    render: () => (
        <div lang="am" className="grid max-w-prose gap-3">
            <p data-testid="body" className="text-sm">
                {TEXT.applicationHelp.am}
            </p>
            <p data-testid="small" className="text-xs text-muted-foreground">
                {TEXT.bolo.am}
            </p>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const body = canvasElement.querySelector<HTMLElement>('[data-testid="body"]');
        const small = canvasElement.querySelector<HTMLElement>('[data-testid="small"]');
        if (!body || !small) throw new Error('text not rendered');
        const b = getComputedStyle(body);
        await expect(px(b.lineHeight) / px(b.fontSize)).toBeCloseTo(1.6, 1);
        await expect(px(getComputedStyle(small).fontSize)).toBeGreaterThanOrEqual(14);
    }
};

/** Utilities a screen might apply for English text do nothing to Ethiopic text. */
export const NoCaseSpacingOrSlant: Story = {
    render: () => (
        <p lang="am" data-testid="styled" className="tracking-widest uppercase italic">
            {TEXT.bolo.am}
        </p>
    ),
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector<HTMLElement>('[data-testid="styled"]');
        if (!el) throw new Error('text not rendered');
        const s = getComputedStyle(el);
        await expect(s.textTransform).toBe('none');
        await expect(s.letterSpacing === 'normal' || px(s.letterSpacing) === 0).toBe(true);
        await expect(s.fontStyle).toBe('normal');
    }
};
