# Production Planner — Product FAQ

Paste-ready answers for the Gumroad product page.

## What exactly do I get?

Source code access to the Production Planner repository, the `README.md` setup guide, a `.env.example` configuration template, the database schema and seed script, and a license agreement for the tier you buy.

The repository is public so you can inspect it before paying. Your payment buys the **legal permission** to use or own it under the selected license, not access to a hidden file.

## What do I need to run it?

- Node.js 20 or newer
- npm
- A Gemini API key if you want the assistant features

It runs locally with SQLite. No cloud database or hosted service is required for the core app.

## How does the AI assistant work?

The assistant proposes calendar operations and shows a preview before anything is saved. Destructive actions require confirmation and support undo. You can paste your own Gemini key in **Settings → Gemini API key**; it is encrypted and never sent back to the browser.

You must set `GEMINI_KEY_ENCRYPTION_SECRET` (at least 32 characters) in `.env.local` before saving a personal key. See `.env.example` and the README.

## Is my data private?

Yes. The app is local-first: client data, projects, and API keys stay in your own SQLite database and environment. Shared Views create links to calendar schedules only, without exposing internal project data.

## Can I use it for client work?

Yes, with the **Commercial License ($99)**. It allows use in client projects, self-hosting for your business, and white-labeling within client deliverables. The **Personal Studio License ($39)** is for one studio's internal use only.

## Can I rebrand or resell it?

Rebranding for your own business or as part of a client deliverable is allowed under the Commercial License. Reselling the source code as a competing product requires the **Full Ownership Transfer ($699)**, which is sold to one buyer only.

## Do you offer installation help?

Yes. The **Setup add-on ($149)** covers installation, environment setup, admin seeding, and basic customization. General questions can be emailed to `contact@raficfekihstudio.com`.

## Can I get a refund?

Refund terms depend on the tier:

- **Personal Studio ($39)** and **Commercial ($99)** — 30-day money back guarantee.
- **Setup add-on ($149)** — refundable before work begins. No refunds after work begins.
- **Full Ownership ($699)** — one buyer only. No refunds after transfer.

If you have trouble installing it, email `contact@raficfekihstudio.com` and I'll help you get it running.

## Do I need a Gemini key?

Only for the AI assistant, voice input, and voice replies. The timeline, projects, clients, work types, and Shared Views work without it.

## Which license should I buy?

- **Personal Studio ($39)** — one person or one studio, internal use.
- **Commercial ($99)** — agencies or freelancers using it in client work, with white-label rights.
- **Setup add-on ($149)** — you want hands-on installation and configuration help.
- **Full Ownership ($699)** — you want to own the code, rebrand, resell, or keep it private. One buyer only.

## Where do I get help?

Email `contact@raficfekihstudio.com`.
