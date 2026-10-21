# @itrms/module-sdk

The module manifest (modularization.md §4): `defineModule` (the Zod schema plus the checks one manifest can do on its own:
naming, keys the module owns, duplicates), `permissionsOf` and the `InstalledSlice` shape. The checks across manifests
(dependencies, unique permission resources, roles, effects, event schemas) run at the API's startup:
`loadSlices` in `@itrms/kernel/api`. Isomorphic: no framework imports.

Rules: [code-structure.md](../../docs/platform/code-structure.md) §3 and §7.
