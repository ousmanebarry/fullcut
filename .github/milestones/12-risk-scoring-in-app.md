# Milestone 12 — Risk scoring in the app

**Goal:** every new booking gets a no-show risk score; the shop sees it with plain-language reasons; risky bookings automatically get the right amount of friction (confirmation text, deposit, standby offer); and the owner stays in control.

**Depends on:** 06, 09, 10, 11
**Skills to read:** `fullcut-noshow-ml`, `fullcut-payments-and-messaging`, `fullcut-booking-engine`

## In scope

- FastAPI scoring service (deployed), heuristic fallback
- App integration, tiers, automated actions, owner controls
- Waitlist / standby basics
- Retraining script and model promotion rule
- Demo data that makes the feature visible

## Out of scope

- Who's due and analytics (13)

## Tasks

### 12.1 Scoring service

- `POST /score`, `GET /health` per the skill's contract; pydantic models; shared `features.py`.
- Auth via shared secret header; reject otherwise.
- Loads the current model artifact at startup; if none or shop has too little history → transparent heuristic (`method: "heuristic"`).
- Returns `top_factors` in plain language (from feature contributions, e.g. SHAP values or simple rules over the top features).
- Dockerfile; deploy to Railway or Fly.io; health check.

### 12.2 Feature data from Fullcut

- The web app (or the service with a read-only DB role) builds the `BookingRecord` history for the client from Fullcut tables and sends features to `/score`. Prefer one place for this logic; document the choice.

### 12.3 Integration

- After booking creation (public, phone, walk-in): call `/score` with ~300 ms timeout. On failure: `risk_score = null`, `tier = unknown`, booking unaffected.
- Store `risk_score`, `risk_tier`, `risk_method`, `risk_model_version`, `risk_factors` (jsonb) on the booking (migration).
- Re-score 48 h before the appointment (job) so reply/confirmation signals count.

### 12.4 Tiers and actions (shop-configurable)

- Settings: tier thresholds (defaults from the skill), and per tier: send confirm request (09 `confirm_request`), require deposit (10, new `high_risk` deposit mode), offer standby.
- Deposit for high risk must be decided **before** checkout, so score synchronously during booking creation when deposits-by-risk is on; if scoring fails, fall back to the shop's normal deposit rule.
- Fairness caps from the skill: no repeated risk-based deposits for clients who keep showing up; owner override per booking ("trust this client").

### 12.5 Waitlist and standby

- `waitlist_entries` table: client, shop, preferred staff/service, preferred days/times, created_at, status.
- Public booking page: "Join the waitlist" when no slots fit.
- When a high-risk booking exists, the dashboard suggests standby candidates; when a booking is cancelled or marked no-show early, matching waitlist clients can be texted an offer (first to accept gets it; uses the normal booking flow so the overlap constraint still protects it).

### 12.6 Dashboard UI

- Risk badge on calendar blocks and booking drawer (low/medium/high/unknown), with the top factors on tap.
- Override control and "why am I seeing this" explanation.
- Settings page for thresholds and actions with plain-language previews ("High-risk bookings (about 1 in 10) will be asked for a $10 deposit").

### 12.7 Retraining

- Script: export labelled bookings (completed/no_show) → train → evaluate on a time-based holdout → promote only if not worse than current (skill rule) → save artifact + metrics.
- Run manually or weekly via job; log every run.

### 12.8 Demo data

- Synthetic generator that creates months of realistic bookings for the demo shop with learnable patterns (some habitual no-showers, long lead times riskier), so the demo shows meaningful scores. Never report metrics from synthetic data.

## Tests

- Service: auth, response shape, heuristic fallback, bad input.
- Integration: timeout path doesn't block booking; deposit-by-risk decision happens before checkout; override respected; fairness cap works.
- Waitlist offer: two clients accepting the same slot → only one gets it.

## Acceptance criteria

- On the demo shop, high-risk bookings are visibly flagged with sensible reasons.
- Turning off every automated action makes the app behave exactly like before this milestone.

## Agent prompt

```
Read .github/AGENTS.md, .github/milestones/12-risk-scoring-in-app.md and the
skills it lists. Plan in phases: (1) service + deploy, (2) integration +
storage, (3) tiers/actions + settings, (4) waitlist, (5) retraining + demo
data. Wait for my OK on the plan, then do one phase at a time, stopping after
each phase for review.
```
