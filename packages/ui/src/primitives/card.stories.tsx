import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Button } from './button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

const meta = {
    title: 'Primitives/Card',
    component: Card
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    render: () => (
        <Card className="max-w-md">
            <CardHeader>
                <CardTitle>
                    <T text={TEXT.newApplication} />
                </CardTitle>
                <CardDescription>
                    <T text={TEXT.applicationHelp} />
                </CardDescription>
            </CardHeader>
            <CardContent>
                <T text={TEXT.bolo} />
            </CardContent>
            <CardFooter className="gap-2">
                <Button>
                    <T text={TEXT.submit} />
                </Button>
                <Button variant="outline">
                    <T text={TEXT.cancel} />
                </Button>
            </CardFooter>
        </Card>
    )
};

export const WithAction: Story = {
    render: () => (
        <Card className="max-w-md">
            <CardHeader>
                <CardTitle>
                    <T text={TEXT.registeredVehicles} />
                </CardTitle>
                <CardAction>
                    <Button size="sm" variant="outline">
                        <T text={TEXT.edit} />
                    </Button>
                </CardAction>
            </CardHeader>
            <CardContent>
                <T text={TEXT.inspectionDate} />
            </CardContent>
        </Card>
    )
};

export const LongText: Story = {
    render: () => (
        <Card className="max-w-xs">
            <CardHeader>
                <CardTitle>
                    <T text={TEXT.longWoreda} />
                </CardTitle>
                <CardDescription>
                    <T text={TEXT.longLabel} />
                </CardDescription>
            </CardHeader>
        </Card>
    )
};
