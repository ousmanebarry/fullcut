"""Retrain on Fullcut's own bookings and promote only a model that is not worse.

    uv run python -m fullcut_ml.retrain --csv bookings.csv

The CSV comes from sql/export_training_bookings.sql (demo shops excluded, never synthetic data).
Bookings released for not confirming are neither shows nor no-shows: they are left out of the labels
and counted, so the selection effect on later training data stays visible. Every run is appended to
artifacts/runs.jsonl, promoted or not.
"""

import argparse
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss

from fullcut_ml.features import FEATURE_NAMES
from fullcut_ml.model import ScoringModel
from fullcut_ml.schema import BookingRecord
from fullcut_ml.train import ARTIFACTS, fit_and_evaluate, prepare_dataset

MIN_LABELLED = 500
# "Not worse" allows for noise between runs on the same holdout.
PR_AUC_TOLERANCE = 0.005
BRIER_TOLERANCE = 0.002

EXPORT_COLUMNS = [
    "booking_id",
    "shop_id",
    "client_id",
    "created_at",
    "starts_at",
    "ends_at",
    "status",
    "source",
    "price_cents",
    "cancelled_at",
    "client_confirmed_at",
    "confirmation_status",
    "release_reason",
    "risk_tier",
    "shop_timezone",
]
SOURCES = {"phone", "walk_in", "import", "demo"}


@dataclass(frozen=True)
class Export:
    records: list[BookingRecord]
    released: int
    released_high_risk: int


def _ts(value: object) -> datetime | None:
    if value is None or (isinstance(value, float) and pd.isna(value)) or value == "":
        return None
    return pd.Timestamp(value).tz_convert(UTC).to_pydatetime()


def load_export(path: Path | str) -> Export:
    df = pd.read_csv(path, usecols=EXPORT_COLUMNS, dtype=str, keep_default_na=False)
    records: list[BookingRecord] = []
    released = released_high = 0
    for row in df.itertuples(index=False):
        is_released = row.status == "cancelled" and row.release_reason != ""
        if is_released:
            released += 1
            released_high += row.risk_tier == "high"
        starts_at = _ts(row.starts_at)
        ends_at = _ts(row.ends_at)
        records.append(
            BookingRecord(
                booking_id=row.booking_id,
                shop_id=row.shop_id,
                client_id=row.client_id,
                created_at=_ts(row.created_at),
                starts_at=starts_at,
                status="released" if is_released else row.status,
                shop_timezone=row.shop_timezone,
                duration_minutes=max(0, round((ends_at - starts_at).total_seconds() / 60)),
                price_cents=int(row.price_cents),
                source=row.source if row.source in SOURCES else "direct",
                cancelled_at=_ts(row.cancelled_at),
                confirm_requested=row.confirmation_status != "not_required",
                reminder_replied=row.client_confirmed_at != "",
            )
        )
    return Export(records, released, released_high)


def _current_model() -> ScoringModel | None:
    pointer = ARTIFACTS / "current.txt"
    if not pointer.exists():
        return None
    path = ARTIFACTS / pointer.read_text().strip() / "model.joblib"
    return ScoringModel.load(path) if path.exists() else None


def should_promote(candidate: dict, current: dict | None) -> tuple[bool, str]:
    """The skill's rule: promote only if not worse than the current model on the same holdout."""
    if current is None:
        return True, "no current model"
    if candidate["pr_auc"] < current["pr_auc"] - PR_AUC_TOLERANCE:
        return False, "lower PR AUC than the current model"
    if candidate["brier"] > current["brier"] + BRIER_TOLERANCE:
        return False, "worse calibration (Brier) than the current model"
    return True, "not worse than the current model"


def retrain(csv: Path, min_labelled: int = MIN_LABELLED) -> dict:
    export = load_export(csv)
    labelled = sum(r.label is not None for r in export.records)
    run: dict = {
        "run_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": csv.name,
        "bookings": len(export.records),
        "labelled": labelled,
        "released": export.released,
        "released_high_risk": export.released_high_risk,
    }

    if labelled < min_labelled:
        run.update(
            promoted=False, reason=f"only {labelled} labelled bookings (need {min_labelled})"
        )
        return _log(run)

    data = prepare_dataset(export.records, {"source": csv.name})
    evaluation = fit_and_evaluate(data)
    candidate = evaluation.model
    test = data.frame[data.test]
    y = test["label"].to_numpy()

    def holdout(model: ScoringModel) -> dict:
        scores = model.predict(test[FEATURE_NAMES])
        return {
            "pr_auc": float(average_precision_score(y, scores)),
            "brier": float(brier_score_loss(y, scores)),
        }

    candidate_metrics = holdout(candidate)
    baseline = evaluation.results["baseline"]["test"]
    current = _current_model()
    current_metrics = holdout(current) if current else None
    promoted, reason = should_promote(candidate_metrics, current_metrics)
    if promoted and candidate_metrics["pr_auc"] <= (baseline["pr_auc"] or 0):
        promoted, reason = False, "does not beat the smoothed-history baseline"

    out = ARTIFACTS / candidate.version
    candidate.save(out / "model.joblib")
    (out / "metrics.json").write_text(
        json.dumps({"data": data.summary, "models": evaluation.results}, indent=2)
    )
    if promoted:
        (ARTIFACTS / "current.txt").write_text(candidate.version)

    run.update(
        candidate=candidate.version,
        current=current.version if current else None,
        holdout={"candidate": candidate_metrics, "current": current_metrics, "baseline": baseline},
        promoted=promoted,
        reason=reason,
    )
    return _log(run)


def _log(run: dict) -> dict:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with (ARTIFACTS / "runs.jsonl").open("a", encoding="utf-8") as log:
        log.write(json.dumps(run) + "\n")
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--min-labelled", type=int, default=MIN_LABELLED)
    args = parser.parse_args()
    run = retrain(args.csv, args.min_labelled)
    print(json.dumps(run, indent=2))


if __name__ == "__main__":
    main()
