# elsewhere

elsewhere is an OpenClaw companion plugin that creates a personal travel companion with guided onboarding, proactive travel postcards, delayed replies, and image generation.

## Install From GitHub Marketplace

Requirements:

- OpenClaw `2026.3.28` or newer
- Node.js `22` or newer

Install the plugin:

```bash
openclaw plugins install elsewhere --marketplace DreamArc77/elsewhere#codex/openclaw-travel-companion
openclaw gateway restart
```

Then activate it in your chat:

```text
/elsewhere activate
```

## Manual Install Fallback

If marketplace install is unavailable in your OpenClaw build, install from source:

```bash
git clone https://github.com/DreamArc77/elsewhere.git
cd elsewhere
git checkout codex/openclaw-travel-companion
npm install
npm run build
openclaw plugins install . --link
openclaw gateway restart
```

Then run:

```text
/elsewhere activate
```
