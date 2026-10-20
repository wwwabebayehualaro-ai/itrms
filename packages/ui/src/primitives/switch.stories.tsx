import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Label } from './label';
import { Switch } from './switch';

const meta = {
    title: 'Primitives/Switch',
    component: Switch
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    render: () => (
        <div className="flex items-center gap-2">
            <Switch id="sms" />
            <Label htmlFor="sms">
                <T text={TEXT.notifySms} />
            </Label>
        </div>
    )
};

export const On: Story = {
    render: () => (
        <div className="flex items-center gap-2">
            <Switch id="sms-on" defaultChecked />
            <Label htmlFor="sms-on">
                <T text={TEXT.notifySms} />
            </Label>
        </div>
    )
};

export const Disabled: Story = {
    render: () => (
        <div className="flex items-center gap-2">
            <Switch id="sms-off" disabled />
            <Label htmlFor="sms-off">
                <T text={TEXT.notifySms} />
            </Label>
        </div>
    )
};

export const LongText: Story = {
    render: () => (
        <div className="flex max-w-xs items-start gap-2">
            <Switch id="sms-long" className="mt-1" />
            <Label htmlFor="sms-long">
                <T text={TEXT.longLabel} />
            </Label>
        </div>
    )
};
