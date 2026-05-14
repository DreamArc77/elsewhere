# Elsewhere SaaS MVP

This app is the centralized Telegram MVP for Elsewhere. It keeps the existing
OpenClaw plugin untouched and adds a hosted Web + Telegram runtime under
`apps/saas`.

## Flow

1. User signs in with Telegram Login.
2. User creates a companion persona on the Web form.
3. Web shows a Telegram Managed Bot creation link/QR.
4. The manager bot webhook receives the managed bot update.
5. The server fetches the child bot token, sets the bot profile, registers the
   child webhook, and shows the final `t.me/<bot>?start=...` link.
6. The child bot `/start` binds the chat and normal text messages enter the
   existing Elsewhere conversation/travel runtime.

## Required Environment

```bash
SAAS_PUBLIC_BASE_URL=https://your-domain.example
SAAS_COOKIE_SECRET=replace-with-a-long-random-string
SAAS_ENCRYPTION_KEY=base64-or-utf8-32-byte-key
TELEGRAM_MANAGER_BOT_TOKEN=123:abc
TELEGRAM_MANAGER_BOT_USERNAME=YourManagerBot
TELEGRAM_MANAGER_WEBHOOK_SECRET=replace-with-webhook-secret
GEMINI_API_KEY=...
```

Then set the manager bot webhook:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_MANAGER_BOT_TOKEN/setWebhook" \
  -H 'content-type: application/json' \
  -d '{"url":"https://your-domain.example/telegram/manager/replace-with-webhook-secret","allowed_updates":["message","managed_bot"],"drop_pending_updates":true}'
```

## Development Storage

The MVP uses JSON files under `.saas-data` by default. The store and runtime
boundaries are isolated so they can be replaced by PostgreSQL and Redis-backed
implementations without changing Telegram or Web handlers.

