'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Button } from '../primitives/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip';

type Props = Omit<ComponentProps<typeof Button>, 'children' | 'aria-label'> & {
    /** Accessible name, also shown as the tooltip. */
    label: string;
    /** Tooltip text when it should say more than the name. */
    tooltip?: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    children: ReactNode;
};

/** An icon-only button that always has a name and a tooltip. */
export function IconButton({ label, tooltip, side = 'top', variant = 'ghost', size = 'icon-sm', type = 'button', children, ...rest }: Props) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button type={type} variant={variant} size={size} aria-label={label} {...rest}>
                    {children}
                </Button>
            </TooltipTrigger>
            <TooltipContent side={side}>{tooltip ?? label}</TooltipContent>
        </Tooltip>
    );
}
