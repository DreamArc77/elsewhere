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

Add the minimum config under `plugins.entries.elsewhere.config`:

```json
{
  "plugins": {
    "entries": {
      "elsewhere": {
        "config": {
          "geminiApiKey": "YOUR_GEMINI_API_KEY"
        }
      }
    }
  }
}
```

Then activate it in chat:

```text
/elsewhere activate
```

If you prefer OpenRouter, set `openrouterApiKey` instead. The first activation will guide you through locale, persona, and model setup.

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

## Quick Start

1. Run `/elsewhere activate`.
2. Follow the setup prompts to choose language and create your companion.
3. Send `/elsewhere start --to Tokyo` to start a trip.
4. Use `/elsewhere status` or `/elsewhere tick` while testing.

## Release Flow

1. Update code, docs, and `CHANGELOG.md`.
2. Bump the version in `package.json`.
3. Run `npm run release:check`.
4. Create the matching Git tag `vX.Y.Z`.
5. Run `npm run release:publish:dry-run`.
6. Run `npm run release:publish`.

The publish scripts use ClawHub as the primary registry and npm as the companion distribution channel.
