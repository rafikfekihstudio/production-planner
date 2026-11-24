# Production Planner

A local-first freelancer production dashboard built with Next.js, React, TypeScript, Drizzle, SQLite, and NextAuth. It combines a day/week timeline, a Gemini-powered scheduling assistant, voice input/output, Shared Views, and personal/work projects.

## Features

- **Timeline** — day and week views from 07:00–23:00, with task creation, drag-to-move, edge resize, multi-select, group moves, and duration labels.
- **Assistant** — proposes calendar operations with a preview; destructive actions require confirmation and support undo. It never claims a change is saved before the server writes it.
- **Voice** — fast browser speech recognition by default, with optional natural Gemini text-to-speech replies.
- **Shared Views** — hourly and whole-day share links with multi-select and drag behavior, without exposing internal project data.
- **Projects** — client work and personal projects with stages from Idea to Archived.
- **Per-user Gemini keys** — optional encrypted personal keys, with an optional shared `GEMINI_API_KEY` fallback.
- **Configurable studio name** — set your own name under **Settings → Studio name**; no personal branding is hardcoded.

## Requirements

- Node.js 20+
- npm

## Local setup

```bash
npm install
cp .env.example .env.local
```

Generate an auth secret and put it in `.env.local`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set `AUTH_SECRET` to that value. Set a strong `SEED_ADMIN_PASSWORD` (at least 12 characters), then initialize the database and seed the first admin:

```bash
npx drizzle-kit push
npx tsx scripts/seed.ts
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` you configured. The login page does not display demo credentials. The studio name defaults to **Production Planner**; change it later under **Settings → Studio name**, or preseed it with `SEED_BUSINESS_NAME`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_SECRET` | Yes | NextAuth sessions and assistant undo signatures |
| `SEED_ADMIN_EMAIL` | No | Admin email for `scripts/seed.ts`; defaults to `admin@example.com` |
| `SEED_ADMIN_NAME` | No | Admin display name for `scripts/seed.ts`; defaults to `Studio Admin` |
| `SEED_ADMIN_PASSWORD` | For seeding | Admin password; at least 12 characters |
| `SEED_BUSINESS_NAME` | No | Studio name for a new install; defaults to `Production Planner` and is editable in Settings |
| `GEMINI_API_KEY` | No | Optional shared Gemini fallback for local development or a private deployment |
| `GEMINI_KEY_ENCRYPTION_SECRET` | For personal keys | AES-256-GCM secret for encrypted per-user keys; at least 32 characters |

Generate the encryption secret the same way as `AUTH_SECRET`. Changing `GEMINI_KEY_ENCRYPTION_SECRET` later makes previously saved personal keys unreadable, so users would need to enter them again.

`.env*` and `/data/` are ignored by git. Never commit `.env.local`, API keys, or the local SQLite database.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run lint    # ESLint
```

Database and seed commands:

```bash
npx drizzle-kit push
npx tsx scripts/seed.ts
```

## Security notes

- Authentication uses NextAuth credentials with bcrypt password hashes.
- AI credentials are read only on the server. Personal keys are encrypted at rest and are never returned to the browser.
- The assistant proposes changes, shows a preview, confirms destructive actions, and supports undo; it does not auto-apply plans.
- Shared Views use their own access model and do not expose stored API keys.

## Deployment

This app uses a local SQLite file under `data/`. For a hosted deployment, provide persistent storage for that file and set all server-side environment variables in the host. If you deploy with personal Gemini keys enabled, set `GEMINI_KEY_ENCRYPTION_SECRET` before users save keys.

## License

All rights reserved. See [LICENSE](./LICENSE). Commercial licensing or transfer of ownership may be available by separate agreement; contact `contact@raficfekih.online`.
