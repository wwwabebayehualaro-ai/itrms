import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { TEXT } from '../stories/fixtures';
import { useText } from '../stories/locale';
import { Pager } from './Pager';

const meta = {
    title: 'Controls/Pager',
    component: Pager,
    // required by the type; every story renders its own state
    args: { page: 1, pageSize: 20, total: 0, onChange: () => undefined }
} satisfies Meta<typeof Pager>;

export default meta;
type Story = StoryObj<typeof meta>;

function PagerDemo({ initialPage = 2, total = 145 }: { initialPage?: number; total?: number }) {
    const noun = useText(TEXT.vehicles);
    const [state, setState] = useState({ page: initialPage, pageSize: 20 });
    return <Pager page={state.page} pageSize={state.pageSize} total={total} noun={noun} onChange={setState} />;
}

export const Default: Story = { render: () => <PagerDemo /> };

export const FirstPage: Story = { render: () => <PagerDemo initialPage={1} /> };

export const LastPage: Story = { render: () => <PagerDemo initialPage={8} /> };

export const Empty: Story = { render: () => <PagerDemo initialPage={1} total={0} /> };
