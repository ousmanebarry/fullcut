# Fullcut milestones

Each file in this folder is a self-contained spec an agent can plan and implement in one or a few sessions. Work through them in order unless the dependency column says otherwise.

| # | Milestone | Depends on | Main skills |
|---|---|---|---|
| 01 | Scaffold (done) | — | — |
| 02 | [Database foundation](02-database.md) | 01 | data-and-tenancy |
| 03 | [Booking engine (pure logic)](03-booking-engine.md) | 02 | booking-engine |
| 04 | [Auth and shop setup](04-auth-and-shop-setup.md) | 02, 03 | data-and-tenancy |
| 05 | [Public booking page](05-public-booking-page.md) | 03, 04 | booking-engine |
| 06 | [Dashboard: calendar and bookings](06-dashboard-calendar.md) | 04, 05 | booking-engine |
| 07 | [Clients and data export](07-clients-and-export.md) | 06 | data-and-tenancy |
| 08 | [Deploy, PWA and CI/CD](08-deploy-and-pwa.md) | 07 | data-and-tenancy |
| 09 | [Background jobs and SMS](09-messaging-and-jobs.md) | 05, 06 | payments-and-messaging |
| 10 | [Payments: deposits](10-payments-deposits.md) | 05, 09 | payments-and-messaging |
| 11 | [No-show model prototype](11-ml-prototype.md) | — (parallel) | noshow-ml |
| 12 | [Risk scoring in the app](12-risk-scoring-in-app.md) | 06, 09, 10, 11 | noshow-ml |
| 13 | [Who's due, sources, analytics](13-whos-due-and-sources.md) | 07, 09, 12 | noshow-ml, payments-and-messaging |
| 14 | [Import from other platforms](14-import.md) | 07, 13 | client-import |
| 15 | [Learned durations and smart slots](15-durations-and-smart-slots.md) | 06, 12 | booking-engine, noshow-ml |
| 16 | [Portfolio polish and launch](16-portfolio-polish.md) | 12+ | all |

**Minimum impressive version:** 02 → 08, then 09, 11, 12. That's a deployed, working booking product with a measured ML feature. 10 and 13–15 make it stronger; 16 makes it presentable.

## How to run a milestone with an agent

1. Start a **fresh session** per milestone.
2. Use the "Agent prompt" at the bottom of the milestone file. Every prompt asks for a plan first — read it, push back, then approve.
3. For big milestones (06, 09, 10, 12, 13), approve one phase at a time.
4. Do the "Manual steps for the human" yourself (accounts, keys, datasets). Never paste secrets into the chat.
5. Before committing: read the diff, run the checks, try the feature yourself.
6. When the agent repeats a mistake, add a rule to `.github/AGENTS.md` or the relevant skill.

## Generic prompt (if a milestone file doesn't have one)
```
Read .github/AGENTS.md and .github/milestones/<NN-name>.md, then every skill
it lists. Restate the goal and the invariants it touches, then give me a plan
(files, migrations, routes, tests). Wait for my OK. Implement in small commits,
run lint/typecheck/tests, and report results and anything left undone.
```

## Updating these files
Specs are a starting point, not a contract. When a decision changes (an ADR, a new library, a cut feature), update the affected milestone files in the same change so future sessions don't follow stale instructions.
