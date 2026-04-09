---
name: openclaw-travel-companion
description: Run a travel-frog-style OpenClaw companion that binds to the current conversation, stores a persona with one reference photo, plans a realistic 3-5 day single-city trip, and proactively sends grounded image-plus-caption postcards back into that bound chat. Use this skill when you want to set up or operate the OpenClaw travel companion plugin.
user-invocable: true
---

# OpenClaw Travel Companion

## Overview

This skill is bundled inside the `openclaw-travel-companion` plugin. It gives the current chat a traveling soulmate who can bind to this conversation, remember a configured persona, generate a grounded 3-5 day trip, and proactively send postcards back here while the background worker advances the itinerary.

## Use It

Use the plugin command directly:

1. `/travel-companion bind`
2. `/travel-companion setup --name 森 --traits 温柔,好奇 --relationship 灵魂伴侣 --tone 轻柔 --image /absolute/path/to/ref.png`
3. `/travel-companion start --to 东京`
4. `/travel-companion status`

Optional:

- `/travel-companion start --to 纽约 --from 东京 --when 下周`
- `/travel-companion tick` for a manual advancement test
- `/travel-companion status --trip <tripId>` to inspect a specific run

## MVP Constraints

- The current conversation must be bound first.
- The reference image must be a local absolute path the gateway can read.
- The destination is user-chosen.
- The trip is single-city only.
- Real-time chat replies are out of scope.

## Runtime Notes

- The plugin requires a Gemini API key in plugin config or `GEMINI_API_KEY`.
- The background service polls due trips and uses `openclaw message send` to deliver outbound postcards.
- JSON state, artifacts, and logs are stored under the plugin state directory.

## Validation

- Read `docs/test-driven-design.md` before changing behavior.
- Keep `npm test` fully offline.
- Treat `tests/live.gemini.smoke.test.ts` as an optional live smoke check.
