import React from 'react';

export const LabeledField = ({
    label,
    help,
    htmlFor,
    children
}: {
    label: string;
    help?: string;
    /** The id of the control, so the label names it. */
    htmlFor?: string;
    children: React.ReactNode;
}) => (
    <div className="mb-3 flex flex-col gap-1">
        <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
        </label>
        {children}
        {help && <small className="text-xs text-muted-foreground">{help}</small>}
    </div>
);
