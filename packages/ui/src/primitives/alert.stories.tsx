import type { Meta, StoryObj } from '@storybook/react-vite';
import { CircleAlert, Info } from 'lucide-react';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Alert, AlertDescription, AlertTitle } from './alert';

const meta = {
    title: 'Primitives/Alert',
    component: Alert
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    render: () => (
        <Alert>
            <Info aria-hidden="true" />
            <AlertTitle>
                <T text={TEXT.alertTitle} />
            </AlertTitle>
            <AlertDescription>
                <T text={TEXT.infoText} />
            </AlertDescription>
        </Alert>
    )
};

export const Destructive: Story = {
    render: () => (
        <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>
                <T text={TEXT.alertTitle} />
            </AlertTitle>
            <AlertDescription>
                <T text={TEXT.failed} />
            </AlertDescription>
        </Alert>
    )
};

/** A long Amharic message wraps inside the alert. */
export const LongText: Story = {
    render: () => (
        <Alert className="max-w-sm">
            <Info aria-hidden="true" />
            <AlertTitle>
                <T text={TEXT.longLabel} />
            </AlertTitle>
            <AlertDescription>
                <T text={TEXT.alertBody} />
            </AlertDescription>
        </Alert>
    )
};
