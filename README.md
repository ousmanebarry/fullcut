<div align="center">

# Fullcut

**Booking and scheduling for independent barbers and stylists who already have their own clients.**

Flat price. Zero commission. Your clients stay yours. And the app actively fills your chair.

![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-12-F69220?logo=pnpm&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)

</div>

---

## Why Fullcut

Square Appointments, Booksy, Fresha, Vagaro and StyleSeat charge established professionals new-client commissions, add-on fees and marketplace listings next to their competitors. Fullcut is the opposite:

- **No commission on clients, ever.** Fees are shown before they are charged.
- **The shop owns its data.** Full CSV export of clients, services and bookings, always.
- **Frictionless for clients.** No account, no app download, mobile-first, three steps or fewer.

### Differentiating features

| Feature                             | What it does                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| No-show prediction                  | Scores every booking; only risky ones get extra friction (confirmation text, deposit). |
| "Who's due" rebooking               | Learns each client's visit rhythm and nudges overdue clients with open slots.          |
| Honest source tracking              | Records where each booking came from (Instagram, referral, Google, returning client).  |
| Learned durations + gap-aware slots | Learns how long each stylist really takes and suggests times that avoid dead gaps.     |
| Zero double bookings                | Enforced by the database, not just the app.                                            |
| One-click migration                 | Imports clients, services and history from competitor exports.                         |
| Branded booking page                | The shop controls it. No marketplace, no competitor listings.                          |

> **Status:** early scaffold. The web app toolchain (Next.js, Tailwind, shadcn/ui, tests, CI) is in place. Supabase, the ML service, Stripe and Twilio are planned and not built yet.

## Tech stack

| Layer    | Choice                                             | Status  |
| -------- | -------------------------------------------------- | ------- |
| Web app  | Next.js (App Router), TypeScript, Tailwind, shadcn | Present |
| Tests    | Vitest (unit), Playwright (e2e)                    | Present |
| Database | Supabase (Postgres, Auth, row-level security)      | Planned |
| Payments | Stripe Connect                                     | Planned |
| SMS      | Twilio                                             | Planned |
| ML       | Python, FastAPI, scikit-learn / LightGBM           | Planned |
| Hosting  | Vercel (web), Railway or Fly.io (ML)               | Planned |

## Getting started

**Requirements:** Node 24 (see `.nvmrc`) and pnpm 12 (pinned in `package.json`; `corepack enable` will pick it up).

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>.

Environment variables are not needed to run the current scaffold. When integrations land, copy `.env.example` to `apps/web/.env.local` and fill it in. Never commit real values.

## Commands

Run everything from the repository root.

| Command             | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `pnpm dev`          | Run the web app locally                     |
| `pnpm lint`         | ESLint (warnings fail)                      |
| `pnpm typecheck`    | `next typegen` then `tsc --noEmit`          |
| `pnpm test`         | Vitest unit tests                           |
| `pnpm test:e2e`     | Playwright e2e on desktop and mobile Chrome |
| `pnpm format`       | Format the repo with Prettier               |
| `pnpm format:check` | Check formatting without writing            |

One-time setup for e2e: `pnpm --filter web exec playwright install chromium`.

Add a shadcn/ui component: `pnpm --filter web exec shadcn add <component>`.

## Project layout

```
fullcut/
├── apps/
│   └── web/            Next.js app: booking pages and shop dashboard
│       ├── app/        routes and layouts
│       ├── components/ UI (shadcn/ui in components/ui)
│       ├── lib/        domain logic as plain, testable functions
│       └── tests/      unit/ (Vitest) and e2e/ (Playwright)
├── docs/adr/           architecture decision records
└── .github/            CI workflow, AGENTS.md and agent skills
```

`supabase/` and `services/ml/` will be added when those parts are built.

## Quality gates

| Where      | What runs                                                               |
| ---------- | ----------------------------------------------------------------------- |
| Editor     | ESLint fix on save; recommended extensions in `.vscode/extensions.json` |
| Pre-commit | Husky + lint-staged: ESLint and Prettier on staged files                |
| CI (PRs)   | Format check, lint, typecheck, unit tests, production build             |

### VS Code status bar buttons

Install the recommended extensions when prompted. The Action Buttons extension adds coloured Dev, Lint, Types, Test and E2E buttons to the status bar. Add more in `.vscode/settings.json` under `actionButtons.commands`, ideally pointing at a `pnpm` script.

## Contributing

- Branch from `main` and open a pull request; CI must pass.
- Follow the product principles and critical invariants in [.github/AGENTS.md](.github/AGENTS.md). That file is also the guide for AI coding agents working in this repo.
- Record significant architecture decisions in [docs/adr](docs/adr).
