import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { Label } from './label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './select';

const meta = {
    title: 'Primitives/Select',
    component: Select
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

function Items() {
    return (
        <SelectGroup>
            <SelectLabel>
                <T text={TEXT.woreda} />
            </SelectLabel>
            <SelectItem value="sodo-zuria">
                <T text={TEXT.sodoZuria} />
            </SelectItem>
            <SelectItem value="damot-gale">
                <T text={TEXT.damotGale} />
            </SelectItem>
            <SelectItem value="humbo">
                <T text={TEXT.humbo} />
            </SelectItem>
            <SelectItem value="ofa" disabled>
                <T text={TEXT.ofa} />
            </SelectItem>
        </SelectGroup>
    );
}

function ClosedDemo({ disabled, invalid }: { disabled?: boolean; invalid?: boolean }) {
    const placeholder = useText(TEXT.selectWoreda);
    return (
        <div className="flex max-w-xs flex-col gap-2">
            <Label htmlFor="woreda">
                <T text={TEXT.woreda} />
            </Label>
            <Select disabled={disabled}>
                <SelectTrigger
                    id="woreda"
                    className="w-full"
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? 'woreda-error' : undefined}
                >
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                    <Items />
                </SelectContent>
            </Select>
            {invalid && (
                <small id="woreda-error" className="text-destructive">
                    <T text={TEXT.requiredError} />
                </small>
            )}
        </div>
    );
}

/** Rendered open so the list is what is checked. */
function OpenDemo() {
    const placeholder = useText(TEXT.selectWoreda);
    return (
        <div className="flex min-h-96 max-w-xs flex-col gap-2 pt-32">
            <Label htmlFor="woreda-open" id="woreda-open-label">
                <T text={TEXT.woreda} />
            </Label>
            <Select defaultOpen defaultValue="sodo-zuria">
                {/* tabIndex -1: Radix hides the page (and this trigger) from assistive technology while the list is open */}
                <SelectTrigger id="woreda-open" className="w-full" tabIndex={-1}>
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                {/* the open list is named by its field's label: axe may check it while it opens or closes */}
                <SelectContent aria-labelledby="woreda-open-label">
                    <Items />
                </SelectContent>
            </Select>
        </div>
    );
}

export const Default: Story = { render: () => <OpenDemo /> };

export const Closed: Story = { render: () => <ClosedDemo /> };

export const Disabled: Story = { render: () => <ClosedDemo disabled /> };

export const Invalid: Story = { render: () => <ClosedDemo invalid /> };

function LongTextDemo() {
    const placeholder = useText(TEXT.longWoreda);
    return (
        <div className="flex max-w-xs flex-col gap-2">
            <Label htmlFor="woreda-long">
                <T text={TEXT.longLabel} />
            </Label>
            <Select>
                <SelectTrigger id="woreda-long" className="w-full">
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                    <Items />
                </SelectContent>
            </Select>
        </div>
    );
}

export const LongText: Story = { render: () => <LongTextDemo /> };
