# Milestone 16 — Portfolio polish and launch

**Goal:** turn Fullcut into something a recruiter understands in 60 seconds and an engineer respects in 10 minutes: a landing page, a clickable demo, a strong README, a short case study, and a final quality pass.

**Depends on:** everything you intend to ship (can start after 12)
**Skills to read:** all (for the README's accuracy)

## Tasks

### 16.1 Landing page (`/`)

- Headline built on the pitch (flat price, zero commission, your clients stay yours, fills your chair).
- Three feature sections with real screenshots: no-show prediction, who's due, zero-commission booking page.
- Honest pricing section (from your chosen plan), "Try the demo" button, sign-up.
- Fast and accessible (Lighthouse ≥ 90 across the board).

### 16.2 Demo experience

- Demo shop with rich synthetic data (from 12.8), one-click "Explore as owner" login that's read-only or resets nightly.
- A short guided tour (3–4 tooltips) highlighting risk badges, due list and insights.

### 16.3 README (repo root)

- One-paragraph pitch, live demo link, 30–60 s GIF.
- Architecture diagram and stack table; why each choice.
- Engineering highlights with links to code: overlap exclusion constraint + concurrency test, RLS tenant isolation + tests, DST-safe scheduling, idempotent webhooks, outbox worker, ML pipeline with time-based evaluation and fairness choices.
- ML results table (from 11/12, real data only) and link to the report.
- Local setup in ≤ 10 commands.

### 16.4 Case study (`docs/case-study.md`)

- Problem (with the competitor pain points), users, what you built, hardest problems and how you solved them, results, what you'd do next. This is your interview script.

### 16.5 Quality pass

- Security: review every RLS policy, run Supabase advisors, check rate limits on public endpoints, dependency audit.
- Accessibility audit of booking page and dashboard (axe + manual keyboard pass).
- Performance: slow-query check on calendar and insights with large synthetic data.
- Error states and empty states reviewed on every page.
- Remove dead code, TODOs resolved or ticketed.

### 16.6 Real users (strongly recommended)

- Pilot with 1–3 barbers or stylists. Track: bookings made through Fullcut, no-shows flagged vs actual, nudges → rebookings.
- Collect one quote you can use (with permission).

### 16.7 Resume bullets

- Write 3–4 bullets with real numbers (e.g. model PR AUC vs baseline, % of no-shows caught in top 20%, test counts, pilot usage).

## Acceptance criteria

- A stranger can understand, try and evaluate Fullcut without talking to you.
- Every claim in the README is backed by code, tests or measured numbers.

## Agent prompt

```
Read .github/AGENTS.md and .github/milestones/16-portfolio-polish.md. Audit
the repo and list what's missing for each section of this milestone. Wait for
my OK on priorities, then work through them one section at a time. Never
invent metrics: use only numbers produced by our code or that I provide.
```
