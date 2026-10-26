import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Combobox } from './Combobox';

const options = [
    { value: 'a', label: 'Abebe' },
    { value: 'b', label: 'Bekele' }
];

describe('Combobox onSearchChange', () => {
    it('tells the caller what is typed and does not filter the options itself', async () => {
        const onSearchChange = vi.fn();
        render(<Combobox options={options} value={null} onChange={() => {}} onSearchChange={onSearchChange} />);
        await userEvent.click(screen.getByRole('combobox'));
        await userEvent.type(screen.getByPlaceholderText('Search…'), 'zz');
        expect(onSearchChange).toHaveBeenLastCalledWith('zz');
        // both options stay: the caller decides what the search found
        expect(screen.getByText('Abebe')).toBeInTheDocument();
        expect(screen.getByText('Bekele')).toBeInTheDocument();
    });

    it('resets the search when an option is picked', async () => {
        const onSearchChange = vi.fn();
        const onChange = vi.fn();
        render(<Combobox options={options} value={null} onChange={onChange} onSearchChange={onSearchChange} />);
        await userEvent.click(screen.getByRole('combobox'));
        await userEvent.type(screen.getByPlaceholderText('Search…'), 'be');
        await userEvent.click(screen.getByText('Bekele'));
        expect(onChange).toHaveBeenCalledWith('b');
        expect(onSearchChange).toHaveBeenLastCalledWith('');
    });

    it('filters by itself without it', async () => {
        render(<Combobox options={options} value={null} onChange={() => {}} searchable />);
        await userEvent.click(screen.getByRole('combobox'));
        await userEvent.type(screen.getByPlaceholderText('Search…'), 'Bek');
        expect(screen.queryByText('Abebe')).not.toBeInTheDocument();
    });
});
