# Milestone 11 — No-show model prototype (offline)

**Goal:** prove the no-show prediction approach offline with real public data before wiring anything into the app: shared feature code, a proper time-based evaluation, a baseline to beat, calibration, fairness choices, and a written report you can show in interviews.

**Depends on:** none of the app milestones (can run in parallel with 09–10)
**Skills to read:** `fullcut-noshow-ml`

## Manual steps for the human
- Download the Kaggle "Medical Appointment No Shows" dataset (needs a Kaggle account) and place the CSV in `services/ml/data/raw/` (git-ignored). Agents can't download it for you.

## In scope
- `services/ml/` Python project scaffold
- Data loading, feature module, training, evaluation, report

## Out of scope
- Serving API and app integration (12)

## Tasks

### 11.1 Project scaffold
- `uv` project, Python 3.12, `ruff`, `pytest`, `pydantic`, `pandas`/`polars`, `scikit-learn`, `lightgbm`, `matplotlib`.
- Layout from the skill (`fullcut_ml/features.py`, `train.py`, `evaluate.py`, `notebooks/`, `tests/`).
- CI job: ruff + pytest for `services/ml`.
- `data/` git-ignored; never commit the dataset.

### 11.2 Exploration notebook
- Rows, date range, label balance, lead-time distribution, no-show rate by lead time, by weekday, by prior history.
- Document which columns exist and which Fullcut will have in production. Note the gap honestly (clinic vs salon).

### 11.3 Canonical booking schema + adapter
- Define a `BookingRecord` (pydantic) matching Fullcut's own data: `client_id`, `created_at`, `starts_at`, `status`, `source`, `price`, `duration`, `reminder_replied`, etc.
- Adapter maps the Kaggle CSV into `BookingRecord`s (patient → client, scheduled day → created_at, appointment day → starts_at). Features are built from `BookingRecord`s only, so the same code later runs on Fullcut data.

### 11.4 Features (`features.py`)
- From the skill: lead time, prior bookings, prior no-shows, smoothed no-show rate, days since last visit, first visit, weekday, hour (if available), reminder/SMS flag (the dataset has an SMS-received column).
- **Excluded on purpose:** age, gender, neighbourhood, and health-related flags in the dataset. Write why in the report (fairness rules + not available for salons).
- History features computed strictly from bookings that happened before the one being scored.

### 11.5 Training and evaluation
- Time-based split (e.g. last 20% of appointment dates as test).
- Models: baseline (smoothed historical rate), logistic regression, LightGBM.
- Metrics: ROC AUC, PR AUC, precision/recall in the top 20% riskiest, Brier score, calibration curve; slices for first-visit vs returning.
- Calibrate if needed (isotonic or Platt) and re-measure.
- Save the model artifact + metrics JSON with a version string.

### 11.6 Report (`docs/ml/noshow-prototype.md`)
- Problem, data, features (and excluded features with reasons), method, results table, calibration plot, what the top-20% number means in shop terms ("flagging 1 in 5 bookings catches X% of no-shows"), limitations, next steps.

## Tests
- Leakage test: features for a booking don't change when future bookings are added to the dataset.
- Adapter test on a tiny fixture CSV.
- Metrics code test on a hand-computed example.
- Regression test: saved model's AUC on the fixed test split stays within tolerance.

## Acceptance criteria
- `uv run python -m fullcut_ml.train` reproduces the results from a clean checkout (given the CSV).
- LightGBM or logistic regression beats the baseline on PR AUC, or the report explains honestly why not.
- The report is readable by a non-ML recruiter in 3 minutes.

## Agent prompt
```
Read .github/AGENTS.md, .github/milestones/11-ml-prototype.md and the
fullcut-noshow-ml skill. The dataset is in services/ml/data/raw/. Plan the
scaffold, BookingRecord schema and features first and wait for my OK. Then
implement, run training/evaluation, and write the report with the real numbers.
```
