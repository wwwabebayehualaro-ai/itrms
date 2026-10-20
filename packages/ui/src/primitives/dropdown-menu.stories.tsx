import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Button } from './button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger
} from './dropdown-menu';

const meta = {
    title: 'Primitives/DropdownMenu',
    component: DropdownMenu
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rendered open so the menu is what is checked. */
export const Default: Story = {
    render: () => (
        <div className="min-h-56">
            <DropdownMenu defaultOpen>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                        <T text={TEXT.menuAccount} />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="start">
                    <DropdownMenuLabel>
                        <T text={TEXT.menuAccount} />
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem>
                            <T text={TEXT.menuProfile} />
                            <DropdownMenuShortcut>⇧P</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                            <T text={TEXT.menuSettings} />
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled>
                            <T text={TEXT.reports} />
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive">
                        <T text={TEXT.menuLogout} />
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
};

export const WithCheckbox: Story = {
    render: () => (
        <div className="min-h-32">
            <DropdownMenu defaultOpen>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                        <T text={TEXT.status} />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="start">
                    <DropdownMenuCheckboxItem checked>
                        <T text={TEXT.approved} />
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={false}>
                        <T text={TEXT.menuShowDrafts} />
                    </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
};

export const LongText: Story = {
    render: () => (
        <div className="min-h-48">
            <DropdownMenu defaultOpen>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                        <T text={TEXT.woreda} />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="start">
                    <DropdownMenuItem>
                        <T text={TEXT.longWoreda} />
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                        <T text={TEXT.longLabel} />
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
};
