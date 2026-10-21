"""Metrics, calibration and slice reports."""

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from sklearn.calibration import calibration_curve
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

TOP_FRACTION = 0.2


def top_fraction_precision_recall(
    y: np.ndarray, scores: np.ndarray, fraction: float = TOP_FRACTION
) -> tuple[float, float]:
    """Precision and recall when flagging the `fraction` riskiest bookings."""
    y = np.asarray(y)
    k = math.ceil(len(y) * fraction)
    top = y[np.argsort(-np.asarray(scores), kind="stable")[:k]]
    positives = y.sum()
    return float(top.mean()), float(top.sum() / positives) if positives else math.nan


def compute_metrics(y: np.ndarray, scores: np.ndarray) -> dict[str, float | int | None]:
    y = np.asarray(y)
    scores = np.asarray(scores)
    both_classes = 0 < y.sum() < len(y)
    precision, recall = top_fraction_precision_recall(y, scores)
    base_rate = float(y.mean())
    return {
        "n": len(y),
        "no_shows": int(y.sum()),
        "base_rate": base_rate,
        "roc_auc": float(roc_auc_score(y, scores)) if both_classes else None,
        "pr_auc": float(average_precision_score(y, scores)) if both_classes else None,
        "brier": float(brier_score_loss(y, scores)),
        "top20_precision": precision,
        "top20_recall": recall,
        "top20_lift": precision / base_rate if base_rate else None,
    }


def slice_metrics(
    y: np.ndarray, scores: np.ndarray, slices: dict[str, np.ndarray]
) -> dict[str, dict[str, float | int | None]]:
    y = np.asarray(y)
    scores = np.asarray(scores)
    masks = {name: np.asarray(m).astype(bool) for name, m in slices.items()}
    # An empty slice (e.g. no same-day bookings at all) has nothing to report.
    return {name: compute_metrics(y[m], scores[m]) for name, m in masks.items() if m.any()}


def calibration_table(
    y: np.ndarray, scores: np.ndarray, n_bins: int = 10
) -> list[dict[str, float]]:
    observed, predicted = calibration_curve(y, scores, n_bins=n_bins, strategy="quantile")
    return [
        {"predicted": float(p), "observed": float(o)}
        for p, o in zip(predicted, observed, strict=True)
    ]


def plot_calibration(curves: dict[str, list[dict[str, float]]], path: Path) -> None:
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.plot([0, 1], [0, 1], linestyle="--", color="grey", label="perfect")
    for name, table in curves.items():
        ax.plot(
            [b["predicted"] for b in table], [b["observed"] for b in table], marker="o", label=name
        )
    upper = max(0.6, *(b["predicted"] for t in curves.values() for b in t))
    ax.set_xlim(0, upper)
    ax.set_ylim(0, upper)
    ax.set_xlabel("Predicted no-show probability")
    ax.set_ylabel("Observed no-show rate")
    ax.set_title("Calibration on the test period")
    ax.legend()
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=120)
    plt.close(fig)
