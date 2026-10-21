# Milestone 12 — Risk scoring in the app

**Goal:** every new booking gets a no-show risk score; the shop sees it with plain-language reasons; risky bookings automatically get the right amount of friction (confirmation request, confirm-or-release, standby suggestions); and the owner stays in control.

**Depends on:** 06, 09, 10, 11
**Skills to read:** `fullcut-noshow-ml`, `fullcut-messaging`, `fullcut-booking-engine`

## In scope

- FastAPI scoring service (deployed), heuristic fallback
- App integration, tiers, automated actions, owner controls
- Confirm-or-release for risky bookings, feeding released slots into the waitlist refill (10)
- Retraining script and model promotion rule
- Demo data that makes the feature visible

## Out of scope

- Who's due and analytics (13)
- Deposits, cards on file or any payment collection (Fullcut doesn't take client payments)

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

- Settings: tier thresholds (defaults from the skill), and per tier: send confirm request (09 `confirm_request`), require confirmation (confirm-or-release, 12.5), extra reminder 2–3 h before, suggest standby.
- No action needs the score before the booking exists, so scoring stays after insert and never delays the client.
- Fairness caps from the skill: a client who keeps showing up can't be required to confirm by risk alone more than N times in a row; owner override per booking ("trust this client").

### 12.5 Confirm-or-release and standby

- Migration: `bookings.confirmation_status` (`not_required` / `requested` / `confirmed` / `released`) and `confirmation_due_at`. Booking `status` and `transitionBooking` don't change: a release is a normal cancel with `cancelled_by = 'shop'` and a `release_reason`.
- Timeline for a booking whose tier requires confirmation: `confirm_request` at start − 48 h (or right after booking if later) → final warning naming the deadline ("Reply YES by 7:00 PM or we'll offer your spot to someone else") → deadline at start − 24 h by default, and never later than start − the waitlist minimum notice (10).
- YES (09 inbound) or an "I'm coming" button on the manage page sets `confirmed`. Cancelling via the manage link stays a normal cancel.
- At the deadline, still unconfirmed:
  - default: "Unconfirmed" flag on the calendar plus standby suggestions from the waitlist matcher (10); the owner decides.
  - auto-release (owner opt-in): cancel the booking, text a release notice, and let the 10 refill job offer the slot.
- Never release without the final warning having been sent outside quiet hours. Bookings made too late for the full timeline get a confirm request only, never a release.
- Released bookings are neither shows nor no-shows: exclude them from training labels and log them (see 12.7).
- When a booking is marked no-show early, the remaining time is not offered (too late to refill); only cancellations and releases feed 10.

### 12.6 Dashboard UI

- Risk badge on calendar blocks and booking drawer (low/medium/high/unknown), with the top factors on tap.
- Override control and "why am I seeing this" explanation.
- "Unconfirmed" and "Released" states on calendar blocks, with the confirmation timeline in the drawer.
- Settings page for thresholds and actions with plain-language previews ("High-risk bookings (about 1 in 10) will be asked to reply YES by 24 h before; unconfirmed ones are flagged for you").

### 12.7 Retraining

- Script: export labelled bookings (completed/no_show) → train → evaluate on a time-based holdout → promote only if not worse than current (skill rule) → save artifact + metrics.
- Report how many high-risk bookings were released (they have no label) so the selection effect on later training data is visible.
- Run manually or weekly via job; log every run.

### 12.8 Demo data

- Synthetic generator that creates months of realistic bookings for the demo shop with learnable patterns (some habitual no-showers, long lead times riskier), so the demo shows meaningful scores. Never report metrics from synthetic data.

## Tests

- Service: auth, response shape, heuristic fallback, bad input.
- Integration: timeout path doesn't block booking; override respected; fairness cap works.
- Confirm-or-release: YES before the deadline prevents release; auto-release off → flag only; quiet hours never push the final warning past the deadline; late bookings are never released; a release queues the 10 refill job.

## Acceptance criteria

- On the demo shop, high-risk bookings are visibly flagged with sensible reasons.
- Turning off every automated action makes the app behave exactly like before this milestone.

## Agent prompt

```
Read .github/AGENTS.md, .github/milestones/12-risk-scoring-in-app.md and the
skills it lists. Plan in phases: (1) service + deploy, (2) integration +
storage, (3) tiers/actions + settings, (4) confirm-or-release + standby, (5) retraining + demo
data. Wait for my OK on the plan, then do one phase at a time, stopping after
each phase for review.
```
