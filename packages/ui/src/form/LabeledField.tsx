import React from 'react';

export const LabeledField = ({
    label,
    help,
    children
}: {
    label: string;
    help?: string;
    children: React.ReactNode;
}) => (
    <div className="mb-3 flex flex-col gap-1">
        <label className="text-sm font-medium">{label}</label>
        {children}
        {help && <small className="text-xs text-muted-foreground">{help}</small>}
    </div>
);
