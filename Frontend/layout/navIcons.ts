import type { LucideIcon } from 'lucide-react';
import { ArrowUpDown, Check, Circle, Clock, Code, File, FileImage, Flag, Folder, Hash, House, Landmark, Pencil, Save, Send, Settings, SlidersHorizontal, SquareCheck, TriangleAlert, User, Warehouse, X, Zap } from 'lucide-react';

/**
 * Menu icons by lucide name (the module registry's `NavItem.icon`, e.g. "save"). Only the icons the menu uses are bundled; add a
 * name here when a module uses a new one.
 */
const ICONS: Record<string, LucideIcon> = {
    'arrow-up-down': ArrowUpDown,
    check: Check,
    clock: Clock,
    code: Code,
    file: File,
    'file-image': FileImage,
    flag: Flag,
    folder: Folder,
    hash: Hash,
    house: House,
    landmark: Landmark,
    pencil: Pencil,
    save: Save,
    send: Send,
    settings: Settings,
    'sliders-horizontal': SlidersHorizontal,
    'square-check': SquareCheck,
    'triangle-alert': TriangleAlert,
    user: User,
    warehouse: Warehouse,
    x: X,
    zap: Zap
};


export function navIcon(name?: string | null): LucideIcon {
    return (name && ICONS[name]) || Circle;
}
