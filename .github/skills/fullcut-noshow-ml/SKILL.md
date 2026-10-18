---
name: fullcut-noshow-ml
description: Use when working on Fullcut's machine learning — the no-show risk model, features, training and evaluation, the FastAPI scoring service, risk tiers, the "who's due" rebooking engine, learned service durations, or fairness rules for automated actions.
---

# Fullcut: no-show prediction and smart features

The ML features are Fullcut's main differentiator and the core of its portfolio story. They must be **measured**, **fair**, and **advisory**: the model suggests, the owner decides, and a model failure never blocks a booking.

Code lives in `services/ml/` (Python, FastAPI, scikit-learn / LightGBM, pydantic, pytest, ruff).

```
services/ml/
├── fullcut_ml/
│   ├── features.py      # shared feature building (training AND serving use this)
│   ├── train.py         # training + evaluation, writes a versioned model artifact
│   ├── evaluate.py      # metrics, calibration, slice reports
│   ├── serve.py         # FastAPI app
│   ├── due.py           # "who's due" logic
│   └── durations.py     # learned service durations
├── notebooks/           # exploration only; nothing production imports from here
└── tests/
```

## 1. No-show risk model

### Label
`no_show = 1` if a booking's final status is `no_show`; `0` if `completed`. Exclude `cancelled` bookings from the label set (model late cancellations separately later if needed).

### Features (computed as of booking/scoring time)
- Lead time (hours between booking creation and appointment)
- Client history: prior bookings, prior no-shows, prior late cancellations, no-show rate with smoothing (e.g. Bayesian average toward the shop's base rate), days since last visit
- First visit vs. returning
- Day of week, local hour, near a holiday
- Booking source (link, referral, returning, import)
- Service price and duration
- Whether the client replied to a confirmation request (for re-scoring closer to the appointment)
- Optionally weather forecast for the appointment time

**No leakage:** every feature must use only information available at the moment of scoring. Client history counts only bookings that finished *before* the booking being scored. Write a test that builds features for a booking and asserts no later data was used.

### Fairness rules (do not relax without asking the human)
- Do **not** use: postal code, neighbourhood, distance from the shop, name, age, gender, or anything that is a proxy for them.
- Cap friction: a client cannot be asked for a deposit by risk alone more than a configurable number of times in a row if they keep showing up; good behaviour must lower their score quickly.
- The owner can override any tier per booking and disable automated actions entirely.
- Every score returns plain-language top factors ("3 no-shows in the last 6 visits", "booked 5 weeks ahead") so the owner understands it.

### Training data
- **Prototype** the pipeline on the public Kaggle "Medical Appointment No Shows" dataset to develop features, evaluation and the serving contract. It is clinic data, not salon data; do not ship weights trained on it to shops as if they were salon-specific.
- **Production:** train on Fullcut's own completed/no-show labels (pooled across shops, with shop-level base rate as a feature), once enough labelled bookings exist.
- **Cold start:** shops with little history use a transparent heuristic (e.g. first visit + long lead time + online source → medium) until the model has enough data. The response says which method produced the score.
- Synthetic data generators are fine for tests and demos, never for reported metrics.

### Evaluation (required before any model is used)
- **Time-based split** (train on older bookings, test on newer). Never a random split; it leaks the future.
- Baseline: the client's smoothed historical no-show rate. A model must beat it to ship.
- Report: ROC AUC, PR AUC, **precision and recall in the top 20% riskiest bookings**, Brier score, and a calibration plot.
- Slice metrics by shop size and first-visit vs. returning to catch uneven performance.
- Save metrics with the model version. A newly trained model is promoted only if it is not worse than the current one on the same holdout.

### Risk tiers and actions
Tiers come from the score with shop-configurable thresholds (defaults e.g. low < 0.15 ≤ medium < 0.35 ≤ high). Actions per tier are configured by the shop, e.g.:
- low → normal reminder
- medium → "reply YES to confirm" text 24 h before
- high → deposit request (if the shop enables it) and offer a standby spot to the waitlist

## 2. Scoring service contract

```
POST /score
request:  { booking_id, shop_id, features: {...} }        # features built by the shared module
response: { risk_score: 0.0–1.0 | null,
            tier: "low" | "medium" | "high" | "unknown",
            method: "model" | "heuristic",
            model_version: "2026-11-02-lgbm-3",
            top_factors: ["3 no-shows in last 6 visits", ...] }

GET /health
```

- The web app calls it with a ~300 ms timeout. On timeout or error the booking proceeds with `tier = "unknown"` and default handling.
- Store `risk_score` and `model_version` on the booking so results can be audited and compared later.
- Authenticate calls between the web app and the service (shared secret or signed token); the service is not public.

## 3. "Who's due" rebooking

For each client with at least 3 completed visits at the shop:
- Usual interval = median days between their visits (robust to one odd gap).
- Due when days since last visit > usual interval × 1.2 (configurable) **and** they have no future booking.
- Suggest 2–3 open slots that match their usual weekday and time of day.
- Sending the nudge is a **marketing** message: requires opt-in, respects quiet hours and frequency caps (see `fullcut-payments-and-messaging`).
- Measure it: rebooking rate within 14 days of a nudge vs. due clients not nudged (holdout group, if the owner agrees).

## 4. Learned service durations

- From completed bookings with staff-recorded start/finish, estimate per staff + service a robust typical duration (e.g. median, or 75th percentile to avoid overruns), with at least ~10 observations.
- Present suggestions to the owner ("Sam's skin fades take ~42 min, booked as 30"); nothing changes until the owner accepts.

## Tests that must exist

- Feature leakage test.
- Features identical between training and serving for the same input.
- Metrics regression test on a fixed holdout (fails if AUC drops beyond a tolerance).
- Serving: valid response shape, heuristic fallback when no model is loaded, fast failure on bad input.
- Due-list logic: interval calculation, future-booking exclusion, opt-in respected.
