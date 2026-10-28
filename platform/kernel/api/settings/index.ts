/**
 * @itrms/kernel/settings: the settings registry and the one resolver (ADR-0026, architecture.md §7). Slices read a
 * setting's value for a unit through SettingsService; the service configuration (task 0.21b) builds its own chains for
 * the same resolver.
 */
export { SettingsService, SENSITIVE_STEP_UP, type UnitSetting, type UnitSettings, type Who } from './settings';
export {
    allowedAt,
    buildSettingsRegistry,
    settingLabelKey,
    type SettingEntry,
    type SettingsRegistry
} from './registry';
export {
    resolve,
    resolveAll,
    sameSource,
    unitChain,
    without,
    type ChainInput,
    type ChainUnit,
    type Layer,
    type Resolved,
    type ResolveRules,
    type Source,
    type SourceLevel
} from './resolve';
export { settingsValues } from './settings.table';
