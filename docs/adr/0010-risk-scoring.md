# ADR 0010: No-show risk scoring and confirm-or-release

- Status: accepted
- Date: 2026-10-20

## Context

Milestone 12 gives every booking a no-show risk score, shows it to the shop with plain-language reasons, and adds the right amount of friction to risky bookings (a "reply YES" text, confirm-or-release, standby suggestions). The rules from the `fullcut-noshow-ml` and `fullcut-messaging` skills apply: scoring never blocks or fails a booking, the owner controls every action, fairness caps apply, and nothing is released without a final warning sent outside quiet hours. Fullcut takes no client payments, so there are no deposits.

## Decision

- **Scoring service** (`services/ml`, FastAPI): `POST /score` takes the booking plus the client's raw booking history at that shop as `BookingRecord`s, and builds features itself with the same `features.py` used in training. Feature logic therefore lives in one place, and the service needs no database credentials. Calls need `Authorization: Bearer $ML_SHARED_SECRET`. The service returns a transparent heuristic (`method: "heuristic"`) unless `ML_MODEL_ENABLED=true` and the shop has enough labelled bookings. The Kaggle prototype is never served as a model.
- **When the app scores:** after a booking is created or moved (public page, dashboard, manage link), via Next's `after()` with a 300 ms timeout, so the response never waits. The tick's `runRiskBatch` also scores upcoming bookings that were never scored, and re-scores each booking once inside its last 48 hours (as of "now", so a YES counts). On a timeout or error the booking gets `risk_tier = 'unknown'` and no score. Without `ML_SERVICE_URL`/`ML_SHARED_SECRET` nothing is scored and the app behaves as before.
- **Storage:** new `bookings` columns are `risk_tier`, `risk_method`, `risk_factors` (jsonb array), `risk_scored_at`, `risk_trusted_at`/`_by` (owner override), `confirmation_status` (`not_required` / `requested` / `confirmed` / `unconfirmed` / `released`), `confirmation_due_at` and `release_reason`. The existing `risk_score` and `risk_model_version` columns are reused. Only the service role writes scores, through `apply_booking_risk`. The trigger `bookings_guard_risk` rejects any signed-in change to these columns, except marking a requested confirmation as confirmed (the client phoned). The same trigger resets a pending confirmation when a booking moves.
- **Plan in TypeScript, texts in the outbox:** `lib/risk/plan.ts` (pure) turns tier + shop settings + fairness into times:
  - confirmation request at start − 48 h (or now);
  - deadline at the earlier of start − `risk_confirm_deadline_hours` and start − the waitlist minimum notice;
  - final warning 3 h before the deadline, moved to 20:30 the evening before if it would land in quiet hours;
  - extra reminder at start − 3 h.

  If the warning can't come at least 2 h after the request, the booking gets a request only and can never be released. `apply_booking_risk` stores the score and queues those texts in `scheduled_messages`, replacing any earlier plan; texts already sent stay sent. `decideSend` skips confirmation texts once the client has confirmed, and never sends a final warning at or after its deadline (including deferrals).

- **Deadlines:** `process_confirmation_deadlines` (run by the tick before the waitlist step) releases a booking only if all of these hold:
  - the owner turned on auto-release;
  - actions are on;
  - a final warning was sent before the deadline;
  - nobody trusted the client;
  - the slot is still beyond the waitlist minimum notice.

  Otherwise it marks the booking `unconfirmed` (flagged, slot kept). A release is an ordinary cancel by the shop with `release_reason = 'unconfirmed'`, so the existing freed-slot trigger feeds the waitlist refill (ADR 0009), and the client gets a `released` notice instead of the plain cancellation text.

- **Confirmations:** an inbound YES, the manage page's "I'm coming" button (`/api/manage/confirm`), or staff ("Client confirmed") set `confirmed`.
- **Fairness:** the score never uses age, gender, location or health data. A client who was asked to confirm and showed up `risk_confirm_cap` times in a row is not asked for their next booking. The owner can trust a client per booking (`set_booking_trust`, owner only), which cancels queued confirmation texts. Every automated action is behind `risk_actions_enabled` (default off).
- **Standby:** for unconfirmed bookings and for tiers the owner chose, the drawer runs the waitlist matcher as a preview while the booking still holds its slot (`lib/waitlist/standby.ts`).
- **Retraining:** `python -m fullcut_ml.retrain` trains on a CSV from `sql/export_training_bookings.sql`, which excludes demo shops and holds no contact details. It excludes released bookings from the labels but counts them, and promotes a model only if it is not worse than the current one on the same time-based holdout. Every run goes to `artifacts/runs.jsonl`.

## Consequences

- A booking created while the service is down shows "Risk unknown" until the 48-hour re-score.
- Released bookings stay on the calendar (struck through, "Released") so the owner can see what happened.
- Demo bookings get realistic lead times and habitual no-showers (synthetic, never used for metrics); their scores appear once a scoring service is configured for the demo environment.
- The retrain export runs by hand with a read-only role; scheduling it weekly is left to the deployment.
