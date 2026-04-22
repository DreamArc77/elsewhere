# elsewhere

elsewhere is an OpenClaw companion plugin for guided onboarding, proactive travel postcards, delayed replies, and grounded trip updates.

## Requirements

- OpenClaw `2026.3.28` or newer
- Node.js `22` or newer

## Install

```bash
openclaw plugins install @dreamarc/elsewhere
openclaw gateway restart
```

Configure the plugin under `plugins.entries.elsewhere.config`, then activate it in chat:

```text
/elsewhere activate
```

## Update

```bash
openclaw plugins update elsewhere
openclaw gateway restart
```

You can also update everything at once with `openclaw plugins update --all`.

## Upgrade Notes

- Existing runtime state is migrated into the `elsewhere` state directory on startup.
- Existing plugin config is merged into `plugins.entries.elsewhere.config` during upgrades.
- GitHub branch installs and old marketplace-spec installs are no longer the recommended update path.

## Release Flow

1. Update code, docs, and `CHANGELOG.md`.
2. Bump the version in `package.json`.
3. Run `npm run release:check`.
4. Create the matching Git tag `vX.Y.Z`.
5. Run `npm run release:publish:dry-run`.
6. Run `npm run release:publish`.

The publish scripts use ClawHub as the primary registry and npm as the companion distribution channel.
