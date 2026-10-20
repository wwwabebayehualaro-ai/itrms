import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const meta = {
    title: 'Primitives/Tabs',
    component: Tabs
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    render: () => (
        <Tabs defaultValue="general" className="max-w-md">
            <TabsList>
                <TabsTrigger value="general">
                    <T text={TEXT.tab1} />
                </TabsTrigger>
                <TabsTrigger value="documents">
                    <T text={TEXT.tab2} />
                </TabsTrigger>
                <TabsTrigger value="payments" disabled>
                    <T text={TEXT.tab3} />
                </TabsTrigger>
            </TabsList>
            <TabsContent value="general">
                <T text={TEXT.tab1Body} />
            </TabsContent>
            <TabsContent value="documents">
                <T text={TEXT.tab2Body} />
            </TabsContent>
            <TabsContent value="payments">
                <T text={TEXT.tab3Body} />
            </TabsContent>
        </Tabs>
    )
};

export const Line: Story = {
    render: () => (
        <Tabs defaultValue="documents" className="max-w-md">
            <TabsList variant="line">
                <TabsTrigger value="general">
                    <T text={TEXT.tab1} />
                </TabsTrigger>
                <TabsTrigger value="documents">
                    <T text={TEXT.tab2} />
                </TabsTrigger>
            </TabsList>
            <TabsContent value="general">
                <T text={TEXT.tab1Body} />
            </TabsContent>
            <TabsContent value="documents">
                <T text={TEXT.tab2Body} />
            </TabsContent>
        </Tabs>
    )
};

export const LongText: Story = {
    render: () => (
        <Tabs defaultValue="a" className="max-w-md">
            <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="a" className="h-auto whitespace-normal">
                    <T text={TEXT.longWoreda} />
                </TabsTrigger>
                <TabsTrigger value="b" className="h-auto whitespace-normal">
                    <T text={TEXT.longLabel} />
                </TabsTrigger>
            </TabsList>
            <TabsContent value="a">
                <T text={TEXT.tab1Body} />
            </TabsContent>
            <TabsContent value="b">
                <T text={TEXT.tab2Body} />
            </TabsContent>
        </Tabs>
    )
};
