import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TONES } from '../tokens/tokens';
import { StatusBadge, toneOf } from './StatusBadge';

describe('StatusBadge', () => {
    it.each(TONES)('shows the %s tone with words and an icon, not colour alone', (tone) => {
        render(<StatusBadge value="x" label={`ሁኔታ ${tone}`} tone={tone} />);
        const badge = screen.getByText(`ሁኔታ ${tone}`);
        expect(badge).toHaveAttribute('data-tone', tone);
        expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        // colours come from the tone's semantic tokens only
        expect(badge.className).toContain(`bg-status-${tone}-bg`);
        expect(badge.className).toContain(`text-status-${tone}-fg`);
    });

    it('gives each tone its own icon', () => {
        const icons = TONES.map((tone) => {
            const { container, unmount } = render(<StatusBadge label="a" tone={tone} />);
            const cls = container.querySelector('svg')?.getAttribute('class') ?? '';
            unmount();
            return cls;
        });
        expect(new Set(icons).size).toBe(TONES.length);
    });

    it('maps the usual workflow words onto the vocabulary', () => {
        expect(toneOf('draft')).toBe('neutral');
        expect(toneOf('Pending approval')).toBe('info');
        expect(toneOf('in-progress')).toBe('progress');
        expect(toneOf('paid')).toBe('success');
        expect(toneOf('expiring')).toBe('warning');
        expect(toneOf('revoked')).toBe('danger');
        expect(toneOf('superseded')).toBe('muted');
        expect(toneOf('something else')).toBe('neutral');
    });

    it('reads a stored status as words', () => {
        render(<StatusBadge value="pending_approval" />);
        expect(screen.getByText('pending approval')).toBeInTheDocument();
    });
});
