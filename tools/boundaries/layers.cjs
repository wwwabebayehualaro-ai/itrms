// The layer facts the boundary rules are built from (docs/platform/code-structure.md §3). Shared by
// .dependency-cruiser.cjs and tools/check-slices.mjs, so a platform slice outside the order is refused.

/** The platform order: a platform slice may import only the slices before it. */
const PLATFORM_ORDER = ['kernel', 'integrations', 'forms', 'fees', 'documents', 'workflow', 'services', 'reports'];

/** Registries sit below the work processes; every other module is a work process. */
const REGISTRIES = ['parties', 'vehicles', 'drivers', 'associations', 'road-assets'];

module.exports = { PLATFORM_ORDER, REGISTRIES };
