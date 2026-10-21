"""Train and evaluate the no-show model on a time-based split.

    uv run python -m fullcut_ml.train [--csv PATH]

Writes artifacts/<version>/{model.joblib,metrics.json}, artifacts/current.txt, and copies the
metrics and calibration plot to docs/ml/ for the report.
"""

import argparse
import json
import shutil
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder, StandardScaler

from fullcut_ml.adapters.kaggle import load_kaggle_csv
from fullcut_ml.evaluate import calibration_table, compute_metrics, plot_calibration, slice_metrics
from fullcut_ml.features import (
    CATEGORICAL_FEATURES,
    FEATURE_NAMES,
    NUMERIC_FEATURES,
    build_feature_frame,
)
from fullcut_ml.model import PlattCalibrator, ScoringModel
from fullcut_ml.schema import BookingRecord

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parents[1]
DEFAULT_CSV = ML_ROOT / "data" / "raw" / "KaggleV2-May-2016.csv"
ARTIFACTS = ML_ROOT / "artifacts"
DOCS = REPO_ROOT / "docs" / "ml"

TEST_FRACTION = 0.2
CALIBRATION_FRACTION = 0.2
SEED = 42


@dataclass
class Dataset:
    frame: pd.DataFrame
    fit: np.ndarray
    calibration: np.ndarray
    test: np.ndarray
    shop_base_rate: float
    summary: dict


def _cutoff(starts_at: pd.Series, fraction: float) -> pd.Timestamp:
    """First appointment date of the newest `fraction` of rows (whole days stay together)."""
    days = starts_at.sort_values().reset_index(drop=True)
    return days.iloc[int(len(days) * (1 - fraction))]


def prepare_dataset(records: list[BookingRecord], extra_summary: dict | None = None) -> Dataset:
    labelled = [r for r in records if r.label is not None]
    starts = pd.Series(pd.to_datetime([r.starts_at for r in labelled], utc=True))
    test_cutoff = _cutoff(starts, TEST_FRACTION)
    cal_cutoff = _cutoff(starts[starts < test_cutoff], CALIBRATION_FRACTION)

    fit_labels = [r.label for r in labelled if pd.Timestamp(r.starts_at) < cal_cutoff]
    shop_base_rate = float(np.mean(fit_labels))
    # Each pooled shop gets its own base rate from the fit period; unseen shops get the pool's.
    by_shop: dict[str, list[int]] = {}
    for r in labelled:
        if pd.Timestamp(r.starts_at) < cal_cutoff and r.label is not None:
            by_shop.setdefault(r.shop_id, []).append(r.label)
    shop_rates = {shop: float(np.mean(labels)) for shop, labels in by_shop.items()}

    # History includes every record (also unlabelled ones) so late cancellations count.
    frame = build_feature_frame(
        records, shop_base_rate=lambda shop: shop_rates.get(shop, shop_base_rate)
    )
    frame = frame[frame["label"].notna()].reset_index(drop=True)
    frame["label"] = frame["label"].astype(int)
    starts_at = pd.to_datetime(frame["starts_at"], utc=True)
    test = (starts_at >= test_cutoff).to_numpy()
    calibration = ((starts_at >= cal_cutoff) & (starts_at < test_cutoff)).to_numpy()
    fit = (starts_at < cal_cutoff).to_numpy()

    def period(mask: np.ndarray) -> dict:
        s = starts_at[mask]
        return {
            "rows": int(mask.sum()),
            "from": s.min().date().isoformat(),
            "to": s.max().date().isoformat(),
            "no_show_rate": float(frame.loc[mask, "label"].mean()),
        }

    summary = {
        **(extra_summary or {}),
        "labelled_rows": len(frame),
        "clients": int(frame["client_id"].nunique()),
        "fit": period(fit),
        "calibration": period(calibration),
        "test": period(test),
    }
    return Dataset(frame, fit, calibration, test, shop_base_rate, summary)


def logistic_pipeline() -> Pipeline:
    numeric = Pipeline(
        [
            (
                "impute",
                SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True),
            ),
            ("log", FunctionTransformer(np.log1p, feature_names_out="one-to-one")),
            ("scale", StandardScaler()),
        ]
    )
    columns = ColumnTransformer(
        [
            ("num", numeric, NUMERIC_FEATURES),
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
        ]
    )
    return Pipeline([("features", columns), ("model", LogisticRegression(max_iter=2000))])


def lightgbm_model() -> LGBMClassifier:
    return LGBMClassifier(
        n_estimators=400,
        learning_rate=0.03,
        num_leaves=31,
        min_child_samples=200,
        subsample=0.8,
        subsample_freq=1,
        colsample_bytree=0.8,
        random_state=SEED,
        deterministic=True,
        force_row_wise=True,
        verbose=-1,
    )


def _next_version(kind: str) -> str:
    prefix = f"{date.today().isoformat()}-{kind}-"
    taken = [int(p.name.removeprefix(prefix)) for p in ARTIFACTS.glob(f"{prefix}*") if p.is_dir()]
    return f"{prefix}{max(taken, default=0) + 1}"


