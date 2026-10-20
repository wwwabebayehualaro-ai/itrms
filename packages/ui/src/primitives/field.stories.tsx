import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Checkbox } from './checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from './field';
import { Input } from './input';

const meta = {
    title: 'Primitives/Field',
    component: Field
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    render: () => (
        <Field className="max-w-sm">
            <FieldLabel htmlFor="field-name">
                <T text={TEXT.applicantName} />
            </FieldLabel>
            <Input id="field-name" aria-describedby="field-name-help" />
            <FieldDescription id="field-name-help">
                <T text={TEXT.applicationHelp} />
            </FieldDescription>
        </Field>
    )
};

export const Invalid: Story = {
    render: () => (
        <Field className="max-w-sm" data-invalid="true">
            <FieldLabel htmlFor="field-phone">
                <T text={TEXT.phone} />
            </FieldLabel>
            <Input id="field-phone" aria-invalid="true" aria-describedby="field-phone-error" />
            <FieldError id="field-phone-error">
                <T text={TEXT.requiredError} />
            </FieldError>
        </Field>
    )
};

export const Horizontal: Story = {
    render: () => (
        <Field orientation="horizontal" className="max-w-sm">
            <Checkbox id="field-terms" />
            <FieldLabel htmlFor="field-terms">
                <T text={TEXT.agreeTerms} />
            </FieldLabel>
        </Field>
    )
};

export const Group: Story = {
    render: () => (
        <FieldSet className="max-w-sm">
            <FieldLegend>
                <T text={TEXT.newApplication} />
            </FieldLegend>
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor="group-name">
                        <T text={TEXT.longLabel} />
                    </FieldLabel>
                    <Input id="group-name" />
                </Field>
                <Field>
                    <FieldLabel htmlFor="group-plate">
                        <T text={TEXT.plateNumber} />
                    </FieldLabel>
                    <Input id="group-plate" />
                </Field>
            </FieldGroup>
        </FieldSet>
    )
};
