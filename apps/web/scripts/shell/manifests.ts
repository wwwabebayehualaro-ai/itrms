// The installed slices whose manifests declare menu items: the same list as apps/api/src/slices.ts (a slice without
// menu items needn't be here). The icon map is generated from it (menu-icons.ts).
import competency from '@itrms/competency/manifest';
import parties from '@itrms/parties/manifest';
import kernel from '@itrms/kernel/manifest';

export const MENU_MANIFESTS = [kernel, parties, competency];