@dataclass
class Evaluation:
    results: dict[str, dict]
    curves: dict[str, list[dict[str, float]]]
    candidates: dict[str, ScoringModel]
    selected: str

    @property
    def model(self) -> ScoringModel:
        return self.candidates[self.selected]


def evaluation_slices(data: Dataset) -> dict[str, np.ndarray]:
    first_visit = data.frame["first_visit"].to_numpy().astype(bool)
    same_day = data.frame["same_day"].to_numpy().astype(bool)
    return {
        "first_visit": first_visit[data.test],
        "returning": ~first_visit[data.test],
        # Same-day bookings are rarely missed and dominate the clinic data; this slice shows
        # how much signal is left without them.
        "booked_ahead": ~same_day[data.test],
    }


def fit_and_evaluate(data: Dataset) -> Evaluation:
    """Baseline, logistic regression and LightGBM on the time split; one is picked on the
    calibration period."""
    frame = data.frame
    x = frame[FEATURE_NAMES]
    y = frame["label"].to_numpy()
    fit, cal, test = data.fit, data.calibration, data.test
    slices = evaluation_slices(data)

    results: dict[str, dict] = {}
    curves: dict[str, list[dict[str, float]]] = {}

    baseline = frame["smoothed_no_show_rate"].to_numpy()
    results["baseline"] = {
        "description": "client's smoothed historical no-show rate",
        "test": compute_metrics(y[test], baseline[test]),
        "test_slices": slice_metrics(y[test], baseline[test], slices),
    }
    curves["baseline"] = calibration_table(y[test], baseline[test])

    candidates: dict[str, ScoringModel] = {}
    for kind, estimator in (("logreg", logistic_pipeline()), ("lgbm", lightgbm_model())):
        estimator.fit(x[fit], y[fit])
        raw_cal = estimator.predict_proba(x[cal])[:, 1]
        calibrator = PlattCalibrator().fit(raw_cal, y[cal])
        model = ScoringModel(_next_version(kind), kind, estimator, calibrator, data.shop_base_rate)
        raw_test = model.predict_raw(x[test])
        scores = model.predict(x[test])
        results[kind] = {
            "version": model.version,
            "calibration_pr_auc": float(average_precision_score(y[cal], model.predict(x[cal]))),
            "test_uncalibrated": compute_metrics(y[test], raw_test),
            "test": compute_metrics(y[test], scores),
            "test_slices": slice_metrics(y[test], scores, slices),
        }
        curves[f"{kind} (raw)"] = calibration_table(y[test], raw_test)
        curves[f"{kind} (calibrated)"] = calibration_table(y[test], scores)
        candidates[kind] = model

    # Chosen on the calibration period so the test period stays untouched.
    selected = max(candidates, key=lambda k: results[k]["calibration_pr_auc"])
    return Evaluation(results, curves, candidates, selected)


def train(csv: Path) -> dict:
    loaded = load_kaggle_csv(csv)
    data = prepare_dataset(
        loaded.records,
        {
            "source": csv.name,
            "rows_read": loaded.rows_read,
            "dropped_scheduled_after_appointment": loaded.dropped_scheduled_after_appointment,
        },
    )
    evaluation = fit_and_evaluate(data)
    results, curves, selected = evaluation.results, evaluation.curves, evaluation.selected
    model = evaluation.model
    lgbm = evaluation.candidates["lgbm"].estimator
    importance = sorted(
        zip(FEATURE_NAMES, lgbm.booster_.feature_importance("gain").tolist(), strict=True),
        key=lambda item: -item[1],
    )

    metrics = {
        "version": model.version,
        "selected_model": selected,
        "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "shop_base_rate": data.shop_base_rate,
        "data": data.summary,
        "features": FEATURE_NAMES,
        "models": results,
        "lgbm_gain_importance": {name: round(gain, 1) for name, gain in importance},
        "calibration": curves,
    }

    out = ARTIFACTS / model.version
    model.save(out / "model.joblib")
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2))
    plot_calibration(
        {k: v for k, v in curves.items() if k == "baseline" or k.startswith(selected)},
        out / "calibration.png",
    )
    (ARTIFACTS / "current.txt").write_text(model.version)

    DOCS.mkdir(parents=True, exist_ok=True)
    shutil.copy(out / "metrics.json", DOCS / "noshow-prototype-metrics.json")
    shutil.copy(out / "calibration.png", DOCS / "noshow-calibration.png")
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    args = parser.parse_args()
    metrics = train(args.csv)
    print(f"saved {metrics['version']} (selected {metrics['selected_model']})")
    for name, result in metrics["models"].items():
        t = result["test"]
        print(
            f"{name:9s} roc_auc={t['roc_auc']:.3f} pr_auc={t['pr_auc']:.3f} brier={t['brier']:.4f} "
            f"top20 precision={t['top20_precision']:.3f} recall={t['top20_recall']:.3f}"
        )


if __name__ == "__main__":
    main()
