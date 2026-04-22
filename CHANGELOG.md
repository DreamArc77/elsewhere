# Changelog

All notable changes to `elsewhere` should be recorded here.

## [1.0.0] - 2026-04-22

### Added

- Added a formal release checklist and publish scripts for ClawHub and npm.
- Added upgrade tests for legacy runtime-state migration and legacy config fallback.

### Changed

- Renamed the public package to `@dreamarc/elsewhere`.
- Renamed the plugin id to `elsewhere`.
- Standardized install and update guidance around `openclaw plugins install` and `openclaw plugins update`.

### Migration

- Existing runtime state is migrated to the `elsewhere` state directory on startup.
- Existing plugin config is merged into the new `plugins.entries.elsewhere.config` entry during upgrades.
