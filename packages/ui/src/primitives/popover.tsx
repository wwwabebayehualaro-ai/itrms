'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Popover as PopoverPrimitive } from 'radix-ui';

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
    return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
    return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

/**
 * Radix renders popover content as role="dialog", which needs an accessible name. A PopoverTitle inside registers its id
 * and names the dialog (aria-labelledby); a popover without a title needs an aria-label from the caller.
 */
const TitleRegistry = React.createContext<((id: string | undefined) => void) | null>(null);

function PopoverContent({
    className,
    align = 'center',
    sideOffset = 4,
    'aria-labelledby': labelledBy,
    ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
    const [titleId, setTitleId] = React.useState<string>();
    return (
        <PopoverPrimitive.Portal>
            <TitleRegistry.Provider value={setTitleId}>
                <PopoverPrimitive.Content
                    data-slot="popover-content"
                    aria-labelledby={labelledBy ?? (props['aria-label'] ? undefined : titleId)}
                    align={align}
                    sideOffset={sideOffset}
                    className={cn(
                        'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
                        className
                    )}
                    {...props}
                />
            </TitleRegistry.Provider>
        </PopoverPrimitive.Portal>
    );
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
    return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
    return <div data-slot="popover-header" className={cn('flex flex-col gap-1 text-sm', className)} {...props} />;
}

function PopoverTitle({ className, id, ...props }: React.ComponentProps<'h2'>) {
    const generated = React.useId();
    const own = id ?? generated;
    const register = React.useContext(TitleRegistry);
    React.useLayoutEffect(() => {
        register?.(own);
        return () => register?.(undefined);
    }, [own, register]);
    return <div id={own} data-slot="popover-title" className={cn('font-medium', className)} {...props} />;
}

function PopoverDescription({ className, ...props }: React.ComponentProps<'p'>) {
    return <p data-slot="popover-description" className={cn('text-muted-foreground', className)} {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverHeader, PopoverTitle, PopoverDescription };
